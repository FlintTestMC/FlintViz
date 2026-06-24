import { create } from "zustand";

import { api, setStandalone } from "../api/client";

import { isReadOnly as isInlineFailureReadOnly, useFailureStore } from "./failure";

export interface ConfigState {
  /** `null` until the initial `/api/config` fetch resolves or fails. */
  readonly: boolean | null;
  standalone: boolean;
  fetched: boolean;
  fetch: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  readonly: null,
  standalone: false,
  fetched: false,
  fetch: async () => {
    if (get().fetched) return;
    const result = await api.getConfig();
    if (result.ok) {
      set({ readonly: result.body.readonly, standalone: false, fetched: true });
    } else {
      setStandalone(true);
      set({ readonly: true, standalone: true, fetched: true });
    }
  },
}));

/** True when the server is readonly OR the editor is showing an inline failure. */
export function isEffectivelyReadOnly(): boolean {
  const state = useConfigStore.getState();
  if (state.standalone) {
    return isInlineFailureReadOnly(useFailureStore.getState());
  }
  return (
    state.readonly === true ||
    isInlineFailureReadOnly(useFailureStore.getState())
  );
}

