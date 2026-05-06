import { useEffect, useState } from "react";

import { loadBlockProviders, type BlockProviders } from "./atlas";

// Shared loader for the deepslate block providers. `loadBlockProviders` is a
// cached singleton so multiple call sites coexist; centralising here keeps
// state ownership clear once #0027 (AssertionGhosts) and #0023 (World) both
// need it.
//
// Returns `{ providers, error }` so callers can render either the world geometry
// or a "missing assets" panel (#0033). The original surface returning just
// `BlockProviders | null` is preserved for backwards compatibility.
export interface BlockProvidersState {
  providers: BlockProviders | null;
  error: Error | null;
}

export function useBlockProvidersState(): BlockProvidersState {
  const [state, setState] = useState<BlockProvidersState>({
    providers: null,
    error: null,
  });
  useEffect(() => {
    let cancelled = false;
    loadBlockProviders()
      .then((p) => {
        if (!cancelled) setState({ providers: p, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        console.error("useBlockProviders: failed to load", e);
        setState({ providers: null, error: e });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function useBlockProviders(): BlockProviders | null {
  return useBlockProvidersState().providers;
}
