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

## Status (post-#0012)

- `place_each` is now wired (own arm in `apply_action`'s `match`); the no-op tail has shrunk to `Remove | Assert | UseItemOn | SetSlot | SelectHotbar`. When you change `apply_action`'s signature to thread `snapshot: &mut PlayerSnapshot`, update the existing `Place` / `Fill` / `PlaceEach` arms too — they don't touch the snapshot, but the parameter must still appear (use `_` if unused on a per-arm basis is not idiomatic; just leave the arg unused, the bind is on the arms that need it).

## Status (post-#0013)

- `Remove` is now wired too. The no-op tail of `apply_action`'s `match` is now `Assert | UseItemOn | SetSlot | SelectHotbar` — these are the four arms left for #0015 and #0037–#0039. When you change `apply_action`'s signature to thread `snapshot: &mut PlayerSnapshot`, update the existing `Place` / `Fill` / `PlaceEach` / `Remove` arms too (they don't read or mutate the snapshot, but the parameter must still appear).
- The one-`ActionEvent`-per-timeline-entry invariant continues to hold for `Remove` (one `ActionEvent::Remove` + one `BlockChange::Remove` per entry).

## Done

Foundation landed:

- `apply_action`'s signature is now `(frame, action, _snapshot: &mut PlayerSnapshot, errors)`. The snapshot is cloned from `initial_player` before the timeline loop and passed through unconditionally. All currently-populated arms (`Place`, `Fill`, `PlaceEach`, `Remove`) ignore it via `_snapshot`.
- `replay::player` module exists at `crates/flint-viz/src/replay/player.rs` and is wired into `replay/mod.rs`. Public helpers:
  - `inventory_diff_mut(frame) -> &mut PlayerDelta` — lazy get-or-init.
  - `record_slot_change(snapshot, delta, slot, item)` — captures `previous`, mutates the snapshot inventory, pushes a `SlotChange` onto `delta.slots`.
  - `record_hotbar_change(snapshot, delta, slot)` — collapses repeats within a tick, keeps start-of-tick `previous`.
  - `record_game_mode_change(snapshot, delta, mode)` — same collapse rule.
- `compute`'s post-pass strips `inventory_diff` whenever `PlayerDelta::is_empty()` — callers can `inventory_diff_mut` unconditionally.
- The per-tick player-action arms (`SetSlot`, `UseItemOn`, `SelectHotbar`) are NOT yet implemented — they're tracked under #0037 / #0038 / #0039 (each updated with a post-#0014 status block including a suggested arm body).
- Engine tests added: `initial_player_falls_back_to_default_when_setup_player_absent`, `initial_player_mirrors_setup_player_field_by_field`, `block_only_timeline_never_attaches_inventory_diff`. Helper-level tests live in `replay::player::tests`.
