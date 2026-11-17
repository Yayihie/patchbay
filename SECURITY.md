# Security Policy

## Reporting

Open a private security advisory via GitHub ("Report a vulnerability") on this
repository, or contact a maintainer directly. Please do not open a public issue
for an exploitable problem.

## Scope

In scope: the engine (permission enforcement, vault encryption, webhook HMAC
verification, plugin integrity), storage, CLI, and the local board UI.

Out of scope: the model providers' own security, the user's machine compromise,
social engineering of the local user.

## Security model in one line

The engine enforces; the model proposes. Every capability grant is an explicit
wire on the board, checked by the engine before anything runs. Irreversible
actions require a human approval gate unless explicitly auto-approved with a
rate cap, and every decision is written to a local audit log.
