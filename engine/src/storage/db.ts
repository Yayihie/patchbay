import { DatabaseSync } from "node:sqlite";
import path from "node:path";
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
        owner_id TEXT NOT NULL DEFAULT '${OWNER_ID}');
      CREATE TABLE IF NOT EXISTS steps(
        run_id TEXT NOT NULL REFERENCES runs(id), step INTEGER NOT NULL, tile_id TEXT NOT NULL,
        decision TEXT NOT NULL, risk TEXT, outcome TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, detail TEXT,
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

  close(): void { this.db.close(); }
}
