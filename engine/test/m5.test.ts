import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { parseBoard, BoardParseError } from "../src/board/parse.js";
import type { Tile } from "../src/board/types.js";
import { Store } from "../src/storage/db.js";
import { Executor } from "../src/run/executor.js";
import { verifyWebhookSignature } from "../src/run/notify.js";

const templatesDir = path.join(process.cwd(), "..", "templates");
const templateFiles = fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json")).sort();

function loadTemplate(name: string) {
  return JSON.parse(fs.readFileSync(path.join(templatesDir, name), "utf8"));
}

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-m5-"));
  return new Store(path.join(dir, "test.db"));
}

function given(store: Store, board: Record<string, unknown>, actionRunner: any) {
  const boardId = store.saveBoard("m5-board", board.tiles as unknown[], board.wires as unknown[]);
  const ex = new Executor(store, actionRunner);
  return { ex, boardId };
}

function stepsOf(store: Store, runId: string) {
  return (store as any).db.prepare("SELECT tile_id, decision, outcome FROM steps WHERE run_id=? ORDER BY step").all(runId);
}

function sign(secret: string, ts: number, rawBody: string) {
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}

describe("M5 board + templates (§15)", () => {
  describe("test_board_validate_roundtrip", () => {
    it("every seed template parses cleanly", () => {
      for (const file of templateFiles) {
        const board = loadTemplate(file);
        expect(() => parseBoard(board, file)).not.toThrow();
        const parsed = parseBoard(board, file);
        expect(parsed.format).toBe("patchbay.board");
        expect(parsed.version).toBe(1);
        expect(parsed.tiles.length).toBeGreaterThan(0);
      }
    });

    it("unknown tile kind is refused with a useful error", () => {
      const bad = loadTemplate("agency-outreach.json");
      bad.tiles[0].kind = "not-a-real-kind" as any;
      try {
        parseBoard(bad, "bad.board");
        throw new Error("expected parseBoard to throw");
      } catch (e) {
        expect(e).toBeInstanceOf(BoardParseError);
        expect((e as Error).message).toContain("unknown tile kind");
        expect((e as Error).message).toContain("not-a-real-kind");
        expect((e as Error).message).toContain("Valid kinds");
      }
    });
  });

  describe("test_webhook_signature", () => {
    const secret = "s3cr3t-key";

    it("accepts a valid signature", () => {
      const ts = Math.floor(Date.now() / 1000);
      const raw = JSON.stringify({ decision_token: `r1:t1:${ts}` });
      const sig = sign(secret, ts, raw);
      expect(verifyWebhookSignature({ secret, timestamp: ts, rawBody: raw, signature: sig })).toBe(true);
    });

    it("rejects a tampered body", () => {
      const ts = Math.floor(Date.now() / 1000);
      const raw = JSON.stringify({ decision_token: `r1:t1:${ts}` });
      const sig = sign(secret, ts, raw);
      const tampered = raw.replace("r1:t1:", "r1:t9:");
      expect(verifyWebhookSignature({ secret, timestamp: ts, rawBody: tampered, signature: sig })).toBe(false);
    });

    it("rejects a stale timestamp beyond ±300s", () => {
      const ts = Math.floor(Date.now() / 1000) - 400;
      const raw = JSON.stringify({ decision_token: "r1:t1:old" });
      const sig = sign(secret, ts, raw);
      expect(() => verifyWebhookSignature({ secret, timestamp: ts, rawBody: raw, signature: sig })).toThrow(/stale/);
    });

    it("fails closed on a missing secret", () => {
      const ts = Math.floor(Date.now() / 1000);
      const raw = JSON.stringify({ decision_token: "r1:t1:x" });
      const sig = sign("x", ts, raw);
      expect(() => verifyWebhookSignature({ secret: "", timestamp: ts, rawBody: raw, signature: sig })).toThrow(/closed/);
    });

    it("rejects a malformed signature", () => {
      const ts = Math.floor(Date.now() / 1000);
      const raw = JSON.stringify({ decision_token: "r1:t1:x" });
      expect(() => verifyWebhookSignature({ secret, timestamp: ts, rawBody: raw, signature: "garbage" })).toThrow(/malformed/);
    });
  });

  describe("test_no_secrets_in_export", () => {
    it("exported run and board contain no vault values", async () => {
      const store = makeStore();
      const calls: string[] = [];
      const actionRunner = async (t: Tile) => { calls.push(t.id); return { ran: t.id }; };
      const board = {
        format: "patchbay.board", version: 1, name: "m5-secret",
        tiles: [{ id: "pay", kind: "action", name: "Pay", risk: "read", source: { type: "http", method: "POST", url: "https://x" } }],
        wires: [],
      };
      const { ex, boardId } = given(store, board, actionRunner);
      // plant a value in the SQLite vault table (created lazily by Vault)
      (store as any).db.exec(
        `CREATE TABLE IF NOT EXISTS vault(key TEXT PRIMARY KEY, value_enc BLOB NOT NULL, updated_at TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT 'local')`,
      );
      const now = new Date().toISOString();
      (store as any).db.prepare("INSERT INTO vault(key,value_enc,updated_at,owner_id) VALUES(?,?,?,?)")
        .run("stripe_secret", Buffer.from("sk_live_never_export_this"), now, "local");

      const res = await ex.run(board as any, boardId);
      const runExport = store.exportRun(res.runId);
      const boardExport = store.exportBoard(boardId);

      const runText = JSON.stringify(runExport);
      const boardText = JSON.stringify(boardExport);
      expect(runText).not.toContain("sk_live_never_export_this");
      expect(boardText).not.toContain("sk_live_never_export_this");
      // the vault table itself is never part of either export
      expect((runExport.board as { tiles: { id: string }[] }).tiles.some((t) => t.id === "pay")).toBe(true);
    });
  });
});
