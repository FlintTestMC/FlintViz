# 0030 — Inventory panel

**Milestone:** M6
**Depends on:** #0018, #0022

## Goal
Show the player's hotbar (9 slots), off-hand, and 4 armor slots at the current tick, with item icons. This is plain HTML/CSS (Tailwind) — not part of the 3D scene.

## Outcome
- Standard MC layout: hotbar across the bottom of the panel, armor down the side, off-hand near the hotbar.
- Item icons rendered from a sprite sheet pre-built by the asset pipeline.
- Selected hotbar slot highlighted.
- Slots that changed *this tick* glow briefly (CSS animation).
- Empty slots shown as empty cells.

## Implementation notes
- Use deepslate's `ItemRenderer` once per item id at app boot to render each icon to an offscreen canvas, then export to a single sprite sheet (data URL) cached in memory. Avoids running a Three.js scene per icon.
- Item count rendered as a small numeric badge (Tailwind `absolute bottom-0 right-0`).
- NBT not displayed in v1; tooltip (Radix) shows item id and count only.

## Files
- `frontend/src/panels/Inventory.tsx`
- `frontend/src/panels/itemIcons.ts` — builds the sprite sheet on demand, returns `(itemId) => CSS background`
