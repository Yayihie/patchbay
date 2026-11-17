# Patchbay — Build Spec

> **Working name:** Patchbay (alternatives: Conduit, Handoff).
> **Verify** the name is free (trademark, domain, GitHub org, npm scope) **before** you
> write it anywhere user-facing. Do **not** ship under a name containing "Yoke" — that
> mark is already held by a funded company (yoketeam.com, $2M seed, 28 employees).
>
> **For the coder building this — hard rules:**
> 1. **No stubs.** A function that returns fake data, a `TODO`, or a hardcoded value
>    standing in for real work is a bug, not progress. If something is genuinely
>    deferred, it must appear in `DEFERRED.md` with the reason.
> 2. **No invented output.** If a command, test or API call fails, report the failure.
>    Never describe work as done that you did not run and see pass.
> 3. **Every milestone ends with its acceptance tests passing**, listed verbatim in
>    the PR description. A milestone without green tests is not delivered.
> 4. **No secrets in the repo, ever.** All credentials live in the local vault the
>    product itself provides.
>
> This product exists because the closed alternative ships an unsigned binary, forces
> a cloud sign-in even for local runs, meters usage through its own server, and does
> not support every model provider. Patchbay is the opposite of each of those things.
> When in doubt, choose the more open option.

---

## 0. What Patchbay is, and why it exists

**The product.** Patchbay is a desktop app that renders your agent workflow as a
board: agents, context boxes, triggers, actions, approval gates and vault keys,
connected by wires you can see. A wire is either a *data wire* (this output feeds
that input) or a *permission wire* (this agent may read this context / use this
key / invoke this tool). Nothing is implied. If you can't trace it on the board,
it doesn't happen.

