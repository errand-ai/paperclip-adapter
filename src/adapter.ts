import type {
  ServerAdapterModule,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterModel,
  AdapterConfigSchema,
  AdapterSkillContext,
  AdapterSkillSnapshot,
  AdapterSkillEntry,
} from "@paperclipai/adapter-utils";
import { renderPaperclipWakePrompt, normalizePaperclipWakePayload, resolvePaperclipDesiredSkillNames } from "@paperclipai/adapter-utils/server-utils";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
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
    url: ((schemaValues?.url ?? config.url) as string ?? "").replace(/\/+$/, ""),
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

/**
 * Derive a human-friendly task title from Paperclip context.
 * Priority: issue identifier → runtime taskKey → wake reason → runId.
 */
export function buildTaskTitle(ctx: AdapterExecutionContext): string {
  const context = ctx.context as Record<string, unknown>;
  const wake = normalizePaperclipWakePayload(context.paperclipWake);

  const suffix =
    wake?.issue?.identifier?.trim() ||
    ctx.runtime.taskKey?.trim() ||
    wake?.reason?.trim() ||
    ctx.runId;

  return `${ctx.agent.name}-${suffix}`;
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

  // Build environment variables for the errand task-runner container
  const taskEnv: Record<string, string> = {
    PAPERCLIP_AGENT_ID: ctx.agent.id,
    PAPERCLIP_COMPANY_ID: ctx.agent.companyId,
    PAPERCLIP_RUN_ID: ctx.runId,
  };
  if (ctx.authToken) {
    taskEnv.PAPERCLIP_API_KEY = ctx.authToken;
  }
  const paperclipApiUrl = process.env.PAPERCLIP_API_URL ?? `http://localhost:3100`;
  taskEnv.PAPERCLIP_API_URL = paperclipApiUrl;

  // Report invocation metadata for the Paperclip run log
  if (ctx.onMeta) {
    try {
      await ctx.onMeta({
        adapterType: "errand",
        command: `${config.url}/mcp/`,
        commandArgs: ["new_task", ...(config.model ? [`profile=${config.model}`] : [])],
        commandNotes: [`env keys: ${Object.keys(taskEnv).join(", ")}`],
        prompt,
        context: ctx.context as Record<string, unknown>,
      });
    } catch {
      // Non-fatal — metadata is informational
    }
  }

  let taskId: string;
  try {
    const taskTitle = buildTaskTitle(ctx);
    try {
      // Try with env parameter (requires errand paperclip-integration-api changes)
      taskId = await client.newTask(prompt, config.model, taskTitle, taskEnv);
    } catch {
      // Fall back without env if errand doesn't support it yet
      taskId = await client.newTask(prompt, config.model, taskTitle);
    }
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

  // Start SSE log stream after a short delay — errand creates tasks in
  // "scheduled" status and the SSE endpoint returns immediately for
  // non-running tasks. Wait for the first poll to confirm the task is running.
  let logPromise: Promise<void> = Promise.resolve();
  let sseStarted = false;

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

      // Start SSE stream once the task is running
      if (!sseStarted && status.status === "running") {
        sseStarted = true;
        logPromise = streamLogs(config.url, taskId, config.apiKey, ctx.onLog, abortController.signal, streamedLines);
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

interface RuntimeSkillEntry {
  key: string;
  runtimeName: string;
  source: string; // filesystem path to skill directory
  required?: boolean;
  requiredReason?: string | null;
}

interface SkillContent {
  description: string;
  instructions: string;
  files: Array<{ path: string; content: string }>;
}

async function readSkillFromDisk(sourceDir: string): Promise<SkillContent | null> {
  try {
    const skillMdPath = path.join(sourceDir, "SKILL.md");
    const raw = await readFile(skillMdPath, "utf-8");

    // Parse frontmatter for description
    let description = "";
    let instructions = raw;
    const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];
      instructions = frontmatterMatch[2].trim();
      const descMatch = fm.match(/description:\s*>?\s*\n?([\s\S]*?)(?:\n\w|$)/);
      if (descMatch) {
        description = descMatch[1].replace(/\n\s*/g, " ").trim();
      }
    }

    // Read additional files (references, etc.)
    const files: Array<{ path: string; content: string }> = [];
    async function walkDir(dir: string, prefix: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walkDir(fullPath, relativePath);
        } else if (entry.name !== "SKILL.md") {
          try {
            const content = await readFile(fullPath, "utf-8");
            files.push({ path: relativePath, content });
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
    await walkDir(sourceDir, "");

    return { description, instructions, files };
  } catch {
    return null;
  }
}

async function listSkills(
  ctx: AdapterSkillContext,
  getClient: (url: string, apiKey: string) => ErrandClient,
): Promise<AdapterSkillSnapshot> {
  const config = ctx.config as Record<string, unknown>;
  const schemaValues = config.adapterSchemaValues as Record<string, unknown> | undefined;
  const url = ((schemaValues?.url ?? config.url) as string ?? "").replace(/\/+$/, "");
  const apiKey = (schemaValues?.apiKey ?? config.apiKey) as string;

  if (!url || !apiKey) {
    return { adapterType: "errand", supported: true, mode: "persistent", desiredSkills: [], entries: [], warnings: ["URL or API key not configured"] };
  }

  const client = getClient(url, apiKey);
  const paperclipSkills = (config.paperclipRuntimeSkills ?? []) as RuntimeSkillEntry[];
  const desiredSkills = resolvePaperclipDesiredSkillNames(config, paperclipSkills);
  const desiredSet = new Set(desiredSkills);

  try {
    const errandSkills = await client.listSkills();
    const errandSkillsByName = new Map(errandSkills.map((s) => [s.name, s]));

    const entries: AdapterSkillEntry[] = paperclipSkills.map((ps) => {
      const runtimeName = ps.runtimeName ?? ps.key;
      const installed = errandSkillsByName.has(runtimeName);
      const desired = desiredSet.has(ps.key);
      return {
        key: ps.key,
        runtimeName,
        desired,
        managed: true,
        required: ps.required,
        requiredReason: ps.requiredReason ?? null,
        state: installed ? "installed" : desired ? "missing" : "available",
        origin: ps.required ? "paperclip_required" as const : "company_managed" as const,
      };
    });

    // Include errand-side skills not managed by Paperclip
    for (const [name, skill] of errandSkillsByName) {
      if (!entries.some((e) => e.runtimeName === name)) {
        entries.push({
          key: name,
          runtimeName: name,
          desired: false,
          managed: false,
          state: "external",
          origin: "external_unknown",
          detail: skill.description,
        });
      }
    }

    return { adapterType: "errand", supported: true, mode: "persistent", desiredSkills, entries, warnings: [] };
  } catch (err) {
    return { adapterType: "errand", supported: true, mode: "persistent", desiredSkills, entries: [], warnings: [`Failed to list skills: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

async function syncSkills(
  ctx: AdapterSkillContext,
  desiredSkills: string[],
  getClient: (url: string, apiKey: string) => ErrandClient,
): Promise<AdapterSkillSnapshot> {
  const config = ctx.config as Record<string, unknown>;
  const schemaValues = config.adapterSchemaValues as Record<string, unknown> | undefined;
  const url = ((schemaValues?.url ?? config.url) as string ?? "").replace(/\/+$/, "");
  const apiKey = (schemaValues?.apiKey ?? config.apiKey) as string;

  if (!url || !apiKey) {
    return { adapterType: "errand", supported: true, mode: "persistent", desiredSkills, entries: [], warnings: ["URL or API key not configured"] };
  }

  const client = getClient(url, apiKey);
  const paperclipSkills = (config.paperclipRuntimeSkills ?? []) as RuntimeSkillEntry[];
  const desiredSet = new Set(desiredSkills);
  const warnings: string[] = [];

  // Debug: log what we're working with
  console.log(`[errand-adapter] syncSkills: ${paperclipSkills.length} available, ${desiredSkills.length} desired: [${desiredSkills.join(", ")}]`);
  for (const ps of paperclipSkills) {
    console.log(`[errand-adapter]   skill: key=${ps.key} runtimeName=${ps.runtimeName} source=${ps.source} desired=${desiredSet.has(ps.key)}`);
  }

  try {
    const errandSkills = await client.listSkills();
    const errandSkillNames = new Set(errandSkills.map((s) => s.name));

    // Upsert desired skills — read content from disk
    for (const ps of paperclipSkills) {
      if (!desiredSet.has(ps.key)) continue;
      const runtimeName = ps.runtimeName ?? ps.key;
      try {
        const skillContent = await readSkillFromDisk(ps.source);
        if (!skillContent) {
          console.log(`[errand-adapter]   SKIP "${ps.key}": readSkillFromDisk returned null for ${ps.source}`);
          warnings.push(`Skill "${ps.key}": could not read from ${ps.source}`);
          continue;
        }
        console.log(`[errand-adapter]   UPSERT "${runtimeName}": instructions=${skillContent.instructions.length}chars, files=${skillContent.files.length}`);
        await client.upsertSkill(
          runtimeName,
          skillContent.description || `Paperclip skill: ${ps.key}`,
          skillContent.instructions,
          skillContent.files.length > 0 ? skillContent.files : undefined,
        );
      } catch (err) {
        warnings.push(`Failed to sync skill "${ps.key}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Delete Paperclip-managed skills that are no longer desired
    for (const ps of paperclipSkills) {
      if (desiredSet.has(ps.key)) continue;
      const runtimeName = ps.runtimeName ?? ps.key;
      if (!errandSkillNames.has(runtimeName)) continue;
      try {
        await client.deleteSkill(runtimeName);
      } catch {
        // Skill may already be deleted
      }
    }
  } catch (err) {
    warnings.push(`Skill sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Return fresh snapshot
  return listSkills(ctx, getClient);
}

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

    listSkills: (ctx: AdapterSkillContext) => listSkills(ctx, getClient),
    syncSkills: (ctx: AdapterSkillContext, desiredSkills: string[]) => syncSkills(ctx, desiredSkills, getClient),

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
