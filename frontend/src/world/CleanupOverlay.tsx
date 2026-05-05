import { useEffect, useMemo } from "react";
import { BoxGeometry, EdgesGeometry } from "three";

import { useReplayStore } from "../store/replay";
import { useOverlayStore } from "./overlayStore";

// Translucent wire-frame box around `replay.cleanup_region`. Mounted under
// `<SceneRoot>` so #0036's scene rotation rotates the wireframe with the
// blocks. Hidden when the user toggles it off via the scene-overlay toolbar.
export default function CleanupOverlay() {
  const region = useReplayStore((s) => s.replay?.cleanup_region ?? null);
  const visible = useOverlayStore((s) => s.cleanupVisible);

  // Each block occupies a unit cube whose corners are at `pos` and `pos + 1`,
  // so the cleanup region spans `min .. max + 1`. Center sits at the inclusive
  // AABB midpoint — same `(min + max + 1) / 2` formula #0024 uses for camera
  // framing and #0036 uses for rotation pivot.
  const dims = useMemo(() => {
    if (!region) return null;
    const dx = region.max[0] - region.min[0] + 1;
    const dy = region.max[1] - region.min[1] + 1;
    const dz = region.max[2] - region.min[2] + 1;
    const cx = (region.min[0] + region.max[0] + 1) / 2;
    const cy = (region.min[1] + region.max[1] + 1) / 2;
    const cz = (region.min[2] + region.max[2] + 1) / 2;
    return { size: [dx, dy, dz] as const, center: [cx, cy, cz] as const };
  }, [region]);

  // Build EdgesGeometry once per dimension change and dispose the temporary
  // BoxGeometry immediately. We own the EdgesGeometry's lifetime and clean it
  // up on unmount / re-keying via the effect below.
  const edges = useMemo(() => {
    if (!dims) return null;
    const box = new BoxGeometry(dims.size[0], dims.size[1], dims.size[2]);
    const e = new EdgesGeometry(box);
    box.dispose();
    return e;
  }, [dims]);

  useEffect(() => {
    return () => {
      edges?.dispose();
    };
  }, [edges]);

  if (!region || !visible || !dims || !edges) return null;

  return (
    <lineSegments position={[dims.center[0], dims.center[1], dims.center[2]]}>
      <primitive object={edges} attach="geometry" />
      <lineBasicMaterial color="#5cf" transparent opacity={0.6} />
    </lineSegments>
  );
}
