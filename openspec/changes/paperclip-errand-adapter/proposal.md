## Why

Paperclip is an agent workforce orchestrator that delegates tasks to adapter-backed runtimes (Claude Code, Codex, Gemini, etc.). Errand is a task execution engine that runs agentic workloads in isolated containers with MCP tool access, multi-model support via LiteLLM, and configurable task profiles. Publishing an errand adapter as a public npm package allows any Paperclip instance to use errand as a backend execution engine — combining Paperclip's agent hierarchy and task delegation with errand's containerised execution, tool ecosystem, and persistent memory.

## What Changes

- Create the `@errand-ai/paperclip-adapter` npm package implementing Paperclip's `ServerAdapterModule` interface
- Implement `execute()` — creates an errand task via MCP, polls for completion, streams execution events for transcript rendering, returns structured result
- Implement `testEnvironment()` — validates connectivity and authentication against the errand instance
- Implement `listModels()` — fetches errand task profiles and maps them as selectable "models"
- Implement `getConfigSchema()` — returns declarative form fields (URL, API key, timeout) for Paperclip's auto-rendered config UI
- Support instructions bundle (AGENT.md, SOUL.md, HEARTBEAT.md) and prompt template for prompt construction
- Provide `./ui-parser` export for transcript rendering — maps errand execution events to Paperclip TranscriptEntry types
- Provide `./server` export with instantiated adapter module
- Create GitHub Actions CI pipeline to test, build, and publish via OIDC trusted publishers

## Capabilities

### New Capabilities
- `adapter-execute`: Execute Paperclip tasks via errand's task API with transcript event streaming and result retrieval
- `adapter-config`: Declarative configuration schema, environment testing, instructions bundle support, and adapter capabilities for Paperclip UI integration
- `transcript-rendering`: UI parser mapping errand task-runner events to Paperclip transcript entries (system messages, tool calls, thinking, assistant output)
- `ci-pipeline`: GitHub Actions workflow for testing, building, and publishing to npmjs.com via OIDC trusted publishers

### Modified Capabilities

- `adapter-execute`: Derive human-friendly errand task titles from Paperclip wake context (issue identifier, task key, wake reason) instead of opaque run UUIDs, for easier identification on the errand dashboard

## Impact

- New npm package: `@errand-ai/paperclip-adapter`
- Dependencies on `@paperclipai/adapter-utils` and `@paperclipai/plugin-sdk`
- Requires a running errand instance with MCP API key access
- Installed via Paperclip's adapter plugin system (API/UI), not `paperclipai plugin install`
