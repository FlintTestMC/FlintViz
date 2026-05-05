import { describe, expect, it } from "vitest";

import type { Block } from "../../api/types";
import { posKey, type PosKey } from "../../store/world";
import { groupByState } from "../instancing";

function world(entries: Array<[[number, number, number], Block]>): Map<PosKey, Block> {
  const m = new Map<PosKey, Block>();
  for (const [pos, block] of entries) m.set(posKey(pos), block);
  return m;
}

describe("groupByState", () => {
  it("returns no groups for an empty world", () => {
    expect(groupByState(new Map())).toEqual([]);
  });

  it("groups same id + same props into one group", () => {
    const groups = groupByState(
      world([
        [[0, 0, 0], { id: "minecraft:stone" }],
        [[1, 0, 0], { id: "minecraft:stone" }],
        [[2, 0, 0], { id: "minecraft:stone" }],
      ]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.blockId).toBe("minecraft:stone");
    expect(groups[0]!.positions).toHaveLength(3);
  });

  it("splits same id by differing props", () => {
    const groups = groupByState(
      world([
        [[0, 0, 0], { id: "minecraft:oak_stairs", facing: "east" }],
        [[1, 0, 0], { id: "minecraft:oak_stairs", facing: "west" }],
        [[2, 0, 0], { id: "minecraft:oak_stairs", facing: "east" }],
      ]),
    );
    expect(groups).toHaveLength(2);
    const east = groups.find((g) => g.props.facing === "east");
    const west = groups.find((g) => g.props.facing === "west");
    expect(east?.positions).toHaveLength(2);
    expect(west?.positions).toHaveLength(1);
  });

  it("treats prop key order as irrelevant", () => {
    const groups = groupByState(
      world([
        [[0, 0, 0], { id: "minecraft:lever", face: "floor", powered: "false" }],
        [[1, 0, 0], { id: "minecraft:lever", powered: "false", face: "floor" }],
      ]),
    );
    expect(groups).toHaveLength(1);
  });

  it("coerces non-string prop values to strings", () => {
    const groups = groupByState(
      world([[[0, 0, 0], { id: "minecraft:redstone_wire", power: 0 }]]),
    );
    expect(groups[0]!.props.power).toBe("0");
  });
});
