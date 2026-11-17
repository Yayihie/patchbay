# Patchbay MCP Plugins

Plugins are MCP servers. Patchbay has no plugin runtime of its own, no router,
and no registry server it operates.

## Adding a plugin

The user adds a plugin by pointing at an MCP server (stdio command, or a
streamable-HTTP URL). The engine connects, lists tools/resources/prompts, and
imports each tool as an `ActionTile` pre-wired with `risk` from the manifest.

## Plugin manifest (optional but honoured)

`patchbay.plugin.json`:

```json
{
  "name": "slack",
  "version": "1.2.0",
  "transport": "stdio",
  "command": ["npx", "-y", "@example/slack-mcp"],
  "url": null,
  "description": "Send messages, search channels",
  "scopes": ["chat:write", "channels:read"],
  "risk": {
    "default": "irreversible",
    "overrides": { "slack_search": "read" }
  },
  "secrets": {
    "SLACK_BOT_TOKEN": { "title": "Slack bot token", "vaultKey": "slack.bot_token" }
  },
  "integrity": { "pinVersions": true }
}
```

If a plugin ships no manifest, every tool it exposes is `irreversible` — safe by
default.

## Secrets to plugins

Secrets are injected as environment variables at spawn, read from the local
vault. They are never written to logs, board files, or run exports. For `http`
transports the engine injects them as headers on the user's instruction only,
and the connection must be `https` unless the host is loopback.

## Risk classes

| Class | Meaning | Default behaviour |
|-------|---------|-------------------|
| `read` | Cannot change outside state | Runs automatically |
| `write` | Reversible change | Runs automatically after explicit downgrade |
| `irreversible` | Sends, publishes, pays, deletes | Requires approval tile |

## Supply-chain integrity

- `pinVersions: true` → stdio commands run with an exact version, and the engine
  records a hash of `command + args` in the board file.
- If the hash changes between runs, the engine refuses and asks the user to
  confirm. This is the direct answer to "an unsigned binary that silently
  changes daily."
- Recommended (v1.1): run untrusted stdio plugins inside a Docker container with
  no network unless the manifest declares `network: "host"`.

## Registry

`patchbay-registry` — a GitHub repo of manifests, one JSON per plugin, added by
pull request. No payments, no rankings, no server. The engine can read it via
raw GitHub URL, or a local path, or any URL.
