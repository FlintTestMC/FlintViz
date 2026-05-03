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
