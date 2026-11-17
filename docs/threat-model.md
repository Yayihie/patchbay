# Patchbay Threat Model

## Trust boundaries

The model is **never** in the trust path. Agents *propose*; the engine *enforces*
and *acts*. An agent with no permission wire to a tool is refused by the engine,
not by its own prompt.

Nothing leaves your machine except calls to the model providers you configured.
No account. No credits. No telemetry by default.

## Threats and mitigations

| Threat | Mitigation |
|--------|------------|
| Agent grants itself tool access | Default-deny: no wire, no access; engine enforces before anything runs |
| Irreversible action runs unattended | `irreversible` actions require an approval tile upstream |
| Plugin silently becomes more dangerous | Integrity pinning: hash of `command + args` recorded; change triggers refusal |
| Secrets leak into logs/exports | Vault values encrypted at rest (AES-256-GCM); never in board files, logs, or exports |
| Webhook tampering | HMAC-SHA256 signature with timing-safe comparison; stale timestamps rejected; missing secret fails closed |
| Rogue plugin exfiltrates data | Plugins run with user privileges; recommended sandbox: Docker with no network |
| Run state corrupted mid-execution | SQLite WAL mode; every step journaled; runs are replayable from audit log |

## Vault security

Values are stored encrypted at rest in the SQLite file, keyed by a master key
derived from a user passphrase via scrypt. **Losing the passphrase loses the
keys** — this is stated in the UI at setup.

## Webhook security

If a trigger is bound beyond `127.0.0.1`, HMAC verification is mandatory:

- Header `X-Patchbay-Signature: t=<unix>,v1=<hex>`
- Digest is `HMAC-SHA256(secret, "<unix>.<raw body>")`
- Verify with timing-safe comparison; reject stale timestamps beyond ±300 s
- Fail closed on a missing secret
- Use raw bytes, not a re-serialisation of parsed JSON

## Scope of this document

This threat model covers v1. Multi-tenant / team workspaces, mobile apps, and
cloud offerings are non-goals for v1.
