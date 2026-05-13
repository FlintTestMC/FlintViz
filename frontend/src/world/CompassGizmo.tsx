import { Html } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Group, Quaternion, Vector3 } from "three";

import { useReplayStore } from "../store/replay";
import { mainCameraRef } from "./Camera";

// Blender-style orientation indicator. A separate <Canvas> overlay so the
// gizmo is immune to the main scene's perspective and zoom — its orthographic
// camera is fixed; only the gizmo group's quaternion changes per frame.
//
// Axes follow Minecraft world conventions: +X east, +Y up, +Z south.

const Y_AXIS = new Vector3(0, 1, 0);

// Arm length / radius and sphere radius were tuned so the assembly fills
// roughly the inner 70 % of a 96 px viewport at zoom 40.
const ARM_LENGTH = 1.0;
const ARM_RADIUS = 0.04;
const TIP_RADIUS = 0.13;
const LABEL_OFFSET = ARM_LENGTH + 0.28;

export default function CompassGizmo() {
  return (
    <div
      className="pointer-events-none absolute top-2 right-2"
      style={{ width: 96, height: 96 }}
    >
      <Canvas
        orthographic
        camera={{ zoom: 40, position: [0, 0, 5], near: 0.1, far: 100 }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[2, 3, 4]} intensity={0.5} />
        <GizmoContent />
      </Canvas>
    </div>
  );
}

function GizmoContent() {
  const groupRef = useRef<Group>(null);
  const rotation = useReplayStore((s) => s.rotation);

  // Scratch quaternion reused every frame to avoid GC pressure.
  const sceneQ = useMemo(() => new Quaternion(), []);

  useFrame(() => {
    const group = groupRef.current;
    const cam = mainCameraRef;
    if (!group || !cam) return;

    // Mirror what the user sees: the on-screen world orientation is
    // (camera_view) ∘ (scene_rotation). The overlay camera is fixed, so we
    // bake that product into the gizmo group's local rotation.
    sceneQ.setFromAxisAngle(Y_AXIS, (rotation * Math.PI) / 2);
    group.quaternion.copy(cam.quaternion).invert().multiply(sceneQ);
  });

  return (
    <group ref={groupRef}>
      <Arm axis="x" color="#ff4444" label="E" />
      <Arm axis="y" color="#44dd44" label="U" />
      <Arm axis="z" color="#5577ff" label="S" />
    </group>
  );
}

interface ArmProps {
  axis: "x" | "y" | "z";
  color: string;
  label: string;
}

function Arm({ axis, color, label }: ArmProps) {
  // Cylinder geometry is built along +Y; rotate it so its length lies along
  // the requested axis, then translate so its base sits at the origin.
  const half = ARM_LENGTH / 2;
  const tipPos: [number, number, number] =
    axis === "x" ? [ARM_LENGTH, 0, 0] :
    axis === "y" ? [0, ARM_LENGTH, 0] :
    [0, 0, ARM_LENGTH];
  const armPos: [number, number, number] =
    axis === "x" ? [half, 0, 0] :
    axis === "y" ? [0, half, 0] :
    [0, 0, half];
  const armRot: [number, number, number] =
    axis === "x" ? [0, 0, -Math.PI / 2] :
    axis === "y" ? [0, 0, 0] :
    [Math.PI / 2, 0, 0];
  const labelPos: [number, number, number] =
    axis === "x" ? [LABEL_OFFSET, 0, 0] :
    axis === "y" ? [0, LABEL_OFFSET, 0] :
    [0, 0, LABEL_OFFSET];

  return (
    <group>
      <mesh position={armPos} rotation={armRot}>
        <cylinderGeometry args={[ARM_RADIUS, ARM_RADIUS, ARM_LENGTH, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={tipPos}>
        <sphereGeometry args={[TIP_RADIUS, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html
        position={labelPos}
        center
        style={{
          color,
          fontSize: 11,
          fontWeight: 700,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, sans-serif",
          userSelect: "none",
          pointerEvents: "none",
          textShadow: "0 0 2px rgba(0,0,0,0.8)",
        }}
      >
        {label}
      </Html>
    </group>
  );
}
