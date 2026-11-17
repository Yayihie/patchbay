# Patchbay Permission Model

Patchbay's permission model is the product. It is implemented exactly as
specified — the engine enforces, the model only proposes.

## Core rules

**R1 — Access is a wire.** An agent may read a context only if there is a
`permission` wire `context → agent` with `grant: "read-context"`. Same shape for
credentials (`vault → agent`) and actions (`action → agent`, `invoke-action`).
No wire, no access. There is no UI affordance to bypass this.

**R2 — The engine enforces, not the model.** When an agent emits an `AgentIntent`,
the engine resolves the wire graph before anything runs. A missing wire produces
a structured refusal to the agent:

```json
{ "ok": false, "error": "permission_denied",
  "detail": "agent 'Outreach' has no invoke-action wire to 'send_email'",
  "hint": "Wire it on the board, or ask a human." }
```

Refusals are surfaced to the agent as a normal tool result, so the agent can
recover gracefully, and to the audit log.

**R3 — Irreversible requires a human.** An `ActionTile` with
`risk: "irreversible"` must sit downstream of an `approval` tile, or the user
must have explicitly flipped its per-tool auto-approve. The engine refuses to run
an irreversible action on an unattended path otherwise.

**R4 — Risk is declared, defaulted dangerous.** Every MCP tool starts at
`irreversible` unless its manifest says otherwise. Downgrades are explicit,
per-tool, recorded, and reversible.

**R5 — Every step is recorded.** Each step produces an audit entry with decision,
risk, and approver.

**R6 — Approval gates pause, they don't block.** A paused run is resumable from
the board.

**R7 — Runs are replayable.** Given a run's audit log and the board version, the
engine can re-emit what *would* have happened — without re-calling the model.

**R8 — Scope beats breadth.** An agent wired to one context sees one context,
even if the board has ten.

**R9 — Agent-to-agent handoff is a wire, not a free-for-all.** An agent may hand
a task to another agent only across an `agent → agent` wire with
`grant: "handoff-task"`. The receiving agent keeps its own permissions.

**R10 — Every tile explains itself.** Each tile carries a plain-English `explains`
string. The board UI shows it on every step.

## Wire grants

| Grant | From → To | Meaning |
|-------|-----------|---------|
| `read-context` | context\|memory\|table → agent | Agent may read this source |
| `write-memory` | agent → memory | Agent may write to this memory |
| `write-table` | agent → table | Agent may write to this table |
| `use-credentials` | vault → agent | Agent may use these credentials |
| `invoke-action` | action → agent | Agent may invoke this action |
| `handoff-task` | agent → agent | Agent may hand a task to this agent |

## Autonomy levels (per agent)

| Level | What the agent may do without a human |
|-------|--------------------------------------|
| `suggest` | Nothing. Every intent is a proposal. |
| `act-with-approval` | `read` actions run; `write` and `irreversible` require approval. (default) |
| `auto-safe` | `read` and `write` run automatically; `irreversible` still requires approval. |
| `auto-capped` | Everything runs, bounded by auto-approve rate cap and per-run spend budget. |

Autonomy is a cap, never an override. An irreversible tile still gates at every
level below `auto-capped`.
