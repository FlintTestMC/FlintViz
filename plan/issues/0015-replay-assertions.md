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

## Status (post-#0010)

- `AssertionView` is **an enum** (not a struct as sketched in #0010), serde-tagged on `kind` with `snake_case`:
  ```rust
  enum AssertionView {
      Block { position: [i32;3], expected: Block },
      Inventory { slot: PlayerSlot, expected: Option<Item> },
      Other { description: String },
  }
  ```
- `flint_core::test_spec` (v1.1.3): `ActionType::Assert { checks: Vec<AssertType> }`. `AssertType` is `#[serde(untagged)]` with `Block(BlockCheck)` and `Inventory(InventoryCheck)`.
- `BlockCheck { pos, is: BlockSpec }`. `BlockSpec` is untagged `Single(Block) | Multiple(Vec<Block>)`. For `Multiple`, emit one `AssertionView::Block` per expected block at that pos (or render as `Other` with a "one of: ..." description — engineer's call; pick whichever the panel UI in #0031 needs).
- `InventoryCheck { slot, is: Option<Item> }` → `AssertionView::Inventory { slot, expected: is }`.
- v1.1.3 `ActionType` does **not** define a separate `assert_state` variant. Skip that; reserve the `Other { description }` arm for when one is added (or when a state-style check appears via flint-core extensions).
- The engine should *not* emit an `ActionEvent` for assertions — they live exclusively in `TickFrame.assertions`. (`ActionEvent` has no `Assert` variant.)
