## Context

Paperclip adapters implement `ServerAdapterModule` from `@paperclipai/adapter-utils`. The adapter's `execute()` is called synchronously by Paperclip's heartbeat system — it must block until the task completes or times out. Errand's task API is asynchronous: create a task, then poll or stream for completion.

The adapter bridges this gap: it creates an errand task via MCP tools, streams logs via SSE, polls status until terminal, and returns a structured `AdapterExecutionResult`.

Errand exposes two API surfaces: REST (OIDC JWT auth) and MCP (API key auth). The adapter uses MCP tools for task lifecycle (`new_task`, `task_status`, `task_output`, `list_task_profiles`) and REST SSE for log streaming (`GET /api/tasks/{id}/logs/stream`).

## Goals / Non-Goals

**Goals:**
- Implement a fully functional Paperclip adapter that creates and monitors errand tasks
- Provide a declarative config schema for Paperclip's auto-rendered UI (URL, API key, profile, timeout)
- Dynamically list errand task profiles as selectable "models" in Paperclip's UI
- Stream errand task logs to Paperclip's `onLog` callback in real-time
- Publish to npmjs.com as a public package installable via `paperclipai plugin install`
- CI pipeline for automated testing and publishing

**Non-Goals:**
- Session continuity across Paperclip heartbeats (errand tasks are single-shot)
- Skill sync (errand manages its own skills independently)
- Quota/cost tracking (errand doesn't currently expose token usage per task)
- Custom UI parser for run-log rendering (plaintext logs are sufficient for v1)

## Decisions

### 1. Use MCP tools for task lifecycle, REST SSE for log streaming

MCP tools (`new_task`, `task_status`, `task_output`) handle the core lifecycle. Log streaming uses the REST SSE endpoint because MCP tools are request-response — they can't stream.

**Rationale:** MCP authentication is simpler (single API key). The log streaming endpoint will gain API key auth support via the errand-side change.

**Alternative considered:** REST-only approach. Rejected because REST task creation (`POST /api/tasks`) doesn't support profile selection and requires OIDC JWT auth.

### 2. MCP communication via direct HTTP POST (not MCP SDK)

The adapter calls errand's MCP endpoint (`POST /mcp`) with JSON-RPC payloads directly rather than using the MCP TypeScript SDK client.

**Rationale:** The MCP SDK adds a heavyweight dependency for what amounts to three simple tool calls. Direct HTTP POST with `fetch()` keeps the adapter dependency-light and avoids SDK version coupling.

### 3. Profile-as-model mapping

Errand task profiles map to Paperclip's `AdapterModel` concept. `listModels()` calls `list_task_profiles` and returns `{ id: profile.name, label: profile.name }`. The selected "model" in Paperclip's UI is passed to `new_task(profile=...)` at execution time.

**Rationale:** Paperclip already has UI and data model for model selection. Profiles are errand's equivalent — they bundle model, system prompt, max turns, and tool configuration.

### 4. getConfigSchema() for declarative UI

The adapter implements `getConfigSchema()` returning fields for:
- `url` (text, required) — errand instance URL
- `apiKey` (text, required) — MCP API key
- `timeoutSec` (number, default 600) — max execution time

Profile selection uses `listModels()` / the standard model dropdown rather than a config field, since Paperclip already has dedicated UI for model selection.

**Rationale:** Uses Paperclip's existing model selection UX. The config schema handles connection settings only.

### 5. Polling with SSE fallback

The adapter polls `task_status` on an interval (default 3s) while simultaneously connecting to the SSE log stream. Polling detects terminal states; SSE provides real-time log output.

**Rationale:** SSE alone can't reliably detect task completion (connection drops, etc.). Polling alone misses real-time logs. Both together give reliability + liveness.

### 6. Publish to npmjs.com (public)

Package published as `@errand-ai/paperclip-adapter` on npmjs.com with `"access": "public"`. No authentication required to install.

**Rationale:** Public npm means any Paperclip instance can install without configuring private registry tokens. The package contains no secrets.

### 7. CI pipeline mirrors errand-component-library

GitHub Actions workflow: lint + test on PRs, build + publish on version tags (`v*`). Uses `NPM_TOKEN` secret for npmjs.com publishing.

**Rationale:** Proven pattern from the existing component library. Tag-based publishing gives explicit version control.

## Risks / Trade-offs

- **MCP protocol coupling** — Direct JSON-RPC calls are coupled to errand's MCP tool signatures. Mitigation: errand's MCP API is stable; tool signatures are versioned via the MCP SDK.
- **Polling latency** — 3s poll interval means up to 3s delay detecting task completion. Mitigation: acceptable for tasks that typically run 30s-10min.
- **No token usage reporting** — Paperclip tracks `UsageSummary` but errand doesn't expose per-task token counts. Mitigation: return empty usage; add usage tracking to errand in a future change.

## Open Questions

- Should the adapter support passing Paperclip's wake prompt enrichment (issue context, comments, documents) as additional context to errand? For v1, the raw prompt is sufficient.
