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
- `crates/flint-viz/src/replay/player.rs` (extend — `PlayerDelta::SetSlot` arm + handler)
- `crates/flint-viz/src/replay/engine.rs` (dispatch on `ActionType::SetSlot`)
- `crates/flint-viz/src/replay/model.rs` (`ActionEvent::SetSlot`)
