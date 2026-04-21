import type {
  ServerAdapterModule,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterModel,
  AdapterConfigSchema,
} from "@paperclipai/adapter-utils";
import { renderPaperclipWakePrompt } from "@paperclipai/adapter-utils/server-utils";
import { readFile } from "node:fs/promises";
import { ErrandClient } from "./errand-client.js";

const TERMINAL_STATES = new Set(["completed", "review", "deleted", "failed"]);
const DEFAULT_TIMEOUT_SEC = 600;
const DEFAULT_POLL_INTERVAL_MS = 3000;

interface AdapterConfig {
  url: string;
  apiKey: string;
  model?: string;
  timeoutSec?: number;
  pollIntervalMs?: number;
}

function extractConfig(ctx: AdapterExecutionContext): AdapterConfig {
  const config = ctx.config as Record<string, unknown>;
  const schemaValues = config.adapterSchemaValues as Record<string, unknown> | undefined;
  return {
    url: (schemaValues?.url ?? config.url) as string,
    apiKey: (schemaValues?.apiKey ?? config.apiKey) as string,
    model: (config.model ?? schemaValues?.model) as string | undefined,
    timeoutSec: (schemaValues?.timeoutSec ?? config.timeoutSec ?? DEFAULT_TIMEOUT_SEC) as number,
    pollIntervalMs: (config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS) as number,
  };
}

const DEFAULT_PROMPT_TEMPLATE =
  "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.";

