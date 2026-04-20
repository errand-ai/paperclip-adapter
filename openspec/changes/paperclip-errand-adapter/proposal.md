## Why

Paperclip is an agent workforce orchestrator that delegates tasks to adapter-backed runtimes (Claude Code, Codex, Gemini, etc.). Errand is a task execution engine that runs agentic workloads in isolated containers with MCP tool access, multi-model support via LiteLLM, and configurable task profiles. Publishing an errand adapter as a public npm package allows any Paperclip instance to use errand as a backend execution engine — combining Paperclip's agent hierarchy and task delegation with errand's containerised execution, tool ecosystem, and persistent memory.

## What Changes

- Create the `@errand-ai/paperclip-adapter` npm package implementing Paperclip's `ServerAdapterModule` interface
- Implement `execute()` — creates an errand task via MCP, polls for completion, streams logs via SSE, returns structured result
- Implement `testEnvironment()` — validates connectivity and authentication against the errand instance
- Implement `listModels()` — fetches errand task profiles and maps them as selectable "models"
- Implement `getConfigSchema()` — returns declarative form fields (URL, API key, profile, timeout) for Paperclip's auto-rendered config UI
- Create GitHub Actions CI pipeline to test, build, and publish the package to npmjs.com on tagged releases

## Capabilities

### New Capabilities
- `adapter-execute`: Execute Paperclip tasks via errand's task API with log streaming and result retrieval
- `adapter-config`: Declarative configuration schema and environment testing for the Paperclip UI
- `ci-pipeline`: GitHub Actions workflow for testing, building, and publishing to npmjs.com

### Modified Capabilities

## Impact

- New npm package: `@errand-ai/paperclip-adapter`
- Dependency on `@paperclipai/adapter-utils` for type definitions and utilities
- Requires a running errand instance with MCP API key access
- Corresponding errand-side API enhancements tracked in a separate change (`paperclip-integration-api`)
