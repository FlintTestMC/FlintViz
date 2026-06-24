import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";

import { loadBlockProviders, type BlockProviders } from "../atlas";
import { BlockMeshLayers } from "../BlockMeshLayers";
import { buildBlockMesh, type BlockMesh } from "../blockAdapter";

interface SampleBlock {
  label: string;
  id: string;
  properties: Record<string, string>;
}

const SAMPLES: SampleBlock[] = [
  { label: "stone", id: "minecraft:stone", properties: {} },
  {
    label: "oak_stairs[facing=east]",
    id: "minecraft:oak_stairs",
    properties: { facing: "east", half: "bottom", shape: "straight" },
  },
  {
    label: "lever[powered=true]",
    id: "minecraft:lever",
    properties: { face: "floor", facing: "north", powered: "true" },
  },
  { label: "glass", id: "minecraft:glass", properties: {} },
  {
    label: "redstone_wire (cross)",
    id: "minecraft:redstone_wire",
    properties: {
      north: "side",
      east: "side",
      south: "side",
      west: "side",
      power: "0",
    },
  },
  {
    label: "oak_fence",
    id: "minecraft:oak_fence",
    properties: {
      north: "true",
      east: "false",
      south: "true",
      west: "false",
    },
  },
];

const COLS = 3;
const SPACING = 2.2;

export default function BlockGallery() {
  const [providers, setProviders] = useState<BlockProviders | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBlockProviders()
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-red-400">
        <pre className="max-w-xl whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  if (!providers) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
        Loading MC assets…
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-neutral-900">
      <Canvas
        orthographic
        camera={{ position: [6, 6, 6], zoom: 60 }}
        className="h-full w-full"
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[8, 12, 6]} intensity={0.8} />
        <Grid samples={SAMPLES} providers={providers} />
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}

function Grid({
  samples,
  providers,
}: {
  samples: SampleBlock[];
  providers: BlockProviders;
}) {
  return (
    <group>
      {samples.map((s, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = (col - (COLS - 1) / 2) * SPACING;
        const z = (row - 0.5) * SPACING;
        return (
          <Sample
            key={`${s.id}-${i}`}
            sample={s}
            providers={providers}
            position={[x, 0, z]}
          />
        );
      })}
    </group>
  );
}

function Sample({
  sample,
  providers,
  position,
}: {
  sample: SampleBlock;
  providers: BlockProviders;
  position: [number, number, number];
}) {
  const built: BlockMesh | null = buildBlockMesh(
    sample.id,
    sample.properties,
    providers,
  );

  return (
    <group position={position}>
      {built ? (
        <BlockMeshLayers mesh={built} />
      ) : (
        <mesh>
          <boxGeometry args={[0.9, 0.9, 0.9]} />
          <meshStandardMaterial color="#ff00ff" wireframe />
        </mesh>
      )}
    </group>
  );
}
