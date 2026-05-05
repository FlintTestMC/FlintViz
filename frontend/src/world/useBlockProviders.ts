import { useEffect, useState } from "react";

import { loadBlockProviders, type BlockProviders } from "./atlas";

// Shared loader for the deepslate block providers. `loadBlockProviders` is a
// cached singleton so multiple call sites coexist; centralising here keeps
// state ownership clear once #0027 (AssertionGhosts) and #0023 (World) both
// need it.
export function useBlockProviders(): BlockProviders | null {
  const [providers, setProviders] = useState<BlockProviders | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadBlockProviders()
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch((err) => {
        console.error("useBlockProviders: failed to load", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return providers;
}
