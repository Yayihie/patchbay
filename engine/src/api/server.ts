import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import type { Store } from "../storage/db.js";
import { ENGINE_VERSION } from "../version.js";
import { builtinActionRunner } from "../run/builtin.js";
import { Executor } from "../run/executor.js";
import { Enforcer } from "../agents/runner.js";
import { defaultTransport } from "../run/notify.js";
import type { NotifyTransport } from "../run/notify.js";
import type { BoardFile } from "../board/types.js";
import { parseBoard } from "../board/parse.js";
import { McpClient } from "../plugins/mcp/client.js";
import { loadManifest, integrityHash, toolRisk, pluginSource, type PluginManifest, type PluginTool } from "../plugins/mcp/manifest.js";

const DEFAULT_PORT = 7443;
const HOST = "127.0.0.1";

export interface ServerDeps {
  store: Store;
  actionRunner?: (tile: unknown, args: unknown) => Promise<unknown>;
  enforcer?: Enforcer;
  notify?: NotifyTransport;
  workspaceDir?: string;
}

function patchbayHome(): string {
  return process.env.PATCHBAY_HOME ?? path.join(os.homedir(), ".patchbay");
}

/** Generate (once) and return the local session token, persisted to
 * ~/.patchbay/session so the UI can authenticate against this engine. */
