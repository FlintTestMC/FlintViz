# 0036 — Rotate the entire scene

**Milestone:** M5
**Depends on:** #0023, #0025, #0026, #0027

## Goal
Let the user rotate the entire 3D scene by 90°/180°/270° around the Y axis as a single rigid-body transform. This is *not* per-block property rewriting — block models render exactly as they are; the whole scene (blocks + cleanup wireframe + action highlights + assertion ghosts) rotates together as one unit.

## Outcome
- A rotation control in the scene overlay: `0° / 90° / 180° / 270°`.
- Toggling rotation rotates the rendered world; the cleanup overlay, action highlights, and assertion ghosts all rotate with it because they live under the same scene-root group.
- Click-to-source picking (#0032) keeps working correctly without manual math (R3F raycasting respects the parent group's transform).
- Camera does not rotate (the rotation is a world transform, not a camera transform).

## Implementation notes
- Single change: wrap the existing `<SceneRoot>` group in a transform.
  ```tsx
  <group
    rotation={[0, (rotation * Math.PI) / 2, 0]}
    position={pivotOffset}
  >
    <World />
    <CleanupOverlay />
    <Highlights />
    <AssertionGhosts />
  </group>
  ```
- `pivotOffset` ensures the rotation pivots around the cleanup-region center (or block-bounds center). Standard trick: translate to origin, rotate, translate back, expressed as a single `position` + `rotation` on the group.
- Store: `rotation: 0 | 1 | 2 | 3`, default `0`, reset on test load.
- Camera framing (#0024) recomputes target on rotation change so the scene stays centered on screen.
- No property tables, no facing rewrites, no source mutation. The block models' built-in facing properties remain whatever they are; rotating the scene is purely visual, the same way picking up a structure block in MC and turning it would look.
- Stretch (separate follow-up, not in this issue): "Bake rotation to source" button that writes a rotated test back to JSON — that one *would* need property rewrites, but it's intentionally out of scope here.

## Files
- `frontend/src/world/Scene.tsx` — wrap `<SceneRoot>` in the rotated group
- `frontend/src/world/SceneToolbar.tsx` (new) — rotation buttons
- `frontend/src/store/replay.ts` — add `rotation`, reset on test load

## Handoff from #0023 (Scene composition root)

`frontend/src/world/Scene.tsx` already exists and contains a private `<SceneRoot>` wrapper around `<World />` (and, post-#0025/#0026/#0027, the cleanup overlay, highlights, and assertion ghosts). The current implementation is a thin no-op group:

```tsx
function SceneRoot({ children }: { children: ReactNode }) {
  return <group>{children}</group>;
}
```

To wire rotation, modify `SceneRoot` (or replace the call site in `Scene.tsx`) to:

- Read `useReplayStore(s => s.rotation)` and the cleanup region for the pivot.
- Compute pivot center via `(min[i] + max[i] + 1) / 2` (same formula #0024 uses for camera framing and #0025 uses for the wireframe center). When `cleanup_region` is `null`, fall back to either the centroid of `worldState` positions or the origin — pick one and document it.
- Apply the standard "translate → rotate → translate back" trick as a single `position` + `rotation` on the group. With pivot `c = [cx, cy, cz]` and rotation angle `θ` around Y, place the rotated children at:
  ```
  position = [cx - cosθ*cx - sinθ*cz,  0,  cz + sinθ*cx - cosθ*cz]
  rotation = [0, θ, 0]
  ```
  …or simpler: nest two groups, outer translates by `+c`, inner rotates, innermost translates by `-c`. R3F is happy with three nested groups.
- Picking (#0032) keeps working without manual math — three.js raycaster handles the inverse transform on the parent group.
- Camera (#0024): subscribe to `rotation` change in your camera controller and recompute the framing target to keep the scene centered.

Store change: extend `frontend/src/store/replay.ts` with `rotation: 0 | 1 | 2 | 3`, default `0`, and reset to `0` inside `openTest` and `setReplay` (the existing reset paths). The existing tests in `__tests__/replay.test.ts` cover the reset semantics — add a `rotation` assertion to those if you want the property tracked.
