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

## Status (post-#0010)

- `PlayerSnapshot` is **a struct** `{ inventory: HashMap<PlayerSlot, Item>, selected_hotbar: u8, game_mode: GameMode }` with a `Default` (empty inventory, hotbar=1, `GameMode::Creative`). Use it for `Replay.initial_player`.
- Source `flint_core::test_spec::PlayerConfig` (`setup.player`) has `inventory: HashMap<PlayerSlot, Item>`, `selected_hotbar: u8` (default 1), `game_mode: GameMode` (default `Creative`). Map field-by-field; fall back to `PlayerSnapshot::default()` when `setup.player` is absent.
- `PlayerDelta` is **a struct** (NOT an enum), aggregating all player-affecting changes within a single tick:
  ```rust
  pub struct PlayerDelta {
      pub slots: Vec<SlotChange>,                // multiple set_slot entries on the same tick
      pub selected_hotbar: Option<HotbarChange>, // last select_hotbar wins on the same tick
      pub game_mode: Option<GameModeChange>,
  }
  ```
  Reason: `TickFrame.inventory_diff: Option<PlayerDelta>` only allows one delta per tick — but a tick can contain several `set_slot` plus a `select_hotbar`. Issues #0037/#0038/#0039 originally said `PlayerDelta::SetSlot` etc.; that wording is **superseded** — they should populate fields on the struct instead.
- `SlotChange { slot, item: Option<Item>, previous: Option<Item> }`, `HotbarChange { slot, previous }`, `GameModeChange { mode, previous }` all carry a `previous` value so the frontend store (#0018) can reverse-scrub in O(1).
- After applying a delta, also emit `inventory_diff = None` (don't attach an empty `PlayerDelta`); use `PlayerDelta::is_empty()` to decide.

## Status (post-#0011)

- The engine entry point is `replay::compute(&TestSpec) -> Replay` in `crates/flint-viz/src/replay/engine.rs`. It currently builds `initial_player` from `setup.player` directly — keep that path and just extend the per-tick walk.
- `apply_action(frame, action, errors)` is the per-action dispatch. To track player state, **change its signature** to thread a running snapshot:
  ```rust
  fn apply_action(
      frame: &mut TickFrame,
      action: &ActionType,
      snapshot: &mut PlayerSnapshot,
      errors: &mut Vec<ReplayError>,
  )
  ```
  The snapshot is initialised from `initial_player.clone()` *before* the timeline loop and mutated forward as each tick's deltas apply. Per-tick: lazily get-or-init `frame.inventory_diff = Some(PlayerDelta::default())`, append changes, then at end of `compute` post-process: drop `inventory_diff` for any frame where `delta.is_empty()`.
- A `Replay`-level `errors: Vec<ReplayError>` field exists now (added in #0011 for oversize fills). Reuse it for `select_hotbar` out-of-range warnings (#0039) instead of inventing a separate channel — it's structured `{ tick, message }`.
- The empty-frame filter (`is_frame_empty` in `engine.rs`) already considers `inventory_diff` — frames whose only contribution is a `PlayerDelta` will be retained correctly.
