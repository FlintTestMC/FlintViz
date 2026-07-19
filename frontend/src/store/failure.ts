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

/** True when the editor buffer came from an inline URL payload and can't be saved to disk. */
export const isReadOnly = (s: FailureState): boolean =>
  s.status.kind === "loaded" && s.status.sourceMode === "inline";

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
  if ("Block" in failure) return failure.Block.position;
  if ("Entity" in failure && Array.isArray(failure.Entity.expected.pos)) {
    const [x, y, z] = failure.Entity.expected.pos;
    if (typeof x === "number" && typeof y === "number" && typeof z === "number") return [x, y, z];
  }
  return null;
}

export function failureTick(failure: AssertFailure): number {
  if ("Block" in failure) return failure.Block.tick;
  if ("Inventory" in failure) return failure.Inventory.tick;
  if ("Time" in failure) return failure.Time.tick;
  return failure.Entity.tick;
}

export function failureMessage(failure: AssertFailure): string {
  if ("Block" in failure) return "Block was different";
  if ("Inventory" in failure) return "Inventory slot content was different";
  if ("Time" in failure) return `Expected time ${failure.Time.expected}, got ${failure.Time.actual}`;
  return "Entity state was different";
}
