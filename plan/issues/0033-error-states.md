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
