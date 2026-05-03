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
- `crates/flint-viz/src/replay/player.rs` (set `PlayerDelta.selected_hotbar` + handler)
- `crates/flint-viz/src/replay/engine.rs` (dispatch on `ActionType::SelectHotbar`)

## Status (post-#0010)

- `ActionEvent::SelectHotbar { slot: u8 }` is **already defined** in `replay/model.rs`.
- `PlayerDelta::SelectHotbar` enum variant **does not exist** — `PlayerDelta` is a struct (see #0014). Set `delta.selected_hotbar = Some(HotbarChange { slot, previous })` where `previous = snapshot.selected_hotbar` *before* applying.
- If multiple `select_hotbar` entries land on the same tick, last wins; `previous` is the value at the start of the tick (so reverse-scrub still restores correctly).
- Out-of-range (`slot < 1 || slot > 9`): emit the `ActionEvent` for visibility but skip the `HotbarChange` and log a warning. (No `Replay`-level warning channel yet; `tracing::warn!` is fine for now — extend the model with a warnings field if a need accumulates.)

## Status (post-#0011)

- A `Replay`-level error channel now exists: `Replay.errors: Vec<ReplayError { tick, message }>` (added in #0011 for oversize fills). Prefer pushing an out-of-range `select_hotbar` into `errors` over `tracing::warn!` — that earlier note about "no warning channel yet" is superseded. The frontend can surface the message inline at the offending tick.
- Dispatch site is `apply_action` in `crates/flint-viz/src/replay/engine.rs`. `ActionType::SelectHotbar { .. }` sits in the no-op tail of the `match`; split it off.
- Depends on #0014 having landed first — needs the running `PlayerSnapshot` (for `previous`) and the per-tick `PlayerDelta` plumbing.

## Status (post-#0014)

- The foundation is in place. `apply_action` now takes `_snapshot: &mut PlayerSnapshot, errors: &mut Vec<ReplayError>` — rename `_snapshot` → `snapshot` when you split off the `SelectHotbar` arm.
- A `replay::player` helper module exists with **`record_hotbar_change(snapshot, delta, slot)`** — use it. The helper already implements the start-of-tick-`previous` rule from this issue's post-#0010 status (last write wins, but `previous` reflects the value at the start of the tick) so two `select_hotbar` entries on the same tick collapse correctly without bespoke logic.
- Suggested arm body:
  ```rust
  ActionType::SelectHotbar { slot } => {
      frame.actions.push(ActionEvent::SelectHotbar { slot: *slot });
      if !(1..=9).contains(slot) {
          errors.push(ReplayError {
              tick: frame.tick,
              message: format!(
                  "select_hotbar at tick {} has slot {} out of range (1..=9); skipped",
                  frame.tick, slot
              ),
          });
          return;
      }
      let delta = player::inventory_diff_mut(frame);
      player::record_hotbar_change(snapshot, delta, *slot);
  }
  ```
- Test (mirroring this issue's Outcome) should also assert that selecting an in-range slot updates the running snapshot — easy to verify by adding a follow-up `set_slot` or by inspecting `replay.frames[i].inventory_diff.selected_hotbar`.
- The empty-delta cleanup in `compute`'s post-pass means out-of-range entries (which return early without recording) won't leave a stale `inventory_diff` even if other actions on the same tick do nothing player-related.
