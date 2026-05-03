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
