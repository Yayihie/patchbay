import type { BoardFile, Tile, TileKind, Wire } from "./types.js";

const TILE_KINDS: readonly TileKind[] = [
  "agent", "context", "trigger", "prompt", "action",
  "approval", "vault", "verify", "memory", "table",
];

export class BoardParseError extends Error {
  constructor(message: string, readonly path?: string) {
    super(message);
    this.name = "BoardParseError";
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(obj: Record<string, unknown>, field: string, path: string): string {
  const v = obj[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new BoardParseError(`${path}: missing or empty string field "${field}"`, path);
  }
  return v;
}

export function parseTile(raw: unknown, path: string): Tile {
  if (!isObject(raw)) throw new BoardParseError(`${path}: tile is not an object`, path);
  const kind = reqString(raw, "kind", path) as TileKind;
  if (!TILE_KINDS.includes(kind)) {
    throw new BoardParseError(
      `${path}: unknown tile kind "${kind}". Valid kinds: ${TILE_KINDS.join(", ")}`, path);
  }
  reqString(raw, "id", path);
  reqString(raw, "name", path);
  return raw as unknown as Tile;
}

export function parseWire(raw: unknown, path: string): Wire {
  if (!isObject(raw)) throw new BoardParseError(`${path}: wire is not an object`, path);
  const kind = reqString(raw, "kind", path);
  if (kind !== "data" && kind !== "permission") {
    throw new BoardParseError(`${path}: wire kind must be "data" or "permission", got "${kind}"`, path);
  }
  reqString(raw, "id", path);
  reqString(raw, "from", path);
  reqString(raw, "to", path);
  if (kind === "permission" && typeof raw.grant !== "string") {
    throw new BoardParseError(`${path}: permission wire requires a "grant"`, path);
  }
  return raw as unknown as Wire;
}

/**
 * Parse and validate a board file (format "patchbay.board", version 1).
 * Unknown tile kinds are refused, not coerced.
 */
export function parseBoard(raw: unknown, path = "<board>"): BoardFile {
  if (!isObject(raw)) throw new BoardParseError(`${path}: board is not an object`, path);
  if (raw.format !== "patchbay.board") {
    throw new BoardParseError(`${path}: expected format "patchbay.board"`, path);
  }
  if (raw.version !== 1) {
    throw new BoardParseError(`${path}: unsupported board version ${JSON.stringify(raw.version)} (want 1)`, path);
  }
  reqString(raw, "name", path);
  const tilesRaw = raw.tiles;
  if (!Array.isArray(tilesRaw)) throw new BoardParseError(`${path}: "tiles" must be an array`, path);
  const wiresRaw = raw.wires;
  if (!Array.isArray(wiresRaw)) throw new BoardParseError(`${path}: "wires" must be an array`, path);

  const tiles = tilesRaw.map((t, i) => parseTile(t, `${path}.tiles[${i}]`));
  const wires = wiresRaw.map((w, i) => parseWire(w, `${path}.wires[${i}]`));

  const ids = new Set<string>();
  for (const t of tiles) {
    if (ids.has(t.id)) throw new BoardParseError(`${path}: duplicate tile id "${t.id}"`, path);
    ids.add(t.id);
  }
  for (const w of wires) {
    if (!ids.has(w.from)) throw new BoardParseError(`${path}: wire ${w.id} references unknown tile "${w.from}"`, path);
    if (!ids.has(w.to)) throw new BoardParseError(`${path}: wire ${w.id} references unknown tile "${w.to}"`, path);
  }
  return raw as unknown as BoardFile;
}
