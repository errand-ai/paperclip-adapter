/**
 * UI parser for errand adapter — maps errand task-runner events to
 * Paperclip TranscriptEntry objects for transcript rendering.
 *
 * This module is served to the Paperclip UI via the ./ui-parser export
 * and must be self-contained (no runtime dependencies).
 */

interface TranscriptEntry {
  kind: string;
  ts: string;
  [key: string]: unknown;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function parseStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) {
    return [{ kind: "stdout", ts, text: line }];
  }

  const type = asString(parsed.type);
  const data = asRecord(parsed.data);

  if (type === "agent_start") {
    const agent = asString(data?.agent, "TaskRunner");
    return [{ kind: "system", ts, text: `Agent started: ${agent}` }];
  }

  if (type === "mcp_connected") {
    const servers = Array.isArray(data?.servers) ? data.servers as string[] : [];
    const count = asNumber(data?.count, servers.length);
    const serverList = servers.length > 0 ? `: ${servers.join(", ")}` : "";
    return [{ kind: "system", ts, text: `Connected to ${count} MCP servers${serverList}` }];
  }

  if (type === "llm_turn_start") {
    const model = asString(data?.model, "unknown");
    const turnId = asString(data?.turn_id);
    return [{
      kind: "init",
      ts,
      model,
      sessionId: turnId,
    }];
  }

  if (type === "thinking") {
    const text = asString(data?.text).trim();
    if (!text) return [];
    return [{ kind: "thinking", ts, text }];
  }

  if (type === "tool_call") {
    const toolName = asString(data?.tool, "tool");
    const args = data?.args ?? {};
    const turnId = asString(data?.turn_id);
    return [{
      kind: "tool_call",
      ts,
      name: toolName,
      toolUseId: turnId || undefined,
      input: args,
    }];
  }

  if (type === "tool_result") {
    const toolName = asString(data?.tool, "tool");
    const output = asString(data?.output, "");
    const durationMs = asNumber(data?.duration_ms, 0);
    const turnId = asString(data?.turn_id);
    const length = asNumber(data?.length, 0);

    const headerParts: string[] = [];
    if (durationMs > 0) headerParts.push(`duration: ${durationMs}ms`);
    if (length > 0) headerParts.push(`length: ${length}`);
    const header = headerParts.length > 0 ? headerParts.join(", ") + "\n\n" : "";
    const content = `${header}${output}`.trim();

    return [{
      kind: "tool_result",
      ts,
      toolUseId: turnId || toolName,
      toolName,
      content,
      isError: false,
    }];
  }

  if (type === "agent_end") {
    const output = asRecord(data?.output);
    const text = asString(output?.raw, "").trim();
    const entries: TranscriptEntry[] = [];
    if (text) {
      entries.push({ kind: "assistant", ts, text });
    }
    entries.push({
      kind: "result",
      ts,
      text: "completed",
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
      subtype: "stop",
      isError: false,
      errors: [],
    });
    return entries;
  }

  if (type === "error") {
    const message =
      asString(data?.message) ||
      asString(parsed.message) ||
      line;
    return [{ kind: "stderr", ts, text: message }];
  }

  // raw or unknown event types
  if (type === "raw") {
    const rawLine = asString(data?.line, line);
    return [{ kind: "stdout", ts, text: rawLine }];
  }

  return [{ kind: "stdout", ts, text: line }];
}
