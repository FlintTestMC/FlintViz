// Failure-context store for issue #0035.
//
// Populated by `FailureView` after decoding the URL fragment. Independent of
// the replay store so a user can clear the failure overlay without disturbing
// the static replay underneath, and so editor edits don't blow away the
// failure context (the failure was emitted by a specific run; subsequent
// edits don't invalidate it visually).

import { create } from "zustand";

import type { AssertFailure, FailurePayload } from "../api/types";

export type FailureLoadStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; payload: FailurePayload; sourceMode: "disk" | "inline" }
  | { kind: "error"; message: string };

export interface FailureState {
  status: FailureLoadStatus;
  /** Toggle for the "Clear failures" UI — overlay hides when false. */
  visible: boolean;
  load: (payload: FailurePayload, sourceMode: "disk" | "inline") => void;
  setLoading: () => void;
  setError: (message: string) => void;
  clear: () => void;
  setVisible: (visible: boolean) => void;
}

export const useFailureStore = create<FailureState>((set) => ({
  status: { kind: "idle" },
  visible: true,
  load: (payload, sourceMode) =>
    set({ status: { kind: "loaded", payload, sourceMode }, visible: true }),
  setLoading: () => set({ status: { kind: "loading" } }),
  setError: (message) => set({ status: { kind: "error", message } }),
  clear: () => set({ status: { kind: "idle" }, visible: true }),
  setVisible: (visible) => set({ visible }),
}));

/** Extract `[x, y, z]` if the failure has a coordinate position. */
export function failureCoordinate(
  failure: AssertFailure,
): [number, number, number] | null {
  if ("Coordinate" in failure.position) {
    const c = failure.position.Coordinate;
    return [c.x, c.y, c.z];
  }
  return null;
}
