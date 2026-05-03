# 0003 — Vite/React/TS frontend scaffold

**Milestone:** M1
**Depends on:** —

## Goal
Stand up a Vite + React + TypeScript SPA with the Overleaf-style split layout in place (placeholder content), proxying API calls to the Rust backend during dev, with **react-three-fiber** and **Tailwind** wired up so later 3D and UI work has a foundation.

## Outcome
- `cd frontend && npm install && npm run dev` opens a Vite dev server.
- Two horizontally resizable panels visible: right "Editor" placeholder, left "Visualization" placeholder. The visualization side already hosts an R3F `<Canvas>` rendering a single test cube to confirm the pipeline is alive.
- Tailwind classes work (`<div class="text-red-500">test</div>` renders red).
- `vite.config.ts` proxies `/api` and `/api/events` to `http://localhost:7878` so `fetch('/api/...')` works in dev.

## Implementation notes
- `npm create vite@latest frontend -- --template react-ts`
- Add deps: `@react-three/fiber`, `@react-three/drei`, `three`, `react-resizable-panels`, `tailwindcss`, `@radix-ui/react-tooltip` (just for tooltips later — heavyweight UI libs intentionally avoided).
- Tailwind setup: `tailwind.config.js`, `postcss.config.js`, `index.css` with `@tailwind base; @tailwind components; @tailwind utilities;`.
- Strict tsconfig (`strict: true`, `noUncheckedIndexedAccess: true`).
- ESLint + Prettier with sensible defaults — no bikeshedding.
- Smoke test in the visualization panel: a `<Canvas><mesh><boxGeometry /><meshStandardMaterial /></mesh></Canvas>` so we know R3F + Three are bundling correctly.

## Files
- `frontend/package.json`
- `frontend/vite.config.ts`
- `frontend/tsconfig.json`
- `frontend/tailwind.config.js`
- `frontend/postcss.config.js`
- `frontend/src/index.css`
- `frontend/src/App.tsx`
- `frontend/src/main.tsx`
- `frontend/src/layout/SplitLayout.tsx`
- `frontend/src/world/CanvasShell.tsx`
