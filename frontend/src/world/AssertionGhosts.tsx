import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import { MeshStandardMaterial, type BufferGeometry, type Material } from "three";

import type { AssertionView, Block, TickEvent, Vec3 } from "../api/types";
import { activeAltIndex, useAssertionsStore } from "../store/assertions";
import { useReplayStore } from "../store/replay";
import { posKey } from "../store/world";
import type { BlockProviders } from "./atlas";
import { BlockMeshLayers, blockMeshGeometries } from "./BlockMeshLayers";
import { buildBlockMesh, getSharedMaterial } from "./blockAdapter";
import { useBlockProviders } from "./useBlockProviders";

// Translucent "expected block" overlay for the current tick. Walks every
// `assert` event's `views` and renders one ghost per *position*, cycling /
// locked / picker-pinned across the alternatives at that position (#0041).
//
// Mounted under `<SceneRoot>` so #0036's rotation rotates ghosts with the
// world.
export default function AssertionGhosts() {
  const tick = useReplayStore((s) => s.tick);
  const eventIndex = useReplayStore((s) => s.eventIndex);
  const frames = useReplayStore((s) => s.replay?.frames ?? null);
  const providers = useBlockProviders();

  const groups = useMemo(() => {
    if (!frames) return { blocks: [], entities: [] };
    const frame = frames.find((f) => f.tick === tick);
    if (!frame) return { blocks: [], entities: [] };
    const events: TickEvent[] =
      eventIndex != null
        ? frame.events[eventIndex]
          ? [frame.events[eventIndex]!]
          : []
        : frame.events;
    const entries: { idx: number; view: AssertionView }[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      if (ev.kind !== "assert") continue;
      const parentIdx = eventIndex != null ? eventIndex : i;
      for (const v of ev.views) entries.push({ idx: parentIdx, view: v });
    }
    return {
      blocks: groupByPosition(entries),
      entities: entityAssertions(entries),
    };
  }, [frames, tick, eventIndex]);

  if (!providers || (groups.blocks.length === 0 && groups.entities.length === 0)) return null;

  return (
    <group>
      {groups.blocks.map((g) => (
        <Ghost
          key={`${g.pos[0]},${g.pos[1]},${g.pos[2]}`}
          group={g}
          pickerActive={eventIndex !== null}
          providers={providers}
        />
      ))}
      {groups.entities.map((entity, index) => (
        <EntityAssertionGhost
          key={`${entity.pos.join(",")}:${entity.alias}:${index}`}
          entity={entity}
          providers={providers}
        />
      ))}
    </group>
  );
}

interface EntityAssertion {
  pos: Vec3;
  alias: string;
  entityType: string;
  itemId: string | null;
  exists: boolean;
}

function entityAssertions(entries: { idx: number; view: AssertionView }[]): EntityAssertion[] {
  const entities: EntityAssertion[] = [];
  for (const { view } of entries) {
    if (view.kind !== "entity") continue;
    const expected = view.expected;
    const pos = vec3(expected.pos);
    if (!pos) continue;
    const entityType = typeof expected.is === "string" ? expected.is : "minecraft:entity";
    const alias =
      typeof expected.entity_alias === "string" ? expected.entity_alias : shortId(entityType);
    entities.push({
      pos,
      alias,
      entityType,
      itemId: entityType === "minecraft:item" ? assertedItemId(expected) : null,
      exists: expected.exists !== false,
    });
  }
  return entities;
}

