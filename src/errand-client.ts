export interface TaskProfile {
  name: string;
  description?: string;
}

export interface TaskStatus {
  id: string;
  status: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

export class ErrandClient {
  private nextId = 1;

  private readonly url: string;

  constructor(
    url: string,
    private readonly apiKey: string,
  ) {
    this.url = url.replace(/\/+$/, "");
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    };

    const response = await fetch(`${this.url}/mcp/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as JsonRpcResponse;

    if (json.error) {
      throw new Error(`MCP error: ${json.error.message}`);
    }

    if (json.result?.isError) {
      const text = json.result.content?.find((c) => c.type === "text")?.text ?? "Unknown error";
      throw new Error(`Tool error: ${text}`);
    }

    const textContent = json.result?.content?.find((c) => c.type === "text");
    return textContent?.text ?? "";
  }

  async newTask(description: string, profile?: string): Promise<string> {
    const args: Record<string, unknown> = { description };
    if (profile) {
      args.profile = profile;
    }
    const result = await this.callTool("new_task", args);
    return result.trim();
  }

  async taskStatus(taskId: string): Promise<TaskStatus> {
    const result = await this.callTool("task_status", { task_id: taskId, format: "json" });
    return JSON.parse(result) as TaskStatus;
  }

  async taskOutput(taskId: string): Promise<string> {
    return await this.callTool("task_output", { task_id: taskId });
  }

  async listTaskProfiles(): Promise<TaskProfile[]> {
    const result = await this.callTool("list_task_profiles", {});
    return JSON.parse(result) as TaskProfile[];
  }
}
