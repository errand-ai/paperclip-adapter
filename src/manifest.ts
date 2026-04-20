import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "errand-ai.paperclip-adapter",
  apiVersion: 1,
  version: "0.1.2",
  displayName: "Errand Adapter",
  description: "Paperclip adapter that delegates task execution to Errand AI via MCP tools with SSE log streaming",
  author: "Errand AI",
  categories: ["connector"],
  capabilities: [],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
