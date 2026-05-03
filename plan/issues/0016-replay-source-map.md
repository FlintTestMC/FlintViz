# 0016 — Replay source map

**Milestone:** M3
**Depends on:** #0011, #0012, #0013, #0014, #0015

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
