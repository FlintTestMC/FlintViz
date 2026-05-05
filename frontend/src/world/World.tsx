import { useEffect, useMemo, useRef, useState } from "react";
import {
  InstancedMesh,
  Matrix4,
  type BufferGeometry,
  type Material,
} from "three";

import type { Vec3 } from "../api/types";
import { useReplayStore } from "../store/replay";
import { loadBlockProviders, type BlockProviders } from "./atlas";
import { buildBlockMesh } from "./blockAdapter";
import { groupByState, type InstanceGroup } from "./instancing";

// Declarative R3F renderer for `store.worldState`. Groups blocks by
// `(id, propsKey)` and emits one `<instancedMesh>` per group. Re-renders
// automatically when the store commits a new `worldState` Map (referential
// equality is the trigger; see #0018).
export default function World() {
  const worldState = useReplayStore((s) => s.worldState);
  const providers = useBlockProviders();

  const groups = useMemo(() => groupByState(worldState), [worldState]);

  if (!providers || groups.length === 0) return null;

  return (
    <group>
      {groups.map((g) => (
        <InstanceGroupMesh key={g.groupKey} group={g} providers={providers} />
      ))}
    </group>
  );
}

// Loads the cached block providers exactly once. Errors are surfaced via
// console for now; #0033 will replace this with a UI panel.
function useBlockProviders(): BlockProviders | null {
  const [providers, setProviders] = useState<BlockProviders | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadBlockProviders()
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch((err) => {
        console.error("World: failed to load block providers", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return providers;
}

function InstanceGroupMesh({
  group,
  providers,
}: {
  group: InstanceGroup;
  providers: BlockProviders;
}) {
  // Geometry is built once per group key and reused across position changes.
  // The shared material from blockAdapter is the same instance for every
  // block — never dispose it here.
  // groupKey already encodes id + props; rebuilding on those identities would
  // thrash geometry every render since `groupByState` returns fresh objects.
  const built = useMemo(
    () => buildBlockMesh(group.blockId, group.props, providers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group.groupKey, providers],
  );

  // Dispose geometry we own when the group disappears or its key changes.
  useEffect(() => {
    return () => {
      built?.geometry.dispose();
    };
  }, [built]);

  // Capacity buckets: round count up to a power of two so that small additions
  // don't reallocate the matrix buffer every tick. The InstancedMesh is
  // remounted only when the bucket grows.
  const capacity = useMemo(
    () => Math.max(8, ceilPow2(group.positions.length)),
    [group.positions.length],
  );

  if (!built) return null;

  return (
    <InstancedNode
      // Remount when the capacity bucket changes; the underlying geometry and
      // material survive because we keep our own refs to them.
      key={capacity}
      geometry={built.geometry}
      material={built.material}
      capacity={capacity}
      positions={group.positions}
    />
  );
}

function InstancedNode({
  geometry,
  material,
  capacity,
  positions,
}: {
  geometry: BufferGeometry;
  material: Material;
  capacity: number;
  positions: Vec3[];
}) {
  const ref = useRef<InstancedMesh>(null);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]!;
      m.makeTranslation(p[0], p[1], p[2]);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = positions.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, capacity]}
      // R3F's default disposal would also drop our shared geometry/material on
      // unmount. We manage their lifetimes manually above.
      dispose={null}
      frustumCulled={false}
    />
  );
}

function ceilPow2(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}
