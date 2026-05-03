# 0035 — (Stretch) Real execution via flint-steel

**Milestone:** M8
**Depends on:** all of M1–M7

## Goal
Optional cargo feature `real-runtime` that links flint-steel and runs a test for real, overlaying actual results onto the static replay.

## Outcome
- `cargo build --features real-runtime` produces a binary that exposes `POST /api/run/:id`.
- Frontend gets a "Run" button next to the timeline. On click, the backend executes via flint-steel and streams real per-tick state.
- Real outcomes overlay the static replay: assertions show ✅ / ❌, real block diffs replace the static diffs (when they differ).
- Without the feature, the button is hidden.

## Implementation notes
- `flint-steel` setup may be heavier — its world initialization should happen once and be reused.
- Stream results via SSE so the timeline updates progressively.
- Don't block static replay on this — keep it fully optional.

## Files
- `crates/flint-viz/Cargo.toml` (feature)
- `crates/flint-viz/src/runtime/mod.rs` (new, behind `cfg(feature = "real-runtime")`)
- `crates/flint-viz/src/api/run.rs` (new)
- `frontend/src/timeline/RunButton.tsx`
