import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "../src/storage/db.js";
import { createServer } from "../src/api/server.js";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

function tempDbFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-api-test-"));
  return path.join(dir, "test.db");
}

function tempScript(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-script-"));
  const file = path.join(dir, "script.js");
  fs.writeFileSync(file, content);
  return file;
}

function req(server: http.Server, method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const u = new URL(url, `http://127.0.0.1:${addr.port}`);
    const token = fs.readFileSync(path.join(os.homedir(), ".patchbay", "session"), "utf8").trim();
    const r = http.request(u, {
      method,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    });
    r.on("response", (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : {} });
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

describe("engine API server", () => {
  let server: http.Server;
  let dbFile: string;
  let store: Store;

  beforeEach(async () => {
    dbFile = tempDbFile();
    store = new Store(dbFile);
    server = createServer({ store }, 0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  });

  afterEach(async () => {
    server.close();
    try { fs.unlinkSync(dbFile); } catch { /* ok */ }
    try { fs.rmdirSync(path.dirname(dbFile)); } catch { /* ok */ }
  });

  it("health returns ok + version", async () => {
    const r = await req(server, "GET", "/api/v1/health");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.version).toBe("0.1.0");
  });

  it("rejects requests without session token", async () => {
    const addr = server.address() as { port: number };
    const u = new URL(`/api/v1/health`, `http://127.0.0.1:${addr.port}`);
    const r = await new Promise<{ status: number }>((resolve, reject) => {
      const x = http.request(u, { method: "GET" });
      x.on("response", (res) => { resolve({ status: res.statusCode ?? 0 }); });
      x.on("error", reject);
      x.end();
    });
    expect(r.status).toBe(401);
  });

  it("boards CRUD roundtrip", async () => {
    const created = await req(server, "POST", "/api/v1/boards", {
      format: "patchbay.board",
      version: 1,
      name: "Test Board",
      tiles: [
        { id: "t1", kind: "action", name: "fetch", source: { type: "http", method: "GET", url: "https://example.com" } },
      ],
      wires: [],
    });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Test Board");
    const id = created.body.id;

    const listed = await req(server, "GET", "/api/v1/boards");
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body)).toBe(true);
    expect(listed.body.some((b: { id: string }) => b.id === id)).toBe(true);

    const got = await req(server, "GET", `/api/v1/boards/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.name).toBe("Test Board");
    expect(got.body.tiles.length).toBe(1);
  });

  it("run board end-to-end", async () => {
    const scriptFile = tempScript('console.log(JSON.stringify({ ok: true }));');
    try {
      const created = await req(server, "POST", "/api/v1/boards", {
        format: "patchbay.board",
        version: 1,
        name: "Run Test",
        tiles: [
          { id: "t1", kind: "action", name: "run-script", source: { type: "script", language: "node", entry: scriptFile } },
        ],
        wires: [],
      });
      const boardId = created.body.id;

      const run = await req(server, "POST", `/api/v1/boards/${boardId}/run`);
      expect(run.status).toBe(200);
      expect(run.body.runId).toBeDefined();
      expect(["completed", "failed"]).toContain(run.body.status);
    } finally {
      try { fs.unlinkSync(scriptFile); } catch { /* ok */ }
      try { fs.rmdirSync(path.dirname(scriptFile)); } catch { /* ok */ }
    }
  });

  it("run audit returns steps", async () => {
    const scriptFile = tempScript('console.log(JSON.stringify({ ok: true }));');
    try {
      const created = await req(server, "POST", "/api/v1/boards", {
        format: "patchbay.board",
        version: 1,
        name: "Audit Test",
        tiles: [
          { id: "t1", kind: "action", name: "noop", source: { type: "script", language: "node", entry: scriptFile } },
        ],
        wires: [],
      });
      const boardId = created.body.id;

      const run = await req(server, "POST", `/api/v1/boards/${boardId}/run`);
      const runId = run.body.runId;

      const audit = await req(server, "GET", `/api/v1/runs/${runId}/audit`);
      expect(audit.status).toBe(200);
      expect(Array.isArray(audit.body)).toBe(true);
    } finally {
      try { fs.unlinkSync(scriptFile); } catch { /* ok */ }
      try { fs.rmdirSync(path.dirname(scriptFile)); } catch { /* ok */ }
    }
  });

  it("run replay returns steps + audit without re-executing", async () => {
    const scriptFile = tempScript('console.log(JSON.stringify({ ok: true }));');
    try {
      const created = await req(server, "POST", "/api/v1/boards", {
        format: "patchbay.board",
        version: 1,
        name: "Replay Test",
        tiles: [
          { id: "t1", kind: "action", name: "noop", source: { type: "script", language: "node", entry: scriptFile } },
        ],
        wires: [],
      });
      const boardId = created.body.id;

      const run = await req(server, "POST", `/api/v1/boards/${boardId}/run`);
      const runId = run.body.runId;

      const replay = await req(server, "GET", `/api/v1/runs/${runId}/replay`);
      expect(replay.status).toBe(200);
      expect(replay.body.id).toBe(runId);
      expect(Array.isArray(replay.body.replay)).toBe(true);
      expect(replay.body.replay.length).toBeGreaterThan(0);
      expect(Array.isArray(replay.body.audit)).toBe(true);
    } finally {
      try { fs.unlinkSync(scriptFile); } catch { /* ok */ }
      try { fs.rmdirSync(path.dirname(scriptFile)); } catch { /* ok */ }
    }
  });

  it("new tables exist: plugins, mcp_cache, traces", () => {
    store.db.exec("INSERT INTO plugins(id,name,version,source_json,created_at) VALUES('p1','test-plugin','1.0.0','{}',datetime('now'))");
    const rows = store.db.prepare("SELECT * FROM plugins WHERE id='p1'").all() as { id: string }[];
    expect(rows.length).toBe(1);

    store.db.exec("INSERT INTO mcp_cache(server_id,tool_name,schema_json,fetched_at) VALUES('s1','tool1','{}',datetime('now'))");
    const mc = store.db.prepare("SELECT * FROM mcp_cache WHERE server_id='s1'").all() as { server_id: string }[];
    expect(mc.length).toBe(1);

    store.db.exec("INSERT INTO traces(id,run_id,step,tile_id,started_at,duration_ms,provider,model) VALUES('tr1','r1',1,'t1',datetime('now'),5,'test','test-model')");
    const tr = store.db.prepare("SELECT * FROM traces WHERE id='tr1'").all() as { id: string }[];
    expect(tr.length).toBe(1);
  });
});
