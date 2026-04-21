# @errand-ai/paperclip-adapter

A [Paperclip](https://paperclip.ing) adapter that delegates agent task execution to [Errand AI](https://errand.sh) — a containerised task execution engine with MCP tool access, multi-model support, and configurable task profiles.

## How it works

When Paperclip dispatches a task to an agent configured with this adapter:

1. The adapter creates an errand task via MCP (`new_task`) with the prompt and selected profile
2. Logs are streamed back to Paperclip in real-time via SSE
3. Task status is polled until completion, review, or timeout
4. The result is returned to Paperclip as an `AdapterExecutionResult`

Errand task profiles map to Paperclip's model selector — each profile bundles a model, system prompt, max turns, and tool configuration.

## Installation

```bash
paperclipai plugin install @errand-ai/paperclip-adapter
```

Or install directly via npm:

```bash
npm install @errand-ai/paperclip-adapter
```

## Configuration

Once installed, configure the adapter in Paperclip's agent settings:

| Field | Description |
|-------|-------------|
| **Errand URL** | Base URL of your errand instance (e.g. `https://errand.example.com`) |
| **API Key** | MCP API key for authenticating with errand |
| **Timeout** | Maximum execution time in seconds (default: 600) |

The **Model** dropdown will automatically populate with errand's available task profiles.

## Prerequisites

- A running [errand](https://github.com/errand-ai/errand) instance
- An MCP API key configured on the errand instance
- The errand instance must have the `paperclip-integration-api` enhancements deployed (for SSE log streaming with API key auth)

## Development

```bash
npm install
npm run lint    # type-check
npm test        # run tests
npm run build   # compile to dist/
```

## License

Apache-2.0
