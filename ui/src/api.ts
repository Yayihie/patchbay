import type { BoardFile, Run } from "./types.js";

const BASE = "http://127.0.0.1:7443";

export async function getBoards(): Promise<BoardFile[]> {
  const res = await fetch(`${BASE}/api/v1/boards`);
  if (!res.ok) throw new Error(`GET /boards failed: ${res.status}`);
  return (await res.json()) as BoardFile[];
}

export async function postRun(boardId: string): Promise<{ runId: string }> {
  const res = await fetch(`${BASE}/api/v1/boards/${boardId}/run`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /run failed: ${res.status}`);
  return (await res.json()) as { runId: string };
}

export async function getRun(runId: string): Promise<Run> {
  const res = await fetch(`${BASE}/api/v1/runs/${runId}`);
  if (!res.ok) throw new Error(`GET /runs/:id failed: ${res.status}`);
  return (await res.json()) as Run;
}

export async function postApprove(runId: string, decision: "approve" | "deny"): Promise<void> {
  const res = await fetch(`${BASE}/api/v1/runs/${runId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new Error(`POST /approve failed: ${res.status}`);
}

export function wsUrl(boardId: string): string {
  return `ws://127.0.0.1:7443/ws?board=${boardId}`;
}
