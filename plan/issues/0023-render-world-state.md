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

## Handoff from #0018 (replay store)

Store at `frontend/src/store/replay.ts`. Key shapes for the world renderer:

- `worldState: Map<PosKey, Block>` where `PosKey = "x,y,z"` (string). Use `posKey([x,y,z])` from `frontend/src/store/world.ts` if you need to write entries; for reading, parse keys back with `key.split(',').map(Number)` — the format is stable.
- `Block` is `{ id: string, [prop: string]: unknown }` — the block id is in `block.id`, properties (e.g. `facing`, `waterlogged`) are flattened onto the same object. The grouping key for instancing is `(block.id, JSON.stringify(otherProps))` or similar — write this in `instancing.ts`.
- Subscribe with `useReplayStore(s => s.worldState)` — Zustand returns the same `Map` reference until `setTick` builds a new one, which it does on every transition (forward step clones the Map, backward rebuild creates a new Map). So referential equality of `worldState` is a valid render trigger.
- The Map is **mutated then re-set** by the store, never mutated in place after being committed — safe to read in render without a snapshot copy.
- `cleanup_region: Aabb | null` lives on `replay.cleanup_region` (selector: `useReplayStore(s => s.replay?.cleanup_region ?? null)`). The center of this AABB is the camera/rotation pivot per the issue's rotation-group plan. Coords are integers (Minecraft block coordinates).
- World resets to empty when `setReplay(replay, [])` is called — your `<World />` should handle `worldState.size === 0` gracefully (return empty group).
