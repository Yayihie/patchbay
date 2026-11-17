# @patchbay/ui

Web board UI (React + Vite), milestone M5. The board is a view of something
that is already safe — permission enforcement lands in M2, before this UI.

## Stack (declared in package.json; run `npm install` to fetch)

React 18 + Vite + TypeScript, served by the engine at `http://127.0.0.1:7443` (SPEC §12, §14).

## What exists here (skeleton)

- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- `src/types.ts` — board/run/approval types (mirrors engine `board/types.ts`)
- `src/api.ts` — fetch client for SPEC §11 API (`GET /boards`, `POST /boards/:id/run`, `GET /runs/:id`, `POST /runs/:id/approve`, WS helper)
- `src/components/BoardCanvas.ts` — tile/wire canvas stub; permission wires dashed, data wires solid, colour by risk
- `src/components/RunView.ts` — live run step list stub
- `src/components/ApprovalRequest.ts` — inline approval stub; redacted args, one-click reveal
- `src/App.ts`, `src/main.ts` — app shell + entry (React mount placeholder)

## Still to build (not stubs)

- Engine HTTP + WS API server (`engine/src/api/`, SPEC §11) — does not exist yet; the UI has nothing to talk to until it's built.
- Real React components (currently pure-TS virtual-node stubs that typecheck without `react` installed).
- First-launch vault passphrase setup (no onboarding account, ever — SPEC §12).
- Templates loadable in one click (the five from SPEC §13).

## Aesthetic constraints (SPEC §12)

Sparse, high-contrast, no decorative glass, no scroll-triggered animation, labelled form controls, ≥44 px hit targets.
