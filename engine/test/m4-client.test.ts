import { it, expect } from "vitest";
import { McpClient } from "../src/plugins/mcp/client.js";

it("connects to reference MCP server", async () => {
  const client = new McpClient(["node", "engine/test/fixtures/reference-mcp-server.js"]);
  await client.connect();
  const tools = await client.listTools();
  client.close();
  expect(tools.map(t => t.name).sort()).toEqual(["delete_file", "read_file"]);
});
