import { describe, it, expect } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { builtinActionRunner } from "../src/run/builtin.js";

describe("builtin action runners", () => {
  it("http runner returns status and parsed body", async () => {
    const server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, echo: req.headers["x-test"] }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const run = builtinActionRunner();
      const out = await run(
        { id: "a", kind: "action", name: "h",
          source: { type: "http", method: "GET", url: `http://127.0.0.1:${port}/`, headers: { "x-test": "1" } } },
        {},
      );
      expect(out).toEqual({ status: 200, body: { ok: true, echo: "1" } });
    } finally { server.close(); }
  });

  it("script runner executes a node script and parses its JSON stdout", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-script-"));
    const entry = path.join(dir, "act.js");
    fs.writeFileSync(entry, "process.stdout.write(JSON.stringify({ sum: 2 + 3 }));\n");
    const run = builtinActionRunner(dir);
    const out = await run(
      { id: "b", kind: "action", name: "s", source: { type: "script", language: "node", entry: "act.js" } },
      {},
    );
    expect(out).toEqual({ sum: 5 });
  });
});
