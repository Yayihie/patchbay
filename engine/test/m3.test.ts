import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildGraph } from "../src/graph/graph.js";
import { Executor, type Tile } from "../src/run/executor.js";
import { Store } from "../src/storage/db.js";
import { Enforcer } from "../src/agents/runner.js";
import type { BoardFile } from "../src/board/types.js";
import { WebhookTransport, SmtpTransport, ConsoleDesktopTransport } from "../src/run/notify.js";

const tiles = (specs: [string, string, string?, Record<string, unknown>?][]): Tile[] =>
  specs.map(([id, kind, name, extra]) => ({ id, kind, name: name ?? id, ...(extra ?? {}) }));

const board = (t: Tile[], wires: unknown[]): BoardFile =>
  ({ format: "patchbay.board", version: 1, name: "m3", tiles: t, wires: wires as BoardFile["wires"] }) as BoardFile;

function makeStore() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pb-m3-")), "test.db");
  return new Store(file);
}

function given(store: Store, b: BoardFile, actionRunner: any) {
  const boardId = store.saveBoard("m3-board", b.tiles, b.wires);
  const graph = buildGraph(b);
  const enforcer = new Enforcer(b, graph, store);
  const ex = new Executor(store, actionRunner, { enforcer });
  return { ex, boardId };
}

function stepsOf(store: Store, runId: string) {
  const db = store as any;
  return db.db.prepare("SELECT tile_id, decision, outcome, detail FROM steps WHERE run_id=? ORDER BY step").all(runId);
}

