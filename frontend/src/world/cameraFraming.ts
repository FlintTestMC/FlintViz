import type { Aabb, Block, EntitySnapshot, Vec3 } from "../api/types";
import type { PosKey } from "../store/world";

export interface Framing {
  target: Vec3;
  position: Vec3;
}

// Diagonal framing direction; matched to the default camera angle in Scene.tsx.
const DIR: Vec3 = [1, 1, 1];
const DIR_LEN = Math.sqrt(3);

// Distance multiplier on the AABB diagonal. Tuned to keep the bounding box
// comfortably inside the fov-50 frustum without leaving too much margin.
const DISTANCE_FACTOR = 1.6;
const MIN_DISTANCE = 4;

export function computeFraming(
  cleanup: Aabb | null,
  worldState: Map<PosKey, Block>,
  entityState: Map<string, EntitySnapshot> = new Map(),
): Framing | null {
  const aabb = cleanup ?? contentBounds(worldState, entityState);
  if (!aabb) return null;

  const { min, max } = aabb;
  // Visual center: each block occupies a unit cube whose corners are at
  // `position` and `position + 1`, so the inclusive AABB centre is
  // `(min + max + 1) / 2`. Same formula #0025 uses for the wireframe and
  // #0036 uses for the rotation pivot.
  const cx = (min[0] + max[0] + 1) / 2;
  const cy = (min[1] + max[1] + 1) / 2;
  const cz = (min[2] + max[2] + 1) / 2;

  const dx = max[0] - min[0] + 1;
  const dy = max[1] - min[1] + 1;
  const dz = max[2] - min[2] + 1;
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const dist = Math.max(MIN_DISTANCE, diag * DISTANCE_FACTOR);

  const k = dist / DIR_LEN;
  return {
    target: [cx, cy, cz],
    position: [cx + DIR[0] * k, cy + DIR[1] * k, cz + DIR[2] * k],
  };
}

function contentBounds(
  worldState: Map<PosKey, Block>,
  entityState: Map<string, EntitySnapshot>,
): Aabb | null {
  if (worldState.size === 0 && entityState.size === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const key of worldState.keys()) {
    const parts = key.split(",");
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  for (const entity of entityState.values()) {
    const [x, y, z] = entity.pos;
    minX = Math.min(minX, Math.floor(x - 0.5));
    minY = Math.min(minY, Math.floor(y));
    minZ = Math.min(minZ, Math.floor(z - 0.5));
    maxX = Math.max(maxX, Math.ceil(x + 0.5) - 1);
    maxY = Math.max(maxY, Math.ceil(y + 1.8) - 1);
    maxZ = Math.max(maxZ, Math.ceil(z + 0.5) - 1);
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
