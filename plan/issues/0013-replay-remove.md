# 0013 — Replay engine: `remove`

**Milestone:** M3
**Depends on:** #0011

## Goal
Handle the `remove` action — single position or AABB region removal.

## Outcome
- Emits `BlockChange::Remove` for each cleared position.
- Removing a position that has no recorded block in the static replay still emits a `Remove` (frontend treats it as "definitely empty after this tick").

## Implementation notes
- Reuse the AABB helper from #0011.

## Files
- `crates/flint-viz/src/replay/engine.rs`
