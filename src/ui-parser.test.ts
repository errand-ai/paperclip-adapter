import { describe, it, expect } from "vitest";
import { parseStdoutLine } from "./ui-parser.js";

const ts = "2026-04-21T10:00:00.000Z";

describe("ui-parser parseStdoutLine", () => {
  it("maps agent_start to system", () => {
    const line = JSON.stringify({ type: "agent_start", data: { agent: "TaskRunner" } });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("system");
    expect(entries[0].text).toBe("Agent started: TaskRunner");
  });

  it("maps mcp_connected to system", () => {
    const line = JSON.stringify({
      type: "mcp_connected",
      data: { servers: ["grafana", "hindsight"], count: 2 },
    });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("system");
    expect(entries[0].text).toBe("Connected to 2 MCP servers: grafana, hindsight");
  });

  it("maps llm_turn_start to init", () => {
    const line = JSON.stringify({
      type: "llm_turn_start",
      data: { turn_id: "abc123", model: "kimi-k2.5" },
    });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("init");
    expect(entries[0].model).toBe("kimi-k2.5");
    expect(entries[0].sessionId).toBe("abc123");
  });

  it("maps thinking to thinking", () => {
    const line = JSON.stringify({
      type: "thinking",
      data: { text: "Let me analyze this...", turn_id: "abc" },
    });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("thinking");
    expect(entries[0].text).toBe("Let me analyze this...");
  });

  it("skips empty thinking", () => {
    const line = JSON.stringify({ type: "thinking", data: { text: "" } });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(0);
  });

  it("maps tool_call to tool_call", () => {
    const line = JSON.stringify({
      type: "tool_call",
      data: { tool: "read_url", args: { url: "https://example.com" }, turn_id: "t1" },
    });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("tool_call");
    expect(entries[0].name).toBe("read_url");
    expect(entries[0].input).toEqual({ url: "https://example.com" });
    expect(entries[0].toolUseId).toBe("t1");
  });

  it("maps tool_result to tool_result", () => {
    const line = JSON.stringify({
      type: "tool_result",
      data: { tool: "read_url", output: "page content", duration_ms: 500, length: 12, turn_id: "t1" },
    });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("tool_result");
    expect(entries[0].toolName).toBe("read_url");
    expect((entries[0].content as string)).toContain("page content");
    expect((entries[0].content as string)).toContain("duration: 500ms");
    expect(entries[0].isError).toBe(false);
  });

  it("maps agent_end to assistant + result", () => {
    const line = JSON.stringify({
      type: "agent_end",
      data: { output: { raw: "Task completed successfully." } },
    });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("assistant");
    expect(entries[0].text).toBe("Task completed successfully.");
    expect(entries[1].kind).toBe("result");
    expect(entries[1].subtype).toBe("stop");
  });

  it("maps error to stderr", () => {
    const line = JSON.stringify({
      type: "error",
      data: { message: "Something went wrong", error_type: "non_retryable" },
    });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("stderr");
    expect(entries[0].text).toBe("Something went wrong");
  });

  it("maps raw to stdout", () => {
    const line = JSON.stringify({ type: "raw", data: { line: "some raw output" } });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("stdout");
    expect(entries[0].text).toBe("some raw output");
  });

  it("handles non-JSON lines as stdout", () => {
    const entries = parseStdoutLine("plain text output", ts);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("stdout");
    expect(entries[0].text).toBe("plain text output");
  });

  it("handles unknown event types as stdout", () => {
    const line = JSON.stringify({ type: "unknown_event", data: {} });
    const entries = parseStdoutLine(line, ts);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("stdout");
  });
});
