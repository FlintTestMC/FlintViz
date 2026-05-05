# 0024 — Orbit camera (drei)

**Milestone:** M5
**Depends on:** #0022

## Goal
Mouse-driven orbit/pan/zoom camera centered on the cleanup region (or the bounding box of placed blocks if no cleanup region exists). This is the camera viewpoint — it is **independent** from the scene-rotation feature in #0036.

## Outcome
- Drag = orbit, right-drag = pan, wheel = zoom.
- Auto-frame: when a test is loaded, camera zooms to fit the cleanup region.
- "Reset view" button.

## Implementation notes
- `<OrbitControls>` from `@react-three/drei`.
- Auto-frame: compute target + distance from the cleanup AABB (or block bounds), then call `controls.target.set(...)` and animate the camera position.
- Default camera lives inside `<Canvas>`'s default; switch to a `<PerspectiveCamera makeDefault>` if we need to tween it programmatically.

## Files
- `frontend/src/world/Camera.tsx` (new)
- `frontend/src/world/Scene.tsx` (composition)

## Handoff from #0023 (composition root + canvas shell)

The composition root is now `frontend/src/world/Scene.tsx` — `CanvasShell.tsx` was deleted in #0023. `Scene.tsx` mounts `<Canvas>` with:
- A perspective camera at `[6, 6, 6]`, fov 50 (same defaults as the deleted `CanvasShell`).
- `<color attach="background" args={["#0a0a0a"]} />`.
- Two directional lights + ambient.
- `<OrbitControls makeDefault />`.
- A private `<SceneRoot>` group wrapping `<World />` (the rotation target for #0036).

The `makeDefault` flag means downstream `useThree(s => s.controls)` returns this instance. To auto-frame:

- Cleanup-region selector: `useReplayStore(s => s.replay?.cleanup_region ?? null)`. AABB is `{ min: [x,y,z], max: [x,y,z] }` in MC integer block coords (inclusive both ends, so the visual center is `(min[i] + max[i] + 1) / 2`).
- For "fit to AABB", compute the diagonal length and place the camera at `center + dir * diag` where `dir` is your preferred angle (e.g. `(1,1,1).normalize()`). Animate via `react-spring` or `lerp` in `useFrame`; both work, neither is installed yet.
- Replace the current static camera with `<PerspectiveCamera makeDefault>` if you need to move it programmatically — the current default camera in `<Canvas camera={...}>` can also be mutated via `useThree(s => s.camera)`, no need to swap if simple animation is enough.
- New `Camera.tsx` should mount inside `<Canvas>` (i.e. as a child of `Scene.tsx`'s Canvas), not at the top level — `useThree` only works inside the R3F render tree.

`OrbitControls` is already in `@react-three/drei`. Don't add a second instance — replace the existing `<OrbitControls makeDefault />` in `Scene.tsx` (or keep it and hold a ref to override props).
