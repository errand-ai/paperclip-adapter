import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { createServerAdapter } from "./adapter.js";
import type {
  AdapterExecutionContext,
  AdapterEnvironmentTestContext,
} from "@paperclipai/adapter-utils";

function mockJsonRpcResponse(text: string) {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }] },
  };
}

function makeExecutionContext(overrides: Partial<AdapterExecutionContext> = {}): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: { id: "agent-1", companyId: "co-1", name: "test-agent", adapterType: "errand", adapterConfig: {} },
    runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
    config: {
      adapterSchemaValues: { url: "https://errand.test", apiKey: "test-key", timeoutSec: 5 },
      model: "default-profile",
      pollIntervalMs: 50,
    },
    context: { prompt: "Do the thing" },
    onLog: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeTestEnvContext(config: Record<string, unknown> = {}): AdapterEnvironmentTestContext {
  return {
    companyId: "co-1",
    adapterType: "errand",
    config: {
      adapterSchemaValues: {
        url: "https://errand.test",
        apiKey: "test-key",
        ...config,
      },
    },
  };
}

describe("Adapter Module", () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  describe("createServerAdapter", () => {
    it("returns valid ServerAdapterModule with type errand", () => {
      const adapter = createServerAdapter();
      expect(adapter.type).toBe("errand");
      expect(typeof adapter.execute).toBe("function");
      expect(typeof adapter.testEnvironment).toBe("function");
      expect(typeof adapter.listModels).toBe("function");
      expect(typeof adapter.getConfigSchema).toBe("function");
      expect(typeof adapter.agentConfigurationDoc).toBe("string");
    });
  });

  describe("execute", () => {
    it("creates task, polls to completion, returns result with output", async () => {
      const taskId = "task-uuid-123";
      let callCount = 0;

      fetchMock.mockImplementation(async (url: string) => {
        // SSE log stream — return empty
        if (typeof url === "string" && url.includes("/logs/stream")) {
          return new Response("", { status: 200 });
        }

        callCount++;
        // 1st call: new_task
        if (callCount === 1) {
          return new Response(JSON.stringify(mockJsonRpcResponse(taskId)), { status: 200 });
        }
        // 2nd call: task_status (still running)
        if (callCount === 2) {
          return new Response(
            JSON.stringify(mockJsonRpcResponse(JSON.stringify({ id: taskId, status: "running" }))),
            { status: 200 },
          );
        }
        // 3rd call: task_status (completed)
        if (callCount === 3) {
          return new Response(
            JSON.stringify(mockJsonRpcResponse(JSON.stringify({ id: taskId, status: "completed" }))),
            { status: 200 },
          );
        }
        // 4th call: task_output
        return new Response(
          JSON.stringify(mockJsonRpcResponse("Task completed successfully")),
          { status: 200 },
        );
      });

      const adapter = createServerAdapter();
      const ctx = makeExecutionContext();
      const result = await adapter.execute(ctx);

      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.summary).toBe("Task completed successfully");
    });

    it("returns timeout result when timeoutSec exceeded", async () => {
      const taskId = "task-uuid-timeout";
      let callCount = 0;

      fetchMock.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("/logs/stream")) {
          return new Response("", { status: 200 });
        }
        callCount++;
        if (callCount === 1) {
          return new Response(JSON.stringify(mockJsonRpcResponse(taskId)), { status: 200 });
        }
        // Always return running
        return new Response(
          JSON.stringify(mockJsonRpcResponse(JSON.stringify({ id: taskId, status: "running" }))),
          { status: 200 },
        );
      });

      const adapter = createServerAdapter();
      const ctx = makeExecutionContext({
        config: {
          adapterSchemaValues: { url: "https://errand.test", apiKey: "test-key", timeoutSec: 0.1 },
          pollIntervalMs: 30,
        },
      });
      const result = await adapter.execute(ctx);

      expect(result.timedOut).toBe(true);
    });

    it("returns question for review status", async () => {
      const taskId = "task-uuid-review";
      let callCount = 0;

      fetchMock.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("/logs/stream")) {
          return new Response("", { status: 200 });
        }
        callCount++;
        if (callCount === 1) {
          return new Response(JSON.stringify(mockJsonRpcResponse(taskId)), { status: 200 });
        }
        // Return review status
        return new Response(
          JSON.stringify(mockJsonRpcResponse(JSON.stringify({ id: taskId, status: "review" }))),
          { status: 200 },
        );
      });

      const adapter = createServerAdapter();
      const ctx = makeExecutionContext();
      const result = await adapter.execute(ctx);

      expect(result.exitCode).toBe(0);
      expect(result.question).toBeDefined();
      expect(result.question?.choices).toHaveLength(2);
      expect(result.question?.choices[0].key).toBe("approve");
    });

    it("returns error when task creation fails", async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("/logs/stream")) {
          return new Response("", { status: 200 });
        }
        return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
      });

      const adapter = createServerAdapter();
      const ctx = makeExecutionContext();
      const result = await adapter.execute(ctx);

      expect(result.exitCode).toBe(1);
      expect(result.errorMessage).toContain("Failed to create task");
    });

    it("returns error when URL is missing", async () => {
      const adapter = createServerAdapter();
      const ctx = makeExecutionContext({
        config: { adapterSchemaValues: { url: "", apiKey: "key" } },
      });
      const result = await adapter.execute(ctx);

      expect(result.exitCode).toBe(1);
      expect(result.errorMessage).toBe("Errand URL is not configured");
    });

    it("returns error when API key is missing", async () => {
      const adapter = createServerAdapter();
      const ctx = makeExecutionContext({
        config: { adapterSchemaValues: { url: "https://errand.test", apiKey: "" } },
      });
      const result = await adapter.execute(ctx);

      expect(result.exitCode).toBe(1);
      expect(result.errorMessage).toBe("API key is not configured");
    });
  });

  describe("testEnvironment", () => {
    it("returns pass for valid connection", async () => {
      const profiles = [{ name: "default" }];
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse(JSON.stringify(profiles))), { status: 200 }),
      );

      const adapter = createServerAdapter();
      const result = await adapter.testEnvironment(makeTestEnvContext());

      expect(result.status).toBe("pass");
      expect(result.adapterType).toBe("errand");
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].code).toBe("connection_ok");
    });

    it("returns fail for invalid API key", async () => {
      fetchMock.mockResolvedValue(
        new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
      );

      const adapter = createServerAdapter();
      const result = await adapter.testEnvironment(makeTestEnvContext());

      expect(result.status).toBe("fail");
      expect(result.checks[0].code).toBe("connection_failed");
    });

    it("returns fail when URL is missing", async () => {
      const adapter = createServerAdapter();
      const result = await adapter.testEnvironment(
        makeTestEnvContext({ url: "", apiKey: "key" }),
      );

      expect(result.status).toBe("fail");
      expect(result.checks[0].code).toBe("url_missing");
    });

    it("returns fail when API key is missing", async () => {
      const adapter = createServerAdapter();
      const result = await adapter.testEnvironment(
        makeTestEnvContext({ url: "https://errand.test", apiKey: "" }),
      );

      expect(result.status).toBe("fail");
      expect(result.checks[0].code).toBe("api_key_missing");
    });
  });

  describe("listModels", () => {
    it("maps profiles to AdapterModel format after testEnvironment populates client", async () => {
      const profiles = [{ name: "default" }, { name: "fast" }];
      const profileResponse = () =>
        new Response(JSON.stringify(mockJsonRpcResponse(JSON.stringify(profiles))), { status: 200 });
      fetchMock.mockImplementation(async () => profileResponse());

      const adapter = createServerAdapter();
      // testEnvironment populates the cached client
      await adapter.testEnvironment(makeTestEnvContext());

      const result = await adapter.listModels!();
      expect(result).toEqual([
        { id: "default", label: "default" },
        { id: "fast", label: "fast" },
      ]);
    });

    it("returns empty array when errand is unreachable", async () => {
      const profiles = [{ name: "default" }];
      // First call succeeds (testEnvironment)
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(mockJsonRpcResponse(JSON.stringify(profiles))), { status: 200 }),
      );

      const adapter = createServerAdapter();
      await adapter.testEnvironment(makeTestEnvContext());

      // Subsequent calls fail (errand unreachable)
      fetchMock.mockRejectedValue(new Error("Network error"));

      const result = await adapter.listModels!();
      expect(result).toEqual([]);
    });

    it("returns empty array when no client configured", async () => {
      const adapter = createServerAdapter();
      const result = await adapter.listModels!();
      expect(result).toEqual([]);
    });
  });

  describe("getConfigSchema", () => {
    it("returns expected field definitions", () => {
      const adapter = createServerAdapter();
      const schema = adapter.getConfigSchema!() as Awaited<ReturnType<NonNullable<typeof adapter.getConfigSchema>>>;

      expect(schema.fields).toHaveLength(3);
      const keys = schema.fields.map((f) => f.key);
      expect(keys).toContain("url");
      expect(keys).toContain("apiKey");
      expect(keys).toContain("timeoutSec");

      const urlField = schema.fields.find((f) => f.key === "url")!;
      expect(urlField.type).toBe("text");
      expect(urlField.required).toBe(true);

      const timeoutField = schema.fields.find((f) => f.key === "timeoutSec")!;
      expect(timeoutField.type).toBe("number");
      expect(timeoutField.default).toBe(600);
    });
  });
});
