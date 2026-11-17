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
  id?: string;
  format: "patchbay.board";
  version: 1;
  name: string;
  tiles: Tile[];
  wires: Wire[];
}

export interface Step {
  step: number;
  tileId: string;
  decision: string;
  outcome: string;
  detail?: string;
  durationMs?: number;
}

export interface Run {
  runId: string;
  boardId: string;
  status: "completed" | "failed" | "paused";
  steps: Step[];
}

export interface ApprovalRequest {
  runId: string;
  tileId: string;
  actionName: string;
  argsHash: string;
  argsRedacted: string;
  createdAt: string;
}
