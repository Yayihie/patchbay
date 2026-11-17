import type { BoardFile, Tile } from "../board/types.js";
import { buildGraph, topoOrder, GraphError } from "../graph/graph.js";
import type { Store } from "../storage/db.js";

export interface RunResult {
  runId: string;
  status: "completed" | "failed";
  outputs: Record<string, unknown>;
  steps: number;
}

export interface RunContext {
  inputs?: Record<string, unknown>;
}

export interface ExecutableAction {
  (tile: Tile, args: unknown): Promise<unknown>;
}

type ActionSource = { source: { type: string } };

export class Executor {
  constructor(
    private readonly store: Store,
    private readonly actionRunner: ExecutableAction,
  ) {}

  async run(board: BoardFile, boardId: string, ctx: RunContext = {}): Promise<RunResult> {
    const graph = buildGraph(board);
    const order = topoOrder(board); // throws GraphError on cycles
    const runId = this.store.newRun(boardId);
    const outputs: Record<string, unknown> = { ...(ctx.inputs ?? {}) };
    let step = 0;
    try {
      for (const tileId of order) {
        const tile = board.tiles.find((t) => t.id === tileId);
        if (!tile) throw new GraphError(`missing tile ${tileId}`);
        const startedAt = new Date().toISOString();
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
        if (tile.kind === "action") {
          const spec = (tile as unknown as ActionSource).source;
          if (!spec) throw new GraphError(`action tile ${tileId} has no source`);
          const result = await this.actionRunner(tile, args);
          outputs[tileId] = result;
          step += 1;
          this.store.recordStep(runId, step, tileId, "auto", "ok", startedAt, undefined, (tile as { risk?: string }).risk);
        } else {
          // M1: non-action tiles pass their input through (agents arrive in M2, approvals M3)
          outputs[tileId] = args;
        }
      }
      this.store.setRunStatus(runId, "completed");
      return { runId, status: "completed", outputs, steps: step };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      step += 1;
      this.store.recordStep(runId, step, "engine", "auto", "error", new Date().toISOString(), detail);
      this.store.setRunStatus(runId, "failed");
      return { runId, status: "failed", outputs, steps: step };
    }
  }
}
