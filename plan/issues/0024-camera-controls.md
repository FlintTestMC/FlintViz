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
