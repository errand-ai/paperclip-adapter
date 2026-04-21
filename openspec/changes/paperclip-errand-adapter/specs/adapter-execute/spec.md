## ADDED Requirements

### Requirement: Task creation via errand MCP
The adapter SHALL create errand tasks by calling the `new_task` MCP tool with the Paperclip prompt and selected profile.

#### Scenario: Successful task creation
- **WHEN** `execute()` is called with a valid execution context
- **THEN** the adapter SHALL call errand's `new_task` MCP tool with the prompt derived from the Paperclip context
- **THEN** the adapter SHALL pass the selected profile name from `adapterConfig.model` to the `profile` parameter
- **THEN** the adapter SHALL pass a `title` parameter in the format `{agent.name}-{runId}` to bypass errand's task summariser and provide a meaningful link back to the Paperclip run
- **THEN** the adapter SHALL receive a task UUID from errand

#### Scenario: Task creation failure
- **WHEN** the `new_task` MCP call fails or returns an error
- **THEN** the adapter SHALL return an `AdapterExecutionResult` with a non-zero `exitCode` and the error in `errorMessage`

#### Scenario: Missing configuration
- **WHEN** `execute()` is called with empty `url` or `apiKey`
- **THEN** the adapter SHALL return an `AdapterExecutionResult` with `exitCode: 1` and a clear error message without attempting to connect

### Requirement: Prompt construction
The adapter SHALL build the task prompt from three sources, matching built-in adapter behaviour.

#### Scenario: Full prompt with all sources
- **WHEN** `execute()` is called with an instructions file, prompt template, and wake payload
- **THEN** the adapter SHALL read the instructions file from `config.instructionsFilePath`
- **THEN** the adapter SHALL render the prompt template from `config.promptTemplate` with `{{agent.id}}` and `{{agent.name}}` substitution
- **THEN** the adapter SHALL render the wake payload from `context.paperclipWake` using `renderPaperclipWakePrompt()`
- **THEN** the adapter SHALL concatenate all three sections as the task description

#### Scenario: Default prompt template
- **WHEN** `config.promptTemplate` is not set
- **THEN** the adapter SHALL use `"You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work."` as the default

#### Scenario: No wake payload
- **WHEN** `context.paperclipWake` is absent (heartbeat without issue context)
- **THEN** the adapter SHALL use only the instructions and prompt template

### Requirement: Task status polling
The adapter SHALL poll errand's `task_status` MCP tool until the task reaches a terminal state.

#### Scenario: Task completes successfully
- **WHEN** `task_status` returns `status: "completed"`
- **THEN** the adapter SHALL call `task_output` to retrieve the result
- **THEN** the adapter SHALL return an `AdapterExecutionResult` with `exitCode: 0` and the output in `summary`

#### Scenario: Task enters review state
- **WHEN** `task_status` returns `status: "review"`
- **THEN** the adapter SHALL return an `AdapterExecutionResult` with `exitCode: 0` and a `question` field containing the review context

#### Scenario: Task fails or is deleted
- **WHEN** `task_status` returns `status: "deleted"` or an unexpected terminal state
- **THEN** the adapter SHALL return an `AdapterExecutionResult` with a non-zero `exitCode`

#### Scenario: Polling timeout
- **WHEN** the configured `timeoutSec` elapses before the task reaches a terminal state
- **THEN** the adapter SHALL return an `AdapterExecutionResult` with `timedOut: true`

### Requirement: Transcript streaming
The adapter SHALL stream errand task execution events to Paperclip as structured stdout JSON lines for transcript rendering.

#### Scenario: Live event streaming during execution
- **WHEN** a task is running and events are available via SSE
- **THEN** the adapter SHALL connect to `GET /api/tasks/{id}/logs/stream?token={apiKey}`
- **THEN** the adapter SHALL parse SSE data lines containing `{"event": "task_event", "type": "...", "data": {...}}`
- **THEN** the adapter SHALL forward the inner `{"type": "...", "data": {...}}` object via `ctx.onLog("stdout", JSON.stringify(event))`

#### Scenario: Log backfill after completion
- **WHEN** the task reaches a terminal state
- **THEN** the adapter SHALL call the `task_logs` MCP tool to retrieve complete runner logs
- **THEN** the adapter SHALL forward any events not already streamed via `ctx.onLog("stdout", ...)`

#### Scenario: SSE connection fails
- **WHEN** the SSE log stream cannot be established
- **THEN** the adapter SHALL continue polling for status without live streaming (degraded but functional)
- **THEN** full logs SHALL still be retrieved via `task_logs` after completion

### Requirement: UI parser for transcript rendering
The adapter package SHALL export a `./ui-parser` module that Paperclip's plugin-loader serves to the UI for transcript parsing.

#### Scenario: Errand events parsed into transcript entries
- **WHEN** Paperclip's UI renders the run transcript
- **THEN** the UI parser SHALL map errand event types to Paperclip TranscriptEntry kinds:
  - `agent_start` → `system` ("Agent started")
  - `mcp_connected` → `system` ("Connected to N MCP servers")
  - `llm_turn_start` → `init` (model name, turn ID)
  - `thinking` → `thinking` (reasoning text)
  - `tool_call` → `tool_call` (tool name, arguments)
  - `tool_result` → `tool_result` (output, duration, error status)
  - `agent_end` → `result` (final output)
  - `error` → `stderr` (error message)
  - `raw` / unknown → `stdout` (plain text fallback)

### Requirement: Invocation metadata
The adapter SHALL report invocation metadata to Paperclip for the run log "Invocation" section.

#### Scenario: Invocation recorded before task creation
- **WHEN** `execute()` is called
- **THEN** the adapter SHALL call `ctx.onMeta()` with an `AdapterInvocationMeta` object containing:
  - `adapterType: "errand"`
  - `command`: the errand MCP endpoint URL
  - `commandArgs`: `["new_task", "profile=<selected_profile>"]`
  - `prompt`: the full rendered prompt sent to errand
  - `context`: the Paperclip execution context

### Requirement: MCP communication via Streamable HTTP
The adapter SHALL communicate with errand's MCP endpoint using the MCP Streamable HTTP transport.

#### Scenario: MCP tool invocation
- **WHEN** the adapter needs to call an MCP tool
- **THEN** the adapter SHALL POST a JSON-RPC request to `{errandUrl}/mcp/` (trailing slash required)
- **THEN** the adapter SHALL include `Authorization: Bearer {apiKey}` and `Accept: application/json, text/event-stream` headers
- **THEN** the adapter SHALL handle both JSON responses (200 OK) and SSE responses (202 Accepted)
- **THEN** for SSE responses, the adapter SHALL parse `data:` lines to extract the JSON-RPC response
