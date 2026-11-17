# Patchbay

**Patchbay is a local-first, visual board system for wiring AI agents, context, and permissions together — with your own API keys, your own MCP servers as plugins, and a human approval gate on anything irreversible.**

## What it is

Patchbay lets you draw a board of tiles (agents, actions, approvals, context) connected by wires (data wires pass values between tiles; permission wires grant an agent the right to invoke a tool). The engine runs the board topologically, enforcing permissions at every step:

- **Local-first:** Runs entirely on your machine. No account, no credits, no telemetry, no cloud control plane.
- **BYOK:** Your keys live in a local encrypted vault (AES-256-GCM, scrypt key derivation) and are used only against the provider you aimed them at. Secrets never appear in board files, logs, or exports.
- **Permission enforcement:** The engine enforces permissions; the model only proposes. An agent with no permission wire to a tool is refused by the engine, not by its prompt.
- **MCP plugins:** Plugins are MCP servers — the open standard — connected over stdio, default-deny, with integrity pinning (SPEC §6).
- **Human approval:** Irreversible actions pause the run for a human decision via `POST /runs/:id/approve`.

## Product runs as a local HTTP API

```bash
patchbay serve          # listens on 127.0.0.1:7443
patchbay serve 8080     # custom port
```

Session token is written to `~/.patchbay/session` on first start. Authenticate API calls with `Authorization: Bearer <token>`.

## Milestones (per SPEC.md)

| Milestone | Delivers | Status |
|---|---|---|
| **M0** | Repo, MIT, CI, skeleton, README | Done |
| **M1** | Engine core: board parse/validate, graph, data wires, Actions (http + script), SQLite, CLI `run` + `board validate` | Done |
| **M2** | Agents + prompts + context boxes + BYOK providers + permission enforcement | Done |
| **M3** | Approval gates, auto-approve rate cap, audit log, export | Done |
| **M4** | MCP plugin system, manifest, integrity hash, reference plugin, registry reader, plugin CRUD API | Done |
| **M5** | Web board UI + templates + end-to-end board from UI | In progress (UI skeleton committed; not yet wired to API server) |
| **M6** | Verify tiles, run replay, docs site | Not started |
| **M7** | Fault tolerance & observability (onFail routes, traces, degraded mode) | Tables exist; implementation not started |

## Build

```bash
npm install
npm run typecheck   # tsc -b across engine + cli + ui
npm test            # vitest 3 (engine + cli)
```

Requires Node >= 22.5 (uses `node:sqlite`).

## CLI

```bash
patchbay --version
patchbay board validate board.json
patchbay serve [port]
```

## License

MIT. Anyone may fork it and sell it; that trade-off is accepted in exchange for maximum adoption and zero friction. If a paid tier ever appears, it ships as open-core on top of an MIT core, never as a license change.

See [SPEC.md](./SPEC.md) for the full build contract (929 lines) and [CONTRIBUTING.md](./CONTRIBUTING.md) for how to contribute.
