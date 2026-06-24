import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import {
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from "three";

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
    if (!frames) return [];
    const frame = frames.find((f) => f.tick === tick);
    if (!frame) return [];
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
    return groupByPosition(entries);
  }, [frames, tick, eventIndex]);

  if (!providers || groups.length === 0) return null;

  return (
    <group>
      {groups.map((g) => (
        <Ghost
          key={`${g.pos[0]},${g.pos[1]},${g.pos[2]}`}
          group={g}
          pickerActive={eventIndex !== null}
          providers={providers}
        />
      ))}
    </group>
  );
}

interface GhostGroup {
  pos: Vec3;
  expecteds: Block[];
  pointerSuffixes: (string | undefined)[];
  eventIndices: number[];
}

function groupByPosition(
  entries: { idx: number; view: AssertionView }[],
): GhostGroup[] {
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
    base instanceof MeshStandardMaterial
      ? base.clone()
      : (base as MeshStandardMaterial).clone();
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
