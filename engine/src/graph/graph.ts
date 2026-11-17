import type { BoardFile, Wire } from "../board/types.js";

export class GraphError extends Error {}

export interface WireGraph {
  wires: Wire[];
  /** hasGrant(agentId, sourceId, grant) — is there a permission wire source -> agent with this grant */
  hasGrant(toTile: string, fromTile: string, grant: string): boolean;
  /** incoming data wires into a tile */
  inputsOf(tileId: string): Wire[];
}

export function buildGraph(board: BoardFile): WireGraph {
  const wires = board.wires;
  const byPair = new Map<string, Wire>();
  for (const w of wires) {
    if (w.kind === "permission") {
      const grant = (w as { grant?: string }).grant;
      if (!grant) throw new GraphError(`permission wire ${w.id} has no grant`);
      byPair.set(`${w.from}>${w.to}>${grant}`, w);
    }
  }
  return {
    wires,
    hasGrant(toTile, fromTile, grant) {
      return byPair.has(`${fromTile}>${toTile}>${grant}`);
    },
    inputsOf(tileId) {
      return wires.filter((w) => w.kind === "data" && w.to === tileId);
    },
  };
}

/**
 * Topological order over data wires. Tiles with no incoming data wires come first.
 * Throws on a data-wire cycle.
 */
export function topoOrder(board: BoardFile): string[] {
  const indeg = new Map<string, number>();
  for (const t of board.tiles) indeg.set(t.id, 0);
  for (const w of board.wires) {
    if (w.kind !== "data") continue;
    indeg.set(w.to, (indeg.get(w.to) ?? 0) + 1);
  }
  const queue: string[] = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  const out = new Map<string, string[]>();
  for (const w of board.wires) {
    if (w.kind !== "data") continue;
    const list = out.get(w.from);
    if (list) list.push(w.to); else out.set(w.from, [w.to]);
  }
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const d = (indeg.get(next) ?? 1) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  if (order.length !== board.tiles.length) {
    const stuck = [...indeg.entries()].filter(([, d]) => d > 0).map(([id]) => id);
    throw new GraphError(`data-wire cycle involving tiles: ${stuck.join(", ")}`);
  }
  return order;
}
