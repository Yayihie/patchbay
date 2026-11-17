import { spawn } from "node:child_process";
import path from "node:path";
import type { ExecutableAction, RunContext } from "./executor.js";

type ActionSpec =
  | { type: "http"; method: string; url: string; headers?: Record<string, string> }
  | { type: "script"; language: "node" | "python"; entry: string };

function specOf(tile: unknown): { source: ActionSpec; timeoutMs?: number } {
  const t = tile as { source: ActionSpec; timeoutMs?: number };
  if (!t.source) throw new Error("action tile has no source");
  return t;
}

function runScript(cmd: string, entry: string, input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [entry], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`script timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`script exited ${code}: ${stderr.slice(0, 500)}`));
    });
    child.stdin.end(input);
  });
}

function parseJsonOrText(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Built-in deterministic action runners for M1:
 *  - http: fetch with method/url/headers from the tile; timeout enforced.
 *  - script: node or python entry file (relative to workspaceDir); JSON args on
 *    stdin for node, argv-less stdin for python; JSON-parsed stdout is the output.
 */
export function builtinActionRunner(workspaceDir?: string): ExecutableAction {
  return async (tile, args) => {
    const { source, timeoutMs } = specOf(tile);
    const timeout = timeoutMs ?? 30_000;
    if (source.type === "http") {
      const res = await fetch(source.url, {
        method: source.method,
        headers: { ...(source.headers ?? {}), "content-type": "application/json" },
        body: source.method === "GET" || source.method === "HEAD" ? undefined : JSON.stringify(args ?? {}),
        signal: AbortSignal.timeout(timeout),
      });
      const text = await res.text();
      return { status: res.status, body: parseJsonOrText(text) };
    }
    if (source.type === "script") {
      const entry = workspaceDir ? path.resolve(workspaceDir, source.entry) : path.resolve(source.entry);
      const input = JSON.stringify(args ?? {});
      if (source.language === "node") {
        return parseJsonOrText((await runScript(process.execPath, entry, input, timeout)).trim());
      }
      return parseJsonOrText((await runScript("python3", entry, input, timeout)).trim());
    }
    throw new Error(`unsupported action source type: ${(source as { type: string }).type}`);
  };
}

export type { RunContext };
