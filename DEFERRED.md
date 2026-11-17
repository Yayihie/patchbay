# Deferred

Anything consciously not built, with the reason. Nothing else may hide a stub.

| Item | Reason | Revisit |
|---|---|---|
| Windows/Linux packaging | macOS-first per spec §18.2 | M6 |
| Hard spending enforcement (`budgetUsd`) | Advisory in v1 (§18.4) | post-M2 |
| Knowledge pipeline / RAG context sources (Dify-style) | Context tiles stay file/url/sheet/table in v1 | v2 |
| "Watch and Learn" (Lindy-style) | Out of v1 scope | v2 |
| Docker sandbox for untrusted stdio plugins | Recommended v1.1 (§6.4); bare stdio runs with user privileges, documented honestly | v1.1 |
| OTLP trace export | Optional per §19.2; trace ledger ships in M7 | M7+ |
