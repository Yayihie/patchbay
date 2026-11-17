export type TileKind =
  | "agent" | "context" | "trigger" | "prompt" | "action"
  | "approval" | "vault" | "verify" | "memory" | "table";

export type Risk = "read" | "write" | "irreversible";

export type WireKind = "data" | "permission";

export type Grant =
  | "read-context" | "write-memory" | "write-table"
  | "use-credentials" | "invoke-action" | "handoff-task";

export interface Wire {
  id: string;
  from: string;
  to: string;
  kind: WireKind;
  grant?: Grant;
  map?: { fromField?: string; toField?: string };
}

export interface TileBase {
  id: string;
  kind: TileKind;
  name: string;
  explains?: string;
  positionX?: number;
  positionY?: number;
}

export type Tile = TileBase & Record<string, unknown>;

export interface BoardFile {
  format: "patchbay.board";
  version: 1;
  name: string;
  tiles: Tile[];
  wires: Wire[];
  plugins?: { serverId: string; integrityHash: string }[];
  settings?: { defaultModel?: { provider: string; model: string } };
}
