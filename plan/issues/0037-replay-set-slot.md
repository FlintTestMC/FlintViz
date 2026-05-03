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
