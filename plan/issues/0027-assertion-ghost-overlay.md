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

## Status (post-#0015)

The replay engine now populates `TickFrame.assertions`. Concrete shape this issue cares about (from `flint-viz`'s wire model):

- `AssertionView::Block { position: [i32; 3], expected: Block }` — render one ghost per entry at `position`. The `expected.id` plus `expected.properties` is the same shape used by the world renderer, so the existing `BlockAdapter` from #0022 should handle it without a special path.
- `AssertionView::Inventory { slot, expected }` — **skip in the 3D overlay**. Per the Outcome, inventory assertions show only in the panel (#0031). Don't try to render anything for these.
- `AssertionView::Other { description }` — never emitted by the engine today (flint-core v1.1.3 has no state-style checks). Safe to ignore here, or render as a no-op for forward-compat.

Behaviors specific to the engine output that `<AssertionGhosts />` must accommodate:

- A single `assert` entry whose check is `BlockSpec::Multiple` expands to **multiple `AssertionView::Block` entries at the same `position`**. If you naively map one ghost per view you'll stack N translucent blocks at the same coordinate (visually messy and depth-fighty). Recommended: group `frame.assertions` by `position`, and either render the *first* alternative as a ghost with a "+N more" label (cheap), or cycle alternatives via a slow pulse if the panel UI ends up showing a list. Decide based on UX, but pick *one* — don't stack overlapping ghosts.
- Assert-only ticks now exist as their own `TickFrame`s (e.g. `basic_placement.json` has assert-only ticks at `at: 1` and `at: 3`). The store/scene must therefore tolerate frames where `actions.length === 0`, `block_diff.length === 0`, but `assertions.length > 0`. Existing #0023 world rendering already operates on the forward-applied `WorldState`, which doesn't change on assert-only ticks — the only thing that changes is which ghosts to show.
- `AssertionView` is serde-tagged with `kind` in `snake_case` (`"block"`, `"inventory"`, `"other"`). Match on `kind` in the TS discriminated union — don't try to switch on `"position" in view` etc.
