# 0026 — Per-tick action highlights

**Milestone:** M5
**Depends on:** #0023

## Goal
Briefly highlight the blocks that were placed/removed/filled at the current tick, so the user can see *what just happened*. Highlights are children of the scene root so they rotate with the scene (#0036).

## Outcome
- On tick change, blocks affected by the new tick's `block_diff` get a 600 ms pulse: green for set, red for remove, cyan outline for fill regions.
- Highlights vanish after the pulse; the underlying block remains.

## Implementation notes
- A `<Highlights />` R3F component that subscribes to `(tick, frames)`.
- On tick change, mount one `<HighlightCube pos color />` per affected block; each unmounts itself after 600 ms (`useEffect` + timeout).
- Pulse animation: `useFrame` lerps emissive intensity over the lifetime, or use a simple opacity tween.
- During play (#0029), shorten or skip pulses to avoid lag.
- All highlight meshes mount inside `<SceneRoot>` so #0036's rotation applies for free.

## Files
- `frontend/src/world/Highlights.tsx` (new)
- `frontend/src/world/Scene.tsx` (composition)

## Handoff from #0023 (Scene composition root)

`frontend/src/world/Scene.tsx` mounts a private `<SceneRoot>` group wrapping `<World />`. Add `<Highlights />` as a sibling child of `<SceneRoot>` so the rotation in #0036 applies for free.

What to subscribe to:

- `useReplayStore(s => s.tick)` and `useReplayStore(s => s.replay?.frames)` — find the frame whose `tick === current tick` (frames are sparse, so `frames.find(f => f.tick === tick)` is fine; for hot path use a precomputed `Map<tick, TickFrame>`).
- The `frame.block_diff` array contains the per-tick changes you want to pulse: `BlockChange` is a tagged union `{ kind: "set", pos, block }` or `{ kind: "remove", pos }`. The `pos` is integer MC coords — render a 1×1×1 highlight cube at `(x, y, z)..(x+1, y+1, z+1)`, same coord system World.tsx uses for its instanced blocks.
- For "cyan outline for fill regions" — `frame.actions` holds `ActionEvent`s with the original semantic shape; `kind: "fill"` carries the `region: Aabb`. Match the AABB's outline rather than highlighting each generated `BlockChange::Set` if you want a single outline pulse per fill.
- Pulse lifetime via `useEffect` + `setTimeout` is fine. Keep highlight meshes simple (`<boxGeometry>` + `<meshBasicMaterial transparent opacity={...} />`); they don't need the deepslate adapter.
- During play (#0029), `useReplayStore(s => s.playback)` lets you skip pulses when `playback === "playing"` to avoid lag.
- Empty-state: when `replay === null` or no frame matches the current tick, render nothing.
