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
