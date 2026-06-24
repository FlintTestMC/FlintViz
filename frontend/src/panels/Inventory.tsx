import * as Tooltip from "@radix-ui/react-tooltip";
import { useMemo } from "react";

import type { Item, PlayerSlot } from "../api/types";
import { useReplayStore } from "../store/replay";
import { useItemIcon } from "./itemIcons";
import { slotLabel } from "./slotLabel";

const HOTBAR_SLOTS: PlayerSlot[] = [
  "hotbar1",
  "hotbar2",
  "hotbar3",
  "hotbar4",
  "hotbar5",
  "hotbar6",
  "hotbar7",
  "hotbar8",
  "hotbar9",
];
const ARMOR_SLOTS: PlayerSlot[] = ["helmet", "chestplate", "leggings", "boots"];

function selectedHotbarSlot(n: number): PlayerSlot | null {
  if (n < 1 || n > 9) return null;
  return `hotbar${n}` as PlayerSlot;
}

// Player inventory at the current tick. Hotbar runs across the bottom, the
// off-hand sits to its right, the four armor slots stack on the left.
//
// Glow signal comes from the *current frame*'s `inventory_diff.slots` (not by
// diffing snapshots) — the panel reads exactly what the engine emitted for
// this tick.
export default function Inventory() {
  const player = useReplayStore((s) => s.player);
  const tick = useReplayStore((s) => s.tick);
  const frames = useReplayStore((s) => s.replay?.frames ?? null);

  const changedSlots = useMemo(() => {
    if (!frames) return new Set<PlayerSlot>();
    const frame = frames.find((f) => f.tick === tick);
    if (!frame) return new Set<PlayerSlot>();
    const out = new Set<PlayerSlot>();
    for (const ev of frame.events) {
      if (ev.kind === "set_slot") out.add(ev.slot);
    }
    return out;
  }, [frames, tick]);

  const selectedSlot = selectedHotbarSlot(player.selected_hotbar);

  return (
    <Tooltip.Provider delayDuration={250}>
      <div className="flex h-full flex-col bg-neutral-950 p-2 text-xs text-neutral-200">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-medium uppercase tracking-wider text-neutral-400">
            Inventory
          </span>
          <span className="text-xs text-neutral-500">
            {player.game_mode}
          </span>
        </div>
        <div className="flex flex-1 items-end gap-2">
          {/* Armor column */}
          <div className="flex flex-col gap-1">
            {ARMOR_SLOTS.map((slot) => (
              <Slot
                key={slot}
                slot={slot}
                item={player.inventory[slot]}
                selected={false}
                changed={changedSlots.has(slot)}
              />
            ))}
          </div>
          {/* Spacer + hotbar + offhand */}
          <div className="flex flex-1 flex-col items-stretch gap-1">
            <div className="flex items-end justify-end gap-1">
              <Slot
                slot="off_hand"
                item={player.inventory.off_hand}
                selected={false}
                changed={changedSlots.has("off_hand")}
                accent
              />
            </div>
            <div className="flex items-end gap-1">
              {HOTBAR_SLOTS.map((slot) => (
                <Slot
                  key={slot}
                  slot={slot}
                  item={player.inventory[slot]}
                  selected={slot === selectedSlot}
                  changed={changedSlots.has(slot)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

function Slot({
  slot,
  item,
  selected,
  changed,
  accent,
}: {
  slot: PlayerSlot;
  item: Item | undefined;
  selected: boolean;
  changed: boolean;
  accent?: boolean;
}) {
  const ring = selected
    ? "ring-2 ring-sky-400"
    : accent
      ? "ring-1 ring-neutral-600"
      : "ring-1 ring-neutral-800";
  const glow = changed ? "slot-glow" : "";

  const tooltipText = item
    ? `${shortItemId(item.id)} × ${item.count}\n(${slotLabel(slot)})`
    : `${slotLabel(slot)} (empty)`;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div
          className={`relative h-8 w-8 rounded bg-neutral-900 ${ring} ${glow}`}
          aria-label={`${slotLabel(slot)}${item ? `: ${item.id} × ${item.count}` : ""}`}
        >
          {item ? <ItemSprite id={item.id} /> : null}
          {item && item.count > 1 ? (
            <span className="absolute bottom-0 right-0.5 text-[9px] font-semibold tabular-nums text-white drop-shadow">
              {item.count}
            </span>
          ) : null}
        </div>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={4}
          className="z-50 whitespace-pre rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-100 shadow-lg ring-1 ring-neutral-700"
        >
          {tooltipText}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function ItemSprite({ id }: { id: string }) {
  const url = useItemIcon(id);
  if (!url) {
    return (
      <span className="absolute inset-0 flex items-center justify-center text-[8px] text-neutral-400">
        {shortItemId(id).slice(0, 4)}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={id}
      className="absolute inset-0.5 bg-contain bg-center bg-no-repeat"
      style={{
        backgroundImage: `url("${url}")`,
        imageRendering: "pixelated",
      }}
    />
  );
}

function shortItemId(id: string): string {
  return id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id;
}
