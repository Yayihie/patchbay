import type { BoardFile, Tile } from "../board/types.js";
import type { WireGraph } from "../graph/graph.js";
import type { Store } from "../storage/db.js";
import type { Vault } from "../vault/vault.js";
import type { ChatMessage, ModelRef } from "../providers/types.js";
import type { ExecutableAction } from "../run/executor.js";
import crypto from "node:crypto";

export interface AgentIntent {
  runId: string;
  tileId: string;
  actionTileId: string;
  args: unknown;
  reasoning?: string;
}

export interface Refusal {
  ok: false;
  error: string;
  detail: string;
  hint: string;
}

export type Resolution =
  | { ok: true; kind: "invoke"; tile: Tile }
  | { ok: true; kind: "handoff"; targetAgentId: string }
  | { ok: true; kind: "write-memory"; memoryTileId: string }
  | { ok: true; kind: "write-table"; tableTileId: string }
  | { ok: true; kind: "read-table"; tableTileId: string }
  | Refusal;

type AgentSpec = {
  model: ModelRef;
  maxSteps?: number;
  budgetUsd?: number;
  autonomy?: string;
};

type ToolCall = { id: string; name: string; args: unknown };

/**
 * The enforcement core. The model proposes; this class resolves every intent
 * against the wire graph BEFORE anything runs (spec R1–R4). Refusals are
 * structured results fed back to the agent and written to the audit log.
 */
export class Enforcer {
  constructor(
    private readonly board: BoardFile,
    private readonly graph: WireGraph,
    private readonly store: Store,
  ) {}

  resolve(intent: { tileId: string; actionTileId: string; args?: unknown; intentKind?: string }): Resolution {
    const kind = intent.intentKind ?? "invoke-action";
    const tiles = new Map(this.board.tiles.map((t) => [t.id, t]));
    const agent = tiles.get(intent.tileId);

    if (kind === "invoke-action") {
      const action = tiles.get(intent.actionTileId);
      if (!action) {
        return this.refuse("permission_denied", `no action tile "${intent.actionTileId}" exists on this board`,
          "Check the tile id.");
      }
      if (!this.graph.hasGrant(intent.tileId, intent.actionTileId, "invoke-action")) {
        return this.refuse("permission_denied",
          `agent '${agent?.name ?? intent.tileId}' has no invoke-action wire to '${action.name}'`,
          "Wire it on the board, or ask a human.");
      }
      // R3: irreversible requires an upstream approval tile (auto-approve lands in M3)
      const risk = (action as { risk?: string }).risk ?? "irreversible";
      if (risk === "irreversible") {
        const hasApproval = this.board.wires.some(
          (w) => w.kind === "data" && w.to === action.id && tiles.get(w.from)?.kind === "approval");
        if (!hasApproval) {
          return this.refuse("approval_required",
            `action '${action.name}' is irreversible and has no approval gate upstream`,
            "Add an approval tile, or explicitly enable auto-approve on this action.");
        }
      }
      return { ok: true, kind: "invoke", tile: action };
    }

    if (kind === "handoff-task") {
      const target = tiles.get(intent.actionTileId);
      if (!target || target.kind !== "agent") {
        return this.refuse("permission_denied", `handoff target "${intent.actionTileId}" is not an agent tile`,
          "Handoffs go agent -> agent.");
      }
      if (!this.graph.hasGrant(intent.tileId, target.id, "handoff-task")) {
        return this.refuse("permission_denied",
          `agent '${agent?.name ?? intent.tileId}' has no handoff-task wire to agent '${target.name}'`,
          "Wire agent -> agent with grant handoff-task.");
      }
      return { ok: true, kind: "handoff", targetAgentId: target.id };
    }

    if (kind === "write-memory") {
      const mem = tiles.get(intent.actionTileId);
      if (!mem || mem.kind !== "memory") {
        return this.refuse("permission_denied", `target "${intent.actionTileId}" is not a memory tile`, "Wire agent -> memory.");
      }
      if (!this.graph.hasGrant(intent.tileId, mem.id, "write-memory")) {
        return this.refuse("permission_denied",
          `agent '${agent?.name ?? intent.tileId}' has no write-memory wire to '${mem.name}'`,
          "Wire agent -> memory with grant write-memory.");
      }
      return { ok: true, kind: "write-memory", memoryTileId: mem.id };
    }

    if (kind === "write-table" || kind === "read-table") {
      const table = tiles.get(intent.actionTileId);
      if (!table || table.kind !== "table") {
        return this.refuse("permission_denied", `target "${intent.actionTileId}" is not a table tile`, "Wire agent -> table.");
      }
      const grant = kind === "write-table" ? "write-table" : "read-context";
      if (!this.graph.hasGrant(intent.tileId, table.id, grant)) {
        return this.refuse("permission_denied",
          `agent '${agent?.name ?? intent.tileId}' has no ${grant} wire to table '${table.name}'`,
          `Wire table -> agent (read) or agent -> table with grant ${grant}.`);
      }
      return kind === "write-table"
        ? { ok: true, kind: "write-table", tableTileId: table.id }
        : { ok: true, kind: "read-table", tableTileId: table.id };
    }

    return this.refuse("permission_denied", `unknown intent kind "${kind}"`, "Use invoke-action, handoff-task, write-memory, write-table or read-table.");
  }

