import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErrandClient } from "./errand-client.js";

function mockJsonRpcResponse(text: string, isError = false) {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text }],
      isError,
    },
  };
}

describe("ErrandClient", () => {
  let client: ErrandClient;

  beforeEach(() => {
    client = new ErrandClient("https://errand.test", "test-api-key");
    vi.restoreAllMocks();
  });

  describe("callTool", () => {
    it("sends correct JSON-RPC request and parses response", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse("hello")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const result = await client.callTool("some_tool", { key: "value" });

      expect(result).toBe("hello");
      expect(fetchSpy).toHaveBeenCalledOnce();

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://errand.test/mcp/");
      expect(options?.method).toBe("POST");
      expect(options?.headers).toEqual(
        expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
        }),
      );

      const body = JSON.parse(options?.body as string);
      expect(body.jsonrpc).toBe("2.0");
      expect(body.method).toBe("tools/call");
      expect(body.params).toEqual({ name: "some_tool", arguments: { key: "value" } });
    });

    it("throws on HTTP error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
      );
      await expect(client.callTool("some_tool")).rejects.toThrow("MCP request failed: 401");
    });

    it("throws on JSON-RPC error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32600, message: "Invalid request" },
          }),
          { status: 200 },
        ),
      );
      await expect(client.callTool("some_tool")).rejects.toThrow("MCP error: Invalid request");
    });

    it("throws on tool error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse("Something went wrong", true)), {
          status: 200,
        }),
      );
      await expect(client.callTool("some_tool")).rejects.toThrow("Tool error: Something went wrong");
    });
  });

  describe("newTask", () => {
    it("returns task UUID from MCP response", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse(uuid)), { status: 200 }),
      );

      const result = await client.newTask("do something");
      expect(result).toBe(uuid);
    });

    it("passes profile when provided", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse("task-id")), { status: 200 }),
      );

      await client.newTask("do something", "my-profile");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.params.arguments).toEqual({
        description: "do something",
        profile: "my-profile",
      });
    });
  });

  describe("taskStatus", () => {
    it("parses JSON status response", async () => {
      const statusData = { id: "task-1", status: "completed", description: "test" };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse(JSON.stringify(statusData))), {
          status: 200,
        }),
      );

      const result = await client.taskStatus("task-1");
      expect(result).toEqual(statusData);
    });

    it("sends format=json argument", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify(mockJsonRpcResponse(JSON.stringify({ id: "t", status: "running" }))),
          { status: 200 },
        ),
      );

      await client.taskStatus("task-1");
      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.params.arguments).toEqual({ task_id: "task-1", format: "json" });
    });
  });

  describe("taskOutput", () => {
    it("returns output text from task_output tool", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse("Here is the task output")), {
          status: 200,
        }),
      );

      const result = await client.taskOutput("task-1");
      expect(result).toBe("Here is the task output");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.params.arguments).toEqual({ task_id: "task-1" });
    });
  });

  describe("taskLogs", () => {
    it("returns log text from task_logs tool", async () => {
      const logs = '{"type": "agent_start", "data": {"agent": "TaskRunner"}}\n{"type": "agent_end", "data": {}}';
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse(logs)), { status: 200 }),
      );

      const result = await client.taskLogs("task-1");
      expect(result).toBe(logs);

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.params.arguments).toEqual({ task_id: "task-1" });
    });
  });

  describe("listTaskProfiles", () => {
    it("returns profile array", async () => {
      const profiles = [
        { name: "default", description: "Default profile" },
        { name: "fast", description: "Fast profile" },
      ];
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse(JSON.stringify(profiles))), {
          status: 200,
        }),
      );

      const result = await client.listTaskProfiles();
      expect(result).toEqual(profiles);
    });
  });

  describe("listSkills", () => {
    it("returns skill array", async () => {
      const skills = [
        { name: "paperclip-inbox", description: "Inbox skill" },
        { name: "web-search", description: "Web search" },
      ];
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse(JSON.stringify(skills))), { status: 200 }),
      );

      const result = await client.listSkills();
      expect(result).toEqual(skills);
    });
  });

  describe("upsertSkill", () => {
    it("calls upsert_skill with name, description, instructions, and files", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse("Skill created")), { status: 200 }),
      );

      await client.upsertSkill("my-skill", "A skill", "Do things", [
        { path: "ref.md", content: "reference" },
      ]);

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.params.arguments).toEqual({
        name: "my-skill",
        description: "A skill",
        instructions: "Do things",
        files: [{ path: "ref.md", content: "reference" }],
      });
    });

    it("omits files when not provided", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse("Skill created")), { status: 200 }),
      );

      await client.upsertSkill("my-skill", "A skill", "Do things");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.params.arguments).toEqual({
        name: "my-skill",
        description: "A skill",
        instructions: "Do things",
      });
    });
  });

  describe("deleteSkill", () => {
    it("calls delete_skill with name", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(mockJsonRpcResponse("Skill deleted")), { status: 200 }),
      );

      await client.deleteSkill("my-skill");

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body.params.arguments).toEqual({ name: "my-skill" });
    });
  });
});
