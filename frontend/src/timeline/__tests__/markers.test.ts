import { describe, expect, it } from "vitest";

import type { Replay, TickEvent, TickFrame } from "../../api/types";
import { buildMarkers, summariseFrame } from "../markers";

function frame(tick: number, events: TickEvent[]): TickFrame {
  return { tick, events };
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
      frame(1, [
        { kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
      ]),
      frame(2, []),
      frame(3, [
        {
          kind: "assert",
          views: [
            {
              kind: "block",
              position: [0, 0, 0],
              expected: { id: "minecraft:stone" },
            },
          ],
        },
      ]),
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
      frame(5, [
        { kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
        {
          kind: "assert",
          views: [
            {
              kind: "block",
              position: [0, 0, 0],
              expected: { id: "minecraft:stone" },
            },
          ],
        },
      ]),
    ]);
    const m = buildMarkers(r)[0]!;
    expect(m.kind).toBe("action");
    expect(m.hasMultipleEvents).toBe(true);
  });

  it("flags single-event ticks as not multi-event", () => {
    const r = replay([
      frame(1, [
        { kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
      ]),
    ]);
    expect(buildMarkers(r)[0]?.hasMultipleEvents).toBe(false);
  });
});

describe("summariseFrame", () => {
  it("formats place actions", () => {
    const text = summariseFrame(
      frame(1, [
        { kind: "place", pos: [0, 100, 0], block: { id: "minecraft:stone" } },
      ]),
    );
    expect(text).toBe("place stone @ (0,100,0)");
  });

  it("groups BlockSpec::Multiple assertions at the same position", () => {
    const text = summariseFrame(
      frame(1, [
        {
          kind: "assert",
          views: [
            {
              kind: "block",
              position: [0, 0, 0],
              expected: { id: "minecraft:stone" },
            },
            {
              kind: "block",
              position: [0, 0, 0],
              expected: { id: "minecraft:dirt" },
            },
          ],
        },
      ]),
    );
    expect(text).toBe("expect stone OR dirt @ (0,0,0)");
  });

  it("formats inventory empty assertions", () => {
    const text = summariseFrame(
      frame(1, [
        {
          kind: "assert",
          views: [{ kind: "inventory", slot: "hotbar2", expected: null }],
        },
      ]),
    );
    expect(text).toBe("expect empty @ hotbar2");
  });

  it("collapses long action lists", () => {
    const text = summariseFrame(
      frame(1, [
        { kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
        { kind: "place", pos: [1, 0, 0], block: { id: "minecraft:stone" } },
        { kind: "place", pos: [2, 0, 0], block: { id: "minecraft:stone" } },
        { kind: "place", pos: [3, 0, 0], block: { id: "minecraft:stone" } },
      ]),
    );
    expect(text).toContain("+2 more");
  });
});
