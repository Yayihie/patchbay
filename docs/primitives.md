# Patchbay Primitives

Patchbay boards are built from nine tile kinds and two wire kinds. Everything on
the board is a tile or a wire — that is the entire data model.

## Tile kinds

| Kind | Purpose |
|------|---------|
| `agent` | LLM worker that proposes actions; never calls tools directly |
| `context` | Scoped knowledge an agent may read (inline, file, url, sheet, table) |
| `trigger` | Starts a run: schedule, webhook, or event |
| `prompt` | Standing instructions, reusable across agents |
| `action` | Deterministic capability: MCP tool, HTTP call, or script |
| `approval` | Human gate: pauses a run until a human approves or denies |
| `vault` | Where credentials live; never rendered to the UI |
| `verify` | Deterministic checks that must pass before the next tile runs |
| `memory` | Per-agent persistent memory, same wire rules as context |
| `table` | Local rows a board can read and write |

## Wire kinds

| Kind | Meaning | Renders as |
|------|---------|------------|
| `data` | This output feeds that input | Solid cable |
| `permission` | This agent may read that context / use that key / invoke that action | Dashed cable |

## Risk classes

| Class | Meaning | Default behaviour |
|-------|---------|-------------------|
| `read` | Cannot change outside state | Runs automatically |
| `write` | Reversible change (draft, local file, staging row) | Runs automatically after explicit downgrade; gated before that |
| `irreversible` | Sends, publishes, pays, deletes | Requires an approval tile, always, unless explicitly auto-approved |

## Board file format

A board file is portable, diffable JSON:

```json
{
  "format": "patchbay.board",
  "version": 1,
  "name": "Agency outreach",
  "tiles": [ /* Tile[] */ ],
  "wires": [ /* Wire[] */ ],
  "plugins": [ { "serverId": "slack", "integrityHash": "sha256:…" } ],
  "settings": { "defaultModel": { "provider": "anthropic", "model": "claude-sonnet-4-5" } }
}
```

Board files contain no secrets and no key material. Unknown tile kinds are
refused, not coerced.
