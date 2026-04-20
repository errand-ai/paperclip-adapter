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

### Requirement: Module export
The adapter package SHALL export a `createServerAdapter()` function as required by Paperclip's plugin loader.

#### Scenario: Module loaded by Paperclip
- **WHEN** Paperclip's plugin loader imports the package
- **THEN** the package SHALL export `createServerAdapter()` returning a `ServerAdapterModule` with `type: "errand"`
