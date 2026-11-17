#!/usr/bin/env node
/** Reference MCP server for Patchbay M4 tests.
 * Exposes two tools: `read_file` (risk: read) and `delete_file` (risk: irreversible).
 * Speaks MCP stdio JSON-RPC 2.0. */
const { spawn } = await import("node:child_process");

// Minimal stdio JSON-RPC 2.0 server
let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    handleLine(line);
  }
});

function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};

  let result;
  if (method === "initialize") {
    result = {
      protocolVersion: "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "reference-mcp-server", version: "1.0.0" },
    };
  } else if (method === "tools/list") {
    result = {
      tools: [
        {
          name: "read_file",
          description: "Read a file (read risk)",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
        {
          name: "delete_file",
          description: "Delete a file (irreversible risk)",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    };
  } else if (method === "tools/call") {
    if (params.name === "read_file") {
      result = { content: [{ type: "text", text: "file contents" }] };
    } else if (params.name === "delete_file") {
      result = { content: [{ type: "text", text: "deleted" }] };
    } else {
      sendError(id, -32601, `unknown tool ${params.name}`);
      return;
    }
  } else {
    sendError(id, -32601, `unknown method ${method}`);
    return;
  }

  if (id !== undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }
}

function sendError(id, code, message) {
  if (id !== undefined) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
  }
}
