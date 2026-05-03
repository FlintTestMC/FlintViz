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

## Status (post-#0011)

- Dispatch in `crates/flint-viz/src/replay/engine.rs` `apply_action`. `ActionType::Assert { .. }` is currently in the no-op tail of the `match`; split it into its own arm and push to `frame.assertions`.
- Frame-empty filtering (`is_frame_empty` in the same file) already includes `assertions` in its check — assert-only ticks will materialise as their own `TickFrame` once you start populating that vec. Today (post-#0011) assert-only ticks are dropped because their frame ends up empty; that flips automatically when this issue lands.
- For `BlockSpec::Multiple` choose ONE convention and document it in the dispatch arm. Recommendation that fits the rest of the engine: emit one `AssertionView::Block` per expected block (so the assertion panel #0031 can render them as a list of alternatives without parsing free-text).
- Suggested skeleton:
  ```rust
  ActionType::Assert { checks } => {
      for check in checks {
          match check {
              AssertType::Block(BlockCheck { pos, is }) => {
                  for expected in is.to_vec() {
                      frame.assertions.push(AssertionView::Block { position: *pos, expected });
                  }
              }
              AssertType::Inventory(InventoryCheck { slot, is }) => {
                  frame.assertions.push(AssertionView::Inventory { slot: *slot, expected: is.clone() });
              }
          }
      }
  }
  ```

## Status (post-#0012)

- The no-op tail of `apply_action`'s `match` is now `Remove | Assert | UseItemOn | SetSlot | SelectHotbar` (PlaceEach has been split out). Splitting `Assert` into its own arm using the skeleton above remains the right move; nothing else changes.
- `~/flint/FlintCLI/FlintBenchmark/tests/non_breaking_cactus.json` is a good cross-fixture for #0015: it contains both `place_each` (now handled) and rich `assert` blocks. After this issue lands, a test that loads that fixture should produce frames with both `actions` (PlaceEach) and `assertions` populated.

## Status (post-#0013)

- The no-op tail of `apply_action`'s `match` is now `Assert | UseItemOn | SetSlot | SelectHotbar` (Remove has been split out). Splitting `Assert` into its own arm using the skeleton above remains the right move.
- The `basic_placement` test fixture pattern (#0011) still holds: assert-only ticks like `at: 1` and `at: 3` in `~/flint/FlintCLI/example_tests/basic_placement.json` are currently dropped by `is_frame_empty`. After this issue lands they materialise as their own `TickFrame`s with `assertions` populated and empty `actions` / `block_diff`. The unit test `basic_placement_emits_place_actions_at_their_ticks` in `engine.rs` currently asserts `replay.frames.len() == 2` — that assertion will need to change to `4` once assertion ticks are no longer dropped.

## Status (post-#0014)

- `apply_action`'s signature changed:
  ```rust
  fn apply_action(
      frame: &mut TickFrame,
      action: &ActionType,
      _snapshot: &mut PlayerSnapshot,
      errors: &mut Vec<ReplayError>,
  )
  ```
  The `Assert` arm doesn't need the snapshot (assertions are purely declarative — see this issue's "Implementation notes"). Leave `_snapshot` underscored on this arm; you don't need to touch it.
- The no-op tail of the `match` is unchanged from post-#0013 (`Assert | UseItemOn | SetSlot | SelectHotbar`) — #0014 only added foundation, not new arms. Splitting `Assert` off using the post-#0011 skeleton remains correct.
- A `replay::player` helper module exists for the player-action issues (#0037–#0039); assertions don't use it.
- `compute`'s post-pass now also strips empty `inventory_diff`s before frame filtering. Asserts emit nothing on `inventory_diff`, so this is invisible to #0015 — just a heads-up if you're reading the surrounding code.
