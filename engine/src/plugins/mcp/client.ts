import { spawn } from "node:child_process";

/** Minimal MCP stdio client. Connects to an MCP server over stdin/stdout,
 * speaks JSON-RPC 2.0, and exposes `initialize` + `tools/list` + `tools/call`.
 * No intermediary service — engine → MCP server directly (SPEC §6). */
export class McpClient {
  private proc: ReturnType<typeof spawn> | null = null;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private idSeq = 0;
  private stderrBuf = "";

  constructor(
    public readonly command: string[],
    public readonly cwd?: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const cmd = this.command[0];
      if (!cmd) { reject(new Error("mcp command is empty")); return; }
      const args = this.command.slice(1);
      this.proc = spawn(cmd, args, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"] });
      const p = this.proc;
      p.on("error", (e: Error) => { reject(e); this.proc = null; });
      p.on("exit", () => { this.proc = null; });

      let buf = "";
      p.stdout!.on("data", (d: Buffer) => {
        buf += d.toString();
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          try { this.handleLine(line); } catch { /* ignore malformed lines */ }
        }
      });
      p.stderr!.on("data", (d: Buffer) => { this.stderrBuf += d.toString(); });

      // MCP initialize handshake
      this.send("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: { roots: { listChanged: true } },
        clientInfo: { name: "patchbay", version: "0.1.0" },
      }).then(() => resolve(), (e: Error) => reject(e));
    });
  }

  private handleLine(line: string): void {
    const msg = JSON.parse(line);
    const id = msg.id;
    if (id === undefined) return; // notification, ignore
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (msg.error) { p.reject(new Error(String(msg.error?.message ?? "mcp error"))); }
    else { p.resolve(msg.result); }
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc) { reject(new Error("mcp client not connected")); return; }
      const id = ++this.idSeq;
      this.pending.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n";
      this.proc!.stdin!.write(msg);
    });
  }

  async listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]> {
    const result = await this.send("tools/list") as { tools?: unknown[] };
    const tools = result.tools ?? [];
    return tools.map((t: unknown) => {
      const tt = t as { name: string; description?: string; inputSchema?: unknown };
      return { name: tt.name, description: tt.description, inputSchema: tt.inputSchema };
    });
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const result = await this.send("tools/call", { name, arguments: args }) as { content?: unknown[]; isError?: boolean };
    if (result.isError) throw new Error(`mcp tool ${name} errored`);
    return result.content;
  }

  close(): void {
    this.proc?.kill("SIGTERM");
    this.proc = null;
    this.pending.forEach((p) => p.reject(new Error("mcp client closed")));
    this.pending.clear();
  }
}