  /** R8: an agent sees only the contexts wired to it. */
  wiredContexts(agentTileId: string): Tile[] {
    return this.board.wires
      .filter((w) => w.kind === "permission" && w.to === agentTileId && (w as { grant?: string }).grant === "read-context")
      .map((w) => this.board.tiles.find((t) => t.id === w.from))
      .filter((t): t is Tile => !!t && (t.kind === "context" || t.kind === "memory"));
  }

  /** R1: vault keys readable by an agent are exactly the wired ones. */
  wiredVaultKeys(agentTileId: string): string[] {
    return this.board.wires
      .filter((w) => w.kind === "permission" && w.to === agentTileId && (w as { grant?: string }).grant === "use-credentials")
      .map((w) => this.board.tiles.find((t) => t.id === w.from))
      .filter((t): t is Tile => !!t && t.kind === "vault")
      .flatMap((t) => ((t as { keys?: { key: string }[] }).keys ?? []).map((k) => k.key));
  }

  /** R9: handoff targets are exactly the wired ones. */
  wiredHandoffTargets(agentTileId: string): string[] {
    return this.board.wires
      .filter((w) => w.kind === "permission" && w.from === agentTileId && (w as { grant?: string }).grant === "handoff-task")
      .map((w) => w.to);
  }

  private refuse(error: string, detail: string, hint: string): Refusal {
    return { ok: false, error, detail, hint };
  }
}

export interface AgentRunDeps {
  store: Store;
  vault: Vault;
  actionRunner: ExecutableAction;
  /** chat call, injectable for tests; defaults to provider routing in M2 wiring */
  chat: (ref: ModelRef, messages: ChatMessage[], tools: { name: string; description: string; parameters: unknown }[])
    => Promise<{ text?: string; toolCalls: ToolCall[] }>;
  onAudit?: (entry: { step: number; tileId: string; decision: string; outcome: string; detail?: string; tool?: string; risk?: string }) => void;
}

function redactArgs(args: unknown): unknown {
  return "***";
}

export class AgentRunner {
  constructor(private readonly deps: AgentRunDeps) {}

