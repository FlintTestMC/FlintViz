# 0023 — Render `WorldState` declaratively in R3F

**Milestone:** M5
**Depends on:** #0018, #0022

## Goal
Render every block in `store.worldState` as part of the R3F scene, declaratively. Re-renders happen automatically when the store updates the tick.

## Outcome
- `<World />` component subscribes to `store.worldState` and emits one mesh per block (instanced under the hood).
- Scrubbing the timeline visibly places/removes blocks at the correct positions with correct properties.
- Smooth at 1000+ blocks; no full atlas rebuild between ticks.

## Implementation notes
- Group blocks by `(id, propsKey)` and render each group as a single `<instancedMesh>` with shared geometry/material from the adapter (#0022).
- On `worldState` change, recompute the grouping (cheap: O(N) over a few hundred to few thousand blocks).
- Keep the entire world inside a single root `<group ref={worldGroup}>` — this group is what #0036 rotates.
- All world coordinates are passed straight to Three.js; the cleanup region center becomes the rotation pivot, set on the group.

## Files
- `frontend/src/world/World.tsx` (new) — declarative renderer
- `frontend/src/world/instancing.ts` (new) — group-by-state helper
- `frontend/src/world/Scene.tsx` — composition root: `<Canvas><SceneRoot><World /><Overlays /></SceneRoot></Canvas>`
