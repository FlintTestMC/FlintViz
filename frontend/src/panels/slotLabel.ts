import type { PlayerSlot } from "../api/types";

export function slotLabel(slot: PlayerSlot): string {
  switch (slot) {
    case "off_hand":
      return "Off-hand";
    case "helmet":
      return "Helmet";
    case "chestplate":
      return "Chestplate";
    case "leggings":
      return "Leggings";
    case "boots":
      return "Boots";
    default: {
      // hotbar1..hotbar9 — display as the 1..9 number; users read these as
      // the visible hotbar slot index.
      const m = /^hotbar(\d)$/.exec(slot);
      return m ? `Hotbar ${m[1]}` : slot;
    }
  }
}