  /** Run one agent to completion within its step budget. Returns its final text. */
  async runAgent(board: BoardFile, boardId: string, runId: string, graph: WireGraph,
                 agentTileId: string, task: string, depth = 0): Promise<string> {
    const tiles = new Map(board.tiles.map((t) => [t.id, t]));
    const agent = tiles.get(agentTileId);
    if (!agent || agent.kind !== "agent") throw new Error(`tile ${agentTileId} is not an agent`);
    const spec = agent as unknown as AgentSpec;
    const enforcer = new Enforcer(board, graph, this.deps.store);
    const maxSteps = spec.maxSteps ?? 12;

    // ---- prompt assembly: wired contexts + own wired memory + task ----
    const messages: ChatMessage[] = [];
    const systemParts: string[] = [];
    for (const promptTile of board.tiles.filter((t) => t.kind === "prompt")) {
      if (board.wires.some((w) => w.kind === "data" && w.from === promptTile.id && w.to === agentTileId)) {
        systemParts.push((promptTile as unknown as { body: string }).body);
      }
    }
    let contextBlock = "";
    for (const ctx of enforcer.wiredContexts(agentTileId)) {
      if (ctx.kind === "memory") {
        const mem = this.deps.store.readMemory(ctx.id);
        contextBlock += `\n[memory: ${ctx.name}]\n${mem.join("\n")}\n`;
      } else {
        const c = (ctx as unknown as { content?: string }).content;
        contextBlock += `\n[context: ${ctx.name}]\n${c ?? ""}\n`;
      }
    }
    if (contextBlock) systemParts.push(contextBlock);
    messages.push({ role: "system", content: systemParts.join("\n\n") || "You are a board agent." });
    messages.push({ role: "user", content: task });

    // ---- tool surface: only invoke-action-wired actions ----
    const tools = board.tiles
      .filter((t) => t.kind === "action" && graph.hasGrant(agentTileId, t.id, "invoke-action"))
      .map((t) => ({
        name: t.name,
        description: (t as unknown as { explains?: string }).explains ?? `action ${t.name}`,
        parameters: { type: "object", properties: {}, additionalProperties: true },
      }));

    let step = 0;
    let finalText = "";
    while (step < maxSteps) {
      const turn = await this.deps.chat(spec.model, messages, tools);
      step += 1;
      if (turn.text) finalText = turn.text;
      if (!turn.toolCalls || turn.toolCalls.length === 0) break;

      messages.push({ role: "assistant", content: turn.text ?? "", toolCalls: turn.toolCalls });
      for (const call of turn.toolCalls) {
        // tool name -> action tile id is the tile id (the runner prompts with tile ids as names)
        const resolution = enforcer.resolve({
          tileId: agentTileId, actionTileId: call.name, args: call.args, intentKind: "invoke-action",
        });
        if (!resolution.ok) {
          this.audit(runId, step, agentTileId, call.name, "refused-permission", resolution.detail);
          messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(resolution) });
          continue;
        }
        if (resolution.kind === "invoke") {
          // vault interpolation: only wired keys are substituted; unwired refs are never resolved
          const resolvedArgs = this.substituteVaultKeys(agentTileId, call.args, enforcer);
          let outcome = "ok";
          let result: unknown;
          try {
            result = await this.deps.actionRunner(resolution.tile, resolvedArgs);
          } catch (e) {
            outcome = "error";
            result = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
          this.audit(runId, step, resolution.tile.id, call.name, "auto", undefined, outcome, resolvedArgs);
          messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
        }
        // handoff / memory / table intents land with their milestones; invoke is the M2 surface
      }
    }
    return finalText;
  }

  /** Replace ${vault:key} placeholders with values ONLY for wired keys. */
  substituteVaultKeys(agentTileId: string, args: unknown, enforcer: Enforcer): unknown {
    const allowed = new Set(enforcer.wiredVaultKeys(agentTileId));
    const walk = (v: unknown): unknown => {
      if (typeof v === "string") {
        return v.replace(/\$\{vault:([^}]+)\}/g, (m, key: string) => {
          if (!allowed.has(key)) return `***unwired:${key}***`;
          const value = this.deps.vault.get(key);
          return value ?? `***missing:${key}***`;
        });
      }
      if (Array.isArray(v)) return v.map(walk);
      if (typeof v === "object" && v !== null) {
        return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, walk(val)]));
      }
      return v;
    };
    return walk(args);
  }

  private audit(runId: string, step: number, tileId: string, tool: string, decision: string,
                detail?: string, outcome = "ok", args?: unknown): void {
    this.deps.store.recordAudit({
      runId, step, tileId, tool, decision, outcome, detail,
      approver: decision === "refused-permission" ? undefined : "local-user",
      argsHash: args === undefined ? undefined : sha256(JSON.stringify(args)),
      argsRedacted: args === undefined ? undefined : redactArgs(args),
    });
    this.deps.onAudit?.({ step, tileId, decision, outcome, detail, tool });
  }
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}
