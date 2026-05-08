# 0045 — Compass gizmo (axis orientation indicator)

**Milestone:** M9
**Depends on:** #0024, #0036

## Goal
Show a Blender-style 3D axis gizmo in the top-right corner of the visualization pane (below `SceneToolbar`) so the user always knows which Minecraft direction faces where on screen.

## Outcome
- Three colored arms radiating from a shared origin: red = X / East ("E"), green = Y / Up ("U"), blue = Z / South ("S").
- Small spheres at the positive tips with single-letter labels.
- Negative axes not shown.
- The gizmo combines both the camera orbit and the scene rotation (#0036) so it always truthfully reflects the world orientation.
- Smooth per-frame sync — the gizmo tracks the camera every frame, no snapping.
- Display only — no click-to-snap-view, no drag interaction.
- ~80–100 px footprint.

## Implementation notes

### Rendering approach
Use a **separate `<Canvas>`** overlaying the main 3D canvas, with its own **orthographic camera**. This decouples the gizmo from the main scene's zoom/pan/perspective and matches how Blender implements its orientation widget.

```tsx
<Canvas
  orthographic
  camera={{ zoom: 40, position: [0, 0, 5], near: 0.1, far: 100 }}
  className="pointer-events-none absolute top-0 right-0"
  style={{ width: 100, height: 100 }}
/>
```

`pointer-events-none` because the gizmo is non-interactive.

### Rotation sync
Inside the overlay canvas, use `useFrame` to read the main camera's quaternion and the scene rotation each frame, then apply the combined rotation to the gizmo group.

Access the main camera from outside R3F: store a ref to the main `THREE.Camera` in a shared location (e.g. a module-level `ref` or a small Zustand atom) so the overlay canvas's `useFrame` can read `mainCamera.quaternion` without being inside the same R3F tree.

The combined rotation is:
```
gizmoQuaternion = inverse(mainCamera.quaternion) * sceneRotationQuaternion
```

Wait — the gizmo should mirror what the user sees, which is already the product of camera × scene rotation. Since the overlay camera is fixed (looking down +Z), copy the main camera's **view rotation** and multiply in the scene rotation:

```ts
useFrame(() => {
  // Scene rotation around Y
  const theta = (rotation * Math.PI) / 2;
  sceneQ.setFromAxisAngle(Y_AXIS, theta);

  // The main camera's quaternion already encodes orbit.
  // We want the gizmo arms to rotate the same way the world
  // appears on screen: camera rotation × scene rotation.
  gizmoGroup.quaternion.copy(mainCamera.quaternion).invert();
  gizmoGroup.quaternion.multiply(sceneQ);
});
```

Test by orbiting + toggling scene rotation — the gizmo arms should always point the same directions as the world axes on screen.

### Gizmo geometry
Build in code, no imported models:

- **Arms**: `CylinderGeometry(0.03, 0.03, 1)` rotated to align with each axis. Colors: `0xff3333` (red/X), `0x33ff33` (green/Y), `0x3333ff` (blue/Z).
- **Tip spheres**: `SphereGeometry(0.1, 16, 16)` positioned at the end of each arm.
- **Labels**: drei `<Text>` or `<Html>` with single characters "E", "U", "S" billboarded to always face the overlay camera. Place slightly past the sphere tip so they don't overlap.
- All geometry is static — create once, only the parent group's quaternion changes per frame.

### Positioning
The overlay `<Canvas>` is `position: absolute` in the visualization pane's container, anchored `top-right`. The `SceneToolbar` sits in a `<header>` above the canvas area, so the gizmo naturally appears below it without z-index conflicts. If the toolbar overlaps, add `top: <toolbar-height>px` to the overlay style.

### Where to mount
The overlay canvas is a sibling of the existing `<Canvas>` in the visualization column. In `App.tsx`, the visualization pane currently has:
```
<header> ... <SceneToolbar /> ... </header>
<Scene />   ← this is the main <Canvas>
```

Add the compass overlay as a positioned element inside the same `relative` container that wraps the main canvas:
```tsx
<div className="relative flex-1">
  <Scene />
  <CompassGizmo />  {/* absolute top-right overlay */}
</div>
```

## Files
- `frontend/src/world/CompassGizmo.tsx` (new) — overlay canvas + gizmo geometry + per-frame sync
- `frontend/src/App.tsx` — mount `<CompassGizmo />` alongside `<Scene />`

## Handoff from #0024 (camera)

`Camera.tsx` owns `OrbitControls` with `makeDefault`. The main camera is accessible via `useThree(s => s.camera)` inside the main R3F tree but **not** from the overlay canvas (separate R3F tree). To share the camera quaternion:

- Option A: store a `THREE.Camera` ref in a module-level variable (`let mainCameraRef: THREE.Camera | null = null`) exported from `Camera.tsx`. Set it in a `useEffect`. The overlay reads it in `useFrame`. Simple, no store overhead.
- Option B: publish `camera.quaternion` components to a Zustand slice each frame. More reactive but unnecessarily expensive for a per-frame consumer.

Recommended: Option A. The overlay only reads in `useFrame` (no React re-renders), so a plain ref is the right primitive.

## Handoff from #0036 (scene rotation)

Scene rotation is `useReplayStore(s => s.rotation)` — a `0 | 1 | 2 | 3` quarter-turn count. The compass overlay can subscribe to this store directly (Zustand works outside R3F). Convert to radians: `theta = rotation * Math.PI / 2`. The rotation is around the Y axis.

The compass does **not** need to know about the scene pivot offset — it only cares about the rotational component, which is axis-angle `(0, 1, 0, theta)`.
