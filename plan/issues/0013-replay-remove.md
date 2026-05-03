# 0013 — Replay engine: `remove`

**Milestone:** M3
**Depends on:** #0011

## Goal
Handle the `remove` action — single position or AABB region removal.

## Outcome
- Emits `BlockChange::Remove` for each cleared position.
- Removing a position that has no recorded block in the static replay still emits a `Remove` (frontend treats it as "definitely empty after this tick").

## Implementation notes
- Reuse the AABB helper from #0011.

## Files
- `crates/flint-viz/src/replay/engine.rs`

## Status (post-#0010)

- `flint_core::test_spec::ActionType::Remove` (v1.1.3) is `{ pos: [i32;3] }` only — there is no AABB region form. The "single position or AABB" wording in this issue's Goal is therefore inaccurate; emit one `ActionEvent::Remove { pos }` + one `BlockChange::Remove { pos }` per entry. If a region-removal action is added to flint-core later, extend then.

## Status (post-#0011)

- Dispatch in `crates/flint-viz/src/replay/engine.rs` `apply_action`. `ActionType::Remove { .. }` is currently in the no-op tail of the `match`; split it into its own arm:
  ```rust
  ActionType::Remove { pos } => {
      frame.actions.push(ActionEvent::Remove { pos: *pos });
      frame.block_diff.push(BlockChange::Remove { pos: *pos });
  }
  ```
- `aabb::iter_aabb` and `Aabb::volume` already exist in `replay/aabb.rs` from #0011 — leave them untouched here, they'll be used by region-removal if/when flint-core adds it.
- No need to consult any prior block state when removing — the frontend treats `BlockChange::Remove` as authoritative ("definitely empty after this tick"), per this issue's Outcome.

## Status (post-#0012)

- The no-op tail of `apply_action`'s `match` has shrunk — it is now `ActionType::Remove | Assert | UseItemOn | SetSlot | SelectHotbar`. Split `Remove` out as described above; the remaining variants stay in the no-op tail until #0014/#0015/#0037–#0039.
- Test convention is set: each new arm gets a unit test parsing inline JSON via `serde_json::from_str` against `TestSpec` and asserting on `frame.actions` + `frame.block_diff` (see `place_each_emits_event_and_one_set_per_placement` in `engine.rs` for the shape).
