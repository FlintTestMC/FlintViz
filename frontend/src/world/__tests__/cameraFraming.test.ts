import { describe, expect, it } from "vitest";

import type { Block } from "../../api/types";
import { posKey, type PosKey } from "../../store/world";
import { computeFraming } from "../cameraFraming";

function world(entries: Array<[[number, number, number], Block]>): Map<PosKey, Block> {
  const m = new Map<PosKey, Block>();
  for (const [pos, block] of entries) m.set(posKey(pos), block);
  return m;
}

const STONE: Block = { id: "minecraft:stone" };

describe("computeFraming", () => {
  it("returns null when no cleanup region and the world is empty", () => {
    expect(computeFraming(null, new Map())).toBeNull();
  });

  it("centers on the cleanup region using the inclusive AABB midpoint", () => {
    const f = computeFraming({ min: [0, 0, 0], max: [3, 3, 3] }, new Map())!;
    // (0+3+1)/2 = 2 on every axis.
    expect(f.target).toEqual([2, 2, 2]);
    // Camera sits diagonally outside the region at +x +y +z.
    expect(f.position[0]).toBeGreaterThan(f.target[0]);
    expect(f.position[1]).toBeGreaterThan(f.target[1]);
    expect(f.position[2]).toBeGreaterThan(f.target[2]);
  });

  it("falls back to block bounds when no cleanup region is given", () => {
    const f = computeFraming(
      null,
      world([
        [[0, 0, 0], STONE],
        [[4, 2, 2], STONE],
      ]),
    )!;
    expect(f.target).toEqual([(0 + 4 + 1) / 2, (0 + 2 + 1) / 2, (0 + 2 + 1) / 2]);
  });

  it("falls back to entity bounds when no blocks or cleanup exist", () => {
    const f = computeFraming(
      null,
      new Map(),
      new Map([
        [
          "zombie",
          {
            alias: "zombie",
            entity_type: "minecraft:zombie",
            pos: [10, 64, -3],
            rot: null,
            nbt: null,
          },
        ],
      ]),
    )!;
    expect(f.target[0]).toBeCloseTo(10);
    expect(f.target[1]).toBeCloseTo(65);
    expect(f.target[2]).toBeCloseTo(-3);
  });

  it("prefers the cleanup region over block bounds", () => {
    const f = computeFraming(
      { min: [-2, -2, -2], max: [2, 2, 2] },
      world([[[100, 100, 100], STONE]]),
    )!;
    expect(f.target).toEqual([0.5, 0.5, 0.5]);
  });

  it("scales camera distance with the AABB diagonal", () => {
    const small = computeFraming({ min: [0, 0, 0], max: [1, 1, 1] }, new Map())!;
    const big = computeFraming({ min: [0, 0, 0], max: [40, 40, 40] }, new Map())!;
    const smallOffset = small.position[0] - small.target[0];
    const bigOffset = big.position[0] - big.target[0];
    expect(bigOffset).toBeGreaterThan(smallOffset);
  });

  it("respects the minimum distance for tiny regions", () => {
    const f = computeFraming({ min: [0, 0, 0], max: [0, 0, 0] }, new Map())!;
    const offset = f.position[0] - f.target[0];
    // Min distance is 4, projected onto the (1,1,1)/√3 direction → 4/√3.
    expect(offset).toBeGreaterThanOrEqual(4 / Math.sqrt(3) - 1e-6);
  });
});
