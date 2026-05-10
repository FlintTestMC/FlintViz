// Renders the visual signal for a flint-steel failure: ghost-rendered expected
// block + solid actual block + red outline cube at each failing coordinate.
//
// Mounted under `<SceneRoot>` so the scene rotation (#0036) rotates the
// overlay with the world. Hidden until the user has reached (or scrubbed past)
// the failing tick — earlier ticks render the static replay clean.

import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  EdgesGeometry,
  MeshStandardMaterial,
  type BufferGeometry,
  type Material,
} from "three";

import type { Block } from "../api/types";
import { failureCoordinate, useFailureStore } from "../store/failure";
import { useReplayStore } from "../store/replay";
import { buildBlockMesh, getSharedMaterial } from "./blockAdapter";
import type { BlockProviders } from "./atlas";
import { useBlockProviders } from "./useBlockProviders";

interface OverlayItem {
  index: number;
  pos: [number, number, number];
  tick: number;
  expected: Block | null;
  actual: Block | null;
}

export default function FailureOverlay() {
  const status = useFailureStore((s) => s.status);
  const visible = useFailureStore((s) => s.visible);
  const tick = useReplayStore((s) => s.tick);
  const providers = useBlockProviders();

  const items = useMemo<OverlayItem[]>(() => {
    if (status.kind !== "loaded" || !visible) return [];
    return status.payload.failures
      .map<OverlayItem | null>((f, i) => {
        const pos = failureCoordinate(f);
        if (!pos) return null;
        return {
          index: i,
          pos,
          tick: f.tick,
          expected: extractBlock(f.expected),
          actual: extractBlock(f.actual),
        };
      })
      .filter((x): x is OverlayItem => x !== null);
  }, [status, visible]);

  if (!providers || items.length === 0) return null;

  return (
    <group>
      {items.map((item) =>
        // Only render once the scrubber has reached this failure's tick — the
        // overlay represents *what would happen at this tick*, not the static
        // initial state.
        tick >= item.tick ? (
          <FailureMark
            key={item.index}
            item={item}
            providers={providers}
          />
        ) : null,
      )}
    </group>
  );
}

function extractBlock(info: import("../api/types").InfoType): Block | null {
  if ("Block" in info) return info.Block;
  if ("Blocks" in info && info.Blocks.length > 0) return info.Blocks[0]!;
  return null;
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

// One "expected ghost" material shared per BlockProviders, same caching trick
// as AssertionGhosts.
const ghostMaterialCache = new WeakMap<BlockProviders, Material>();

function getGhostMaterial(providers: BlockProviders): Material {
  const cached = ghostMaterialCache.get(providers);
  if (cached) return cached;
  const base = getSharedMaterial(providers) as MeshStandardMaterial;
  const clone = base.clone();
  clone.transparent = true;
  clone.opacity = 0.4;
  clone.depthWrite = false;
  ghostMaterialCache.set(providers, clone);
  return clone;
}

function FailureMark({
  item,
  providers,
}: {
  item: OverlayItem;
  providers: BlockProviders;
}) {
  const expectedMesh = useMemo(() => {
    if (!item.expected) return null;
    return buildBlockMesh(
      item.expected.id,
      extractProps(item.expected),
      providers,
    );
  }, [item.expected, providers]);

  const actualMesh = useMemo(() => {
    if (!item.actual) return null;
    return buildBlockMesh(
      item.actual.id,
      extractProps(item.actual),
      providers,
    );
  }, [item.actual, providers]);

  // Geometries we own — dispose on unmount / re-key.
  const expectedGeomRef = useRef<BufferGeometry | null>(null);
  const actualGeomRef = useRef<BufferGeometry | null>(null);
  expectedGeomRef.current = expectedMesh?.geometry ?? null;
  actualGeomRef.current = actualMesh?.geometry ?? null;
  useEffect(() => {
    const eg = expectedGeomRef.current;
    const ag = actualGeomRef.current;
    return () => {
      eg?.dispose();
      ag?.dispose();
    };
  }, [expectedMesh, actualMesh]);

  // Red wireframe cube around the failing block — sized larger than the unit
  // block so the outline reads as a deliberate marker (not a tight border)
  // and stays visible from any camera distance.
  const outlineEdges = useMemo(() => {
    const box = new BoxGeometry(1.3, 1.3, 1.3);
    const edges = new EdgesGeometry(box);
    box.dispose();
    return edges;
  }, []);
  useEffect(() => () => outlineEdges.dispose(), [outlineEdges]);

  const ghostMat = getGhostMaterial(providers);
  const sharedMat = getSharedMaterial(providers);
  const [x, y, z] = item.pos;

  return (
    <group position={[x, y, z]}>
      {/* Expected — translucent ghost at full unit cube. */}
      {expectedMesh ? (
        <mesh
          geometry={expectedMesh.geometry}
          material={ghostMat}
          dispose={null}
        />
      ) : null}
      {/* Actual — solid, scaled down 15% so it sits visibly inside the ghost
          and z-fighting between the two passes is avoided. */}
      {actualMesh ? (
        <group position={[0.5, 0.5, 0.5]} scale={[0.85, 0.85, 0.85]}>
          <group position={[-0.5, -0.5, -0.5]}>
            <mesh
              geometry={actualMesh.geometry}
              material={sharedMat}
              dispose={null}
            />
          </group>
        </group>
      ) : null}
      {/* Red outline cube — anchors the failure visually from any angle. */}
      <lineSegments position={[0.5, 0.5, 0.5]}>
        <primitive object={outlineEdges} attach="geometry" />
        <lineBasicMaterial
          color="#ef4444"
          transparent
          opacity={0.95}
          depthTest={false}
        />
      </lineSegments>
    </group>
  );
}