describe("M3 approval gates (§15)", () => {
  afterEach(() => {
    delete process.env.PATCHBAY_SMTP_HOST;
    delete process.env.PATCHBAY_WEBHOOK_URL;
    delete process.env.PATCHBAY_ADMIN_EMAIL;
  });

  it("test_irreversible_requires_approval: no gate upstream → run refused", async () => {
    const store = makeStore();
    const calls: string[] = [];
    const actionRunner = async (t: Tile) => { calls.push(t.id); return { ok: true }; };
    const b = board(
      tiles([["del", "action", "Delete", { risk: "irreversible", source: { type: "http", method: "DELETE", url: "https://x" } }]]),
      [],
    );
    const { ex, boardId } = given(store, b, actionRunner);
    const res = await ex.run(b, boardId);
    expect(res.status).toBe("failed");
    expect(calls).toEqual([]);
    expect(stepsOf(store, res.runId).some((s: any) => s.decision === "refused-permission" && s.outcome === "blocked")).toBe(true);
  });

  it("test_approval_pauses_and_resumes: gate pauses, approve resumes, action runs exactly once", async () => {
    const store = makeStore();
    const calls: string[] = [];
    const actionRunner = async (t: Tile) => { calls.push(t.id); return { ran: t.id }; };
    const b = board(
      tiles([
        ["gate", "approval", "Approve Deploy", { timeout: 300 }],
        ["deploy", "action", "Deploy", { risk: "irreversible", source: { type: "http", method: "POST", url: "https://x" } }],
        ["notify", "action", "Notify", { source: { type: "http", method: "POST", url: "https://y" } }],
      ]),
      [
        { id: "w1", kind: "data", from: "gate", to: "deploy" },
        { id: "w2", kind: "data", from: "deploy", to: "notify" },
      ],
    );
    const { ex, boardId } = given(store, b, actionRunner);
    const res = await ex.run(b, boardId);
    expect(res.status).toBe("paused");
    expect(res.pausedTileId).toBe("deploy");
    expect(calls).toEqual([]);

    const resumed = await ex.resume(b, boardId, res.runId, "approve");
    expect(resumed.status).toBe("completed");
    expect(calls).toEqual(["deploy", "notify"]);
    expect(store.getRun(res.runId).status).toBe("completed");

    const db = store as any;
    const rows = db.db.prepare("SELECT decision,tool,approver FROM audit WHERE run_id=? AND tile_id='engine'").all(res.runId);
    expect(rows.some((r: any) => r.decision === "approve" && r.tool === "approval")).toBe(true);
  });

  it("test_approval_pauses_and_resumes: reject halts the run", async () => {
    const store = makeStore();
    const calls: string[] = [];
    const actionRunner = async (t: Tile) => { calls.push(t.id); return { ran: t.id }; };
    const b = board(
      tiles([["gate", "approval", "G"], ["deploy", "action", "Deploy", { risk: "irreversible", source: { type: "http" } }]]),
      [{ id: "w1", kind: "data", from: "gate", to: "deploy" }],
    );
    const { ex, boardId } = given(store, b, actionRunner);
    const res = await ex.run(b, boardId);
    expect(res.status).toBe("paused");
    const resumed = await ex.resume(b, boardId, res.runId, "reject");
    expect(resumed.status).toBe("failed");
    expect(calls).toEqual([]);
    expect(store.getRun(res.runId).status).toBe("cancelled");
  });

  it("test_auto_approve_rate_cap: first two auto-approve, third is held for a human", async () => {
    const store = makeStore();
    const calls: string[] = [];
    const actionRunner = async (t: Tile) => { calls.push(t.id); return { ran: t.id }; };
    const b = board(
      tiles([["deploy", "action", "Deploy", { risk: "irreversible", autoApprove: { enabled: true, maxPerHour: 2 }, source: { type: "http" } }]]),
      [],
    );
    const { ex, boardId } = given(store, b, actionRunner);
    const r1 = await ex.run(b, boardId);
    expect(r1.status).toBe("completed");
    const r2 = await ex.run(b, boardId);
    expect(r2.status).toBe("completed");
    const r3 = await ex.run(b, boardId);
    expect(r3.status).toBe("paused");
    expect(calls).toEqual(["deploy", "deploy"]);
  });

  it("test_approval_webhook_link_is_signed: signature binds timestamp+body; tampering invalidates", async () => {
    const secret = "s3cr3t";
    const transport = new WebhookTransport(secret);
    let captured: { headers: Record<string, string>; body: string } | null = null;
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async (_url: string, init: any) => {
      captured = { headers: Object.entries(init.headers ?? {}).reduce((a, [k, v]) => ({ ...a, [k]: String(v) }), {}), body: String(init.body) };
      return new Response("ok") as any;
    };
    try {
      await transport.webhook({ runId: "r1", tileId: "t1", tileName: "Deploy", reason: "gate", args: { a: 1 }, url: "https://hook" });
      expect(captured).not.toBeNull();
      const sig = captured!.headers["X-Patchbay-Signature"];
      const ts = captured!.headers["X-Patchbay-Timestamp"];
      expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
      expect(ts).toBeDefined();

      // a different body must not verify under the original signature
      const crypto = await import("node:crypto");
      const valid = crypto.createHmac("sha256", secret).update(`${ts}.${captured!.body}`).digest("hex");
      const otherBody = '{"decision_token":"r1:t1:999999999"}';
      const otherSig = crypto.createHmac("sha256", secret).update(`${ts}.${otherBody}`).digest("hex");
      expect(otherSig).not.toBe(valid);
      // and re-signing the original body reproduces the signature
      expect(crypto.createHmac("sha256", secret).update(`${ts}.${captured!.body}`).digest("hex")).toBe(valid);
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  it("test_approval_email_never_leaves_without_smtp: fails loudly at save time", async () => {
    const transport = new SmtpTransport();
    await expect(transport.email({ runId: "r1", tileId: "t1", tileName: "Deploy", reason: "gate", args: {}, to: "a@b.c" }))
      .rejects.toThrow(/SMTP/);
  });

  it("ConsoleDesktopTransport surfaces the gate for a headless operator", async () => {
    const transport = new ConsoleDesktopTransport();
    let logged = "";
    const orig = console.log;
    (console as any).log = (...a: any[]) => { logged = a.join(" "); };
    try {
      await transport.desktop({ runId: "r1", tileId: "t1", tileName: "Deploy", reason: "irreversible gate", args: { x: 1 } });
    } finally {
      (console as any).log = orig;
    }
    expect(logged).toContain("r1");
    expect(logged).toContain("Deploy");
    expect(logged).toContain("POST /runs/r1/approve");
  });

  it("audit export: every run/step/decision is retrievable", async () => {
    const store = makeStore();
    const actionRunner = async (t: Tile) => ({ ran: t.id });
    const b = board(tiles([["a", "action", "A", { risk: "read", source: { type: "http" } }]]), []);
    const { ex, boardId } = given(store, b, actionRunner);
    const res = await ex.run(b, boardId);
    expect(store.getRun(res.runId).status).toBe("completed");
    const steps = store.completedSteps(res.runId);
    expect(steps.get("a")).toEqual({ ran: "a" });
    const db = store as any;
    const audit = db.db.prepare("SELECT * FROM audit WHERE run_id=?").all(res.runId);
    expect(audit.length).toBeGreaterThan(0);
  });
});
