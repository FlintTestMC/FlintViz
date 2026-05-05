import { create } from "zustand";

import type { Vec3 } from "../api/types";

// Imperative camera commands published from outside the Canvas tree (Reset
// View button, "fly to" from the assertion panel #0031). Tokens monotonically
// increase so the Camera component can detect each command exactly once via
// store.subscribe; the latest target is read on the next animation tick.
export interface CameraState {
  resetToken: number;
  flyToToken: number;
  flyToTarget: Vec3 | null;

  resetView: () => void;
  flyTo: (target: Vec3) => void;
}

export const useCameraStore = create<CameraState>((set) => ({
  resetToken: 0,
  flyToToken: 0,
  flyToTarget: null,

  resetView: () => set((s) => ({ resetToken: s.resetToken + 1 })),
  flyTo: (target) =>
    set((s) => ({ flyToToken: s.flyToToken + 1, flyToTarget: target })),
}));
