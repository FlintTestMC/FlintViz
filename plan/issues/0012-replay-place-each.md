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
