import type { BoardFile, Run } from "./types.js";

export type { BoardFile, Run } from "./types.js";

const BASE = "http://127.0.0.1:7443";

let token: string | null = null;

export async function ensureToken(): Promise<string> {
  if (token) return token;
  const res = await fetch(`${BASE}/api/v1/session`);
  if (!res.ok) throw new Error(`GET /session failed: ${res.status}`);
  const data = (await res.json()) as { token: string };
  token = data.token;
  return token;
}

export async function api(path: string, init?: RequestInit): Promise<Response> {
  const t = await ensureToken();
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      ...(init?.headers ?? {}),
    },
  });
}

export async function getBoards(): Promise<BoardFile[]> {
  const res = await api("/api/v1/boards");
  if (!res.ok) throw new Error(`GET /boards failed: ${res.status}`);
  return (await res.json()) as BoardFile[];
}

export async function postRun(boardId: string): Promise<{ runId: string }> {
  const res = await api(`/api/v1/boards/${boardId}/run`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /run failed: ${res.status}`);
  return (await res.json()) as { runId: string };
}

export async function getRun(runId: string): Promise<Run> {
  const res = await api(`/api/v1/runs/${runId}`);
  if (!res.ok) throw new Error(`GET /runs/:id failed: ${res.status}`);
  const raw = await res.json();
  return {
    runId: raw.id,
    boardId: raw.board_id,
    status: raw.status,
    steps: raw.steps,
  } as Run;
}

export async function postApprove(runId: string, decision: "approve" | "deny"): Promise<void> {
  const res = await api(`/api/v1/runs/${runId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new Error(`POST /approve failed: ${res.status}`);
}

export function wsUrl(boardId: string): string {
  return `ws://127.0.0.1:7443/ws?board=${boardId}`;
}