async function buildPrompt(
  ctx: AdapterExecutionContext,
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>,
): Promise<string> {
  const config = ctx.config as Record<string, unknown>;
  const context = ctx.context as Record<string, unknown>;

  const sections: string[] = [];

  // 1. Read instructions file (AGENT.md bundle managed by Paperclip)
  const instructionsFilePath = ((config.instructionsFilePath as string) ?? "").trim();
  if (instructionsFilePath) {
    try {
      const instructions = await readFile(instructionsFilePath, "utf-8");
      if (instructions.trim()) {
        sections.push(`--- Agent Instructions ---\n${instructions.trim()}`);
      }
    } catch (err) {
      await onLog("stderr", `[errand-adapter] Warning: could not read instructions file "${instructionsFilePath}": ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  // 2. Render prompt template (default provided if not configured)
  const promptTemplate = ((config.promptTemplate as string) ?? "").trim() || DEFAULT_PROMPT_TEMPLATE;
  const renderedTemplate = promptTemplate
    .replace(/\{\{agent\.id\}\}/g, ctx.agent.id)
    .replace(/\{\{agent\.name\}\}/g, ctx.agent.name);
  sections.push(renderedTemplate);

  // 3. Append wake prompt from Paperclip wake payload (issue, comments, etc.)
  const wakePrompt = renderPaperclipWakePrompt(context.paperclipWake);
  if (wakePrompt) {
    sections.push(wakePrompt);
  }

  return sections.join("\n\n") || "Begin your work cycle.";
}

function parseAndForwardEvent(
  raw: string,
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>,
  streamedLines: Set<string>,
): void {
  try {
    const parsed = JSON.parse(raw);
    // Check for end sentinel
    if (parsed.event === "task_log_end") return;

    // Extract inner event from {"event": "task_event", "type": "...", "data": {...}}
    if (parsed.event === "task_event" && parsed.type) {
      const inner = JSON.stringify({ type: parsed.type, data: parsed.data });
      if (!streamedLines.has(inner)) {
        streamedLines.add(inner);
        void onLog("stdout", inner + "\n");
      }
      return;
    }

    // If it's already in {"type": "...", "data": {...}} format (from task_logs)
    if (parsed.type && parsed.data !== undefined) {
      const line = JSON.stringify(parsed);
      if (!streamedLines.has(line)) {
        streamedLines.add(line);
        void onLog("stdout", line + "\n");
      }
      return;
    }
  } catch {
    // Not JSON — forward as stderr
  }
  void onLog("stderr", raw + "\n");
}

async function streamLogs(
  url: string,
  taskId: string,
  apiKey: string,
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>,
  signal: AbortSignal,
  streamedLines: Set<string>,
): Promise<void> {
  try {
    const response = await fetch(
      `${url}/api/tasks/${taskId}/logs/stream?token=${encodeURIComponent(apiKey)}`,
      { signal },
    );
    if (!response.ok || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventData: string[] = [];

    const flushEvent = (): void => {
      if (eventData.length === 0) return;
      const raw = eventData.join("\n");
      eventData = [];
      parseAndForwardEvent(raw, onLog, streamedLines);
    };

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let lineStart = 0;
      while (true) {
        const lineEnd = buffer.indexOf("\n", lineStart);
        if (lineEnd === -1) {
          buffer = buffer.slice(lineStart);
          break;
        }

        let line = buffer.slice(lineStart, lineEnd);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        lineStart = lineEnd + 1;

        if (line === "") {
          flushEvent();
          continue;
        }

        if (line.startsWith(":")) continue;

        if (line.startsWith("data:")) {
          eventData.push(line.startsWith("data: ") ? line.slice(6) : line.slice(5));
        }
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0 && !buffer.startsWith(":") && buffer.startsWith("data:")) {
      eventData.push(buffer.startsWith("data: ") ? buffer.slice(6) : buffer.slice(5));
    }
    flushEvent();
  } catch {
    // SSE connection failed — degraded but functional
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function execute(
  ctx: AdapterExecutionContext,
  getClient: (url: string, apiKey: string) => ErrandClient,
): Promise<AdapterExecutionResult> {
  const config = extractConfig(ctx);

  if (!config.url) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "Errand URL is not configured",
    };
  }

  if (!config.apiKey) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "API key is not configured",
    };
  }

  const client = getClient(config.url, config.apiKey);
  const prompt = await buildPrompt(ctx, ctx.onLog);

  let taskId: string;
  try {
    const taskTitle = `${ctx.agent.name}-${ctx.runId}`;
    taskId = await client.newTask(prompt, config.model, taskTitle);
  } catch (err) {
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: `Failed to create task: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const streamedLines = new Set<string>();
  const abortController = new AbortController();
  const logPromise = streamLogs(config.url, taskId, config.apiKey, ctx.onLog, abortController.signal, streamedLines);

  const deadline = Date.now() + (config.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000;

  try {
    while (Date.now() < deadline) {
      await sleep(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);

      let status;
      try {
        status = await client.taskStatus(taskId);
      } catch {
        continue; // transient failure, keep polling
      }

      if (!TERMINAL_STATES.has(status.status)) continue;

      // Stop SSE stream and backfill any missed events from task_logs
      abortController.abort();
      await logPromise.catch(() => {});
      try {
        const logs = await client.taskLogs(taskId);
        for (const line of logs.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) {
            parseAndForwardEvent(trimmed, ctx.onLog, streamedLines);
          }
        }
      } catch {
        // Log backfill failed — non-fatal
      }

      if (status.status === "completed") {
        let output = "";
        try {
          output = await client.taskOutput(taskId);
        } catch {
          // output retrieval failed
        }
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          summary: output || undefined,
        };
      }

      if (status.status === "review") {
        return {
          exitCode: 0,
          signal: null,
          timedOut: false,
          question: {
            prompt: "The errand task requires review before proceeding.",
            choices: [
              { key: "approve", label: "Approve", description: "Approve and continue the task" },
              { key: "reject", label: "Reject", description: "Reject and stop the task" },
            ],
          },
        };
      }

      // deleted or failed
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        errorMessage: `Task ended with status: ${status.status}`,
      };
    }

    // timeout
    return {
      exitCode: null,
      signal: null,
      timedOut: true,
      errorMessage: `Task timed out after ${config.timeoutSec}s`,
    };
  } finally {
    abortController.abort();
    await logPromise.catch(() => {});
  }
}

async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
  getClient: (url: string, apiKey: string) => ErrandClient,
): Promise<AdapterEnvironmentTestResult> {
  const config = ctx.config as Record<string, unknown>;
  const schemaValues = config.adapterSchemaValues as Record<string, unknown> | undefined;
  const url = (schemaValues?.url ?? config.url) as string;
  const apiKey = (schemaValues?.apiKey ?? config.apiKey) as string;

  const checks: AdapterEnvironmentTestResult["checks"] = [];

  if (!url) {
    checks.push({
      code: "url_missing",
      level: "error",
      message: "Errand URL is not configured",
      hint: "Set the errand instance URL in the adapter configuration",
    });
    return { adapterType: "errand", status: "fail", checks, testedAt: new Date().toISOString() };
  }

  if (!apiKey) {
    checks.push({
      code: "api_key_missing",
      level: "error",
      message: "API key is not configured",
      hint: "Set the MCP API key in the adapter configuration",
    });
    return { adapterType: "errand", status: "fail", checks, testedAt: new Date().toISOString() };
  }

  const client = getClient(url, apiKey);
  try {
    const profiles = await client.listTaskProfiles();
    checks.push({
      code: "connection_ok",
      level: "info",
      message: `Connected to errand instance (${profiles.length} profiles available)`,
    });
    return { adapterType: "errand", status: "pass", checks, testedAt: new Date().toISOString() };
  } catch (err) {
    checks.push({
      code: "connection_failed",
      level: "error",
      message: `Failed to connect to errand: ${err instanceof Error ? err.message : String(err)}`,
      hint: "Check that the URL and API key are correct and the errand instance is reachable",
    });
    return { adapterType: "errand", status: "fail", checks, testedAt: new Date().toISOString() };
  }
}

