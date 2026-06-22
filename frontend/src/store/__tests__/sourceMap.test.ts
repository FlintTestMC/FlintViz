import { describe, expect, it } from "vitest";

import type { Replay, TickFrame } from "../../api/types";
import {
  buildPosSourceMap,
  buildSourceIndices,
  pointerForEvent,
  pointerForTick,
} from "../sourceMap";
import { posKey } from "../world";

function makeReplay(frames: TickFrame[], sourceMap: Replay["source_map"]): Replay {
  return {
    name: "t",
    cleanup_region: null,
    initial_player: { inventory: {}, selected_hotbar: 1, game_mode: "Creative" },
    max_tick: frames.length > 0 ? frames[frames.length - 1]!.tick : 0,
    frames,
    breakpoints: [],
    source_map: sourceMap,
  };
}

describe("buildSourceIndices", () => {
  it("indexes spans by tick + event_index and reverse-maps to ticks", () => {
    const replay = makeReplay(
      [],
      [
        { tick: 1, event_index: 0, json_pointer: "/timeline/0" },
        { tick: 2, event_index: 0, json_pointer: "/timeline/1" },
        { tick: 2, event_index: 1, json_pointer: "/timeline/1" },
        { tick: 5, event_index: 0, json_pointer: "/timeline/0" },
      ],
    );
    const idx = buildSourceIndices(replay);

    expect(pointerForEvent(idx, 1, 0)).toBe("/timeline/0");
    expect(pointerForEvent(idx, 2, 1)).toBe("/timeline/1");
    expect(pointerForEvent(idx, 99, 0)).toBeNull();

    // suffix composes with the resolved base pointer (#0041).
    expect(pointerForEvent(idx, 2, 1, "/is/2")).toBe("/timeline/1/is/2");
    expect(pointerForEvent(idx, 2, 1, undefined)).toBe("/timeline/1");
    expect(pointerForEvent(idx, 99, 0, "/is/0")).toBeNull();

    expect(pointerForTick(idx, 2)).toBe("/timeline/1");

    expect(Array.from(idx.pointerToTicks.get("/timeline/0")!)).toEqual([1, 5]);
    expect(idx.pointerToTicks.get("/timeline/1")!.size).toBe(1);
  });

  it("returns empty indices for null replay", () => {
    const idx = buildSourceIndices(null);
    expect(pointerForEvent(idx, 0, 0)).toBeNull();
    expect(idx.pointerToTicks.size).toBe(0);
  });
});

describe("buildPosSourceMap", () => {
  it("attributes fill positions to the same eventIndex", () => {
    const replay = makeReplay(
      [
        {
          tick: 1,
          events: [
            {
              kind: "fill",
              region: { min: [0, 0, 0], max: [1, 0, 1] },
              block: { id: "minecraft:stone" },
            },
          ],
        },
      ],
      [],
    );
    const map = buildPosSourceMap(replay, 1);
    expect(map.size).toBe(4);
    expect(map.get(posKey([0, 0, 0]))).toEqual({ tick: 1, eventIndex: 0 });
    expect(map.get(posKey([1, 0, 1]))).toEqual({ tick: 1, eventIndex: 0 });
  });

  it("overwrites earlier writes with later ones (last touched wins)", () => {
    const replay = makeReplay(
      [
        {
          tick: 1,
          events: [
            { kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
          ],
        },
        {
          tick: 3,
          events: [
            { kind: "place", pos: [0, 0, 0], block: { id: "minecraft:dirt" } },
          ],
        },
      ],
      [],
    );
    const at1 = buildPosSourceMap(replay, 1).get(posKey([0, 0, 0]));
    expect(at1).toEqual({ tick: 1, eventIndex: 0 });
    const at3 = buildPosSourceMap(replay, 3).get(posKey([0, 0, 0]));
    expect(at3).toEqual({ tick: 3, eventIndex: 0 });
  });

  it("ignores non-block events", () => {
    const replay = makeReplay(
      [
        {
          tick: 1,
          events: [
            { kind: "select_hotbar", slot: 3 },
            { kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
          ],
        },
      ],
      [],
    );
    const map = buildPosSourceMap(replay, 1);
    expect(map.size).toBe(1);
    expect(map.get(posKey([0, 0, 0]))).toEqual({ tick: 1, eventIndex: 1 });
  });

  it("ignores assertion events", () => {
    const replay = makeReplay(
      [
        {
          tick: 1,
          events: [
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
            { kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
          ],
        },
      ],
      [],
    );
    const map = buildPosSourceMap(replay, 1);
    expect(map.size).toBe(1);
    expect(map.get(posKey([0, 0, 0]))).toEqual({ tick: 1, eventIndex: 1 });
  });
});
