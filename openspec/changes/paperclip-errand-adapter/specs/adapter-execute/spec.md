## ADDED Requirements

### Requirement: Task creation via errand MCP
The adapter SHALL create errand tasks by calling the `new_task` MCP tool with the Paperclip prompt and selected profile.

#### Scenario: Successful task creation
- **WHEN** `execute()` is called with a valid execution context
- **THEN** the adapter SHALL call errand's `new_task` MCP tool with the prompt derived from the Paperclip context
- **THEN** the adapter SHALL pass the selected profile name from `adapterConfig.model` to the `profile` parameter
- **THEN** the adapter SHALL receive a task UUID from errand

#### Scenario: Task creation failure
- **WHEN** the `new_task` MCP call fails or returns an error
- **THEN** the adapter SHALL return an `AdapterExecutionResult` with a non-zero `exitCode` and the error in `errorMessage`

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

### Requirement: Log streaming
The adapter SHALL stream errand task logs to Paperclip's `onLog` callback in real-time.

#### Scenario: Logs streamed during execution
- **WHEN** a task is running and logs are available via SSE
- **THEN** the adapter SHALL connect to `GET /api/tasks/{id}/logs/stream` and forward each log line to `ctx.onLog("stderr", chunk)`

#### Scenario: SSE connection fails
- **WHEN** the SSE log stream cannot be established
- **THEN** the adapter SHALL continue polling for status without logs (degraded but functional)

### Requirement: MCP communication via direct HTTP
The adapter SHALL communicate with errand's MCP endpoint using direct JSON-RPC HTTP POST requests.

#### Scenario: MCP tool invocation
- **WHEN** the adapter needs to call an MCP tool
- **THEN** the adapter SHALL POST a JSON-RPC request to `{errandUrl}/mcp` with the `Authorization: Bearer {apiKey}` header
- **THEN** the adapter SHALL parse the JSON-RPC response to extract the tool result
