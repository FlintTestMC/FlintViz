# 0025 — Cleanup region wire-frame overlay

**Milestone:** M5
**Depends on:** #0023

## Goal
Show the cleanup region as a translucent wire-frame box. Sits as a child of the world group so it rotates along with the scene (#0036).

## Outcome
- Box visible whenever `replay.cleanup_region` is set.
- Toggleable via a small UI button in the scene overlay.
- Subtle styling — does not visually compete with rendered blocks.

## Implementation notes
- R3F: `<lineSegments>` with `<edgesGeometry args={[boxGeometry]} />` and `<lineBasicMaterial color="#5cf" transparent opacity={0.6} />`.
- Mount inside the same `<SceneRoot>` group as `<World />` so the rotation in #0036 applies uniformly.

## Files
- `frontend/src/world/CleanupOverlay.tsx` (new)
- `frontend/src/world/Scene.tsx` (composition)

## Handoff from #0023 (Scene composition root)

`frontend/src/world/Scene.tsx` exists and contains a private `<SceneRoot>` component that wraps every world-space child. To add this overlay:

- Edit `Scene.tsx` and add `<CleanupOverlay />` as a child of `<SceneRoot>` alongside `<World />`. Order doesn't matter visually for an unfilled wireframe, but lights and `<OrbitControls>` stay outside `<SceneRoot>` (they must not rotate with #0036).
- Cleanup-region selector: `useReplayStore(s => s.replay?.cleanup_region ?? null)`. The AABB uses inclusive integer block coords; the visible box must span from `min` to `max + 1` because each block occupies a unit cube whose corners are at its integer position and `position + 1`.
- Center for the wireframe: `(min[i] + max[i] + 1) / 2`. Same formula #0024 uses for camera framing and #0036 uses for rotation pivot.
- Render `null` when `cleanup_region == null` — many tests omit it during early authoring, and the world should still render.
- Coordinate system reminder: world-space is 1-unit-per-block, untranslated. World blocks render at `(x, y, z)..(x+1, y+1, z+1)` for MC coord `[x, y, z]`. Your wireframe extents follow the same convention.
