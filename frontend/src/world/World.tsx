import { type ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  InstancedMesh,
  Matrix4,
  type BufferGeometry,
  type Material,
} from "three";

import type { Vec3 } from "../api/types";
import { useCrosslinkStore } from "../store/crosslink";
import { useReplayStore } from "../store/replay";
import {
  buildPosSourceMap,
  pointerForEvent,
} from "../store/sourceMap";
import { posKey } from "../store/world";
import type { BlockProviders } from "./atlas";
import { buildBlockMesh } from "./blockAdapter";
import { groupByState, type InstanceGroup } from "./instancing";
import { useBlockProviders } from "./useBlockProviders";

// Declarative R3F renderer for `store.worldState`. Groups blocks by
// `(id, propsKey)` and emits one `<instancedMesh>` per group. Re-renders
// automatically when the store commits a new `worldState` Map (referential
// equality is the trigger; see #0018).
export default function World() {
  const worldState = useReplayStore((s) => s.worldState);
  const providers = useBlockProviders();

  const groups = useMemo(() => groupByState(worldState), [worldState]);

  // Click → editor reveal (#0032). Compute the position-source map lazily on
  // click using the *current* tick, mirroring the engine's forward-application
  // semantics. Cheap enough to recompute per click — avoids cache invalidation
  // headaches when the user scrubs or edits.
  const onInstanceClick = useCallback((position: Vec3) => {
    const { replay, tick, sourceIndices } = useReplayStore.getState();
    if (!replay) return;
    const posSource = buildPosSourceMap(replay, tick);
    const entry = posSource.get(posKey(position));
    if (!entry) return;
    const pointer = pointerForEvent(sourceIndices, entry.tick, entry.eventIndex);
    if (!pointer) return;
    useCrosslinkStore.getState().revealPointer(pointer);
  }, []);

  if (!providers || groups.length === 0) return null;

  return (
    <group>
      {groups.map((g) => (
        <InstanceGroupMesh
          key={g.groupKey}
          group={g}
          providers={providers}
          onInstanceClick={onInstanceClick}
        />
      ))}
    </group>
  );
}

function InstanceGroupMesh({
  group,
  providers,
  onInstanceClick,
}: {
  group: InstanceGroup;
  providers: BlockProviders;
  onInstanceClick: (position: Vec3) => void;
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
      onInstanceClick={onInstanceClick}
    />
  );
}

function InstancedNode({
  geometry,
  material,
  capacity,
  positions,
  onInstanceClick,
}: {
  geometry: BufferGeometry;
  material: Material;
  capacity: number;
  positions: Vec3[];
  onInstanceClick: (position: Vec3) => void;
}) {
  const ref = useRef<InstancedMesh>(null);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      const id = e.instanceId;
      if (id === undefined || id < 0 || id >= positions.length) return;
      // R3F propagates clicks to every intersected mesh by default — only the
      // closest hit (smallest distance) is the visually clicked block. Stop
      // propagation so deeper instances behind the front one don't all fire.
      e.stopPropagation();
      const pos = positions[id]!;
      onInstanceClick(pos);
    },
    [positions, onInstanceClick],
  );

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
      onClick={handleClick}
    />
  );
}

function ceilPow2(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}
