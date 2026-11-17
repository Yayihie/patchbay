# Patchbay

**An open-source, local-first visual board where you wire AI agents, context and
permissions together — with your own API keys, your own MCP servers as plugins,
and a human approval gate on anything irreversible.**

- MIT licensed. Anyone may fork it and sell it; that trade-off is accepted in
  exchange for maximum adoption and zero friction.
- Local-first: runs entirely on your machine. No account, no credits, no
  telemetry, no cloud control plane.
- BYOK: your keys live in a local encrypted vault and are used only against the
  provider you aimed them at.
- The engine enforces permissions; the model only proposes. An agent with no
  permission wire to a tool is refused by the engine, not by its prompt.
- Plugins are MCP servers — the open standard — default-deny, with integrity
  pinning.

## Status

Pre-release. See SPEC.md for the build spec and milestone plan (M0–M7).

## Build

```
npm install
npm run typecheck
npm test
```

## Note on macOS binaries

Releases are not yet signed or notarized (no Apple Developer account yet).
When macOS builds ship unsigned, this README says so loudly; it will be
updated the moment Developer ID signing lands.
