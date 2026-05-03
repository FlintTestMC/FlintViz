# 0019 — Test list sidebar

**Milestone:** M4
**Depends on:** #0017, #0018

## Goal
A collapsible left-most sidebar listing all discovered tests, grouped by directory.

## Outcome
- Tree view based on the `id` slash structure.
- Click a test → loads its source into the store, fetches its replay.
- Highlight the currently-open test.
- SSE `file-changed` for the open test triggers a refresh.

## Implementation notes
- Build the tree client-side from the flat `TestSummary[]`.
- A simple recursive component is fine; no virtualization needed at this scale.

## Files
- `frontend/src/panels/TestList.tsx`
- `frontend/src/panels/buildTree.ts`

## Handoff from M1
- Current layout (`frontend/src/layout/SplitLayout.tsx`) is a 2-panel `PanelGroup` (left visualization / right editor). The sidebar is a *third* panel on the far left — extend `SplitLayout` to accept an optional `sidebar` slot and render a 3-panel `PanelGroup` when present, rather than wrapping `SplitLayout` from the outside (keeps resize handles consistent).
- Tailwind v4 is wired via `@tailwindcss/vite`; there is no `tailwind.config.js`. Use utility classes directly in JSX. The base font/background already comes from `index.html`'s `<body class="bg-neutral-950 text-neutral-100">`.
- `App.tsx` is where you'll plumb the sidebar in. The current `App.tsx` is the only consumer of `SplitLayout`, so extending the prop API is safe.
