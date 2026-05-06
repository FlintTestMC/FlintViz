import { describe, expect, it } from "vitest";

import type { Replay, TickFrame } from "../../api/types";
import { buildMarkers, summariseFrame } from "../markers";

function frame(overrides: Partial<TickFrame>): TickFrame {
  return {
    tick: 0,
    actions: [],
    block_diff: [],
    inventory_diff: null,
    assertions: [],
    ...overrides,
  };
}

function replay(frames: TickFrame[], breakpoints: number[] = []): Replay {
  return {
    name: "t",
    cleanup_region: null,
    initial_player: { inventory: {}, selected_hotbar: 1, game_mode: "Creative" },
    max_tick: Math.max(0, ...frames.map((f) => f.tick)) + 1,
    frames,
    breakpoints,
    source_map: [],
  };
}

describe("buildMarkers", () => {
  it("returns [] for null replay", () => {
    expect(buildMarkers(null)).toEqual([]);
  });

  it("emits one marker per event-bearing tick", () => {
    const r = replay([
      frame({
        tick: 1,
        actions: [{ kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } }],
      }),
      frame({ tick: 2 }), // empty — no marker (defensive: this won't normally land in `frames`)
      frame({
        tick: 3,
        assertions: [
          { kind: "block", position: [0, 0, 0], expected: { id: "minecraft:stone" } },
        ],
      }),
    ]);
    const markers = buildMarkers(r);
    expect(markers).toHaveLength(2);
    expect(markers[0]?.tick).toBe(1);
    expect(markers[0]?.kind).toBe("action");
    expect(markers[1]?.tick).toBe(3);
    expect(markers[1]?.kind).toBe("assertion");
  });

  it("classifies a frame with both actions and assertions as action", () => {
    const r = replay([
      frame({
        tick: 5,
        actions: [{ kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } }],
        assertions: [
          { kind: "block", position: [0, 0, 0], expected: { id: "minecraft:stone" } },
        ],
      }),
    ]);
    expect(buildMarkers(r)[0]?.kind).toBe("action");
  });
});

describe("summariseFrame", () => {
  it("formats place actions", () => {
    const text = summariseFrame(
      frame({
        tick: 1,
        actions: [{ kind: "place", pos: [0, 100, 0], block: { id: "minecraft:stone" } }],
      }),
    );
    expect(text).toBe("place stone @ (0,100,0)");
  });

  it("groups BlockSpec::Multiple assertions at the same position", () => {
    const text = summariseFrame(
      frame({
        tick: 1,
        assertions: [
          { kind: "block", position: [0, 0, 0], expected: { id: "minecraft:stone" } },
          { kind: "block", position: [0, 0, 0], expected: { id: "minecraft:dirt" } },
        ],
      }),
    );
    expect(text).toBe("expect stone OR dirt @ (0,0,0)");
  });

  it("formats inventory empty assertions", () => {
    const text = summariseFrame(
      frame({
        tick: 1,
        assertions: [
          { kind: "inventory", slot: "hotbar2", expected: null },
        ],
      }),
    );
    expect(text).toBe("expect empty @ hotbar2");
  });

  it("collapses long action lists", () => {
    const text = summariseFrame(
      frame({
        tick: 1,
        actions: [
          { kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
          { kind: "place", pos: [1, 0, 0], block: { id: "minecraft:stone" } },
          { kind: "place", pos: [2, 0, 0], block: { id: "minecraft:stone" } },
          { kind: "place", pos: [3, 0, 0], block: { id: "minecraft:stone" } },
        ],
      }),
    );
    expect(text).toContain("+2 more");
  });
});