function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "url",
        label: "Errand URL",
        type: "text",
        required: true,
        hint: "The URL of the errand instance (e.g. https://errand.example.com)",
      },
      {
        key: "apiKey",
        label: "API Key",
        type: "text",
        required: true,
        hint: "MCP API key for authentication",
      },
      {
        key: "timeoutSec",
        label: "Timeout (seconds)",
        type: "number",
        default: 600,
        hint: "Maximum execution time in seconds",
      },
    ],
  };
}

export const agentConfigurationDoc = `## Errand Adapter Configuration

| Field | Description |
|-------|-------------|
| **Errand URL** | The base URL of your errand instance (e.g. \`https://errand.example.com\`) |
| **API Key** | MCP API key for authenticating with the errand instance |
| **Timeout** | Maximum time in seconds to wait for task completion (default: 600) |

### Model Selection

The model dropdown lists errand task profiles. Each profile bundles a model, system prompt, max turns, and tool configuration. Select the profile that matches your use case.
`;

export function createServerAdapter(): ServerAdapterModule {
  let cachedClient: ErrandClient | null = null;
  let cachedUrl = "";
  let cachedApiKey = "";

  function getClient(url: string, apiKey: string): ErrandClient {
    if (cachedClient && cachedUrl === url && cachedApiKey === apiKey) {
      return cachedClient;
    }
    cachedClient = new ErrandClient(url, apiKey);
    cachedUrl = url;
    cachedApiKey = apiKey;
    return cachedClient;
  }

  return {
    type: "errand",
    execute: (ctx: AdapterExecutionContext) => execute(ctx, getClient),
    testEnvironment: (ctx: AdapterEnvironmentTestContext) => testEnvironment(ctx, getClient),
    agentConfigurationDoc,
    getConfigSchema,
    supportsLocalAgentJwt: true,
    supportsInstructionsBundle: true,
    instructionsPathKey: "instructionsFilePath",

    async listModels(): Promise<AdapterModel[]> {
      if (!cachedClient) return [];
      try {
        const profiles = await cachedClient.listTaskProfiles();
        return profiles.map((p) => ({ id: p.name, label: p.name }));
      } catch {
        return [];
      }
    },
  };
}
