# 0039 — Replay engine: `select_hotbar`

**Milestone:** M3
**Depends on:** #0014

## Goal
Handle the `select_hotbar` timeline action — change which hotbar slot (1–9) is currently active.

## flint-core reference
`~/flint/flint-core/src/test_spec.rs` line 397:
```rust
SelectHotbar {
    slot: u8,
},
```
- `slot` is 1..=9. Maps onto `PlayerConfig.selected_hotbar` (line 125).

## Outcome
- Engine emits `ActionEvent::SelectHotbar { slot }` and `PlayerDelta::SelectHotbar { slot, previous: u8 }`.
- Forward-apply updates `PlayerSnapshot.selected_hotbar`; reverse-apply restores `previous`.
- The selected slot drives:
  - `use_item_on` resolution when its `item` field is omitted (#0038).
  - The "selected slot" highlight in the inventory panel (#0030).
- Unit test: fixture with `{"do": "select_hotbar", "slot": 3}` flips the snapshot's `selected_hotbar` to 3 at that tick and reverts when scrubbing back.

## Implementation notes
- Validate `1 <= slot <= 9` at engine time; emit a `Replay`-level warning (not a hard error) if out of range so a malformed test still produces a usable replay.

## Files
- `crates/flint-viz/src/replay/player.rs` (`PlayerDelta::SelectHotbar` arm + handler)
- `crates/flint-viz/src/replay/engine.rs` (dispatch on `ActionType::SelectHotbar`)
- `crates/flint-viz/src/replay/model.rs` (`ActionEvent::SelectHotbar`)
