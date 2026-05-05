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

## Handoff from #0025 (cleanup overlay + scene-overlay toolbar)

`frontend/src/world/CleanupOverlay.tsx` is mounted as a child of `<SceneRoot>` alongside `<World />`. It will rotate with #0036 automatically — no special handling required from this issue.

- View toggles (`cleanupVisible` today, future highlight/ghost toggles) live in `frontend/src/world/overlayStore.ts` (`useOverlayStore`). When you add the rotation control, you have two options:
  - Add `rotation` to `replay.ts` (per the existing handoff below) since rotation must reset on test load alongside `tick` / `worldState`. Recommended — rotation is part of view-of-this-test state, not a global preference.
  - **Don't** colocate it with `cleanupVisible` in `overlayStore`; that store is intentionally global-preference scoped (no test-load reset).
- The "scene overlay" UI for #0025 is currently a button in the visualization header in `App.tsx` (alongside `ResetViewButton`). When `SceneToolbar.tsx` arrives in #0036 it should subsume both toggles — at that point, lift `CleanupToggleButton` and `ResetViewButton` from `App.tsx` into `SceneToolbar.tsx` and render the toolbar in the header. This keeps the overlay UI discoverable in one place rather than scattered across header chrome.
- Disposal: `CleanupOverlay` builds an `EdgesGeometry` keyed on the cleanup-region dimensions and disposes it on unmount / re-key. If you copy the pattern for highlights or assertion ghosts, follow the same useMemo + cleanup-effect shape.

## Handoff from #0024 (camera framing)

The camera at `frontend/src/world/Camera.tsx` auto-frames against the cleanup region (or block bounds) **once per test load** and exposes a `resetView()` action via `useCameraStore` (`frontend/src/world/cameraStore.ts`). It does **not** automatically re-frame on every store change — auto-framing yanks the user out of any view they've manually set, which would happen on every rotation toggle.

- The framing helper `computeFraming(cleanup, worldState)` in `frontend/src/world/cameraFraming.ts` is rotation-agnostic — it ignores rotation entirely and computes target/position from raw AABB coords. Since the rotation pivot in #0036 *is* the same AABB centre, the unrotated framing target lands exactly on the rotated scene's centre on screen. **No camera change is needed for the scene to stay centred** as long as your rotation transform is the standard "translate to origin → rotate → translate back" pivoted at `(min[i] + max[i] + 1) / 2`. The earlier note saying "subscribe to rotation change in your camera controller and recompute the framing target" is now obsolete — keep the camera out of the rotation loop entirely.
- If you do want a Reset View click to nudge the user back to the canonical angle after a rotation, call `useCameraStore.getState().resetView()` from the same toolbar that hosts the rotation buttons (or just rely on the existing top-right Reset View button in the visualization header — already wired).
- Don't add a second OrbitControls instance. `Camera.tsx` already mounts one with `makeDefault`; downstream `useThree(s => s.controls)` returns it.
- The store-reset semantics for `rotation` (extending `openTest` / `setReplay`) are unchanged from #0023's note.

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
