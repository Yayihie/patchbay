# Contributing

1. Every milestone ends with its acceptance tests passing, listed verbatim in
   the PR description. A milestone without green tests is not delivered.
2. No stubs. A function that returns fake data, a `TODO`, or a hardcoded value
   standing in for real work is a bug, not progress. If something is genuinely
   deferred, it must appear in `DEFERRED.md` with the reason.
3. No invented output. If a command, test or API call fails, report the failure.
4. No secrets in the repo, ever. All credentials live in the local vault the
   product itself provides.
5. No `any` in engine public APIs. Typecheck and lint must stay clean.

Commit convention: `type: concise subject line` (fix:, feat:, refactor:, docs:, chore:).
