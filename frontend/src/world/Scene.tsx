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
  const { providers, error: assetError, status, retry } = useBlockProvidersState();
  if (status.kind === "eula_prompt") {
    return <EulaPromptPanel onAccept={status.onAccept} />;
  }
  if (assetError || status.kind === "error") {
    const err =
      assetError ??
      (status.kind === "error" ? status.error : new Error("Asset load failed"));
    return <AssetMissingPanel error={err} onRetry={retry} />;
  }
  if (providers) {
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
  if (status.kind === "loading" || status.kind === "idle") {
    return (
      <AssetLoadingPanel
        progress={
          status.kind === "loading" ? status.message : "Initializing WebGL..."
        }
      />
    );
  }
  return <AssetLoadingPanel progress="Building block atlas..." />;
}

function AssetLoadingPanel({ progress }: { progress: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-950 p-6 text-sm text-neutral-400">
      <div className="flex flex-col items-center gap-3 text-center max-w-sm">
        <div className="animate-spin h-6 w-6 border-2 border-neutral-700 border-t-blue-500 rounded-full" />
        <div className="font-medium text-neutral-200">Loading 3D Scene Assets</div>
        <p className="text-xs text-neutral-500 whitespace-pre-wrap">{progress}</p>
      </div>
    </div>
  );
}

function EulaPromptPanel({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-950 p-6 text-sm text-neutral-400">
      <div className="max-w-md rounded-md bg-neutral-900 p-5 text-sm text-neutral-200 ring-1 ring-neutral-800">
        <div className="mb-2 font-semibold">Minecraft Assets Download</div>
        <p className="mb-4 text-xs text-neutral-400 leading-relaxed">
          FlintVisualizer renders block geometries using official Minecraft models and textures. 
          To visualize the 3D scene, we need to download the client jar (~36 MB) directly from Mojang's servers and extract them.
        </p>
        <p className="mb-5 text-xs text-neutral-500 leading-relaxed">
          By clicking <strong>Agree & Download</strong>, you acknowledge that you possess a valid license and agree to the{" "}
          <a
            href="https://www.minecraft.net/eula"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline inline-flex items-center"
          >
            Minecraft End User License Agreement (EULA)
          </a>.
        </p>
        <button
          onClick={onAccept}
          className="w-full rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
        >
          Agree & Download
        </button>
      </div>
    </div>
  );
}

function AssetMissingPanel({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-950 p-6">
      <div className="max-w-md rounded-md bg-neutral-900 p-4 text-sm text-neutral-200 ring-1 ring-neutral-800">
        <div className="mb-2 font-semibold">Failed to load block assets</div>
        <p className="mb-4 whitespace-pre-wrap text-xs text-neutral-400">
          {error.message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="w-full rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-medium text-white transition-colors cursor-pointer"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
