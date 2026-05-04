# 0016 — Replay source map

**Milestone:** M3
**Depends on:** #0011, #0012, #0013, #0014, #0015, #0037, #0038

## Goal
For each event in each `TickFrame`, record a JSON pointer back to its position in the original source. Enables the timeline-event ↔ editor cross-link in #0032.

## Outcome
- `Replay.source_map` populated as `[{ tick, event_index, json_pointer }]`.
- Pointers like `/timeline/3/checks/0` resolvable against the original JSON.

## Implementation notes
- Walk the timeline alongside its index path during engine emission. Pass the index path as a `Vec<String>` and convert to a JSON pointer (`/` joined, with RFC 6901 escaping).
- Frontend converts pointer → text range using a JSON CST library (or `jsonc-parser`); see #0032.

## Files
- `crates/flint-viz/src/replay/engine.rs`
- `crates/flint-viz/src/replay/source_map.rs` (new)

## Status (post-#0010)

- `SourceSpan { tick: u32, event_index: usize, json_pointer: String }` — note `event_index` is `usize`, not `u32`.
- `event_index` is the index of the corresponding entry in `TickFrame.actions` (or `TickFrame.assertions` for assertion sources). Decide a convention and document it: either separate `source_map` lists per stream, or a single list where `event_index` indexes the merged `(actions ++ assertions)` order. Recommended: single list, with `event_index` referring to position within the *combined ordered emission* for that tick, matching how the timeline scrubber will iterate them.
- The pointer must escape per RFC 6901: `~` → `~0`, `/` → `~1`. Numeric path components stay as decimal strings (e.g. `/timeline/3/checks/0`).

## Status (post-#0011)

- The current engine loop (`replay::compute` in `crates/flint-viz/src/replay/engine.rs`) iterates `for entry in &spec.timeline { for tick in entry.at.to_vec() { ... } }`. Change to `for (timeline_idx, entry) in spec.timeline.iter().enumerate()` and pass `timeline_idx` into `apply_action` so each emitted `ActionEvent` / `AssertionView` can be tagged with its source pointer.
- Frames are sparse (empty ones are filtered by `is_frame_empty`) and ordered by tick (collected from a `BTreeMap<u32, _>`). Use the **post-filter** order when you compute `event_index`, since that's what the frontend timeline iterates.
- `Replay.source_map` is already a `Vec<SourceSpan>` — just populate it in `compute` rather than leaving it `Vec::new()` at the bottom of the function.
- For the "single combined ordered list" convention: the natural order within a tick is the order `apply_action` inserts into `frame.actions` and `frame.assertions`. Decide on `actions` first, then `assertions`, since that matches how M5 / M6 render layers stack.

## Status (post-#0012)

