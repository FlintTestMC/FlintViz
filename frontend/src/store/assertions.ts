// Per-position lock + global cycle index for multi-alt `assert_block` rendering
// (#0041). The cycle index is advanced by a module-scope `setInterval` at 1 Hz
// regardless of playback so the 3D scene rotates through alternatives at
// 1 wall-clock second per alt. Locks are cleared whenever the active test
// changes — they are intentionally NOT persisted.

import { create } from "zustand";

import { useReplayStore } from "./replay";
import type { PosKey } from "./world";

export interface AssertionsState {
  // Monotonically increasing; consumers `mod` it against the per-position
  // alternative count to pick which alt to render.
  cycleIndex: number;
  // Per-position pinned alternative index. Picking `Auto` removes the entry.
  locks: Record<PosKey, number>;

  lock: (key: PosKey, altIndex: number) => void;
  unlock: (key: PosKey) => void;
  clearLocks: () => void;
  // Test seam — wall-clock cycling is driven outside the store.
  tickCycle: () => void;
}

export const useAssertionsStore = create<AssertionsState>((set) => ({
  cycleIndex: 0,
  locks: {},
  lock: (key, altIndex) =>
    set((s) => ({ locks: { ...s.locks, [key]: altIndex } })),
  unlock: (key) =>
    set((s) => {
      if (!(key in s.locks)) return s;
      const next = { ...s.locks };
      delete next[key];
      return { locks: next };
    }),
  clearLocks: () => set({ locks: {} }),
  tickCycle: () => set((s) => ({ cycleIndex: s.cycleIndex + 1 })),
}));

// Drive the cycle at 1 Hz. `setInterval` survives across React re-mounts
// because it's module-scope. Test environments can override `globalThis.window`
// to avoid scheduling.
let cycleTimer: ReturnType<typeof setInterval> | null = null;
if (typeof window !== "undefined") {
  cycleTimer = setInterval(() => {
    useAssertionsStore.getState().tickCycle();
  }, 1000);
}

export function stopAssertionCycleForTests(): void {
  if (cycleTimer !== null) {
    clearInterval(cycleTimer);
    cycleTimer = null;
  }
}

// Wipe locks whenever the active test changes. Subscribed once; selector
// returns the testId so the listener fires only on change.
useReplayStore.subscribe((state, prev) => {
  if (state.testId !== prev.testId) {
    useAssertionsStore.getState().clearLocks();
  }
});

// Resolve the active alternative index for a multi-alt group. Priority:
// picker (eventIndex !== null) > per-position lock > cycling.
export function activeAltIndex(
  altCount: number,
  cycleIndex: number,
  lock: number | undefined,
  pickerOverride: number | null,
): number {
  if (altCount <= 0) return 0;
  if (pickerOverride !== null) {
    return Math.max(0, Math.min(pickerOverride, altCount - 1));
  }
  if (lock !== undefined) {
    return Math.max(0, Math.min(lock, altCount - 1));
  }
  return cycleIndex % altCount;
}
