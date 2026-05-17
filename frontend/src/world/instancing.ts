import type { Block, Vec3 } from "../api/types";
import type { PosKey } from "../store/world";
import type { BlockDefaults } from "./blockDefaults";

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
  defaults: BlockDefaults = {},
): InstanceGroup[] {
  const groups = new Map<string, InstanceGroup>();

  for (const [posKey, block] of worldState) {
    const props = extractProps(block, defaults);
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
//
// `defaults` (#0048) are merged *underneath* the block's own props
// (`{ ...defaults, ...userProps }`) so a test that omits a property still
// renders in Minecraft's default state. Keys are emitted sorted so the group
// key stays stable — and a block with explicit `facing=north` collapses into
// the same group as a bare block defaulted to `facing=north`, which is correct
// since they render identically. Unknown ids contribute no defaults and pass
// through unchanged.
function extractProps(
  block: Block,
  defaults: BlockDefaults,
): Record<string, string> {
  const lookupId = block.id.includes(":")
    ? block.id
    : `minecraft:${block.id}`;
  const blockDefaults = defaults[lookupId] ?? defaults[block.id] ?? {};
  const merged: Record<string, string> = { ...blockDefaults };
  for (const k of Object.keys(block)) {
    if (k === "id") continue;
    const v = (block as Record<string, unknown>)[k];
    if (v == null) continue;
    merged[k] = String(v);
  }
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(merged).sort()) sorted[k] = merged[k]!;
  return sorted;
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
