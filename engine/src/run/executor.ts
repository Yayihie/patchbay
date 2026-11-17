import type { BoardFile, Tile } from "../board/types.js";
import { buildGraph, topoOrder, GraphError } from "../graph/graph.js";
import type { Store } from "../storage/db.js";
import type { Enforcer } from "../agents/runner.js";
import type { NotifyTransport, ApprovalArgs } from "./notify.js";
import { defaultTransport } from "./notify.js";
import crypto from "node:crypto";

type ActionSource = { source: { type: string } };
type RiskyTile = Tile & { risk?: string; autoApprove?: { enabled?: boolean; maxPerHour?: number } };

export interface RunResult {
  runId: string;
  status: "completed" | "failed" | "paused";
  outputs: Record<string, unknown>;
  steps: number;
  pausedTileId?: string;
  pendingArgs?: unknown;
  traces?: { step: number; tileId: string; durationMs: number }[];
}

export interface RunContext {
  inputs?: Record<string, unknown>;
}

export interface ExecutableAction {
  (tile: Tile, args: unknown): Promise<unknown>;
}

export class Executor {
  constructor(
    private readonly store: Store,
    private readonly actionRunner: ExecutableAction,
    private readonly deps: { enforcer?: Enforcer; notify?: NotifyTransport } = {},
  ) {}

  private notify(): NotifyTransport {
    return this.deps.notify ?? defaultTransport();
  }

