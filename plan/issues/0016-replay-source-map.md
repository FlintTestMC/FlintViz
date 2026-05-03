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
