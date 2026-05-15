import { Canvas } from "@react-three/fiber";

import AssertionGhosts from "./AssertionGhosts";
import Camera from "./Camera";
import CleanupOverlay from "./CleanupOverlay";
import FailureOverlay from "./FailureOverlay";
import Highlights from "./Highlights";
import World from "./World";
import { useBlockProvidersState } from "./useBlockProviders";

// Composition root for the 3D pane. World-space layers (world geometry,
// cleanup wireframe, action highlights, assertion ghosts) render directly in
// world space; the camera orbits via mouse (OrbitControls).
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
      <World />
      <CleanupOverlay />
      <Highlights />
      <AssertionGhosts />
      <FailureOverlay />
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