  private assembleArgs(graph: ReturnType<typeof buildGraph>, tileId: string,
                       outputs: Record<string, unknown>): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    for (const w of graph.inputsOf(tileId)) {
      const map = (w as { map?: { fromField?: string; toField?: string } }).map;
      const src = outputs[w.from];
      if (map?.toField) {
        args[map.toField] = map.fromField ? (src as Record<string, unknown>)?.[map.fromField] : src;
      } else {
        Object.assign(args, src as Record<string, unknown>);
      }
    }
    return args;
  }

  async run(board: BoardFile, boardId: string, ctx: RunContext = {}): Promise<RunResult> {
    const graph = buildGraph(board);
    const order = topoOrder(board); // throws GraphError on cycles
    const runId = this.store.newRun(boardId);
    const outputs: Record<string, unknown> = { ...(ctx.inputs ?? {}) };
    let step = 0;
    const traces: { step: number; tileId: string; durationMs: number }[] = [];
    try {
      for (const tileId of order) {
        const tile = board.tiles.find((t) => t.id === tileId);
        if (!tile) throw new GraphError(`missing tile ${tileId}`);
        const startedAt = new Date().toISOString();
        const args = this.assembleArgs(graph, tileId, outputs);
        if (tile.kind === "action") {
          const spec = (tile as unknown as ActionSource).source;
          if (!spec) throw new GraphError(`action tile ${tileId} has no source`);
          const risky = tile as unknown as RiskyTile;

          // ---- M3 enforcement: irreversible actions need a gate or auto-approve ----
          const enforcer = this.deps.enforcer;
          if (enforcer) {
            const clearance = enforcer.actionClearance(risky);
            if (clearance.mode === "refuse") {
              step += 1;
              this.store.recordStepWithOutput(runId, step, tileId, "refused-permission", "blocked", startedAt,
                clearance.detail, undefined, risky.risk);
              this.store.setRunStatus(runId, "failed");
              return { runId, status: "failed", outputs, steps: step };
            }
            if (clearance.mode === "gate") {
              // pause run before executing; notify human; await /runs/:id/approve
              this.store.pauseRun(runId, tileId, args);
              await this.desktopNotify({ runId, tileId, tileName: tile.name, reason: clearance.detail ?? "approval required", args });
              await this.channelNotify(tile, { runId, tileId, tileName: tile.name, reason: clearance.detail ?? "approval required", args });
              return {
                runId, status: "paused", outputs, steps: step,
                pausedTileId: tileId, pendingArgs: args,
              };
            }
            // mode === "auto": execute unattended; rate cap already checked by enforcer
          }

          // ---- M7 fault tolerance: retry with exponential backoff on transient failure ----
          const maxRetries = 3;
          let lastErr: unknown;
          let attempt = 0;
          let result: unknown;
          for (;;) {
            attempt += 1;
            const t0 = Date.now();
            try {
              result = await this.actionRunner(tile, args);
              break;
            } catch (e) {
              lastErr = e;
              const dur = Date.now() - t0;
              this.store.saveTrace(crypto.randomUUID(), runId, step + 1, tileId, startedAt, dur,
                null, null, null, null, null, JSON.stringify({ error: e instanceof Error ? e.message : String(e), attempt }));
              if (attempt >= maxRetries) {
                step += 1;
                this.store.recordStep(runId, step, tileId, "auto", "error", new Date().toISOString(),
                  `failed after ${maxRetries} attempts: ${e instanceof Error ? e.message : String(e)}`);
                this.store.setRunStatus(runId, "failed");
                return { runId, status: "failed", outputs, steps: step };
              }
              // backoff: 250ms, 500ms, 1000ms
              await new Promise(r => setTimeout(r, 250 * Math.pow(2, attempt - 1)));
            }
          }
          const durMs = Date.now() - Date.parse(startedAt);
          outputs[tileId] = result;
          step += 1;
          traces.push({ step, tileId, durationMs: durMs });
          this.store.recordStepWithOutput(runId, step, tileId, "auto", "ok", startedAt, result,
            undefined, risky.risk);
          this.store.saveTrace(crypto.randomUUID(), runId, step, tileId, startedAt, durMs,
            null, null, null, null, null, JSON.stringify({ ok: true }));
          this.store.recordAudit({ runId, step, tileId: tile.id, tool: tile.id, decision: "auto", outcome: "ok", approver: "local-user" });
        } else {
          // non-action tiles pass their input through (agents arrive in M2, approvals M3)
          const durMs = Date.now() - Date.parse(startedAt);
          traces.push({ step, tileId, durationMs: durMs });
          outputs[tileId] = args;
        }
      }
      this.store.setRunStatus(runId, "completed");
      return { runId, status: "completed", outputs, steps: step, traces };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      step += 1;
      this.store.recordStep(runId, step, "engine", "auto", "error", new Date().toISOString(), detail);
      this.store.setRunStatus(runId, "failed");
      return { runId, status: "failed", outputs, steps: step };
    }
  }

  /** Resume a paused run after a human decision. Replays completed steps from
   * persisted outputs (so each action runs exactly once), executes the paused
   * action, then continues the remaining topo order. */
  async resume(board: BoardFile, boardId: string, runId: string,
               decision: "approve" | "reject", approver = "local-user"): Promise<RunResult> {
    const run = this.store.getRun(runId);
    if (run.status !== "paused") throw new Error(`run ${runId} is not paused (status=${run.status})`);
    this.store.resumeRun(runId, decision, approver);
    if (decision === "reject") {
      this.store.setRunStatus(runId, "cancelled");
      return { runId, status: "failed", outputs: {}, steps: 0 };
    }

    const graph = buildGraph(board);
    const order = topoOrder(board);
    const completed = this.store.completedSteps(runId); // tileId -> output
    const outputs: Record<string, unknown> = { ...completed };
    let step = completed.size;
    let resumed = false;
    const pausedTileId = run.paused_tile_id!;
    const pendingArgs = run.paused_args_json ? JSON.parse(run.paused_args_json) : {};

    for (const tileId of order) {
      if (completed.has(tileId)) continue; // already executed; output persisted, never re-run
      const tile = board.tiles.find((t) => t.id === tileId);
      if (!tile) throw new GraphError(`missing tile ${tileId}`);
      const startedAt = new Date().toISOString();
      const args = this.assembleArgs(graph, tileId, outputs);

      if (tileId === pausedTileId && !resumed) {
        resumed = true;
        const result = await this.actionRunner(tile, pendingArgs);
        outputs[tileId] = result;
        step += 1;
        this.store.recordStepWithOutput(runId, step, tileId, "auto", "ok", startedAt, result,
          undefined, (tile as { risk?: string }).risk);
        this.store.recordAudit({ runId, step, tileId: tile.id, tool: tile.id, decision: "auto", outcome: "ok", approver: "local-user" });
        continue;
      }

      if (tile.kind === "action") {
        const spec = (tile as unknown as ActionSource).source;
        if (!spec) throw new GraphError(`action tile ${tileId} has no source`);
        const result = await this.actionRunner(tile, args);
        outputs[tileId] = result;
        step += 1;
        this.store.recordStepWithOutput(runId, step, tileId, "auto", "ok", startedAt, result,
          undefined, (tile as { risk?: string }).risk);
        this.store.recordAudit({ runId, step, tileId: tile.id, tool: tile.id, decision: "auto", outcome: "ok", approver: "local-user" });
      } else {
        outputs[tileId] = args;
      }
    }
    this.store.setRunStatus(runId, "completed");
    return { runId, status: "completed", outputs, steps: step };
  }

  /** M7 fault tolerance: resume a failed run from its last completed step.
   * Replays persisted outputs so each action runs exactly once, then continues
   * from the first uncompleted step in topo order. Returns 'failed' if no
   * steps were ever completed (nothing to recover from). */
  async retryRun(board: BoardFile, boardId: string, runId: string): Promise<RunResult> {
    const run = this.store.getRun(runId);
    if (run.status === "completed") {
      return { runId, status: "completed", outputs: {}, steps: 0 };
    }
    if (run.status === "running" || run.status === "paused") {
      throw new Error(`run ${runId} is ${run.status}, not failed; nothing to retry`);
    }

    const graph = buildGraph(board);
    const order = topoOrder(board);
    const completed = this.store.completedSteps(runId); // tileId -> output
    if (completed.size === 0) {
      return { runId, status: "failed", outputs: {}, steps: 0 };
    }
    const outputs: Record<string, unknown> = { ...completed };
    // continue step numbering after the last existing step (failed runs may
    // have recorded error steps for tiles we're about to redo)
    const maxStepRow = this.store.db.prepare(
      "SELECT MAX(step) m FROM steps WHERE run_id=?"
    ).get(runId) as { m: number | null };
    let step = (maxStepRow.m ?? 0);
    const traces: { step: number; tileId: string; durationMs: number }[] = [];

    for (const tileId of order) {
      if (completed.has(tileId)) continue; // already executed; output persisted, never re-run
      const tile = board.tiles.find((t) => t.id === tileId);
      if (!tile) throw new GraphError(`missing tile ${tileId}`);
      const startedAt = new Date().toISOString();
      const args = this.assembleArgs(graph, tileId, outputs);

      if (tile.kind === "action") {
        const spec = (tile as unknown as ActionSource).source;
        if (!spec) throw new GraphError(`action tile ${tileId} has no source`);
        const result = await this.actionRunner(tile, args);
        const durMs = Date.now() - Date.parse(startedAt);
        outputs[tileId] = result;
        step += 1;
        traces.push({ step, tileId, durationMs: durMs });
        this.store.recordStepWithOutput(runId, step, tileId, "auto", "ok", startedAt, result,
          undefined, (tile as { risk?: string }).risk);
        this.store.saveTrace(crypto.randomUUID(), runId, step, tileId, startedAt, durMs,
          null, null, null, null, null, JSON.stringify({ ok: true, retried: true }));
        this.store.recordAudit({ runId, step, tileId: tile.id, tool: tile.id, decision: "auto", outcome: "ok", approver: "local-user" });
      } else {
        const durMs = Date.now() - Date.parse(startedAt);
        traces.push({ step, tileId, durationMs: durMs });
        outputs[tileId] = args;
      }
    }
    this.store.setRunStatus(runId, "completed");
    return { runId, status: "completed", outputs, steps: step, traces };
  }

  private async desktopNotify(a: ApprovalArgs): Promise<void> {
    try { await this.notify().desktop(a); } catch { /* best effort */ }
  }
  private async channelNotify(tile: Tile, a: ApprovalArgs): Promise<void> {
    const notify = (tile as unknown as { notify?: string[] }).notify ?? [];
    const transport = this.notify();
    for (const ch of notify) {
      if (ch === "webhook") {
        const url = process.env.PATCHBAY_WEBHOOK_URL;
        if (url) { try { await transport.webhook({ ...a, url }); } catch { /* best effort */ } }
      } else if (ch === "email") {
        const to = process.env.PATCHBAY_ADMIN_EMAIL;
        if (to) { try { await transport.email({ ...a, to }); } catch { /* best effort */ } }
      }
    }
  }
}
