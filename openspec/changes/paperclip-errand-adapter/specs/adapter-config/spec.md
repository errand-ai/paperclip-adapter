## ADDED Requirements

### Requirement: Declarative configuration schema
The adapter SHALL provide a `getConfigSchema()` method returning a declarative field schema for Paperclip's auto-rendered config UI.

#### Scenario: Config schema fields
- **WHEN** `getConfigSchema()` is called
- **THEN** the adapter SHALL return an `AdapterConfigSchema` with fields for:
  - `url` (text, required) — the errand instance URL
  - `apiKey` (text, required) — the MCP API key
  - `timeoutSec` (number, default 600) — maximum execution time in seconds

### Requirement: Dynamic profile listing as models
The adapter SHALL implement `listModels()` to fetch errand task profiles dynamically.

#### Scenario: Profiles fetched successfully
- **WHEN** `listModels()` is called and errand is reachable
- **THEN** the adapter SHALL call errand's `list_task_profiles` MCP tool
- **THEN** the adapter SHALL return an array of `AdapterModel` objects mapping each profile's name to `{ id: name, label: name }`

#### Scenario: Errand unreachable
- **WHEN** `listModels()` is called and errand is not reachable
- **THEN** the adapter SHALL return an empty array

### Requirement: Environment testing
The adapter SHALL implement `testEnvironment()` to validate connectivity and authentication.

#### Scenario: Successful environment test
- **WHEN** `testEnvironment()` is called with valid URL and API key
- **THEN** the adapter SHALL call errand's `list_task_profiles` MCP tool to verify connectivity
- **THEN** the adapter SHALL return a passing `AdapterEnvironmentTestResult`

#### Scenario: Failed environment test
- **WHEN** `testEnvironment()` is called with invalid URL or API key
- **THEN** the adapter SHALL return a failing `AdapterEnvironmentTestResult` with a descriptive error message

### Requirement: Adapter capabilities for UI integration
The adapter SHALL declare capabilities required for Paperclip's UI to render configuration and instructions editors.

#### Scenario: Config section visibility
- **WHEN** the adapter module is loaded by Paperclip
- **THEN** `supportsLocalAgentJwt` SHALL be `true` (required for UI to show the Permissions & Configuration section)
- **THEN** `supportsInstructionsBundle` SHALL be `true` (enables AGENT.md, SOUL.md, HEARTBEAT.md editors)
- **THEN** `instructionsPathKey` SHALL be `"instructionsFilePath"` (tells Paperclip which config key stores the instructions file path)

### Requirement: Module and subpath exports
The adapter package SHALL export a `createServerAdapter()` function and provide standard subpath exports.

#### Scenario: Module loaded by Paperclip's adapter plugin store
- **WHEN** Paperclip's adapter plugin loader imports the package
- **THEN** the root export (`.`) SHALL export `createServerAdapter()` returning a `ServerAdapterModule` with `type: "errand"`, plus metadata exports `type`, `label`, and `agentConfigurationDoc`
- **THEN** the `./server` export SHALL provide the instantiated adapter module (execute, testEnvironment, etc.)
- **THEN** the `./ui-parser` export SHALL provide a `parseStdoutLine` function for transcript rendering
