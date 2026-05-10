import { Canvas } from "@react-three/fiber";
import { useMemo, type ReactNode } from "react";

import type { Aabb, Block } from "../api/types";
import { useReplayStore } from "../store/replay";
import type { PosKey } from "../store/world";
import AssertionGhosts from "./AssertionGhosts";
import Camera from "./Camera";
import CleanupOverlay from "./CleanupOverlay";
import FailureOverlay from "./FailureOverlay";
import Highlights from "./Highlights";
import World from "./World";
import { useBlockProvidersState } from "./useBlockProviders";

// Composition root for the 3D pane. Every world-space layer (world geometry,
// cleanup wireframe, action highlights, assertion ghosts) lives under
// `<SceneRoot>` so #0036's rotation can transform them as one rigid body.
// `<Camera>` stays *outside* `<SceneRoot>` — rotation is a world transform,
// not a camera transform.
export default function Scene() {
  const { error: assetError } = useBlockProvidersState();
  if (assetError) return <AssetMissingPanel error={assetError} />;
  return (
    <Canvas
      camera={{ position: [6, 6, 6], fov: 50 }}
      className="h-full w-full"
    >
      <color attach="background" args={["#2d2d2d"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[8, 12, 6]} intensity={0.8} />
      <directionalLight position={[-6, 4, -8]} intensity={0.3} />
      <Camera />
      <SceneRoot>
        <World />
        <CleanupOverlay />
        <Highlights />
        <AssertionGhosts />
        <FailureOverlay />
      </SceneRoot>
    </Canvas>
  );
}

// Rendered in place of the canvas when `loadBlockProviders` rejects. Surfaces
// the loader's pre-baked instruction string verbatim (#0033 handoff from
// #0023) — that string already points at the right `npm run assets` command.
function AssetMissingPanel({ error }: { error: Error }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-950 p-6">
      <div className="max-w-md rounded-md bg-neutral-900 p-4 text-sm text-neutral-200 ring-1 ring-neutral-800">
        <div className="mb-2 font-semibold">Block assets missing</div>
        <p className="mb-3 whitespace-pre-wrap text-xs text-neutral-400">
          {error.message}
        </p>
        <p className="text-xs text-neutral-500">
          The 3D view needs <code>frontend/public/mc-assets.zip</code>. Run{" "}
          <code className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-200">
            npm run assets
          </code>{" "}
          in the <code>frontend/</code> directory and reload.
        </p>
      </div>
    </div>
  );
}

// Single rigid-body transform around the cleanup-region (or block-bounds)
// centre. Rotation is a quarter-turn count around Y (#0036). The pivot is the
// same `(min + max + 1) / 2` formula #0024 / #0025 use, so the camera
// auto-framing target lands exactly on the rotated scene's centre on screen
// without any camera-side rotation handling.
function SceneRoot({ children }: { children: ReactNode }) {
  const rotation = useReplayStore((s) => s.rotation);
  const cleanup = useReplayStore((s) => s.replay?.cleanup_region ?? null);
  const worldState = useReplayStore((s) => s.worldState);

  const pivot = useMemo(() => computePivot(cleanup, worldState), [
    cleanup,
    worldState,
  ]);

  if (rotation === 0) {
    // Zero-cost path: no nested groups when rotation is identity.
    return <group>{children}</group>;
  }

  const theta = (rotation * Math.PI) / 2;
  // Standard "translate → rotate → translate back" pivot trick, expressed as
  // three nested groups so the math is obvious and three.js handles the
  // composition.
  return (
    <group position={[pivot[0], pivot[1], pivot[2]]}>
      <group rotation={[0, theta, 0]}>
        <group position={[-pivot[0], -pivot[1], -pivot[2]]}>{children}</group>
      </group>
    </group>
  );
}

function computePivot(
  cleanup: Aabb | null,
  worldState: Map<PosKey, Block>,
): [number, number, number] {
  if (cleanup) {
    return [
      (cleanup.min[0] + cleanup.max[0] + 1) / 2,
      (cleanup.min[1] + cleanup.max[1] + 1) / 2,
      (cleanup.min[2] + cleanup.max[2] + 1) / 2,
    ];
  }
  if (worldState.size === 0) return [0, 0, 0];
  // Fall back to the block-bounds centre so rotation still pivots on the
  // visible content rather than the world origin.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const key of worldState.keys()) {
    const parts = key.split(",");
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return [(minX + maxX + 1) / 2, (minY + maxY + 1) / 2, (minZ + maxZ + 1) / 2];
}
