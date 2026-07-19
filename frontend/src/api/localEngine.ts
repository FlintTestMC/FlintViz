import initWasm, { replay } from "../wasm/flint-viz-replay/flint_viz_replay";

import type { ReplayResponse } from "./types";

let initialized: Promise<void> | null = null;

async function initialize(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const wasmLocation = new URL(
        "../wasm/flint-viz-replay/flint_viz_replay_bg.wasm",
        import.meta.url,
      );
      if (typeof window === "undefined") {
        // Vitest runs in Node, whose fetch cannot read file: URLs. Keep the
        // Node-only import opaque so Vite does not bundle it for browsers.
        const moduleName = "node:fs/promises";
        const fs = await import(/* @vite-ignore */ moduleName);
        const bytes = await fs.readFile(wasmLocation);
        await initWasm({ module_or_path: bytes });
      } else {
        await initWasm({ module_or_path: wasmLocation });
      }
    })();
  }
  await initialized;
}

/** Parse and replay a Flint test through the shared Rust/WASM adapter. */
export async function localReplay(source: string): Promise<ReplayResponse> {
  await initialize();
  return JSON.parse(replay(source) as string) as ReplayResponse;
}
