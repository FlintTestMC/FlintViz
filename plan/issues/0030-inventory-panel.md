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

## Handoff from #0018 (replay store)

Store at `frontend/src/store/replay.ts`:

- `player: PlayerSnapshot` — selector: `useReplayStore(s => s.player)`. Shape:
  ```ts
  interface PlayerSnapshot {
    inventory: Partial<Record<PlayerSlot, Item>>;  // missing slot ↔ empty
    selected_hotbar: number;                       // 1..=9
    game_mode: GameMode;
  }
  ```
- Empty slots are **omitted** from `inventory` (not `null`) — render slot N as "empty cell" if `player.inventory[slot] === undefined`. This is `noUncheckedIndexedAccess`-safe automatically.
- `Item` is `{ id: string, count: number, [data: string]: unknown }` — count badge reads `item.count`. NBT-ish data is flattened onto the same object; ignore for v1.
- "Glow when changed this tick" should source from the *current* frame's `inventory_diff`, not by diffing snapshots. Find it via `replay.frames.find(f => f.tick === tick)?.inventory_diff` — `slots[]` lists the slots that changed, `selected_hotbar` is a `HotbarChange`. Note `inventory_diff` is `null` on most ticks; selectors should default to "no glow".
- `PlayerDelta` fields are **omitted** when empty (`slots`, `selected_hotbar`, `game_mode`) — code defensively (`delta.slots ?? []`).
- `selected_hotbar: 1..=9` — slots in `inventory` are keyed by the `PlayerSlot` enum string (`"hotbar1"`..`"hotbar9"`, `"off_hand"`, `"helmet"`, `"chestplate"`, `"leggings"`, `"boots"`). The selected hotbar number maps to `"hotbar${n}"` — write a small label/order helper and reuse it from #0031 (assertion panel uses the same enum values).
- Forward/reverse scrubbing through the store is correct for inventory — slots and hotbar reverse via `previous` fields on `SlotChange`/`HotbarChange`. The panel just reads `store.player`; no need to re-derive.
