## Context

Paperclip adapters implement `ServerAdapterModule` from `@paperclipai/adapter-utils`. The adapter's `execute()` is called synchronously by Paperclip's heartbeat system — it must block until the task completes or times out. Errand's task API is asynchronous: create a task, then poll or stream for completion.

The adapter bridges this gap: it creates an errand task via MCP tools, streams execution events via SSE for transcript rendering, polls status until terminal, and returns a structured `AdapterExecutionResult`.

Errand exposes two API surfaces: REST (OIDC JWT or API key auth) and MCP Streamable HTTP (API key auth). The adapter uses MCP tools for task lifecycle (`new_task`, `task_status`, `task_output`, `task_logs`, `list_task_profiles`) and REST SSE for live event streaming (`GET /api/tasks/{id}/logs/stream`).

The adapter is installed via Paperclip's adapter plugin system (`POST /api/adapters/install`), not the plugin SDK system (`paperclipai plugin install`). These are separate systems — the adapter plugin store loads packages that export `createServerAdapter()`.

## Goals / Non-Goals

**Goals:**
- Implement a fully functional Paperclip adapter that creates and monitors errand tasks
- Provide a declarative config schema for Paperclip's auto-rendered UI (URL, API key, timeout)
- Dynamically list errand task profiles as selectable "models" in Paperclip's UI
- Stream errand task execution events to Paperclip as structured stdout lines for transcript rendering
- Provide a UI parser (`./ui-parser` export) that maps errand events to Paperclip TranscriptEntry types
- Support Paperclip's instructions bundle (AGENT.md, SOUL.md, HEARTBEAT.md)
- Build prompts from instructions file + prompt template + wake payload, matching built-in adapter behaviour
- Publish to npmjs.com as a public package via OIDC trusted publishers
- CI pipeline for automated testing and publishing

**Non-Goals:**
- Session continuity across Paperclip heartbeats (errand tasks are single-shot)
- Skill sync (errand manages its own skills independently)
- Quota/cost tracking (errand doesn't currently expose token usage per task)

## Decisions

### 1. Use MCP tools for task lifecycle, REST SSE for event streaming

MCP tools (`new_task`, `task_status`, `task_output`, `task_logs`) handle the core lifecycle. Live event streaming uses the REST SSE endpoint because MCP tools are request-response — they can't stream.

**Rationale:** MCP authentication is simpler (single API key via Bearer token). The SSE log streaming endpoint also accepts API key auth via `?token=` query parameter.

### 2. MCP Streamable HTTP via direct HTTP POST (not MCP SDK)

The adapter calls errand's MCP endpoint (`POST /mcp/`) with JSON-RPC payloads directly. The endpoint requires a trailing slash, an `Accept: application/json, text/event-stream` header, and can return either JSON (200) or SSE (202 Accepted).

**Rationale:** The MCP SDK adds a heavyweight dependency for what amounts to a few simple tool calls. Direct HTTP POST with `fetch()` keeps the adapter dependency-light. The adapter handles both JSON and SSE response formats.

### 3. Profile-as-model mapping

Errand task profiles map to Paperclip's `AdapterModel` concept. `listModels()` calls `list_task_profiles` and returns `{ id: profile.name, label: profile.name }`. The selected "model" in Paperclip's UI is passed to `new_task(profile=...)` at execution time.

**Rationale:** Paperclip already has UI and data model for model selection. Profiles are errand's equivalent.

### 4. getConfigSchema() for declarative UI

The adapter implements `getConfigSchema()` returning fields for:
- `url` (text, required) — errand instance URL
- `apiKey` (text, required) — MCP API key
- `timeoutSec` (number, default 600) — max execution time

**Rationale:** Uses Paperclip's existing config schema UX. Profile selection uses `listModels()` / the standard model dropdown.

### 5. Adapter capabilities for UI integration

The adapter sets `supportsLocalAgentJwt: true`, `supportsInstructionsBundle: true`, and `instructionsPathKey: "instructionsFilePath"`.

**Rationale:** `supportsLocalAgentJwt` is required for Paperclip's UI to render the "Permissions & Configuration" section (gated by `isLocal` in AgentConfigForm). `supportsInstructionsBundle` enables the AGENT.md/SOUL.md/HEARTBEAT.md managed instructions editors. `instructionsPathKey` tells Paperclip which config key stores the instructions file path.

### 6. Prompt construction

The adapter builds the task prompt from three sources:
1. Instructions file content (read from `config.instructionsFilePath`) — the AGENT.md bundle
2. Prompt template (from `config.promptTemplate`, defaulting to "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.")
3. Wake payload (from `context.paperclipWake`) — issue details, comments, execution stage

**Rationale:** Matches how built-in adapters (claude-local, opencode-local) construct their prompts. The instructions file provides the agent's persona and rules, the prompt template provides the heartbeat instruction, and the wake payload provides the specific issue context.

### 7. Transcript streaming via stdout + UI parser

Errand's task-runner emits structured JSON events (`agent_start`, `llm_turn_start`, `thinking`, `tool_call`, `tool_result`, `agent_end`, `error`). The adapter streams these via `ctx.onLog("stdout", ...)` during execution, and the package exports a `./ui-parser` module that Paperclip's plugin-loader serves to the UI for transcript parsing.

**Rationale:** Paperclip's transcript UI is built from stdout lines parsed by per-adapter `parseStdoutLine` functions. For external adapters, the server loads `./ui-parser` from the package exports and serves it to the UI dynamically.

### 8. Polling with SSE for liveness

The adapter polls `task_status` on an interval (default 3s) while simultaneously connecting to the SSE event stream. Polling detects terminal states; SSE provides real-time transcript events. After completion, `task_logs` backfills any events missed during streaming.

**Rationale:** SSE alone can't reliably detect task completion. Polling alone misses real-time events. Both together give reliability + liveness.

### 9. Publish via OIDC trusted publishers

GitHub Actions CI uses OIDC trusted publishers for npm authentication — no `NPM_TOKEN` secret needed. Requires Node 24 (ships with npm >= 11.5.1), `--provenance` flag, `id-token: write` permission, and `repository.url` in package.json matching the configured trusted publisher.

**Rationale:** More secure than long-lived tokens. The npm org configures the GitHub repo as a trusted publisher.

### 10. Adapter plugin system (not plugin SDK)

The adapter is installed via Paperclip's adapter plugin system (`POST /api/adapters/install` or the UI), which stores records in `~/.paperclip/adapter-plugins.json` and loads packages that export `createServerAdapter()`. This is separate from the plugin SDK system (`paperclipai plugin install`) which uses manifests, workers, and `definePlugin()`.

**Rationale:** Adapters are execution backends, not plugins. The adapter plugin system is the correct integration point. The package also includes a plugin manifest and worker for compatibility, but the primary entry is the adapter plugin store.

## Risks / Trade-offs

- **MCP protocol coupling** — Direct JSON-RPC calls are coupled to errand's MCP tool signatures. Mitigation: errand's MCP API is stable.
- **Polling latency** — 3s poll interval means up to 3s delay detecting task completion. Mitigation: acceptable for tasks that typically run 30s-10min.
- **No token usage reporting** — Paperclip tracks `UsageSummary` but errand doesn't expose per-task token counts. Mitigation: return empty usage; add usage tracking to errand in a future change.
- **SSE response handling** — MCP Streamable HTTP can return either JSON or SSE responses. The adapter must handle both.

## Open Questions

(None remaining — all resolved during implementation.)
