# 0012 — Replay engine: `place_each`

**Milestone:** M3
**Depends on:** #0011

## Goal
Handle the `place_each` action — multiple positions paired with a single block, or position/block pairs.

## Outcome
- Engine produces correct `BlockChange`s for both forms (verify exact shape against `flint_core::test_spec::ActionType::PlaceEach` fields).
- Unit test covers a `place_each` from `~/flint/FlintCLI/FlintBenchmark/tests/`.

## Implementation notes
- Match the exact field names in `flint-core`'s deserialization. Do not re-invent.

## Files
- `crates/flint-viz/src/replay/engine.rs`

## Status (post-#0010)

- `flint_core::test_spec::ActionType::PlaceEach` shape (v1.1.3): `{ blocks: Vec<BlockPlacement> }` where `BlockPlacement { pos: [i32;3], block: Block }`.
- Emit ONE `ActionEvent::PlaceEach { placements: Vec<BlockPlacement> }` per timeline entry (the field is renamed `placements` in our wire format) plus N `BlockChange::Set` entries (one per placement). Reuse `BlockPlacement` directly — it's re-exported through `flint_core::test_spec`.

## Status (post-#0011)

- The engine entry point is `replay::compute(&TestSpec) -> Replay` in `crates/flint-viz/src/replay/engine.rs`. Dispatch happens in `apply_action(frame, action, errors)` via a `match` on `ActionType`.
- `ActionType::PlaceEach { .. }` is currently in the no-op tail of that match — split it into its own arm. Pattern to follow (mirrors `Place` / `Fill`):
  ```rust
  ActionType::PlaceEach { blocks } => {
      frame.actions.push(ActionEvent::PlaceEach { placements: blocks.clone() });
      for placement in blocks {
          frame.block_diff.push(BlockChange::Set {
              pos: placement.pos,
              block: placement.block.clone(),
          });
      }
  }
  ```
- Frame creation/empty-filter is handled centrally — `is_frame_empty` drops ticks that produced nothing, so you don't need to guard against empty `blocks` Vecs.
- No `Replay`-level `errors` need to be emitted for `place_each` (no size cap defined; positions are already validated by `flint-core`'s `validate()` if the loader path is used).
