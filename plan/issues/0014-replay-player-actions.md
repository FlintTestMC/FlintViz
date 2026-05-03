# 0014 — Replay engine: player actions

**Milestone:** M3
**Depends on:** #0010

## Goal
Track the player snapshot through the timeline: gamemode, hotbar slot selection, slot contents, off-hand, armor.

## Outcome
- `Replay.initial_player` populated from `TestSpec.setup.player` (or sensible default).
- `TickFrame.inventory_diff` populated for ticks with player-affecting actions: setting a slot, selecting a hotbar slot, gamemode change, `use_item_on` (decrement count for consumables — only if flint-core's spec models this; otherwise no change).
- The frontend can reconstruct `PlayerSnapshot` at any tick by applying diffs forward from `initial_player`.

## Implementation notes
- Look at `flint_core::test_spec::PlayerSlot`, `PlayerConfig`, the player-related `ActionType` variants.
- For `use_item_on`: in static replay we **do not** simulate the result — only record the inventory change to the using slot if the spec describes one. When unsure, leave inventory unchanged and just emit an `ActionEvent::UseItemOn`.

## Files
- `crates/flint-viz/src/replay/engine.rs`
- `crates/flint-viz/src/replay/player.rs` (new)