function sessionToken(): string {
  const home = patchbayHome();
  fs.mkdirSync(home, { recursive: true });
  const file = path.join(home, "session");
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, "utf8").trim();
  }
  const token = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("invalid JSON body")); }
    });
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createServer(deps: ServerDeps, port = DEFAULT_PORT): http.Server {
  const { store, enforcer, notify, workspaceDir } = deps;
  const actionRunner = deps.actionRunner ?? builtinActionRunner(workspaceDir);
  const executor = new Executor(store, actionRunner, { enforcer, notify });
  const token = sessionToken();

  const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ---- session auth (loopback-only engine, SPEC §11) ----
    const auth = req.headers["authorization"];
    if (!auth || !auth.startsWith("Bearer ")) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    if (auth.slice("Bearer ".length).trim() !== token) {
      json(res, 401, { error: "unauthorized" });
      return;
    }

    try {
      const url = new URL(req.url ?? "/", `http://${HOST}`);
      const pathname = url.pathname;
      const segments = pathname.split("/").filter(Boolean); // ["api","v1","boards","id","run"]

      // ---- health ----
      if (req.method === "GET" && segments.join("/") === "api/v1/health") {
        json(res, 200, { ok: true, version: ENGINE_VERSION });
        return;
      }

      // ---- boards list / create ----
      if (segments.join("/") === "api/v1/boards") {
        if (req.method === "GET") {
          const rows = (store.db.prepare(
            "SELECT id, name, version, created_at, updated_at FROM boards ORDER BY updated_at DESC"
          ).all() as { id: string; name: string; version: number; created_at: string; updated_at: string }[]);
          json(res, 200, rows);
          return;
        }
        if (req.method === "POST") {
          const body = await readBody(req);
          const board = parseBoard(body as unknown, "POST /api/v1/boards");
          const id = store.saveBoard(board.name, board.tiles as unknown[], board.wires as unknown[]);
          json(res, 201, { id, name: board.name, tiles: board.tiles.length, wires: board.wires.length });
          return;
        }
      }

      // ---- boards/:id (get) ----
      if (req.method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "v1" && segments[2] === "boards") {
        const id = segments[3]!;
        const b = store.getBoard(id);
        json(res, 200, { id, name: b.name, tiles: b.tiles, wires: b.wires });
        return;
        }

        // ---- boards/:id/run ----
        if (req.method === "POST" && segments.length === 5 && segments[0] === "api" && segments[1] === "v1" && segments[2] === "boards" && segments[4] === "run") {
        const id = segments[3]!;
        const b = store.getBoard(id);
        const board: BoardFile = {
          format: "patchbay.board",
          version: 1,
          name: b.name,
          tiles: b.tiles,
          wires: b.wires,
        };
        const result = await executor.run(board, id);
        json(res, 200, result);
        return;
      }

      // ---- runs/:id (get) ----
      if (req.method === "GET" && segments.length === 4 && segments[0] === "api" && segments[1] === "v1" && segments[2] === "runs") {
        const id = segments[3]!;
        const run = store.getRun(id);
        const steps = (store.db.prepare(
          "SELECT step,tile_id,decision,risk,outcome,started_at,finished_at,detail,output_json FROM steps WHERE run_id=? ORDER BY step"
        ).all(id) as { step: number; tile_id: string; decision: string; risk: string | null; outcome: string; started_at: string; finished_at: string | null; detail: string | null; output_json: string | null }[]);
        json(res, 200, {
          id: run.id,
          board_id: run.board_id,
          status: run.status,
          started_at: run.started_at,
          finished_at: run.finished_at,
          steps: steps.map(s => ({ ...s, output: s.output_json ? JSON.parse(s.output_json) : undefined })),
        });
        return;
      }

      // ---- runs/:id/approve ----
      if (req.method === "POST" && segments.length === 5 && segments[0] === "api" && segments[1] === "v1" && segments[2] === "runs" && segments[4] === "approve") {
        const id = segments[3]!;
        const body = await readBody(req);
        const { decision, note } = body as { decision: "approve" | "reject"; note?: string };
        if (decision !== "approve" && decision !== "reject") {
          json(res, 400, { error: "decision must be 'approve' or 'reject'" });
          return;
        }
        const run = store.getRun(id);
        const b2 = store.getBoard(run.board_id);
        const board2: BoardFile = {
          format: "patchbay.board",
          version: 1,
          name: b2.name,
          tiles: b2.tiles,
          wires: b2.wires,
        };
        const result = await executor.resume(board2, id, id, decision);
        json(res, 200, { runId: id, status: result.status, decision, note });
        return;
      }

      // ---- runs/:id/audit ----
      if (req.method === "GET" && segments.length === 5 && segments[0] === "api" && segments[1] === "v1" && segments[2] === "runs" && segments[4] === "audit") {
        const id = segments[3]!;
        const audit = store.auditForRun(id);
        json(res, 200, audit);
        return;
      }

      // ---- runs/:id/export ----
      if (req.method === "GET" && segments.length === 5 && segments[0] === "api" && segments[1] === "v1" && segments[2] === "runs" && segments[4] === "export") {
        const id = segments[3]!;
        const exportData = store.exportRun(id);
        json(res, 200, exportData);
        return;
      }

      // ---- plugins list / add ----
      if (segments.join("/") === "api/v1/plugins") {
        if (req.method === "GET") {
          const plugins = store.getPlugins().map(p => ({...JSON.parse(p.source_json), id: p.id, integrityHash: p.integrity_hash}));
          json(res, 200, plugins);
          return;
        }
        if (req.method === "POST") {
          const body = await readBody(req);
          const { command, url, manifestRef } = body as { command?: string[]; url?: string; manifestRef?: string };

          let manifest: PluginManifest | undefined;
          if (manifestRef) {
            manifest = await loadManifest(manifestRef);
          }

          const transport = command ? "stdio" : "http";
          const cmd = command ?? (url ? [url] : []);

          const client = new McpClient(cmd);
          await client.connect();
          const mcpTools = await client.listTools();
          client.close();

          const tools: PluginTool[] = mcpTools.map(t => ({
            name: t.name,
            description: t.description ?? "",
            risk: toolRisk(t.name, manifest),
            source: "mcp",
          }));

          const id = crypto.randomUUID();
          const sourceJson = pluginSource(manifest, tools);
          const ih = transport === "stdio" && cmd.length > 0 ? integrityHash(cmd) : null;
          store.savePlugin(id, manifest?.name ?? (url ?? "plugin"), manifest?.version ?? "1.0.0", sourceJson, ih);
          store.saveMcpCache(id, "__all__", JSON.stringify(mcpTools));

          json(res, 201, { id, name: manifest?.name ?? (url ?? "plugin"), tools: tools.length });
          return;
        }
      }

      // ---- plugins/:id/refresh ----
      if (req.method === "POST" && segments.length === 5 && segments[0] === "api" && segments[1] === "v1" && segments[2] === "plugins" && segments[4] === "refresh") {
        const id = segments[3]!;
        const p = store.getPlugin(id);
        if (!p) { json(res, 404, { error: "plugin not found" }); return; }
        const src = JSON.parse(p.source_json) as { manifest?: PluginManifest; tools: PluginTool[] };
        const manifest = src.manifest;
        const cmd = manifest?.transport === "stdio" && manifest.command ? manifest.command : [];
        const client = new McpClient(cmd);
        await client.connect();
        const mcpTools = await client.listTools();
        client.close();

        const tools: PluginTool[] = mcpTools.map(t => ({
          name: t.name,
          description: t.description ?? "",
          risk: toolRisk(t.name, manifest),
          source: "mcp",
        }));
        store.savePlugin(id, manifest?.name ?? p.name, manifest?.version ?? p.version, pluginSource(manifest, tools), p.integrity_hash);
        store.saveMcpCache(id, "__all__", JSON.stringify(mcpTools));
        json(res, 200, { id, tools: tools.length });
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      json(res, 500, { error: msg });
    }
  });

  server.listen(port, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`patchbay engine listening on http://${HOST}:${port}`);
  });

  return server;
}
