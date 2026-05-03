# 0011 — Replay engine: `place` + `fill`

**Milestone:** M3
**Depends on:** #0010

## Goal
Walk a `TestSpec` timeline and produce `TickFrame`s for `place` and `fill` actions.

## Outcome
- `replay::compute(&TestSpec) -> Replay` handles these two action types.
- For each `place`, emits a `BlockChange::Set { pos, block }`.
- For each `fill`, emits `BlockChange::Set` for every position in the AABB (clamp to a sane size — reject fills > 100k blocks with an error in the `Replay`).
- Wire into `POST /api/replay` so the response now contains a real `replay` field.

## Implementation notes
- Read `flint_core::test_spec::ActionType` variants for the exact field names.
- AABB iteration helper used here will be reused by other actions.

## Tests
- `~/flint/FlintCLI/example_tests/basic_placement.json` → 1 place at tick 0, 1 assertion at tick 1.
- A small synthetic fill test.

## Files
- `crates/flint-viz/src/replay/engine.rs` (new)
- `crates/flint-viz/src/replay/aabb.rs` (new)
- `crates/flint-viz/src/api/replay.rs` (wire in)
