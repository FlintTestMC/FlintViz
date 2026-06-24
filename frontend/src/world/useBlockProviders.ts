import { useEffect, useState } from "react";

import {
  loadBlockProviders,
  subscribeAssetStatus,
  type AssetLoadStatus,
  type BlockProviders,
} from "./atlas";

// Shared loader for the deepslate block providers. `loadBlockProviders` is a
// cached singleton so multiple call sites coexist; centralising here keeps
// state ownership clear once #0027 (AssertionGhosts) and #0023 (World) both
// need it.
//
// Returns `{ providers, error, status }` so callers can render either the world geometry,
// a loader spinner with progress, or a "missing assets" panel. The original surface
// returning just `BlockProviders | null` is preserved for backwards compatibility.
export interface BlockProvidersState {
  providers: BlockProviders | null;
  error: Error | null;
  status: AssetLoadStatus;
}

export function useBlockProvidersState(): BlockProvidersState {
  const [providers, setProviders] = useState<BlockProviders | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [status, setStatus] = useState<AssetLoadStatus>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = subscribeAssetStatus((s) => {
      if (!cancelled) setStatus(s);
    });

    loadBlockProviders()
      .then((p) => {
        if (!cancelled) {
          setProviders(p);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        console.error("useBlockProviders: failed to load", e);
        setError(e);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { providers, error, status };
}

export function useBlockProviders(): BlockProviders | null {
  return useBlockProvidersState().providers;
}

