# 0032 — Source ↔ visual cross-linking

**Milestone:** M7
**Depends on:** #0016, #0020, #0023, #0028, #0036

## Goal
Bidirectional cross-link so users can navigate between the JSON and the 3D/timeline views.

## Outcome
- **Timeline → editor**: clicking a tick marker scrolls the editor to the matching JSON range and selects it.
- **3D → editor**: clicking a placed block highlights the JSON object in the editor that placed (or last touched) it.
- **Editor → timeline**: when the cursor is inside a `timeline` entry, the timeline highlights that entry's tick.

## Implementation notes
- Convert `json_pointer` (from #0016) into a Monaco `Range` using `jsonc-parser` to walk the source CST.
- Maintain a reverse index `pos → last source pointer` while applying diffs in the store.
- 3D picking: R3F handles raycasting natively. Add `onClick` to the `<instancedMesh>` and use `event.instanceId` to recover which block was clicked. Because picking is on world-space rays through the rotated `<group>` (#0036), Three.js inversely transforms automatically — no manual math needed.
- Cursor → timeline: re-parse the source on cursor move (cheap), find the enclosing `timeline[N]`, dispatch.

## Files
- `frontend/src/editor/jsonPointerToRange.ts`
- `frontend/src/store/replay.ts` (extend with reverse index)
- `frontend/src/timeline/Scrubber.tsx` (handle click)
- `frontend/src/world/World.tsx` (instance click handler)