function EntityAssertionGhost({
  entity,
  providers,
}: {
  entity: EntityAssertion;
  providers: BlockProviders;
}) {
  const itemMesh = useMemo(
    () => (entity.itemId ? buildBlockMesh(entity.itemId, {}, providers) : null),
    [entity.itemId, providers],
  );
  const geomRef = useRef<BufferGeometry[]>([]);
  geomRef.current = blockMeshGeometries(itemMesh);
  useEffect(() => {
    const geometries = geomRef.current;
    return () => geometries.forEach((geometry) => geometry.dispose());
  }, [itemMesh]);

  const color = entity.exists ? "#a78bfa" : "#f87171";
  const label = entity.itemId
    ? `assert item: ${shortId(entity.itemId)}`
    : `assert ${entity.alias}: ${shortId(entity.entityType)}`;

  return (
    <group position={entity.pos}>
      {itemMesh ? (
        <group position={[-0.175, 0.05, -0.175]} scale={0.35}>
          <BlockMeshLayers mesh={itemMesh} material={getGhostMaterial(providers)} />
        </group>
      ) : (
        <mesh position={[0, 0.25, 0]}>
          <octahedronGeometry args={[0.25]} />
          <meshStandardMaterial color={color} transparent opacity={0.55} depthWrite={false} />
        </mesh>
      )}
      <mesh position={[0, 0.25, 0]}>
        <sphereGeometry args={[0.42, 16, 12]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.75} />
      </mesh>
      <Html
        position={[0, 0.95, 0]}
        center
        distanceFactor={8}
        style={{
          pointerEvents: "none",
          fontSize: "10px",
          color: entity.exists ? "#ede9fe" : "#fee2e2",
          background: "rgba(0,0,0,0.68)",
          padding: "1px 4px",
          borderRadius: "2px",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </Html>
    </group>
  );
}

function assertedItemId(expected: Record<string, unknown>): string | null {
  const nestedNbt =
    expected.nbt && typeof expected.nbt === "object" && !Array.isArray(expected.nbt)
      ? (expected.nbt as Record<string, unknown>)
      : null;
  const item = expected.Item ?? expected.item ?? nestedNbt?.Item ?? nestedNbt?.item;
  if (typeof item === "string") return item;
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const id = (item as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  return null;
}

function vec3(value: unknown): Vec3 | null {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((component) => typeof component !== "number")
  ) {
    return null;
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

interface GhostGroup {
  pos: Vec3;
  expecteds: Block[];
  pointerSuffixes: (string | undefined)[];
  eventIndices: number[];
}

function groupByPosition(entries: { idx: number; view: AssertionView }[]): GhostGroup[] {
  const byKey = new Map<string, GhostGroup>();
  for (const { idx, view } of entries) {
    if (view.kind !== "block") continue;
    const key = `${view.position[0]},${view.position[1]},${view.position[2]}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.expecteds.push(view.expected);
      existing.pointerSuffixes.push(view.pointer_suffix);
      existing.eventIndices.push(idx);
    } else {
      byKey.set(key, {
        pos: view.position,
        expecteds: [view.expected],
        pointerSuffixes: [view.pointer_suffix],
        eventIndices: [idx],
      });
    }
  }
  return Array.from(byKey.values());
}

// Lazily clones the shared opaque material into a translucent variant. Cached
// per BlockProviders identity so every ghost reuses one material — same
// approach the World adapter uses for its shared opaque material.
const ghostMaterialCache = new WeakMap<BlockProviders, Material>();

function getGhostMaterial(providers: BlockProviders): Material {
  const cached = ghostMaterialCache.get(providers);
  if (cached) return cached;
  const base = getSharedMaterial(providers);
  // Clone preserves the atlas texture and vertex-color setup.
  const clone =
    base instanceof MeshStandardMaterial ? base.clone() : (base as MeshStandardMaterial).clone();
  clone.transparent = true;
  clone.opacity = 0.4;
  clone.depthWrite = false;
  ghostMaterialCache.set(providers, clone);
  return clone;
}

function extractProps(block: Block): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(block)) {
    if (k === "id") continue;
    if (v == null) continue;
    out[k] = String(v);
  }
  return out;
}

function shortId(id: string): string {
  return id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id;
}

function Ghost({
  group,
  pickerActive,
  providers,
}: {
  group: GhostGroup;
  pickerActive: boolean;
  providers: BlockProviders;
}) {
  const cycleIndex = useAssertionsStore((s) => s.cycleIndex);
  const lock = useAssertionsStore((s) => s.locks[posKey(group.pos)]);
  const altCount = group.expecteds.length;
  const active = activeAltIndex(altCount, cycleIndex, lock, null);
  const expected = group.expecteds[active]!;

  const built = useMemo(
    () => buildBlockMesh(expected.id, extractProps(expected), providers),
    [expected, providers],
  );

  const geomRef = useRef<BufferGeometry[]>([]);
  geomRef.current = blockMeshGeometries(built);
  useEffect(() => {
    const geoms = geomRef.current;
    return () => {
      for (const g of geoms) g.dispose();
    };
  }, [built]);

  if (!built) return null;

  const ghostMat = getGhostMaterial(providers);
  const label = labelFor(group, active, lock !== undefined, pickerActive);

  return (
    <group position={[group.pos[0], group.pos[1], group.pos[2]]}>
      <BlockMeshLayers mesh={built} material={ghostMat} />
      <Html
        position={[0.5, 1.1, 0.5]}
        center
        distanceFactor={8}
        style={{
          pointerEvents: "none",
          fontSize: "10px",
          color: "#fef3c7",
          background: "rgba(0,0,0,0.6)",
          padding: "1px 4px",
          borderRadius: "2px",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </Html>
    </group>
  );
}

function labelFor(
  group: GhostGroup,
  active: number,
  locked: boolean,
  pickerActive: boolean,
): string {
  const altCount = group.expecteds.length;
  if (altCount <= 1) return "asserted";
  const id = shortId(group.expecteds[active]!.id);
  if (pickerActive) return id;
  if (locked) return `${id} 🔒`;
  return `${id} …+${altCount - 1}`;
}
