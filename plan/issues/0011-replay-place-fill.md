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

## Status (post-#0010)

- `flint-core` is pinned to `tag = "v1.1.3"` (was `rev = "b04ad23"`). The new tag exposes `Item`, `PlayerSlot`, `BlockFace`, `GameMode`, `PlayerConfig`, `BlockSpec`, `InventoryCheck`, `AssertType`, and the full `ActionType` enum (incl. `UseItemOn`, `SetSlot`, `SelectHotbar`).
- Data model lives in `crates/flint-viz/src/replay/model.rs`, re-exported from `crates/flint-viz/src/replay/mod.rs`. The module currently has `#![allow(dead_code)]`; remove it once the engine consumes the types.
- For this issue, emit BOTH:
  - `ActionEvent::Place { pos, block }` / `ActionEvent::Fill { region: Aabb, block }` into `TickFrame.actions` (drives the timeline highlight in #0026).
  - `BlockChange::Set { pos, block }` into `TickFrame.block_diff` (drives world reconstruction).
- `Aabb` is `{ min: [i32;3], max: [i32;3] }`. Use `Aabb::from_pair([[i32;3];2])` to build one from `flint_core`'s `Fill.region` literal.
- `flint-core`'s `ActionType::Fill` field is named `with: Block` (not `block`).
- Build a real `Replay` and wire `crates/flint-viz/src/api/replay.rs` to put it in the `replay` field (currently `Option<()>` — change to `Option<Replay>`).
