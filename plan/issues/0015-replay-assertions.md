# 0015 — Replay engine: assertion collection

**Milestone:** M3
**Depends on:** #0010

## Goal
Collect every `assert` / `assert_state` entry into `TickFrame.assertions` as `AssertionView`s. We do **not** evaluate them — static replay can't claim pass/fail.

## Outcome
- Each block check → `AssertionView { kind: Block, expected: Block, position: [x,y,z] }`.
- Each inventory check → `AssertionView { kind: Inventory, expected: Item, slot: PlayerSlot }`.
- Each state check (e.g., `expected_count`, comparators) → represented as a generic `Other { description }` for now; the frontend just displays the description text.

## Implementation notes
- `flint_core::test_spec::Assert`, `BlockCheck`, `InventoryCheck` define the expected shapes.
- Keep this purely declarative — no game-state lookups.

## Files
- `crates/flint-viz/src/replay/engine.rs`
- `crates/flint-viz/src/replay/assertions.rs` (new)
