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

## Handoff from #0006 (TestSummary semantics for the tree)
- Build the tree from `summary.id` by splitting on `/`. The id always uses forward slashes regardless of host OS, so `id.split('/')` is correct and platform-independent.
- The server returns the list sorted by `id` ascending — preserve that order when grouping into folders for stable rendering.
- A summary with `parse_error` set should still appear in the tree (use `name` which falls back to the file stem). Surface the error somehow (tooltip, red dot, italics) — these files won't open cleanly in #0007/#0008 but the user needs to see them to fix them.
- Tags are available on each summary (`string[]`) — out of scope for v1 sidebar UI, but consider exposing them as a tooltip or small badge if cheap.

## Handoff from #0017 (API client)

The typed client lives at `frontend/src/api/`:

- `import { api, ApiError } from "../api/client"` exposes `listTests()`, `getTest(id)`, `replay(source)`, `events(onEvent)`.
- All methods accept an optional `AbortSignal` (`api.listTests(signal)`, etc.) — wire the sidebar's initial fetch to a `useEffect` AbortController so unmounts during dev StrictMode double-mount don't leak.
- `getTest(id)` URL-encodes each path segment internally — pass the raw `summary.id` (e.g. `"redstone/lever_basic.json"`) verbatim, don't pre-encode.
- Types: `import type { TestSummary, TestDetail, FileChangedEvent } from "../api/types"`. `TestSummary.parse_error` is **snake_case** (omitted on success) — match exactly.
- Errors throw `ApiError` with `status` and `body`; non-OK responses are *not* shown via `res.ok` — let the throw propagate to a try/catch.
- SSE: `const dispose = api.events(e => …)` returns a disposer that closes the `EventSource`. Listener gets `FileChangedEvent { id }`. Server debounces to 1 event / file / 100ms; treat as cache-bust and re-call `api.getTest(id)`.

## Handoff from #0018 (replay store)

Store at `frontend/src/store/replay.ts` exposes `useReplayStore` (Zustand). Selectors the sidebar will use:

- `testId` — the currently-open test id. Highlight the matching tree row by comparing to `summary.id`.
- `openTest(testId, source)` — call when the user clicks a row. It resets `replay`, `tick`, `worldState`, `player`, `playback` to a clean state. **It does not fetch** — after calling `openTest`, fire `api.replay(source)` (or `api.getTest(id)` first if you only have an id), then call `setReplay(replay, parseErrors)` with the result.
- `setSource(source)` — used by #0020 on edits; the sidebar shouldn't call it directly. After SSE `file-changed` for the open test, call `api.getTest(id)` then `openTest(id, detail.source)` to re-seed (or `setSource` + re-replay if you want to preserve cursor — see #0020).
- Use `useReplayStore(s => s.testId)` (selector form) to avoid re-rendering on unrelated store changes.

Files you'll touch from upstream contexts: extend `frontend/src/layout/SplitLayout.tsx` to add an optional `sidebar` prop (3-panel `PanelGroup`); plumb in `frontend/src/App.tsx`.

## Status (this issue)

Implemented at:

- `frontend/src/panels/buildTree.ts` — pure tree builder + 6 Vitest cases in `__tests__/buildTree.test.ts`. `TreeNode = TreeFolder | TreeFile`; folders carry their accumulated `path` (e.g. `"a/b"`); files carry the original `summary`. Order preservation matches the server's id-sorted listing.
- `frontend/src/panels/TestList.tsx` — fetches `api.listTests()` on mount with `AbortController`; renders the recursive tree; click → `api.getTest(id)` → `store.openTest` → `api.replay(source)` → `store.setReplay`. Stale-result protection via a token ref so concurrent clicks don't race.
- SSE: subscribes once on mount via `api.events`. **Every** `file-changed` triggers a `refreshList()` (cheap; catches new files, renames, parse-error toggles); the open test is re-loaded only when the event id matches the current `testId` (read via a ref to avoid re-subscribing on every test switch).
- Files with `parse_error` show a red dot + italic + a native `title` tooltip (the issue suggested Radix tooltips; deferred — `title` is good enough for v1, easy to swap later). Tags are exposed inside the same `title` tooltip.
- Folders are expanded by default; click to collapse. State held as a `Set<string>` of *collapsed* paths.
- `SplitLayout` now accepts an optional `sidebar` slot; when present it renders a 3-panel `PanelGroup` (sidebar 18% / left 50% / right 32% defaults, with min/max clamps on the sidebar). The 2-panel form is preserved for layouts without a sidebar.
- `App.tsx` updated to pass `<TestList />` as the sidebar slot. The temporary "Tailwind smoke test" red text was removed; right pane now reads "Editor placeholder (lands in #0020)".

Notes for #0033 (error states): the sidebar currently renders `listError` and `openError` inline as red text strips. Once toasts land, those strings should migrate out — see #0033's handoff section.
