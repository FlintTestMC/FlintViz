# 0033 — Error states & empty UI

**Milestone:** M7
**Depends on:** #0019, #0020, #0023

## Goal
Make the tool gentle to use when things go wrong.

## Outcome
- Path doesn't exist on `flint-viz serve` → backend exits with a clear message; instructions in stderr.
- Empty test root → sidebar shows "No tests found in <path>" with a hint.
- JSON parse error → editor squiggles, 3D view freezes on the last good state with a small "stale" badge top-right and a tooltip "showing last valid replay".
- Asset bundle missing → 3D pane shows a panel explaining how to fetch assets (`npm run assets`).
- API request fails → toast with the error.

## Implementation notes
- A single `<ErrorBoundary>` wraps each pane to prevent a single failure from killing the whole UI.

## Files
- `frontend/src/components/ErrorBoundary.tsx`
- `frontend/src/components/StaleBadge.tsx`
- `frontend/src/components/Toast.tsx`
- `crates/flint-viz/src/main.rs` (path validation message)

## Handoff from #0019 (test list sidebar)

The sidebar (`frontend/src/panels/TestList.tsx`) already does limited error rendering — `listError` and `openError` strings render inline at the top/bottom of the panel. It uses `ApiError.message` (with the body baked in) for most cases. When this issue lands:

- Move the `listError`/`openError` strings out of `TestList.tsx` into your global `<Toast />` channel; the sidebar should fire a toast and stay otherwise quiet (it currently shows red footer text, which is acceptable for v1 but redundant once toasts exist).
- The "No tests found" copy lives in the sidebar today; keep it there but extend it with the served `path` (currently the frontend has no API for that — either expose it via a new `/api/info` endpoint or include it in the `listTests` response). Out of scope unless this issue picks it up.
- Files with `summary.parse_error` set are rendered with a red dot + italic + native `title` tooltip. If you adopt Radix tooltips for the rest of the app, swap the `title` for a Radix tooltip here too — keep the red dot.
- Last-good replay state: `setReplay(null, errors)` already preserves `tick`/`worldState`/`player`. So a stale badge just needs a selector like `useReplayStore(s => s.parseErrors.length > 0 && s.replay !== null)` (or "had a replay before this error"). The sidebar already calls `setReplay(replay.replay, replay.errors)` regardless — when `errors.length > 0` the world view stays on the previous frame.

## Handoff from #0017/#0018 (referenced indirectly)

- `ApiError` from `frontend/src/api/client.ts` is the only thrown error type from the API layer; switch on `err instanceof ApiError && err.status === N` for status-specific UX (e.g. 413 → "test file too big", 404 → "test was deleted").
- The store's `parseErrors: ParseError[]` is already the canonical "current replay errors" source; toasts and stale badges should subscribe to it, not duplicate state.
