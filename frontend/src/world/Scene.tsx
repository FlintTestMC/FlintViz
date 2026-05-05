import { Canvas } from "@react-three/fiber";
import type { ReactNode } from "react";

import Camera from "./Camera";
import CleanupOverlay from "./CleanupOverlay";
import World from "./World";

// Composition root for the 3D pane. The single `<SceneRoot>` group is the
// rotation target for #0036 and the parent of every world-space overlay
// (#0025 cleanup, #0026 highlights, #0027 assertion ghosts). `<Camera>` owns
// OrbitControls and the auto-framing state machine — it stays *outside*
// `<SceneRoot>` so #0036's rotation doesn't apply to the camera view.
export default function Scene() {
  return (
    <Canvas
      camera={{ position: [6, 6, 6], fov: 50 }}
      className="h-full w-full"
    >
      <color attach="background" args={["#0a0a0a"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[8, 12, 6]} intensity={0.8} />
      <directionalLight position={[-6, 4, -8]} intensity={0.3} />
      <Camera />
      <SceneRoot>
        <World />
        <CleanupOverlay />
      </SceneRoot>
    </Canvas>
  );
}

// All world-space content lives under this group so that #0036 can rotate
// blocks, overlays, highlights, and ghosts as one rigid body.
function SceneRoot({ children }: { children: ReactNode }) {
  return <group>{children}</group>;
}