- `place_each` is now wired and emits **one** `ActionEvent::PlaceEach { placements }` per timeline entry (regardless of how many `BlockPlacement`s it contains). For source-mapping that means one `SourceSpan` per `place_each` entry whose `json_pointer` points to the **timeline entry itself** (e.g. `/timeline/3`), NOT to individual `/timeline/3/blocks/N` placements. The placements are inspectable client-side from the `ActionEvent` payload — splitting the source map per-placement would scatter pointers across an event that the timeline scrubber treats as atomic.
- `Place`, `Fill`, `PlaceEach` already emit exactly one `ActionEvent` per timeline entry. Once `Remove` (#0013) and the player-action arms (#0037–#0039) land, the same one-event-per-entry invariant should hold — check this when implementing source-mapping; if any future arm emits multiple `ActionEvent`s per entry, the `event_index` convention needs an explicit decision.

## Status (post-#0013)

- `Remove` is now wired and confirms the one-`ActionEvent`-per-timeline-entry invariant: it emits exactly one `ActionEvent::Remove` (plus one `BlockChange::Remove`) per `ActionType::Remove` entry. So `Place`, `Fill`, `PlaceEach`, `Remove` all hold the invariant; only the four still-no-op variants (`Assert`, `UseItemOn`, `SetSlot`, `SelectHotbar`) remain to validate when their issues land.
- Watch out: `Assert` (#0015) is the one variant that pushes only into `frame.assertions`, not `frame.actions`. The "single combined ordered list with `actions` first then `assertions`" convention recorded in the post-#0011 status is still correct, but make sure `event_index` for an assertion span is computed against the merged `(actions ++ assertions)` length, not just one stream — easy to slip on this when implementing.
- One timeline entry can also expand into multiple `SourceSpan`s when its `at` is a `Vec<u32>` (one span per resulting tick). This was implicit before but `Remove` makes it concrete: an `at: [0, 2, 4]` remove emits three frames, each with its own span pointing back to the same `/timeline/N` entry.

## Status (post-#0014)

- `apply_action`'s signature is now `(frame, action, _snapshot, errors)`. When you change it again to thread `timeline_idx` (per the post-#0011 plan), the snapshot parameter stays — don't drop it.
- A new module exists at `crates/flint-viz/src/replay/player.rs` with helpers used by the player-action arms (#0037 / #0039). It is internal to `apply_action`; the source map walker has no business in there.
- `compute` now post-processes frames to drop empty `inventory_diff`s, after the timeline walk. Compute the `source_map` either *during* the walk (preferred — `event_index` aligns with the order entries were inserted) or *after* the post-pass (also fine — the post-pass only mutates `inventory_diff`, never the action/assertion ordering or counts). The post-#0011 advice "use the post-filter order" still applies.
- `apply_action`'s match still has the same set of populated arms as post-#0013: `Place`, `Fill`, `PlaceEach`, `Remove`. The four player/assertion variants remain in the no-op tail until their own issues land. The suggested arm bodies recorded in the post-#0014 status of #0037 / #0038 / #0039 each emit exactly one `ActionEvent`; #0015's `Assert` arm emits zero `ActionEvent`s but N `AssertionView`s. The merged-list convention (`actions` first, then `assertions`) covers all of these.

## Status (post-#0037 / #0038)

- `apply_action`'s parameter is now named `snapshot` (no leading underscore) — both arms now read it. Don't rename when threading `timeline_idx` through.
- Both `SetSlot` and `UseItemOn` arms hold the one-`ActionEvent`-per-timeline-entry invariant — confirms the convention recorded in post-#0012 holds for all four player-related variants pending. Only `SelectHotbar` (#0039) remains to validate; the suggested arm body in #0039's post-#0014 status also emits exactly one `ActionEvent`, so it will hold too.
- `SetSlot` additionally emits **one** `SlotChange` onto `inventory_diff.slots`. The source map convention does not currently track inventory-diff entries (they're not user-visible "events" — they reconstruct state, not timeline). Don't extend `SourceSpan` to cover them; if the inventory panel #0030 ever needs a "scroll editor to this slot's source" affordance, the `event_index` of the parent `SetSlot` ActionEvent already points at the right `/timeline/N` entry.
- `UseItemOn` emits no `BlockChange` and no `PlayerDelta` — only an `ActionEvent`. So its source span is the simplest possible case: one entry → one `ActionEvent` → one `SourceSpan` pointing at `/timeline/N`.

## Status (post-#0039)

- `SelectHotbar` is now wired and **confirms the one-`ActionEvent`-per-timeline-entry invariant** for every action variant the engine dispatches. The only variant still in the no-op tail is `Assert` (#0015), which intentionally emits *zero* `ActionEvent`s and N `AssertionView`s — that case is already covered by the merged-list convention recorded in post-#0011 and post-#0013.
- Out-of-range `SelectHotbar` (`slot < 1 || slot > 9`) still pushes its `ActionEvent` (so the timeline shows the attempted selection) but skips the `HotbarChange` and pushes a `ReplayError`. From source-mapping's perspective it's a normal one-event entry — point its `SourceSpan` at `/timeline/N` like any other; the `errors` channel is independent.
- `SelectHotbar` writes `inventory_diff.selected_hotbar` (a `HotbarChange`, not a list). Same convention as #0037's `SlotChange`: don't extend `SourceSpan` to cover it — the parent `ActionEvent` already maps the entry.
- Repeated `SelectHotbar` on the same tick: each entry emits its own `ActionEvent` (so two `SourceSpan`s, one per entry), but only one `HotbarChange` survives in `inventory_diff.selected_hotbar` (last write wins, with start-of-tick `previous`). The source map doesn't need to know about this collapse — it operates on `ActionEvent`s, not on the delta.

## Status (post-#0015)

- `Assert` is now wired. The `apply_action` no-op tail is **gone entirely** — every `ActionType` variant has its own arm. The dispatch now covers all M3 emissions; only the source-map walk itself remains.
- `Assert` emits **zero** `ActionEvent`s and **N** `AssertionView`s onto `frame.assertions` (one per check, with `BlockSpec::Multiple` expanded into one view per alternative). That means a single `/timeline/N` entry of type `assert` produces N `SourceSpan`s, all pointing at the *same* timeline entry pointer, but with `event_index` values that increment within the merged `(actions ++ assertions)` order for that tick. Don't try to point individual assertion spans at `/timeline/N/checks/M` — the assertion panel (#0031) treats the whole `assert` entry as the click target, and `BlockSpec::Multiple` would otherwise need a `/checks/M/N` sub-pointer convention.
- The new helper module `replay::assertions` (`crates/flint-viz/src/replay/assertions.rs`) owns the `AssertType → AssertionView` conversion. The source-map walker has no business in there — it only needs to know that the `Assert` arm of `apply_action` pushes `n = check_count_after_blockspec_expansion(checks)` views onto `frame.assertions` per timeline entry. If you need that count without re-running the conversion, sum `is.to_vec().len()` across `BlockType` checks and `1` per `Inventory` check (preferred: just count `frame.assertions.len()` before/after the call).
- The `apply_action` arm signature is unchanged from post-#0014 (`frame, action, snapshot, errors`); the `Assert` arm ignores `snapshot` and `errors`. When threading `timeline_idx` through, the assert arm just needs the index for the spans it pushes — it doesn't need any of the other parameters.
- `is_frame_empty` already considers `assertions`, so assert-only ticks now materialise as their own `TickFrame` (e.g. `basic_placement.json` now produces 4 frames instead of 2 — see `engine.rs` test `basic_placement_emits_place_actions_at_their_ticks`). The `source_map` walker will see those frames in the post-filter order, exactly as the post-#0011 advice prescribes.
