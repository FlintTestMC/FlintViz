import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

export default function CanvasShell() {
  return (
    <Canvas camera={{ position: [3, 3, 3], fov: 50 }} className="h-full w-full">
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 7]} intensity={0.8} />
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#7dd3fc" />
      </mesh>
      <OrbitControls />
    </Canvas>
  );
}
