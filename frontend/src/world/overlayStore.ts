import { create } from "zustand";

// UI toggles for scene-overlay layers (cleanup wireframe today; highlights /
// assertion ghosts will land here as #0026 / #0027 arrive). Kept separate
// from the replay store because these are pure view preferences and don't
// participate in the test/tick state machine.
export interface OverlayState {
  cleanupVisible: boolean;
  toggleCleanup: () => void;
  setCleanupVisible: (visible: boolean) => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  cleanupVisible: true,
  toggleCleanup: () => set((s) => ({ cleanupVisible: !s.cleanupVisible })),
  setCleanupVisible: (visible) => set({ cleanupVisible: visible }),
}));
