import { useEffect, useMemo, useState } from "react";
import { BoxGeometry, EdgesGeometry } from "three";

import type { Aabb, Vec3 } from "../api/types";
import { useReplayStore } from "../store/replay";

const PULSE_MS = 600;

// One-shot pulse on tick change for the blocks affected by the new tick's
// `block_diff`. Mounted under `<SceneRoot>` so #0036's scene rotation rotates
// highlights with the world. Skipped during playback to avoid lag (#0029).
//
// Each pulse is a fresh React subtree keyed on the tick + a monotonic counter
// so re-entering the same tick (e.g. scrub left then right) restarts the
// animation; existing pulses unmount on key change.
export default function Highlights() {
  const tick = useReplayStore((s) => s.tick);
  const frames = useReplayStore((s) => s.replay?.frames ?? null);
  const playback = useReplayStore((s) => s.playback);

  const frame = useMemo(() => {
    if (!frames) return null;
    return frames.find((f) => f.tick === tick) ?? null;
  }, [frames, tick]);

  // Bump on every tick change so re-pulsing works even when the same tick is
  // re-entered (the dependency changes via tick itself, but a fresh key also
  // forces full subtree remount so timers start clean).
  const [pulseId, setPulseId] = useState(0);
  useEffect(() => {
    setPulseId((n) => n + 1);
  }, [tick]);

  if (!frame || playback === "playing") return null;

  const cubes: { pos: Vec3; color: string }[] = [];
  for (const change of frame.block_diff) {
    cubes.push({
      pos: change.pos,
      color: change.kind === "set" ? "#4ade80" : "#f87171",
    });
  }

  const fills: Aabb[] = [];
  for (const action of frame.actions) {
    if (action.kind === "fill") fills.push(action.region);
  }

  return (
    <group key={pulseId}>
      {cubes.map((c, i) => (
        <HighlightCube
          key={`c${i}`}
          pos={c.pos}
          color={c.color}
        />
      ))}
      {fills.map((region, i) => (
        <HighlightFill key={`f${i}`} region={region} />
      ))}
    </group>
  );
}

function HighlightCube({ pos, color }: { pos: Vec3; color: string }) {
  const [opacity, setOpacity] = useState(0.6);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / PULSE_MS);
      // Ease out: bright → transparent.
      setOpacity(0.6 * (1 - t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (opacity <= 0.01) return null;

  return (
    <mesh position={[pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5]}>
      <boxGeometry args={[1.05, 1.05, 1.05]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

function HighlightFill({ region }: { region: Aabb }) {
  const [opacity, setOpacity] = useState(0.9);

  const dims = useMemo(() => {
    const dx = region.max[0] - region.min[0] + 1;
    const dy = region.max[1] - region.min[1] + 1;
    const dz = region.max[2] - region.min[2] + 1;
    const cx = (region.min[0] + region.max[0] + 1) / 2;
    const cy = (region.min[1] + region.max[1] + 1) / 2;
    const cz = (region.min[2] + region.max[2] + 1) / 2;
    return { size: [dx, dy, dz] as const, center: [cx, cy, cz] as const };
  }, [region]);

  const edges = useMemo(() => {
    const box = new BoxGeometry(dims.size[0], dims.size[1], dims.size[2]);
    const e = new EdgesGeometry(box);
    box.dispose();
    return e;
  }, [dims]);

  useEffect(() => {
    return () => {
      edges.dispose();
    };
  }, [edges]);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / PULSE_MS);
      setOpacity(0.9 * (1 - t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (opacity <= 0.01) return null;

  return (
    <lineSegments position={[dims.center[0], dims.center[1], dims.center[2]]}>
      <primitive object={edges} attach="geometry" />
      <lineBasicMaterial color="#22d3ee" transparent opacity={opacity} />
    </lineSegments>
  );
}
