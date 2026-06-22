import { describe, expect, it } from "vitest";

import { parseBlockDefaults } from "../blockDefaults";

describe("parseBlockDefaults", () => {
  it("namespaces ids and maps Java constants to serialized names", () => {
    const out = parseBlockDefaults({
      blocks: [
        {
          name: "oak_stairs",
          default_properties: [
            "HORIZONTAL_FACING=north",
            "HALF=bottom",
            "STAIRS_SHAPE=straight",
            "WATERLOGGED=false",
          ],
        },
        {
          name: "wheat",
          default_properties: ["AGE_7=0"],
        },
        {
          name: "redstone_wire",
          default_properties: ["EAST_REDSTONE=none", "POWER=0"],
        },
      ],
    });

    expect(out["minecraft:oak_stairs"]).toEqual({
      facing: "north",
      half: "bottom",
      shape: "straight",
      waterlogged: "false",
    });
    expect(out["minecraft:wheat"]).toEqual({ age: "0" });
    expect(out["minecraft:redstone_wire"]).toEqual({
      east: "none",
      power: "0",
    });
  });

  it("falls back to lowercase for unmapped constants", () => {
    const out = parseBlockDefaults({
      blocks: [{ name: "future_block", default_properties: ["SOME_NEW_PROP=x"] }],
    });
    expect(out["minecraft:future_block"]).toEqual({ some_new_prop: "x" });
  });

  it("tolerates a missing/empty blocks array and malformed entries", () => {
    expect(parseBlockDefaults({})).toEqual({});
    expect(
      parseBlockDefaults({
        blocks: [
          { name: "no_props" },
          { name: "bad", default_properties: ["NO_EQUALS_SIGN"] },
        ],
      }),
    ).toEqual({ "minecraft:no_props": {}, "minecraft:bad": {} });
  });
});
