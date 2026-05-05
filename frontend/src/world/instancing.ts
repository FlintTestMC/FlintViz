import type { Block, Vec3 } from "../api/types";
import type { PosKey } from "../store/world";

export interface InstanceGroup {
  groupKey: string;
  blockId: string;
  props: Record<string, string>;
  positions: Vec3[];
}

// Splits a `worldState` map into one group per `(blockId, propsKey)` pair so
// each group can be rendered as a single `<instancedMesh>` sharing geometry
// and material. The group key is stable across re-renders and across blocks
// with the same id+props in any order.
export function groupByState(
  worldState: Map<PosKey, Block>,
): InstanceGroup[] {
  const groups = new Map<string, InstanceGroup>();

  for (const [posKey, block] of worldState) {
    const props = extractProps(block);
    const groupKey = makeGroupKey(block.id, props);

    let group = groups.get(groupKey);
    if (!group) {
      group = { groupKey, blockId: block.id, props, positions: [] };
      groups.set(groupKey, group);
    }
    group.positions.push(parsePosKey(posKey));
  }

  return Array.from(groups.values());
}

// Builds the `Record<string, string>` deepslate expects, dropping `id` and
// coercing every property value to its string form (Rust replay engine emits
// strings already, but the wire `Block` type is permissive).
function extractProps(block: Block): Record<string, string> {
  const props: Record<string, string> = {};
  const keys = Object.keys(block).filter((k) => k !== "id").sort();
  for (const k of keys) {
    const v = (block as Record<string, unknown>)[k];
    if (v == null) continue;
    props[k] = String(v);
  }
  return props;
}

function makeGroupKey(
  blockId: string,
  sortedProps: Record<string, string>,
): string {
  return `${blockId}|${JSON.stringify(sortedProps)}`;
}

function parsePosKey(key: PosKey): Vec3 {
  const parts = key.split(",");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}
