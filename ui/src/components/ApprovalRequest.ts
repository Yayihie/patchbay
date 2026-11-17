import type { ApprovalRequest } from "../types.js";

export interface ApprovalRequestProps {
  request: ApprovalRequest;
  onReveal: () => void;
  onDecide: (decision: "approve" | "deny") => void;
}

export function ApprovalRequest(props: ApprovalRequestProps): { type: string; props: ApprovalRequestProps } {
  return { type: "ApprovalRequest", props };
}

/** Args shown redacted by default; one-click reveal (SPEC §12). */
export function redactedArgs(hash: string): string {
  return `*** ${hash.slice(0, 8)} ***`;
}
