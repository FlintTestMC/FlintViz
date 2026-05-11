import { create } from "zustand";

import { api } from "../api/client";

import { isReadOnly as isInlineFailureReadOnly, useFailureStore } from "./failure";

export interface ConfigState {
  /** `null` until the initial `/api/config` fetch resolves or fails. */
  readonly: boolean | null;
  fetched: boolean;
  fetch: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  readonly: null,
  fetched: false,
  fetch: async () => {
    if (get().fetched) return;
    const result = await api.getConfig();
    set({ readonly: result.ok ? result.body.readonly : null, fetched: true });
  },
}));

/** True when the server is readonly OR the editor is showing an inline failure. */
export function isEffectivelyReadOnly(): boolean {
  return (
    useConfigStore.getState().readonly === true ||
    isInlineFailureReadOnly(useFailureStore.getState())
  );
}
