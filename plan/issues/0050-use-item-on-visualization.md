# 0050 — Visualize `use_item_on` actions

**Milestone:** M5
**Depends on:** #0038, #0030

## Goal
Make `use_item_on` understandable in the 3D view. The replay engine already emits this as an event-only action: no block is placed, no inventory is consumed, and world state does not change. The visualization should therefore show *where* and *with what item* the player interacted without implying that Flint simulated Minecraft placement logic.

## Outcome
- When the current tick contains a `use_item_on` event, show a persistent 3D overlay while that tick/event is selected.
- Render a face marker at `event.pos` on `event.face`, centered on the clicked face and offset slightly outside the block.
- Render a small screen-facing item badge near the face marker.
- Use `event.resolved_item` for the badge so item overrides and selected-hotbar resolution are already baked in.
- Support arbitrary items, not only block items. Buckets, tools, food, etc. must render as item identity rather than trying to become 3D block ghosts.
- If `resolved_item` is `null`, show a compact `unknown item` badge.
- Do **not** add `BlockChange`s, ghost placement blocks, inventory changes, or any block-item placement heuristic.

## Implementation notes
- Add a dedicated `frontend/src/world/UseItemOnOverlay.tsx` component and mount it in `frontend/src/world/Scene.tsx` beside `Highlights`.
- Keep `Highlights.tsx` as the transient pulse layer. This issue adds a persistent inspection overlay, so it should not be folded into the 600 ms highlight pulse.
- Select events from the current sparse replay frame:
  - If `eventIndex === null`, render every `use_item_on` event on the current tick.
  - If `eventIndex !== null`, render only `frame.events[eventIndex]` when it is `use_item_on`.
  - Render nothing when there is no replay, no matching frame, or no matching event.
- Face normal mapping:
  ```ts
  top    -> [ 0,  1,  0]
  bottom -> [ 0, -1,  0]
  north  -> [ 0,  0, -1]
  south  -> [ 0,  0,  1]
  east   -> [ 1,  0,  0]
  west   -> [-1,  0,  0]
  ```
- Marker position: block center `[x + 0.5, y + 0.5, z + 0.5]` plus normal `* 0.53` so it sits just outside the face.
- Use a colored face panel, short arrow, or similar compact marker. Avoid a full cube or block-shaped ghost because `use_item_on` is intentionally not simulated placement.
- Reuse the existing item-icon loading path from `frontend/src/panels/itemIcons.ts`. If needed, extract the inventory panel's item-sprite rendering into a shared component/helper rather than duplicating icon subscription logic.
- Item badge should face the camera and remain legible at normal zoom levels. A small HTML overlay via Drei `<Html>` is acceptable if already available; otherwise use a simple sprite/plane with a text fallback.
- Badge text fallback should use the short id (`minecraft:water_bucket` -> `water_bucket`) when an icon is unavailable.
- Keep the overlay under the scene's world-space composition so scene rotation (#0036) moves the marker with the block.

## Files
- `frontend/src/world/UseItemOnOverlay.tsx` (new)
- `frontend/src/world/Scene.tsx`
- `frontend/src/panels/Inventory.tsx` / shared item icon helper, only if factoring out reusable item badge code is needed
- `frontend/src/panels/itemIcons.ts`, only if the icon API needs a small export for world overlays

## Verification
1. Add or load a test containing `use_item_on` with an explicit non-block item such as `minecraft:water_bucket`.
2. Scrub to that tick: the clicked face shows a marker and the badge shows the bucket item.
3. Use an omitted `item` field with a selected hotbar item: the badge uses `resolved_item`.
4. Use an empty selected hotbar slot: the overlay still shows the face marker plus `unknown item`.
5. Pick individual events via #0040: only the selected `use_item_on` overlay remains visible; `[all]` shows all `use_item_on` events on the tick.
6. Confirm no new world block appears and the player inventory is unchanged by the overlay.
7. Run the focused frontend tests plus the normal frontend test suite.

## Out of scope
- Simulating right-click Minecraft behavior.
- Guessing whether an item id is a placeable block.
- Rendering arbitrary item models as 3D geometry.
- Adding a side-panel action detail view.