**Who it's for.** The operator who is not a developer but is not naive — the
agency owner, the ops lead, the solo founder — who wants automation power without
one of three prices: renting compute (Yoke's credits), surrendering API keys to a
third-party control plane (Yoke's forced sign-in, Lindy's cloud), or trusting a
prompt-governed agent with irreversible actions (every "autonomous agent" tool).
The second user is the engineer who already runs n8n and wants agents as
first-class nodes with real permission enforcement, MIT-licensed.

**The four purposes, in order of priority:**

1. **Control.** A human decides what an agent can touch, via wires, enforced by
   the engine — not by the model's own good behaviour. Approval gates pause real
   runs on anything irreversible. This is the product's reason to exist; every
   other feature must not compromise it.
2. **Legibility.** Every run is a trace you can follow: what the agent proposed,
   what the engine allowed, what it refused, what it cost. The board explains
   itself (`explains` on every tile). If a competitor's users can't answer
   "what did my agent actually do?", ours can.
3. **Ownership.** BYOK, local-first, SQLite, MIT, no telemetry. Your keys never
   leave your machine except to the provider you aimed them at. Your boards are
   files you can diff in git. No accounts, no credits, no control plane.
4. **Composability.** Plugins are MCP servers — the open standard — with a
   risk manifest and integrity pinning, so a plugin can get safer later but never
   more dangerous by accident. Templates are free JSON. Boards call boards.

**The market gap it fills.** The 2025–2026 agent-builder market split into
closed SaaS (Lindy, Gumloop, Zapier Agents, Yoke) that rent compute and custody
keys, and open-source workflow engines (n8n, Langflow, Activepieces, Windmill)
that put a canvas in front of models without making *an agent with scoped
permissions* the core primitive. Nobody ships both: agent-first, permission-
enforced, BYOK, MIT. That combination is Patchbay.

**How to check any feature against this.** If it requires a server we operate,
if it meters usage, if it makes permissions harder to see, or if it lets a model
grant itself capability — it doesn't ship.

## 1. One-line pitch

**An open-source, local-first visual board where you wire AI agents, context and
permissions together — with your own API keys, your own MCP servers as plugins, and
a human approval gate on anything irreversible.**

Two sentences of positioning, because they should drive every design decision:

- The model is **never** in the trust path. Agents *propose*; the engine *enforces*
  and *acts*. An agent with no permission wire to a tool is refused by the engine,
  not by its own prompt.
- Nothing leaves your machine except calls to the model providers you configured.
  No account. No credits. No telemetry by default.

## 2. Principles (check decisions against these)

| # | Principle | What it rules out |
|---|---|---|
| P1 | Local-first: runs entirely on the user's machine | Cloud control plane, forced sign-in, server-side state |
| P2 | BYOK: keys live in a local vault, used only against the provider | Metered credits, a token router, key custody |
| P3 | Engine enforces, model proposes | Prompt-based "guardrails" as a security boundary |
| P4 | Default-deny on capabilities | Auto-granting tool access because an agent asked |
| P5 | Irreversible ≠ automatic | Silently sending email, paying, publishing, deleting |
| P6 | Everything auditable, locally | Opaque runs, "trust us" |
| P7 | MCP is the plugin system | A proprietary tool registry or router |
| P8 | Open source, MIT | Fair-code / source-available licensing |

## 3. Non-goals (v1)

- **No cloud offering.** No hosted execution, no accounts, no billing.
- **No marketplace with payments.** Templates are free JSON files in a GitHub repo.
- **No mobile app.**
- **No multi-tenant / team workspaces.** Single local user with org-shaped seams
  left in the data model (`owner_id` on every row) so multi-user can be added later
  without a migration of the permission model.
- **No visual debugger for LLM token streams.** Log to file, show what matters.
- **Not** an n8n/Zapier replacement for pure deterministic integrations. The centre
  of gravity is *agents*, with deterministic Actions as the safe edges.

## 4. The nine primitives

Everything on the board is one of these nine kinds. A board is tiles + wires. That
is the entire data model, so getting these right matters more than anything else.

```ts
type TileKind =
  | "agent"     // LLM worker: proposes steps
  | "context"   // scoped knowledge the agent may read
  | "trigger"   // starts a run: schedule | webhook | event
  | "prompt"    // standing instructions, reusable
  | "action"    // deterministic capability: MCP tool, HTTP call, script
  | "approval"  // human gate: pause a run until a human decides
  | "vault"     // where credentials live; never rendered
  | "verify"    // deterministic checks that must pass before the next tile runs
  | "memory"    // per-agent persistent memory; same wire rules as context
  | "table"     // local rows a board can read and write (§4.10)
;

type Risk = "read" | "write" | "irreversible";
```

### 4.1 Agent

```ts
interface AgentTile {
  id: string;                  // nanoid
  kind: "agent";
  name: string;
  model: ModelRef;             // see §9
  promptIds: string[];         // prompt tiles wired in
  maxSteps: number;            // hard stop; default 12
  budgetUsd?: number;          // optional per-run spend cap
}
```

An agent never calls a tool. It emits an intent:

```ts
interface AgentIntent {
  runId: string;
  tileId: string;              // the proposing agent
  actionTileId: string;        // the action it wants performed
  args: unknown;               // JSON arguments
  reasoning?: string;          // short human-readable why
}
```

The engine resolves the intent: checks the permission wire, checks risk, runs or
refuses. **Refusals are surfaced to the agent as a normal tool result**, so the
agent can recover gracefully (e.g. ask a human), and surfaced to the audit log.

### 4.2 Context box

```ts
interface ContextTile {
  id: string;
  kind: "context";
  name: string;
  source: "inline" | "file" | "url" | "sheet" | "table";
  content?: string;            // for inline
  path?: string;               // for file (relative to workspace)
  url?: string;                // for url, refetched per run unless pinned
  tableId?: string;            // for table (§4.10)
  refresh?: "per-run" | "pinned";
}
```

Context is read-only to agents and only readable if wired. There is no global
"the agent can see everything" mode.

### 4.3 Trigger

```ts
interface TriggerTile {
  id: string;
  kind: "trigger";
  name: string;
  type: "schedule" | "webhook" | "event";
  // schedule
  cron?: string;               // 5-field, validated
  timezone?: string;           // IANA; default the machine's
  // webhook
  path?: string;               // /hooks/<random-id>, bound to 127.0.0.1 by default
  secret?: { vaultKey: string };  // optional HMAC verification, see §7
  // event
  event?: string;              // e.g. "file.changed", "mcp.resource.updated"
}
```

Webhooks are **localhost-bound by default**. Exposing one beyond the machine is an
explicit toggle that also turns on HMAC verification (mandatory at that point).

### 4.4 Prompt / 4.5 Action / 4.6 Approval / 4.7 Verify

```ts
interface PromptTile {
  id: string; kind: "prompt"; name: string; body: string;
}

interface ActionTile {
  id: string; kind: "action"; name: string;
  source:
    | { type: "mcp"; serverId: string; tool: string }   // from a plugin, §6
    | { type: "http"; method: string; url: string; headers?: Record<string,string> }
    | { type: "script"; language: "node" | "python"; entry: string };
  risk: Risk;                  // MCP tools: from manifest, §6.3
  timeoutMs: number;           // default 30_000
  retries?: {
    max: number;               // default 0 (no retry)
    backoffMs: number;         // base delay, exponential; default 1_000
    retryOn: ("network" | "timeout" | "http_5xx" | "http_429")[];  // default all four
  };
}

interface ApprovalTile {
  id: string; kind: "approval"; name: string;
  timeout?: { after: string; onTimeout: "pause" | "skip" | "fail" };  // ISO 8601 duration
  notify?: {
    channel: "desktop" | "webhook" | "email";  // go where the human is, §5.4
    url?: string;                              // webhook target
    email?: string;                            // local SMTP relay, configured by user
  };
}

interface VerifyTile {
  id: string; kind: "verify"; name: string;
  checks: VerifyCheck[];       // deterministic, no LLM
}

interface VerifyCheck {
  type: "http_status" | "json_path" | "file_exists" | "regex" | "command_zero_exit";
  // per-type params, e.g. { url, expect: 200 } or { path, pattern }
  onFail: "block" | "warn";
}
```

A `verify` tile that fails with `block` stops the run and records a
`BLOCKED` outcome. This is what makes "evidence-backed" a product feature rather
than a promise.

### 4.8 Vault

```ts
interface VaultTile {
  id: string; kind: "vault"; name: string;
  keys: VaultKeyRef[];         // references, never values
}
interface VaultKeyRef { key: string; title: string; }
```

Values are stored **encrypted at rest** in the SQLite file (§8), keyed by a master
key derived from a passphrase the user sets on first launch. No key material is
ever included in a board file, a log line, or a run export.

### 4.9 Memory

Persistent, per-agent memory — what Lindy calls the difference between an agent
that works and one that *knows your work*. An agent without memory re-learns its
job every run; memory is what turns a script-shaped loop into an assistant.

```ts
interface MemoryTile {
  id: string; kind: "memory"; name: string;
  scope: "agent" | "board";         // default "agent"
  writePolicy: "append-only" | "agent-editable";
  maxEntries: number;               // LRU trim; default 500
}
```

Rules:
- Memory is **read and written through wires**, exactly like context:
  `memory → agent` with `grant: "read-context"` to include it in prompts, and
  `agent → memory` with `grant: "write-memory"` to let the agent save to it.
  Unwired memory is invisible — an agent cannot "discover" another agent's memory.
- Memory content is stored locally in SQLite (§8), never synced anywhere.
- Every write is audited like any other step (§5.2), with the written value in
  `argsRedacted` (agent-visible) and full value behind the reveal click.
- A `memory` tile is a first-class data source for a `context` tile's content —
  a context box can be *fed by* a memory tile, which is how "brief the agent on
  what happened last time" is built without bespoke plumbing.

### 4.10 Tables

Activepieces puts chat, agents, flows, **tables** and connections in one workspace
because agents that only transform text keep re-deriving the same structured data
every run. Patchbay needs a lightweight local datastore — not a database product,
just rows a board can read and write:

```ts
interface TableTile {
  id: string; kind: "table"; name: string;
  columns: { name: string; type: "text" | "number" | "bool" | "json"; }[];
}
```

- Stored in SQLite (§8). Reads go through a wired `table → agent` permission wire
  (`grant: "read-context"`); writes go through `grant: "write-table"`.
- Tables are what make "invoice intake", "lead routing" and "renewal watch" — the
  examples Activepieces, Gumloop and Zapier all lead with — buildable without an
  external database.

## 5. Wires and the permission model

This section is the product. Implement it exactly.

```ts
type WireKind = "data" | "permission";
interface Wire {
  id: string;
  from: string;                // tile id
  to: string;                  // tile id
  kind: WireKind;
  // for permission wires, what is being granted:
  grant?:
    | "read-context"      // context|memory|table -> agent
    | "write-memory"      // agent -> memory
    | "write-table"       // agent -> table
    | "use-credentials"   // vault -> agent
    | "invoke-action"     // action -> agent
    | "handoff-task"      // agent -> agent: may hand a task to that agent
  ;
  // for data wires, which output feeds which input:
  map?: { fromField?: string; toField?: string };
}
```

### Rules

**R1 — Access is a wire.** An agent may read a context only if there is a
`permission` wire `context → agent` with `grant: "read-context"`. Same shape for
credentials (`vault → agent`) and actions (`action → agent`, `invoke-action`).
No wire, no access. There is no UI affordance to bypass this.

**R2 — The engine enforces, not the model.** When an agent emits an
`AgentIntent`, the engine resolves the wire graph **before** anything runs. A
missing wire produces a structured refusal to the agent:

```json
{ "ok": false, "error": "permission_denied",
  "detail": "agent 'Outreach' has no invoke-action wire to 'send_email'",
  "hint": "Wire it on the board, or ask a human." }
```

**R3 — Irreversible requires a human.** An `ActionTile` with
`risk: "irreversible"` **must** sit downstream of an `approval` tile, or the user
must have explicitly flipped its per-tool auto-approve (§5.1). The engine refuses
to run an irreversible action on an unattended path otherwise.

**R4 — Risk is declared, defaulted dangerous.** Every MCP tool starts at
`irreversible` unless its manifest says otherwise (§6.3). Downgrades are explicit,
per-tool, recorded, and reversible.

**R5 — Every step is recorded.** See §5.2.

**R6 — Approval gates pause, they don't block.** A paused run is resumable from
the board. Timeout behaviour is per-tile (default `pause`).

**R7 — Runs are replayable.** Given a run's audit log and the board version, the
engine can re-emit what *would* have happened — without re-calling the model —
which is what makes the audit genuinely inspectable.

**R8 — Scope beats breadth.** An agent wired to one context sees one context, even
if the board has ten. Small context is a correctness feature, not just a privacy one.

**R9 — Agent-to-agent handoff is a wire, not a free-for-all.** An agent may hand a
task to another agent only across an `agent → agent` wire with
`grant: "handoff-task"`. The receiving agent keeps its own permissions; a handoff
**never** grants the sender's wires to the receiver or vice versa. This is what
makes "a fleet of agents" composable without becoming an implicit capability
transit (Flowise calls this Agentflow; the mistake to avoid is agents inheriting
each other's access).

**R10 — Every tile explains itself.** Each tile carries a plain-English `explains`
string — "what this does", written once and pinned. The board UI shows it on every
step, because the competitor with the strongest positioning here is the one whose
pitch is "agents and workflows you can *follow*" (n8n). An unexplained board is a
black box with better colours.

### 5.1 Auto-approve, done loudly

Each action tile carries:

```ts
interface AutoApprove {
  enabled: boolean;            // default false
  setAt?: string;              // ISO timestamp
  maxPerHour?: number;         // rate cap; default 10
}
```

When enabled, the tile shows a visible marker on the board (`⚡ auto`), the audit
log records `decision: "auto"`, and the rate cap still forces a human review if
the tool misbehaves at volume.

### 5.2 Audit log

```ts
interface AuditEntry {
  runId: string; step: number;
  tileId: string; tileKind: TileKind;
  tool?: string;                                        // action tiles
  argsHash: string;                                     // sha256 of canonical args
  argsRedacted?: unknown;                               // values replaced by "***"
  risk?: Risk;
  decision: "auto" | "approved" | "denied" | "refused-permission" | "blocked" | "skipped";
  approver?: string;                                    // "local-user"
  startedAt: string; finishedAt: string;
  outcome: "ok" | "error" | "timeout" | "blocked";
  detail?: string;
}
```

Written to SQLite, exportable per run as JSON. `argsRedacted` is what the UI shows
by default; raw args are visible only behind an explicit "reveal" click.

### 5.3 Autonomy levels (per agent)

Relevance AI sells an explicit autonomy ladder; it is a good idea and it maps
cleanly onto risk classes. One enum, per agent tile, shown on the board:

```ts
type Autonomy = "suggest" | "act-with-approval" | "auto-safe" | "auto-capped";
```

| Level | What the agent may do without a human |
|---|---|
| `suggest` | Nothing. Every intent is surfaced as a proposal; the human runs it. |
| `act-with-approval` | `read` actions run; `write` and `irreversible` require approval. (default) |
| `auto-safe` | `read` and `write` run automatically; `irreversible` still requires approval. |
| `auto-capped` | Everything runs, bounded by the auto-approve rate cap (§5.1) and per-run spend budget. |

Autonomy is a *cap*, never an override of §5.1: a tile explicitly marked
irreversible still gates at every level below `auto-capped`, and `auto-capped`
still respects the rate cap. The ladder is what makes the board legible to a
non-engineer: you do not have to reason about every wire to know what your agent
is allowed to do — you pick a number.

### 5.4 Approvals delivered where the human is

n8n's strongest demo sends the approval question *into Slack* mid-run; Lindy's
arrives by email, SMS and chat. An approval gate that only exists inside the app
goes unread while the run sits paused. So notifications fan out:

- **desktop** — the default; no network.
- **webhook** — a POST to the user's own URL (Slack incoming webhook, ntfy, their
  own n8n instance). Payload includes a signed one-click approve/deny link (§7).
- **email** — through a locally configured SMTP relay; never a hosted service.
- The run stays paused until decided; the board shows it as waiting.

## 6. MCP plugin contract

**Plugins are MCP servers.** Patchbay has no plugin runtime of its own, no router,
and no registry server it operates. The contract is:

1. The user adds a plugin by pointing at an MCP server (stdio command, or a
   streamable-HTTP URL).
2. The engine connects, lists tools/resources/prompts, and **imports each tool as
   an `ActionTile`** pre-wired with `risk` from the manifest.
3. Tool calls go engine → MCP server directly. No intermediary service.

### 6.1 Plugin manifest (optional but honoured)

MCP servers already expose tools. The manifest adds what MCP does not: risk,
required secrets, and identity. Live beside the server or in a registry entry.

```jsonc
// patchbay.plugin.json
{
  "name": "slack",
  "version": "1.2.0",
  "transport": "stdio",                       // "stdio" | "http"
  "command": ["npx", "-y", "@example/slack-mcp"],
  "url": null,                                // for http transport
  "description": "Send messages, search channels",
  "scopes": ["chat:write", "channels:read"],
  "risk": {
    "default": "irreversible",
    "overrides": { "slack_search": "read" }   // explicit exceptions
  },
  "secrets": {
    "SLACK_BOT_TOKEN": { "title": "Slack bot token", "vaultKey": "slack.bot_token" }
  },
  "integrity": { "pinVersions": true }
}
```

**If a plugin ships no manifest, every tool it exposes is `irreversible`.** Safe by
default, and it means a plugin can get simpler later, never more dangerous.

### 6.2 Secrets to plugins

Secrets are injected as environment variables at spawn, read from the local vault.
They are never written to logs, board files, or run exports. For `http` transports
the engine injects them as headers on the user's instruction only, and the
connection must be `https` unless the host is loopback.

### 6.3 Risk classes

| Class | Meaning | Default behaviour |
|---|---|---|
| `read` | Cannot change outside state | Runs automatically |
| `write` | Reversible change (draft, local file, staging row) | Runs automatically **after** the user downgrades it once; gated before that |
| `irreversible` | Sends, publishes, pays, deletes | Requires an approval tile, always, unless explicitly auto-approved (§5.1) |

### 6.4 Supply-chain integrity

- `pinVersions: true` → stdio commands run with an exact version, and the engine
  records a hash of `command + args` in the board file.
- **If the hash changes between runs, the engine refuses and asks.** This is the
  direct answer to "an unsigned binary that silently changes daily."
- Recommended (v1.1): run untrusted stdio plugins inside a Docker container with
  no network unless the manifest declares `network: "host"`. Provide a
  `patchbay plugin run --sandbox docker` path; document that a bare stdio plugin
  runs with user privileges. **Be honest in the docs about this limitation.**

### 6.5 Registry (GitHub, free)

`patchbay-registry` — a repo of manifests, one JSON per plugin, added by pull
request. No payments, no rankings, no server. The engine can read it via raw
GitHub URL, and also accepts a local path or any URL.

## 7. Webhook security (mandatory once exposed)

If a trigger is bound beyond `127.0.0.1`, HMAC verification is required:

- Header `X-Patchbay-Signature: t=<unix>,v1=<hex>`
- Digest is `HMAC-SHA256(secret, "<unix>.<raw body>")`
- Verify with **timing-safe comparison**, reject stale timestamps beyond ±300 s
  (retries must re-sign), fail **closed** on a missing secret.
- Use the raw bytes, not a re-serialisation of parsed JSON.

This is the pattern that closed a real hole in another product's pipeline — treat
it as the reference implementation.

## 8. Storage

Single SQLite file at `~/.patchbay/patchbay.db` (configurable via
`PATCHBAY_HOME`). No server dependency.

```sql
boards(id, name, version, created_at, updated_at, owner_id)
tiles(id, board_id, kind, name, spec_json, position_x, position_y, created_at, updated_at, owner_id)
wires(id, board_id, kind, from_tile, to_tile, spec_json, owner_id)
runs(id, board_id, status, started_at, finished_at, cost_usd, owner_id)
steps(run_id, step, tile_id, decision, risk, outcome, started_at, finished_at, detail, owner_id)
audit(run_id, step, tile_id, tool, args_hash, args_redacted_json, decision, approver,
      started_at, finished_at, outcome, detail, owner_id)
vault(key TEXT PRIMARY KEY, value_enc BLOB, updated_at, owner_id)  -- AES-256-GCM
plugins(id, name, version, source_json, integrity_hash, created_at, owner_id)
mcp_cache(server_id, tool_name, schema_json, fetched_at, owner_id)
memory(id, agent_tile_id, board_id, content, created_at, owner_id)  -- LRU-trimmed per tile
tables(id, board_id, name, schema_json, owner_id)
table_rows(id, table_id, data_json, created_at, updated_at, owner_id)
traces(run_id, step, tile_id, started_at, duration_ms, prompt_tokens, completion_tokens,
       cost_usd, provider, model, detail_json, owner_id)   -- one row per step; OTel export optional
```

- `owner_id` exists on every row from day one (non-goals say single-user, but
  adding a column later is a migration; adding it now is free).
- Vault values: AES-256-GCM, master key from a user passphrase via scrypt.
  **Losing the passphrase loses the keys** — say so in the UI at setup.
- Every write is journaled; the DB is the only durable state.

## 9. Model providers (BYOK)

```ts
interface ModelRef { provider: string; model: string; }
```

| Provider | Endpoint | Notes |
|---|---|---|
| `openai` | api.openai.com | chat completions + tool calling |
| `anthropic` | api.anthropic.com/v1 | messages API + tool use |
| `google` | generativelanguage.googleapis.com | |
| `xai` | api.x.ai | |
| `openrouter` | openrouter.ai | access to most other models |
| `openai-compatible` | **user-supplied base URL** | **this is how Meta/Muse, vLLM, LM Studio, Ollama and any private gateway get in. Do not skip it.** |
| `ollama` | localhost:11434 | local, zero-cost |

Rules:
- Keys are read from the vault at call time, used **only** against that provider's
  endpoint, and never proxied, logged or echoed.
- Every provider entry exposes a **base URL override**. Yoke shipped exactly one
  (`ANTHROPIC_BASE_URL`) and it locked out an entire model family; don't repeat it.
- Per-run spend is computed from provider-reported usage where available, and
  surfaced as `runs.cost_usd`. Never guessed.

## 10. Board file format

Portable, diffable, shareable. This is the template format too.

```jsonc
{
  "format": "patchbay.board",
  "version": 1,
  "name": "Agency outreach",
  "tiles": [ /* Tile[] as in §4, positions included */ ],
  "wires": [ /* Wire[] as in §5 */ ],
  "plugins": [ { "serverId": "slack", "integrityHash": "sha256:…" } ],
  "settings": { "defaultModel": { "provider": "anthropic", "model": "claude-sonnet-4-5" } }
}
```

- Board files contain **no secrets** and no key material, ever.
- Import validates against the schema; unknown tile kinds are refused, not coerced.
- `patchbay board validate <file>` is a CLI command that does exactly that, so
  templates can be checked in CI without launching the app.

## 11. Engine API surface

Engine is a single process: HTTP + WebSocket on `127.0.0.1:7443` (configurable),
authored against the local user only (loopback bind, plus a random session token
written to `~/.patchbay/session` to stop other local processes).

```
GET    /api/v1/health                       -> { ok, version }
GET    /api/v1/boards                       -> Board[]
POST   /api/v1/boards                       -> create from board file JSON
GET    /api/v1/boards/:id                   -> Board + tiles + wires
PUT    /api/v1/boards/:id                   -> replace (validated)
DELETE /api/v1/boards/:id
POST   /api/v1/boards/:id/run               -> { runId }
GET    /api/v1/runs/:id                     -> status, steps, cost
POST   /api/v1/runs/:id/approve             -> { decision: "approve" | "reject", note? }
POST   /api/v1/runs/:id/pause | /resume | /cancel
GET    /api/v1/runs/:id/audit               -> AuditEntry[]
GET    /api/v1/runs/:id/trace               -> full execution trace (Flowise's model:
                                          per-step tokens, latency, cost; OTLP export optional)
POST   /api/v1/boards/:id/invoke            -> run on demand with input; every board is
                                          an API (Langflow/Flowise/Windmill all do this)
GET    /api/v1/spend                        -> spend aggregated by provider + model
                                          (Gumloop's "AI Spend" panel, but local)
POST   /api/v1/copilot/draft                -> plain-language task -> draft board JSON
                                          (Zapier Copilot / Yoke's describe-to-build).
                                          ALWAYS returns draft:true; a copilot draft
                                          cannot run until a human saves it — copilot
                                          proposes, the human wires.
GET    /api/v1/plugins                      -> Plugin[]
POST   /api/v1/plugins                      -> add (stdio cmd or http url, or manifest)
POST   /api/v1/plugins/:id/refresh          -> re-list tools, re-check integrity
GET    /api/v1/vault/keys                   -> key names only, never values
PUT    /api/v1/vault/keys/:key              -> set value
DELETE /api/v1/vault/keys/:key
GET    /api/v1/providers                    -> configured providers + base URLs
PUT    /api/v1/providers/:name              -> { baseUrl?, model? }
WS     /ws?board=<id>                       -> board state, run progress, approvals
```

WebSocket messages are the only way the UI learns about run progress and approval
requests. Keep payloads small; the UI fetches detail over HTTP.

## 12. The board UI

Web app served by the engine at `http://127.0.0.1:7443`. React + Vite.

- **Canvas:** drag tiles, draw wires. A `permission` wire renders as a **dashed
  cable**; a `data` wire as solid. Colour by risk class. This visual distinction is
  the whole point of permission pipes — they must be legible at a glance.
- **Run view:** steps appear live; a refused intent shows the exact missing wire
  and a button that opens the two tiles involved.
- **Approval requests:** inline on the canvas, with redacted args by default and a
  one-click "reveal" for raw values. Desktop notification when the tab is hidden.
- **No onboarding account, ever.** First launch sets the vault passphrase and
  drops the user on an empty board with three example templates loadable in one click.
- Aesthetic: sparse, high-contrast, no decorative glass, no scroll-triggered
  animation, generous hit targets (≥44 px), labelled form controls.

## 13. Templates & the community registry

`patchbay-templates` — a GitHub repo of free board files, one directory each,
validated in CI by `patchbay board validate`. Seed it with five:

1. `agency-outreach` — find → verify → draft → **approval gate** → send (the
   canonical "human taps before every send" flow)
2. `invoice-chaser` — overdue invoices → draft reminders → approval → send → summary
3. `content-pipeline` — draft post → verify checks → approval → publish
4. `release-check` — after deploy: confirm revision live → run checks →
   `PASS / FAIL / BLOCKED` row (evidence-backed)
5. `research-team` — three agents hand work to each other, one verifier

Templates are JSON. Anyone can fork, edit, PR. **No payments anywhere.**

## 14. Repo layout

```
patchbay/
  LICENSE                      # MIT, full text, no modifications
  README.md
  CONTRIBUTING.md
  SECURITY.md                  # how to report, what's in scope
  DEFERRED.md                  # anything consciously not built, with reasons
  package.json                 # workspaces: engine, ui, cli
  .github/workflows/ci.yml     # lint + typecheck + test on PR
  .github/workflows/release.yml
  engine/
    src/
      board/                   # parse, validate, graph
      graph/                   # wire resolution, permission checks
      run/                     # executor, steps, approval pauses
      providers/               # one module per provider + openai-compatible
      plugins/mcp/             # client, manifest, integrity, risk
      vault/                   # aes-256-gcm, scrypt
      storage/                 # sqlite
      api/                     # http + ws
    test/                      # integration tests, §15
  ui/
    src/                       # react board, run view, approvals
  cli/
    src/                       # patchbay run | board validate | plugin …
  docs/
    primitives.md  permission-model.md  mcp-plugins.md  threat-model.md
```

**License: MIT.** Say plainly in the README that it is MIT, what that means (anyone
may fork it and sell it), and that the trade-off is accepted in exchange for
maximum adoption and zero friction. If a paid tier ever appears, it ships as
open-core on top of an MIT core, never as a license change.

## 15. Tests the coder must write (not optional)

These are the acceptance criteria. A milestone is done when its tests pass in CI.

**M2 — permission model**
- `test_permission_denied_without_wire`: agent emits an intent for an action it has
  no `invoke-action` wire to → engine refuses, agent receives the structured
  refusal, **no tool call is made**, audit logs `refused-permission`.
- `test_handoff_without_wire_is_refused`: agent A emits a handoff to agent B with
  no `agent → agent` wire → refused, logged, B never receives it.
- `test_memory_isolation`: agent B reads its own memory fine; reading agent A's
  memory tile without a wire is refused; A's memory never appears in B's prompt.
- `test_table_write_without_wire`: an action attempts to write an unwired table
  → refused with the structured refusal naming the missing `write-table` grant.
- `test_context_scoping`: an agent wired to one of two contexts receives only that
  one in its prompt assembly.
- `test_vault_isolation`: a vault key not wired to the agent is never present in
  any request the provider receives (assert on a recorded request fixture).

**M3 — approvals**
- `test_irreversible_requires_approval`: an irreversible action with no approval
  tile upstream is refused by the engine.
- `test_approval_pauses_and_resumes`: a run pauses at the gate, resumes on
  `POST /runs/:id/approve`, and the downstream action executes exactly once.
- `test_auto_approve_rate_cap`: with auto-approve on and `maxPerHour: 2`, the
  third call inside the hour is held for a human.
- `test_approval_webhook_link_is_signed`: the one-click approve/deny link in a
  webhook/email notification fails verification when the body is tampered with.
- `test_approval_email_never_leaves_without_smtp`: with no SMTP relay configured,
  choosing `email` notification fails loudly at save time, not silently mid-run.

**M4 — MCP plugins**
- `test_mcp_tool_import`: adding a reference stdio server imports its tools as
  action tiles with manifest risk applied; a tool absent from the manifest's
  overrides defaults to `irreversible`.
- `test_integrity_hash_change_refuses`: mutate the recorded command hash → engine
  refuses to run until the user confirms.
- `test_reference_plugin_end_to_end`: run the bundled reference plugin (a tiny
  MCP server with one `read` and one `irreversible` tool) through a full board run,
  including one approval.

**M5 — board + templates**
- `test_board_validate_roundtrip`: every template in `patchbay-templates`
  validates; a board with an unknown tile kind is refused with a useful error.
- `test_webhook_signature`: valid signature accepted; tampered body rejected;
  stale timestamp rejected; missing secret fails **closed**.
- `test_no_secrets_in_export`: run a board end to end, export the run and the
  board, and assert no secrets appear in either file.

**M7 — fault tolerance & observability (§19)**
- `test_onfail_routes_to_fallback`: an action fails after retries → the run
  continues at `onFail.target`, and the trace records the failure and the route.
- `test_onfail_cannot_escalate`: the fallback agent's permissions are its own; a
  fallback path attempts an action its wires do not allow → refused, logged.
- `test_trace_completeness`: every step of a run — including refusals and
  fallback routes — has a trace row with duration, outcome and cost; no silent
  steps.
- `test_sub_board_degraded_mode`: a parent board invokes a sub-board without a
  wire to the sub-board's vault keys → the sub-board skips protected actions,
  flags `degraded` in the trace, and never requests those keys.

**Global**
- `test_audit_completeness`: every executed step (including refusals) has an
  audit entry with decision, risk and approver; a run with an unlogged step fails
  the test.
- `test_memory_lru_trim`: a memory tile with `maxEntries: 500` trims to 500 on
  the 501st write, oldest first.
- Typecheck + lint clean; no `any` in engine public APIs.

## 16. Milestones

| Milestone | Delivers | Acceptance |
|---|---|---|
| **M0** | Repo, MIT, CI, skeleton, README | CI green on an empty-but-runnable monorepo |
| **M1** | Engine core: board parse/validate, graph, data wires, Actions (http + script), SQLite, CLI `run` + `board validate` | M5's `board_validate_roundtrip` passes for a hand-made board |
| **M2** | Agents + prompts + context boxes + BYOK providers + **permission enforcement** | M2 tests pass |
| **M3** | Approval gates, auto-approve, audit log, export | M3 tests pass |
| **M4** | MCP plugin system, manifest, integrity, reference plugins, registry reader | M4 tests pass |
| **M5** | Web board UI, templates repo, releases with SHA256SUMS | M5 tests pass; a real board runs end to end from the UI |
| **M6** | Verify tiles, run replay, docs site | `release-check` template runs and emits a PASS/FAIL/BLOCKED row |
| **M7** | **Fault tolerance & observability** — competitor-driven hardening | See §19 tests |

Sequence matters: **permission enforcement lands in M2, before the UI in M5.** The
board is a view of something that is already safe.

## 17. Release requirements

- Every release publishes `SHA256SUMS` alongside the artifacts.
- macOS builds: **signed with a Developer ID and notarized** as soon as an Apple
  Developer account exists. Until then, say so loudly in the README — do not
  quietly ship an ad-hoc-signed binary and call it fine.
- No telemetry, ever, by default. If crash reporting is added, it is opt-in,
  off by default, and the payload is shown to the user before sending.
- Changelog per release. The version in `package.json` and the running
  `GET /health` must agree.
- Ship `llms.txt` at the docs root describing the API surface in machine-readable
  form (n8n does this; it is a one-page file and it is how AI tools discover what
  the product can do).

## 18. Open questions (decide before building, not during)

1. **Engine language:** spec assumes **TypeScript** for v1 (fastest to build
   correctly, easiest for contributors, and the engine's contract is
   transport-agnostic so a Rust rewrite can come later behind the same API). If
   the coder prefers Rust, the API surface in §11 is the contract either way.
2. **Windows/Linux packaging:** defer to M6; document the macOS path first.
3. **Multi-board concurrency:** one engine process per machine is fine for v1;
   runs on the same board serialise.
4. **Spending controls:** `budgetUsd` is advisory in v1 (tracked and reported);
   hard enforcement can come later via provider-side limits.

## 19. Competitor-driven enhancements (the "what they do well" pass)

Analysis of the market leaders in workflow automation and agentic orchestration
(n8n, Zapier, Make, Langflow, Flowise, Activepieces, Lindy, Gumloop, Relevance AI,
Windmill, Yoke) reveals three structural gaps in Patchbay v1. These are not
features to bolt on later — they are the reasons users stay on the incumbents
when a self-hosted agent misbehaves.

### 19.1 Failure branching (from n8n / Zapier / Make)

Every incumbent treats an error as a *route*, not a crash. n8n lets a failed node
trigger an "Error Workflow"; Zapier retries and then halts with a human-readable
task history. Patchbay's current model treats a failed action as a dead run.

**Addition — `onFail` routing on ActionTile:**

```ts
interface ActionTile {
  // ... existing fields
  onFail?: {
    target: string;        // tile id of a fallback agent or notify tile
    maxRetries: number;    // before falling back (default 0)
  };
}
```

- A failed action routes to `onFail.target` instead of killing the run.
- If no `onFail` is wired, the run halts with a structured error in the trace.
- The fallback path inherits *only* the sender's permission wires for the
  duration of the handoff — it cannot escalate its own privileges (P4).

### 19.2 Execution observability (from Flowise / LangSmith)

Flowise's adoption was driven by the ability to see *exactly* which token or tool
call failed inside a multi-step agent. Patchbay has `verify` but no deep trace.

**Addition — `Trace` ledger:**

Every run emits a `trace.json` to `~/.patchbay/traces/<run_id>/`:

```json
{
  "step": 3,
  "tile": "verify-external-api",
  "decision": "block",
  "latency_ms": 421,
  "input_preview": "...redacted...",
  "error": "connection_refused",
  "stack_preview": "..."
}
```

The board UI must render a **waterfall view** of these steps (Gantt-style), so a
user can visually see which agent hung, where the bottleneck is, and what step
triggered the fallback route.

### 19.3 Sub-flow composition (from n8n "Sub-workflows")

Complex workflows become unmaintainable single-canvas "spaghetti boards." n8n
solves this with executable sub-workflows. Patchbay supports this via
**Board-as-a-Tool**:

- Any saved board can be exposed to other boards as an MCP-style `ActionTile`.
- The parent board triggers the sub-board; the sub-board's `vault` and `approval`
  gates remain *local* to the sub-board's execution context.
- **Constraint:** A sub-board cannot silently escalate permissions. If the parent
  lacks a permission wire to the sub-board's required vault keys, the sub-board
  runs in "degraded" mode (skips protected actions) and flags it in the trace.

## 20. What we took from whom (the competitive landscape)

| Product | License | What it does well | What Patchbay takes |
|---|---|---|---|
| **n8n** | fair-code (Sustainable Use) | Error workflows; Slack approvals mid-run; "agents and workflows you can follow"; llms.txt for machine-readable docs | §19.1 failure branching, §5.4 out-of-app approval channels, §5.3 R10 explainability, `llms.txt` |
| **Langflow** | MIT | 153k stars; hundreds of pre-built flows; "flow as an API"; MCP server generation | §11 `POST /boards/:id/invoke`; the MCP registry is our component library |
| **Flowise** | EOL Aug 2026 | Multi-agent orchestration; HITL; full execution traces (Prometheus/OTel) | §5.3 R9 agent handoff wires; §19.2 trace ledger + OTLP export |
| **Dify** | source-available | Knowledge pipeline (prepare searchable bases); marketplace; real-time agent monitoring | Context tiles stay file/url/sheet — knowledge pipeline is a DEFERRED v2; monitoring = §19.2 |
| **Activepieces** | MIT-ish core | Chat + agents + flows + tables in one workspace; audit log; "nobody's tracking what they access" pitch | §4.10 Tables; §5.2 audit already specified |
| **Windmill** | AGPL/EE | Code-first: retries, approvals, parallel branches built in; Git-based collaboration; 20+ languages | §4.5 `retries` on ActionTile; boards-as-files = Git-native by default |
| **Lindy** | closed | Skills, Memory, Routines; "Watch and Learn"; works in Slack/email/text/calendar | §4.9 Memory; Routines = trigger tiles; Watch-and-learn is DEFERRED (v2) |
| **Gumloop** | closed | AI Spend by provider with chart; adoption by user; connectors/skills panels | §11 `GET /spend` by provider+model; agent settings panel |
| **Zapier Agents** | closed | Copilot-assisted agent building; 9,000+ apps; chat with agent mid-run | Copilot draft-builder (§11, `draft:true` mandatory); chat-with-agent is a UI view of a paused run |
| **Relevance AI** | closed | Explicit autonomy ladder (L1–L4); embedded deployment team | §5.3 Autonomy levels per agent |
| **Yoke** | closed | Describe-in-plain-language board building; permission pipes; escrowed builder marketplace | The describe-to-build UX (as copilot with mandatory human save); permission pipes are the core spec |

The honest read: **the primitives are all borrowed from ideas in the market.**
What is genuinely new here is the combination — permission pipes *as the data
model* (not a bolted-on policy layer), default-deny MCP plugins with integrity
pinning, and MIT with zero telemetry. Do not add anything from the table that
breaks P1–P8.
