import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { Tile, Wire } from "../board/types.js";
import os from "node:os";
import fs from "node:fs";

export function patchbayHome(): string {
  return process.env.PATCHBAY_HOME ?? path.join(os.homedir(), ".patchbay");
}

const OWNER_ID = "local"; // single local user in v1; column exists from day one

export class Store {
  readonly db: DatabaseSync;

  constructor(file?: string) {
    const home = patchbayHome();
    fs.mkdirSync(home, { recursive: true });
    this.db = new DatabaseSync(file ?? path.join(home, "patchbay.db"));
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS boards(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '${OWNER_ID}');
      CREATE TABLE IF NOT EXISTS tiles(
        id TEXT NOT NULL, board_id TEXT NOT NULL REFERENCES boards(id), kind TEXT NOT NULL,
        name TEXT NOT NULL, spec_json TEXT NOT NULL, position_x REAL, position_y REAL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '${OWNER_ID}',
        PRIMARY KEY (board_id, id));
      CREATE TABLE IF NOT EXISTS wires(
        id TEXT NOT NULL, board_id TEXT NOT NULL REFERENCES boards(id), kind TEXT NOT NULL,
        from_tile TEXT NOT NULL, to_tile TEXT NOT NULL, spec_json TEXT NOT NULL,
        owner_id TEXT NOT NULL DEFAULT '${OWNER_ID}', PRIMARY KEY (board_id, id));
      CREATE TABLE IF NOT EXISTS runs(
        id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), status TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, cost_usd REAL NOT NULL DEFAULT 0,
        paused_at TEXT, paused_tile_id TEXT, paused_args_json TEXT,
        owner_id TEXT NOT NULL DEFAULT '${OWNER_ID}');
      CREATE TABLE IF NOT EXISTS steps(
        run_id TEXT NOT NULL REFERENCES runs(id), step INTEGER NOT NULL, tile_id TEXT NOT NULL,
        decision TEXT NOT NULL, risk TEXT, outcome TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, detail TEXT, output_json TEXT,
        owner_id TEXT NOT NULL DEFAULT '${OWNER_ID}', PRIMARY KEY (run_id, step));
      CREATE TABLE IF NOT EXISTS audit(
        run_id TEXT NOT NULL, step INTEGER NOT NULL, tile_id TEXT NOT NULL, tool TEXT,
        args_hash TEXT, args_redacted_json TEXT, decision TEXT NOT NULL, approver TEXT,
        started_at TEXT NOT NULL, finished_at TEXT, outcome TEXT NOT NULL, detail TEXT,
        owner_id TEXT NOT NULL DEFAULT '${OWNER_ID}', PRIMARY KEY (run_id, step, tile_id, started_at));
      CREATE TABLE IF NOT EXISTS memory(
        id TEXT PRIMARY KEY, agent_tile_id TEXT NOT NULL, board_id TEXT NOT NULL,
        content TEXT NOT NULL, created_at TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '${OWNER_ID}');
      CREATE TABLE IF NOT EXISTS tables(
        id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), name TEXT NOT NULL,
        schema_json TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '${OWNER_ID}');
      CREATE TABLE IF NOT EXISTS table_rows(
        id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES tables(id), data_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '${OWNER_ID}');
    `);
  }

  saveBoard(name: string, tiles: unknown[], wires: unknown[]): string {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const tileRows = tiles as { id: string; kind: string; name: string; positionX?: number; positionY?: number }[];
    const wireRows = wires as { id: string; kind: string; from: string; to: string }[];
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT INTO boards(id,name,version,created_at,updated_at) VALUES(?,?,1,?,?)")
        .run(id, name, now, now);
      const t = this.db.prepare(
        "INSERT INTO tiles(id,board_id,kind,name,spec_json,position_x,position_y,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
      for (const tile of tileRows) {
        t.run(tile.id, id, tile.kind, tile.name, JSON.stringify(tile), tile.positionX ?? null, tile.positionY ?? null, now, now);
      }
      const wi = this.db.prepare(
        "INSERT INTO wires(id,board_id,kind,from_tile,to_tile,spec_json) VALUES(?,?,?,?,?,?)");
      for (const wire of wireRows) {
        wi.run(wire.id, id, wire.kind, wire.from, wire.to, JSON.stringify(wire));
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return id;
  }

  newRun(boardId: string): string {
    const id = crypto.randomUUID();
    this.db.prepare("INSERT INTO runs(id,board_id,status,started_at) VALUES(?,?,?,?)")
      .run(id, boardId, "running", new Date().toISOString());
    return id;
  }

  recordStep(runId: string, step: number, tileId: string, decision: string,
             outcome: string, startedAt: string, detail?: string, risk?: string): void {
    this.db.prepare(
      `INSERT INTO steps(run_id,step,tile_id,decision,risk,outcome,started_at,finished_at,detail)
       VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(runId, step, tileId, decision, risk ?? null, outcome, startedAt,
           new Date().toISOString(), detail ?? null);
  }

  setRunStatus(runId: string, status: string, costUsd = 0): void {
    this.db.prepare("UPDATE runs SET status=?, finished_at=?, cost_usd=? WHERE id=?")
      .run(status, new Date().toISOString(), costUsd, runId);
  }

  runStatus(runId: string): { id: string; status: string; started_at: string; finished_at: string | null } {
    const row = this.db.prepare("SELECT id,status,started_at,finished_at FROM runs WHERE id=?").get(runId) as
      { id: string; status: string; started_at: string; finished_at: string | null } | undefined;
    if (!row) throw new Error(`no run ${runId}`);
    return row;
  }

  recordAudit(entry: {
    runId: string; step: number; tileId: string; tool?: string;
    argsHash?: string; argsRedacted?: unknown; decision: string; approver?: string;
    outcome: string; detail?: string; risk?: string;
  }): void {
    this.db.prepare(
      `INSERT INTO audit(run_id,step,tile_id,tool,args_hash,args_redacted_json,decision,approver,
                        started_at,finished_at,outcome,detail)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(entry.runId, entry.step, entry.tileId, entry.tool ?? null, entry.argsHash ?? null,
           entry.argsRedacted === undefined ? null : JSON.stringify(entry.argsRedacted),
           entry.decision, entry.approver ?? null, new Date().toISOString(),
           new Date().toISOString(), entry.outcome, entry.detail ?? null);
  }

  auditForRun(runId: string): { step: number; tile_id: string; decision: string; outcome: string }[] {
    return this.db.prepare(
      "SELECT step,tile_id,decision,outcome FROM audit WHERE run_id=? ORDER BY step").all(runId) as
      { step: number; tile_id: string; decision: string; outcome: string }[];
  }

  writeMemory(agentTileId: string, boardId: string, content: string, maxEntries = 500): void {
    this.db.prepare("INSERT INTO memory(id,agent_tile_id,board_id,content,created_at) VALUES(?,?,?,?,?)")
      .run(crypto.randomUUID(), agentTileId, boardId, content, new Date().toISOString());
    // LRU trim: oldest first
    this.db.prepare(
      `DELETE FROM memory WHERE agent_tile_id=? AND id NOT IN (
         SELECT id FROM memory WHERE agent_tile_id=? ORDER BY rowid DESC LIMIT ?)`)
      .run(agentTileId, agentTileId, maxEntries);
  }

  readMemory(agentTileId: string): string[] {
    return (this.db.prepare(
      "SELECT content FROM memory WHERE agent_tile_id=? ORDER BY rowid DESC")
      .all(agentTileId) as { content: string }[]).map((r) => r.content);
  }

  createTable(boardId: string, name: string, columns: { name: string; type: string }[]): string {
    const id = crypto.randomUUID();
    this.db.prepare("INSERT INTO tables(id,board_id,name,schema_json) VALUES(?,?,?,?)")
      .run(id, boardId, name, JSON.stringify(columns));
    return id;
  }

  insertTableRow(tableId: string, data: unknown): void {
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO table_rows(id,table_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?)")
      .run(crypto.randomUUID(), tableId, JSON.stringify(data), now, now);
  }

  readTableRows(tableId: string): unknown[] {
    return (this.db.prepare("SELECT data_json FROM table_rows WHERE table_id=? ORDER BY created_at")
      .all(tableId) as { data_json: string }[]).map((r) => JSON.parse(r.data_json));
  }

  getBoard(boardId: string): { id: string; name: string; tiles: Tile[]; wires: Wire[] } {
    const row = this.db.prepare("SELECT name, tiles_json, wires_json FROM boards WHERE id=?").get(boardId) as { name: string; tiles_json: string; wires_json: string } | undefined;
    if (!row) throw new Error(`no board ${boardId}`);
    return { id: boardId, name: row.name, tiles: JSON.parse(row.tiles_json), wires: JSON.parse(row.wires_json) };
  }

  getRun(runId: string): { id: string; board_id: string; status: string; started_at: string; finished_at: string | null; paused_tile_id: string | null; paused_args_json: string | null } {
    const row = this.db.prepare("SELECT id,board_id,status,started_at,finished_at,paused_tile_id,paused_args_json FROM runs WHERE id=?").get(runId) as any;
    if (!row) throw new Error(`no run ${runId}`);
    return row;
  }

  completedSteps(runId: string): Map<string, unknown> {
    const rows = this.db.prepare("SELECT tile_id, output_json FROM steps WHERE run_id=? AND output_json IS NOT NULL").all(runId) as { tile_id: string; output_json: string }[];
    const m = new Map<string, unknown>();
    for (const r of rows) { try { m.set(r.tile_id, JSON.parse(r.output_json)); } catch { /* skip */ } }
    return m;
  }

  recordStepWithOutput(runId: string, step: number, tileId: string, decision: string,
                       outcome: string, startedAt: string, output: unknown, detail?: string, risk?: string): void {
    this.db.prepare(
      `INSERT INTO steps(run_id,step,tile_id,decision,risk,outcome,started_at,finished_at,detail,output_json)
       VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(runId, step, tileId, decision, risk ?? null, outcome, startedAt,
           new Date().toISOString(), detail ?? null, output === undefined ? null : JSON.stringify(output));
  }

  pauseRun(runId: string, tileId: string, args: unknown): void {
    this.db.prepare("UPDATE runs SET status='paused', paused_at=?, paused_tile_id=?, paused_args_json=? WHERE id=?")
      .run(new Date().toISOString(), tileId, JSON.stringify(args), runId);
  }

  resumeRun(runId: string, decision: "approve" | "reject" | "auto", approver: string): void {
    this.db.prepare("UPDATE runs SET status='running', paused_at=NULL, paused_tile_id=NULL, paused_args_json=NULL WHERE id=?")
      .run(runId);
    this.recordAudit({
      runId, step: 0, tileId: "engine", tool: "approval", decision, outcome: decision === "reject" ? "blocked" : "ok",
      approver, detail: `approval ${decision}`,
    });
  }

  autoApprovalsInWindow(tool: string, since: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) n FROM audit WHERE decision='auto' AND tool=? AND started_at > ?").get(tool, since) as { n: number };
    return row.n;
  }

  close(): void { this.db.close(); }
}
