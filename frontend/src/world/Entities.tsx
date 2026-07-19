import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import type { BufferGeometry } from "three";

import type { Block, EntitySnapshot } from "../api/types";
import { useReplayStore } from "../store/replay";
import { BlockMeshLayers, blockMeshGeometries } from "./BlockMeshLayers";
import { buildBlockMesh } from "./blockAdapter";
import type { BlockProviders } from "./atlas";
import { useBlockProviders } from "./useBlockProviders";

export default function Entities() {
  const entities = useReplayStore((state) => state.entityState);
  const providers = useBlockProviders();
  if (!providers) return null;

  return (
    <group>
      {Array.from(entities.values()).map((entity) => (
        <Entity key={entity.alias} entity={entity} providers={providers} />
      ))}
    </group>
  );
}

function Entity({ entity, providers }: { entity: EntitySnapshot; providers: BlockProviders }) {
  const block = fallingBlock(entity);
  const yaw = entity.rot ? (-entity.rot[0] * Math.PI) / 180 : 0;

  return (
    <group position={entity.pos} rotation={[0, yaw, 0]}>
      {block ? (
        <FallingBlock block={block} providers={providers} />
      ) : (
        <GenericEntity type={entity.entity_type} color={colorFor(entity.entity_type)} />
      )}
      <Html
        position={[0, block ? 1.25 : 2.05, 0]}
        center
        distanceFactor={8}
        style={{
          pointerEvents: "none",
          fontSize: "10px",
          color: "#e0f2fe",
          background: "rgba(3, 7, 18, 0.78)",
          border: "1px solid rgba(56, 189, 248, 0.45)",
          padding: "1px 5px",
          borderRadius: "3px",
          whiteSpace: "nowrap",
        }}
      >
        {entity.alias} · {shortId(entity.entity_type)}
      </Html>
    </group>
  );
}

function FallingBlock({ block, providers }: { block: Block; providers: BlockProviders }) {
  const properties = blockProperties(block);
  const mesh = useMemo(
    () => buildBlockMesh(block.id, properties, providers),
    [block.id, properties, providers],
  );
  const geometries = useRef<BufferGeometry[]>([]);
  geometries.current = blockMeshGeometries(mesh);
  useEffect(() => {
    const current = geometries.current;
    return () => current.forEach((geometry) => geometry.dispose());
  }, [mesh]);

  if (!mesh) return <GenericEntity type="minecraft:falling_block" color="#d6b36a" />;
  return (
    <group position={[-0.5, 0, -0.5]}>
      <BlockMeshLayers mesh={mesh} />
    </group>
  );
}

function GenericEntity({ type, color }: { type: string; color: string }) {
  if (isSmallEntity(type)) {
    return (
      <mesh position={[0, 0.2, 0]} castShadow>
        <sphereGeometry args={[0.2, 16, 12]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
    );
  }

  return (
    <group>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[0.6, 1.1, 0.42]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
      <mesh position={[0, 1.55, 0]} castShadow>
        <boxGeometry args={[0.52, 0.52, 0.52]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
      <mesh position={[0, 1.57, 0.265]}>
        <boxGeometry args={[0.3, 0.1, 0.03]} />
        <meshBasicMaterial color="#082f49" />
      </mesh>
    </group>
  );
}

function fallingBlock(entity: EntitySnapshot): Block | null {
  if (entity.entity_type !== "minecraft:falling_block" || !entity.nbt) return null;
  const raw = entity.nbt.BlockState ?? entity.nbt.block_state;
  if (typeof raw === "string") return { id: raw };
  if (!isRecord(raw)) return null;
  const id = raw.Name ?? raw.name;
  if (typeof id !== "string") return null;
  const properties = isRecord(raw.Properties)
    ? Object.fromEntries(Object.entries(raw.Properties).map(([key, value]) => [key, String(value)]))
    : {};
  return { id, properties };
}

function blockProperties(block: Block): Record<string, string> {
  if (isRecord(block.properties)) {
    return Object.fromEntries(
      Object.entries(block.properties).map(([key, value]) => [key, String(value)]),
    );
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSmallEntity(type: string): boolean {
  return /(item|arrow|snowball|egg|pearl|potion|fireball|orb)$/.test(type);
}

function colorFor(type: string): string {
  let hash = 0;
  for (let index = 0; index < type.length; index++) hash = (hash * 31 + type.charCodeAt(index)) | 0;
  return `hsl(${Math.abs(hash) % 360} 58% 55%)`;
}

function shortId(id: string): string {
  return id.replace(/^minecraft:/, "");
}
