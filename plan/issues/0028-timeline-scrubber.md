# 0028 — Timeline scrubber

**Milestone:** M6
**Depends on:** #0018

## Goal
Horizontal scrubber along the bottom of the right pane. Lets the user drag through ticks and shows where events happen.

## Outcome
- Track from tick 0 to `replay.max_tick`.
- Tick markers for every event-bearing tick (slightly bolder for assertions).
- Breakpoints rendered as red flags.
- Drag the playhead → store updates `tick` live.
- Hover a marker → tooltip with action summary ("place stone @ (0,100,0)").

## Implementation notes
- SVG renders fine and is easy to test; canvas overkill at this scale.
- Computed marker positions memoized off `replay`.

## Files
- `frontend/src/timeline/Scrubber.tsx`
- `frontend/src/timeline/markers.ts`

## Status (post-#0015)

Assert ticks now materialise as their own `TickFrame`s with empty `actions` / `block_diff` and populated `assertions`. So the "tick markers for every event-bearing tick" rule needs to read from **both** `frame.actions` and `frame.assertions`:

- "Bolder for assertions" maps cleanly: a frame is an *assertion* tick iff `frame.assertions.length > 0 && frame.actions.length === 0`. A frame with both populated (e.g. a `place` and an `assert` on the same tick) should pick the action style — bolder reads as a distinguisher, and the action is the "primary" event.
- Don't iterate `replay.frames` and look only at `actions.length` to decide whether to draw a marker; you'd miss every assert-only tick. `frames.length` is now strictly ≥ "ticks with at least one action *or* assertion".
- Tooltip summaries for assert-only ticks should pull from `frame.assertions` (e.g. "expect stone @ (0,100,0)" — same line as #0031 generates). One tick with multiple assertions can summarise as "N assertions" with the panel as the canonical detail view.
- A single `assert` entry whose check is `BlockSpec::Multiple` produces N `AssertionView::Block`s at the same position. Group by position when summarising in the tooltip ("expect stone OR dirt @ (0,0,0)"), same convention as #0031, so the scrubber doesn't visually undercount or overcount the user's intent.

## Status (post-#0016)

`replay.source_map` is now populated. The scrubber's click-to-source path (used by #0032 to scroll the editor when a marker is clicked) should resolve `(tick, event_index)` against the source map, not try to recompute pointers from `frame.actions[i]` shapes:

- For a "tick was clicked" interaction (no specific event chosen), the natural target is the **first** event on that tick, i.e. `event_index = 0` — this gives `/timeline/N` of the first emitted entry on that tick. `frame.actions[0]` exists when actions is non-empty; otherwise the assertion at index 0 is the first event.
- For tooltips that list multiple events on the same tick, the merged-list iteration order is `frame.actions ++ frame.assertions` — this is exactly the order `event_index` indexes into. So `event_index = i` for the i-th entry in that concatenation maps directly to `replay.source_map[?].json_pointer` for the matching `(tick, event_index)`.
- Build the lookup once per replay (e.g. `Map<tick, Map<event_index, string>>` keyed off `replay.source_map`), not per-frame on render. Spans are emitted in spec-order, not sorted.
- `at: [t1, t2, t3]` repeats a single source pointer across three frames. The scrubber should still render three distinct markers (one per tick); they'll all `click → /timeline/N` to the same JSON entry, which is the intended "this is the source of *all three* placements" UX.
- A rejected `fill` (oversize) or out-of-range `select_hotbar` has both an `ActionEvent` and a `SourceSpan`. So the scrubber's tick marker for those still works as a clickable source link, even though the action's world/inventory side-effect was skipped.
