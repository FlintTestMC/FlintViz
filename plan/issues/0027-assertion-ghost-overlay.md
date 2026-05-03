# 0027 — Assertion ghost overlay

**Milestone:** M5
**Depends on:** #0023

## Goal
Render asserted blocks at the current tick as semi-transparent ghosts at their positions, with a small label "asserted". Ghosts live inside the scene-root group so they rotate with the scene (#0036).

## Outcome
- For each `AssertionView` of kind `Block` at the current tick, a translucent (≈0.4 opacity) version of the expected block appears at the position.
- If a real block already exists there, the ghost is rendered with an outline (`<Outlines />` from drei) so both are visible.
- Inventory assertions don't appear in 3D — they show in the assertion panel (#0031).

## Implementation notes
- `<AssertionGhosts />` reads `store.currentFrame.assertions` and emits one mesh per block assertion, using the same `BlockAdapter` from #0022 but cloned with a translucent material variant (`transparent: true`, `depthWrite: false`, `opacity: 0.4`).
- Labels via drei `<Html>` for HTML-in-3D; cheap and aligns with overlays.
- We don't compute pass/fail here. The overlay is purely descriptive: "the test will check this".

## Files
- `frontend/src/world/AssertionGhosts.tsx` (new)
- `frontend/src/world/Scene.tsx` (composition)
