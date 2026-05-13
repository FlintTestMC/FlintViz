import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import {
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from "three";

import type { AssertionView, Block, TickEvent, Vec3 } from "../api/types";
import { useReplayStore } from "../store/replay";
import type { BlockProviders } from "./atlas";
import { buildBlockMesh, getSharedMaterial } from "./blockAdapter";
import { useBlockProviders } from "./useBlockProviders";

// Translucent "expected block" overlay for the current tick. Walks every
// `assert` event's `views` and renders one ghost per block-kind view, grouped
// by position. When the event picker (#0040) has selected event N: render only
// that single assert event's block views (or nothing if N is not an assert).
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
    const views: AssertionView[] = [];
    for (const ev of events) {
      if (ev.kind === "assert") views.push(...ev.views);
    }
    return groupByPosition(views);
  }, [frames, tick, eventIndex]);

  if (!providers || groups.length === 0) return null;

  return (
    <group>
      {groups.map((g) => (
        <Ghost
          key={`${g.pos[0]},${g.pos[1]},${g.pos[2]}`}
          pos={g.pos}
          expected={g.expected}
          alternativeCount={g.alternativeCount}
          providers={providers}
        />
      ))}
    </group>
  );
}

interface GhostGroup {
  pos: Vec3;
  expected: Block;
  alternativeCount: number;
}

function groupByPosition(views: AssertionView[]): GhostGroup[] {
  const byKey = new Map<string, GhostGroup>();
  for (const a of views) {
    if (a.kind !== "block") continue;
    const key = `${a.position[0]},${a.position[1]},${a.position[2]}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.alternativeCount += 1;
    } else {
      byKey.set(key, {
        pos: a.position,
        expected: a.expected,
        alternativeCount: 1,
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

function Ghost({
  pos,
  expected,
  alternativeCount,
  providers,
}: {
  pos: Vec3;
  expected: Block;
  alternativeCount: number;
  providers: BlockProviders;
}) {
  const built = useMemo(
    () => buildBlockMesh(expected.id, extractProps(expected), providers),
    [expected, providers],
  );

  // Track the geometry we own and dispose it on unmount / change. The material
  // is shared (cached above) so we never dispose it here.
  const geomRef = useRef<BufferGeometry | null>(null);
  geomRef.current = built?.geometry ?? null;
  useEffect(() => {
    const g = geomRef.current;
    return () => {
      g?.dispose();
    };
  }, [built]);

  if (!built) return null;

  const ghostMat = getGhostMaterial(providers);
  const label = alternativeCount > 1 ? `asserted +${alternativeCount - 1}` : "asserted";

  return (
    <group position={[pos[0], pos[1], pos[2]]}>
      <mesh
        geometry={built.geometry}
        material={ghostMat}
        // Owning material lives outside R3F's disposal — keep it alive across
        // unmounts. Geometry disposal is handled by the effect above.
        dispose={null}
      />
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
