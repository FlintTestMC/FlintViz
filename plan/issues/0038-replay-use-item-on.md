# 0038 — Replay engine: `use_item_on`

**Milestone:** M3
**Depends on:** #0014

## Goal
Handle the `use_item_on` timeline action — the player uses an item on a block face. In static replay we **do not** simulate game logic, so this issue *only emits an event*; no inventory mutation, no automatic block placement.

## flint-core reference
`~/flint/flint-core/src/test_spec.rs` line 379:
```rust
UseItemOn {
    pos: [i32; 3],
    face: BlockFace,
    #[serde(default)]
    item: Option<String>,
},
```
- `pos` — block being interacted with.
- `face` — `BlockFace` enum (`Top`/`Bottom`/`North`/`South`/`East`/`West`, snake_case in JSON).
- `item: Option<String>` — overrides the currently-selected hotbar item if present; otherwise the active hotbar slot's item is used.

## Outcome
- Engine emits `ActionEvent::UseItemOn { pos, face, item: Option<String>, resolved_item: Option<Item> }`.
  - `resolved_item` is computed at engine time: if `item.is_some()`, use it (count 1); else look up the current `selected_hotbar` slot in the running `PlayerSnapshot`.
- **No** `PlayerDelta` is emitted — inventory does not change in static replay (we cannot decide whether the item is consumable, a block, etc., without an MC registry).
- **No** `BlockChange` is emitted — we do not approximate block placement here. The visualizer shows the action as a highlight (#0026) at `pos` with a face indicator, and any expected outcome should appear via subsequent `assert` actions in the test.
- Unit test: fixture with `use_item_on` produces an event with `resolved_item` correctly resolved from the current hotbar.

## Implementation notes
- Resolving the active item requires the `PlayerSnapshot` *as of the previous tick*. Easiest: thread a running snapshot through the engine while it walks the timeline.
- Document the no-side-effect choice explicitly in the source as a comment — future maintainers will be tempted to "fix" this without realising it's intentional.
- Stretch (NOT in this issue, future ticket): a "block-item heuristic" that emits a tentative `BlockChange::Set` when `resolved_item.id` matches a known block id. Requires a vendored block-id allow-list. Skip for now.

## Files
- `crates/flint-viz/src/replay/engine.rs` (dispatch on `ActionType::UseItemOn`)
- `crates/flint-viz/src/replay/player.rs` (helper: `resolve_active_item(snapshot, override)`)

## Status (post-#0010)

- `ActionEvent::UseItemOn { pos, face: BlockFace, item: Option<String>, resolved_item: Option<Item> }` is **already defined** in `replay/model.rs`. `BlockFace` comes directly from `flint_core::test_spec` (no local mirror); don't redefine.
- This action emits **no** `BlockChange` and **no** `PlayerDelta` (so `inventory_diff` stays whatever the rest of the tick produces).
- `resolve_active_item`: if `item.is_some()`, return `Some(Item::new(item))` (count 1, no data). Else look up `snapshot.inventory.get(&PlayerSlot::hotbar(snapshot.selected_hotbar)?)` and clone. If neither resolves, leave `resolved_item = None` — frontend will render the action with an "unknown item" badge.

## Status (post-#0011)

- Dispatch site is `apply_action` in `crates/flint-viz/src/replay/engine.rs`. `ActionType::UseItemOn { .. }` is in the no-op tail of that `match`; split it off.
- Depends on #0014 having landed first — it threads a running `PlayerSnapshot` through `apply_action`, which is required for `resolved_item` resolution.
- Reminder of intent: emit ONLY `ActionEvent::UseItemOn`; do NOT push to `frame.block_diff` and do NOT mutate the snapshot. The `is_frame_empty` filter will keep the frame because `actions` is non-empty.

## Status (post-#0014)

- `apply_action` now takes `_snapshot: &mut PlayerSnapshot`. Rename to `snapshot` when you split off the `UseItemOn` arm (you'll need it to read `selected_hotbar` + `inventory`).
- The `replay::player` helper module exists. **No new helper for `use_item_on` was added** — `resolve_active_item` belongs to this issue. Add it to `replay/player.rs` next to the existing helpers; suggested signature:
  ```rust
  pub fn resolve_active_item(snapshot: &PlayerSnapshot, override_id: &Option<String>) -> Option<Item> {
      if let Some(id) = override_id {
          return Some(Item::new(id));
      }
      let slot = PlayerSlot::hotbar(snapshot.selected_hotbar)?;
      snapshot.inventory.get(&slot).cloned()
  }
  ```
  `Item::new` already handles the `count: 1, data: empty` case.
- Suggested arm body:
  ```rust
  ActionType::UseItemOn { pos, face, item } => {
      let resolved_item = player::resolve_active_item(snapshot, item);
      frame.actions.push(ActionEvent::UseItemOn {
          pos: *pos,
          face: face.clone(),
          item: item.clone(),
          resolved_item,
      });
  }
  ```
  Note: `BlockFace` is `Clone` but not `Copy` (it's an enum re-exported from `flint_core::test_spec`).
- Do **not** call `player::inventory_diff_mut` in this arm. `use_item_on` emits no `PlayerDelta` per the issue Outcome, and `inventory_diff_mut` would lazily allocate an empty delta. The post-pass would clean it up, but it's wasted work and obscures intent.
- The no-op tail after this issue lands shrinks to `Assert | SetSlot | SelectHotbar` (assuming #0037 hasn't landed yet; if both have, it's `Assert | SelectHotbar`).
