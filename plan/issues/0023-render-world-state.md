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

## Handoff from #0022 (deepslate adapter)

The block-rendering pipeline is wired and verified for six representative blocks. Files:

- `frontend/src/world/atlas.ts` exposes `loadBlockProviders(): Promise<BlockProviders>`. **Cached singleton** — call freely from any component (e.g. via a `useEffect` + `useState` like `BlockGallery.tsx`, or wrap in a small Suspense-cache hook). Returns `{ blockModels, blockDefinitions, atlas, atlasTexture, atlasSize }`. Throws "Failed to load /mc-assets.zip … Run `npm run assets` to generate it." on a missing zip — surface that string in the world pane (this is one of the cases #0033 calls out).
- `frontend/src/world/blockAdapter.ts` exposes `buildBlockMesh(blockId, props, providers): BlockMesh | null`. Returns `{ geometry, material, transform }` with geometry in 1-unit-per-block scene-space. Material is **the same instance for every block** (one `MeshStandardMaterial` with the atlas texture and `vertexColors: true`) — preserve that when instancing. `transform` is currently identity; ignore it or repurpose for your per-instance offset.

Critical for instancing:

- **Group key.** `Block` from the store is `{ id: string, [prop: string]: unknown }`. Build the props subset by stripping `id`, JSON-stringifying the rest with sorted keys: `{id} + JSON.stringify(Object.fromEntries(Object.entries(block).filter(([k]) => k !== 'id').sort(...)))`. That string is your `<instancedMesh>` group key. Don't include the position — instancing handles that.
- **Geometry per group.** Call `buildBlockMesh(id, propsAsStringMap, providers)` once per group. Cache by group key — `useMemo` is fine for small worlds; for larger ones drive a `Map<string, BufferGeometry>` keyed on the group key with manual eviction when groups disappear.
- **Props are strings to deepslate.** `BlockDefinition.getMesh` takes `Record<string, string>`. The Rust replay engine emits property values as JSON-strings already (`"powered": "false"` etc.), but the wire `Block` type in TypeScript has them as `unknown` to keep the schema permissive. Coerce with `String(v)` per property before calling the adapter.
- **Cull mask.** The adapter currently passes `Cull.none()` so every face renders. For dense worlds (>~500 blocks) you'll want to compute a 6-face cull mask per instance based on the 6 adjacent positions in `worldState`. Easiest: build geometry per `(id, propsKey, cullKey)` where `cullKey` packs the 6 booleans. That blows up cache size in pathological cases but is fine for typical Flint tests (small cleanup region, sparse layouts). Defer until you actually have a perf problem — `Cull.none()` is correct, just wasteful.
- **Tinting (grass/leaves/redstone-wire power).** Not wired. Will render gray. Layer in `BlockColors` (deepslate) later if it matters.
- **`null` from `buildBlockMesh`** means either an unknown block id or an empty mesh (e.g. `air`). Treat as "skip this block" rather than fall back — air shouldn't be in `worldState` at all.

Coordinate system reminder: geometry is in 1-unit-per-block units, untranslated — the block sits with corners at `(0,0,0)..(1,1,1)`. To place at MC coord `[x, y, z]`, use `instance.position.set(x, y, z)` (or `setMatrixAt(i, new Matrix4().setPosition(x, y, z))` on `<instancedMesh>`). The cleanup region center (for camera/rotation pivot) is `(min + max + 1) / 2` in world coords because both endpoints are inclusive integer block coords.

`CanvasShell.tsx` is now empty of geometry — no smoke-test cube, just lights and `OrbitControls`. This issue's `<Scene>` composition root replaces or wraps it. Don't recreate the lights elsewhere.
