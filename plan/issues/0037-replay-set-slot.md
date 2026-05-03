# 0037 — Replay engine: `set_slot`

**Milestone:** M3
**Depends on:** #0014

## Goal
Handle the `set_slot` timeline action — a scripted inventory mutation that places (or clears) an item in a specific player slot at a specific tick.

## flint-core reference
`~/flint/flint-core/src/test_spec.rs` line 388:
```rust
SetSlot {
    slot: PlayerSlot,
    #[serde(default)]
    item: Option<String>,
    #[serde(default = "default_count")]
    count: u8,
},
```
- `slot: PlayerSlot` — `Hotbar1`–`Hotbar9`, `OffHand`, `Helmet`, `Chestplate`, `Leggings`, `Boots`, `None`.
- `item: Option<String>` — item id like `"minecraft:honeycomb"`. `None` ⇒ clear the slot.
- `count: u8` — defaults to 1.

## Outcome
- Engine emits `ActionEvent::SetSlot { slot, item, count }` and `PlayerDelta::SetSlot { slot, item: Option<Item>, count }` for each `set_slot` entry.
- Forward-applying the delta updates `PlayerSnapshot.inventory` (insert / overwrite / remove the slot entry).
- Reverse-applying restores the previous slot contents (store the prior value alongside the delta or compute it during scrubbing).
- Unit test against a fixture with at least one `set_slot` (and one with `item` omitted to verify "clear").

## Implementation notes
- Construct an `Item { id: item.clone().unwrap_or_default(), count, data: Default::default() }` when `item.is_some()`; otherwise the new slot value is `None`.
- For reverse-application: snapshot the previous slot value into `PlayerDelta::SetSlot.previous` so backward scrubbing in #0018 is O(1). If you'd rather keep deltas pure-forward, the frontend (#0018) rebuilds from `initial_player` whenever target tick < current — that's already the planned fallback.

## Files
- `crates/flint-viz/src/replay/player.rs` (extend — append a `SlotChange` to `PlayerDelta.slots` + handler)
- `crates/flint-viz/src/replay/engine.rs` (dispatch on `ActionType::SetSlot`)

## Status (post-#0010)

- `ActionEvent::SetSlot { slot: PlayerSlot, item: Option<String>, count: u8 }` is **already defined** in `replay/model.rs`. Don't redefine.
- The `PlayerDelta::SetSlot` enum variant referenced in this issue's Outcome **does not exist** — `PlayerDelta` is a struct (see #0014 "Status"). Append a `SlotChange { slot, item: Option<Item>, previous: Option<Item> }` to `delta.slots` instead.
- `previous` is captured by reading the running `PlayerSnapshot.inventory` *before* applying the delta (snapshot is threaded through the engine).
- For `item.is_some()`, build `Item { id: item.clone().unwrap(), count, data: Default::default() }`. For `item.is_none()`, the new value is `None` (clear the slot).
- After a tick's slot writes, attach the `PlayerDelta` only if `!delta.is_empty()`; otherwise leave `inventory_diff = None`.

## Status (post-#0011)

- Dispatch site is `apply_action` in `crates/flint-viz/src/replay/engine.rs`. `ActionType::SetSlot { .. }` currently sits in the no-op tail of that `match`; split it off.
- Threading the running `PlayerSnapshot` through `apply_action` is part of #0014's foundation. Land #0014 first (it changes the `apply_action` signature to take `&mut PlayerSnapshot`) and build on top of that — don't refactor the signature here.
- Use the existing `Replay.errors: Vec<ReplayError>` field (added in #0011) only for genuine engine-level rejections; `set_slot` is well-defined and shouldn't need it.

## Status (post-#0014)

- The foundation is in place: `apply_action` is now
  ```rust
  fn apply_action(
      frame: &mut TickFrame,
      action: &ActionType,
      _snapshot: &mut PlayerSnapshot,
      errors: &mut Vec<ReplayError>,
  )
  ```
  in `crates/flint-viz/src/replay/engine.rs`. Rename `_snapshot` → `snapshot` when you split off the `SetSlot` arm. The snapshot is cloned from `initial_player` before the timeline loop and is mutated forward as deltas apply.
- A `replay::player` module now exists at `crates/flint-viz/src/replay/player.rs` with the helper this issue should use — **don't reimplement it inline**:
  ```rust
  player::record_slot_change(snapshot, delta, slot, item);
  ```
  It captures `previous` from the snapshot, mutates the snapshot (insert/remove), and pushes a `SlotChange` onto `delta.slots` in one call. Get the `&mut PlayerDelta` via `player::inventory_diff_mut(frame)` (lazy get-or-init).
- The empty-delta cleanup is already handled in `compute`'s post-pass: any `inventory_diff` whose `PlayerDelta::is_empty()` returns true is reset to `None` before frames are filtered. So you can call `inventory_diff_mut` unconditionally from the SetSlot arm; you do NOT need to undo it on no-op paths.
- Suggested arm body (concise version, leveraging the helper):
  ```rust
  ActionType::SetSlot { slot, item, count } => {
      frame.actions.push(ActionEvent::SetSlot {
          slot: *slot,
          item: item.clone(),
          count: *count,
      });
      let new_item = item
          .as_ref()
          .map(|id| Item { id: id.clone(), count: *count, data: Default::default() });
      let delta = player::inventory_diff_mut(frame);
      player::record_slot_change(snapshot, delta, *slot, new_item);
  }
  ```
- The no-op tail of the `match` is now `Assert | UseItemOn | SetSlot | SelectHotbar` (unchanged from post-#0013 — #0014 only added foundation, not a new arm). After this issue lands it shrinks to `Assert | UseItemOn | SelectHotbar`.
- `Item`'s `data` field is `FxHashMap<String, String>` (re-exported from `flint_core`), not `HashMap`. `Default::default()` works for both, but use `FxHashMap::default()` if you'd rather be explicit.
