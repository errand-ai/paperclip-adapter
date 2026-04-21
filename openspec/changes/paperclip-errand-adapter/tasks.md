## 1. Project Scaffolding

- [x] 1.1 Create `package.json` with name `@errand-ai/paperclip-adapter`, type `module`, dependency on `@paperclipai/adapter-utils`, publishConfig for public npmjs.com
- [x] 1.2 Create `tsconfig.json` targeting ES2022/NodeNext with strict mode, outputting to `dist/`
- [x] 1.3 Create `.github/workflows/ci.yml` — lint + test on PRs, build + publish to npmjs.com on `v*` tags using `NPM_TOKEN` secret

## 2. Errand MCP Client

- [x] 2.1 Implement `ErrandClient` class — wraps HTTP POST to errand's MCP endpoint (`/mcp`) with JSON-RPC request/response handling and Bearer token auth
- [x] 2.2 Implement `callTool(name, args)` method — sends `tools/call` JSON-RPC request, parses response, extracts text content from result
- [x] 2.3 Implement `newTask(description, profile?)` method — calls `new_task` tool, returns task UUID
- [x] 2.4 Implement `taskStatus(taskId)` method — calls `task_status` with `format="json"`, parses JSON response, returns typed status object
- [x] 2.5 Implement `taskOutput(taskId)` method — calls `task_output` tool, returns output text
- [x] 2.6 Implement `listTaskProfiles()` method — calls `list_task_profiles` tool, parses JSON response, returns profile array

## 3. Adapter Module

- [x] 3.1 Implement `createServerAdapter()` export returning `ServerAdapterModule` with `type: "errand"`
- [x] 3.2 Implement `execute(ctx)` — extract config, build prompt, create task, poll status with log streaming, return `AdapterExecutionResult`
- [x] 3.3 Implement SSE log streaming — connect to `GET /api/tasks/{id}/logs/stream?token={apiKey}`, forward lines to `ctx.onLog("stderr", chunk)`, handle connection errors gracefully
- [x] 3.4 Implement polling loop — poll `taskStatus()` every `pollIntervalMs` (default 3000), detect terminal states (completed, review, deleted), respect `timeoutSec`
- [x] 3.5 Handle `review` status — return `AdapterExecutionResult` with `question` field for Paperclip's approval system
- [x] 3.6 Implement `testEnvironment(ctx)` — validate URL and API key by calling `listTaskProfiles()`, return pass/fail with descriptive checks
- [x] 3.7 Implement `listModels()` — call `listTaskProfiles()`, map to `AdapterModel[]` with `{ id: name, label: name }`
- [x] 3.8 Implement `getConfigSchema()` — return `AdapterConfigSchema` with fields for `url` (text), `apiKey` (text), `timeoutSec` (number, default 600)
- [x] 3.9 Set `agentConfigurationDoc` with markdown describing adapter configuration fields

## 4. Tests

- [x] 4.1 Test `ErrandClient.callTool` sends correct JSON-RPC request and parses response
- [x] 4.2 Test `ErrandClient.newTask` returns task UUID from MCP response
- [x] 4.3 Test `ErrandClient.taskStatus` parses JSON status response
- [x] 4.4 Test `ErrandClient.listTaskProfiles` returns profile array
- [x] 4.5 Test `execute()` creates task, polls to completion, returns result with output
- [x] 4.6 Test `execute()` returns timeout result when `timeoutSec` exceeded
- [x] 4.7 Test `execute()` returns question for review status
- [x] 4.8 Test `testEnvironment()` returns pass for valid connection
- [x] 4.9 Test `testEnvironment()` returns fail for invalid API key
- [x] 4.10 Test `listModels()` maps profiles to AdapterModel format
- [x] 4.11 Test `getConfigSchema()` returns expected field definitions
- [x] 4.12 Test `createServerAdapter()` returns valid ServerAdapterModule with type "errand"

## 5. Transcript Streaming & UI Parser

- [ ] 5.1 Add `taskLogs(taskId)` method to `ErrandClient` — calls `task_logs` MCP tool, returns raw log text
- [ ] 5.2 Rewrite `streamLogs()` to forward structured errand events as stdout JSON lines — parse SSE data as `{"event": "task_event", "type": "...", "data": {...}}`, forward inner object via `ctx.onLog("stdout", ...)`
- [ ] 5.3 After task completion, fetch full logs via `taskLogs()` and forward any remaining events as stdout lines
- [ ] 5.4 Create `src/ui-parser.ts` — self-contained `parseStdoutLine(line, ts)` mapping errand events to Paperclip `TranscriptEntry` types (agent_start→system, thinking→thinking, tool_call→tool_call, tool_result→tool_result, llm_turn_start→init, agent_end→result, error→stderr)
- [ ] 5.5 Add `./ui-parser` export to `package.json` exports map so Paperclip's plugin-loader can serve it to the UI
- [ ] 5.6 Remove temporary `[errand-adapter]` debug log lines from `execute()`
- [ ] 5.7 Test `ErrandClient.taskLogs` returns log text
- [ ] 5.8 Test `ui-parser` parseStdoutLine maps each errand event type to correct TranscriptEntry kind
