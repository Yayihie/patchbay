import type { BoardFile, Tile, Wire } from "../types.js";

export interface BoardCanvasProps {
  board: BoardFile;
  onTileDrag?: (tileId: string, x: number, y: number) => void;
  onWireDraw?: (from: string, to: string, kind: "data" | "permission") => void;
}

export function BoardCanvas(props: BoardCanvasProps): { type: string; props: BoardCanvasProps } {
  return { type: "BoardCanvas", props };
}

/** Permission wires render dashed; data wires solid (SPEC §12). Colour by risk class. */
export function wireStyle(kind: "data" | "permission"): string {
  return kind === "permission" ? "dashed" : "solid";
}

export function wireGrantLabel(wire: Wire): string | undefined {
  return wire.grant;
}
