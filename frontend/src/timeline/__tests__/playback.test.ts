import { describe, expect, it } from "vitest";

import type { Replay, TickFrame } from "../../api/types";
import { nextBreakpoint, nextEventTick, prevEventTick } from "../playback";

function frame(tick: number, hasEvent = true): TickFrame {
  return {
    tick,
    actions: hasEvent
      ? [{ kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } }]
      : [],
    block_diff: [],
    inventory_diff: null,
    assertions: [],
  };
}

function replay(frames: TickFrame[], breakpoints: number[] = []): Replay {
  return {
    name: "t",
    cleanup_region: null,
    initial_player: { inventory: {}, selected_hotbar: 1, game_mode: "Creative" },
    max_tick: 20,
    frames,
    breakpoints,
    source_map: [],
  };
}

describe("nextEventTick", () => {
  it("skips empty frames between events", () => {
    const r = replay([frame(1), frame(5), frame(10)]);
    expect(nextEventTick(r, 1)).toBe(5);
    expect(nextEventTick(r, 5)).toBe(10);
  });

  it("falls back to tick+1 (clamped) when no later event", () => {
    const r = replay([frame(1)]);
    expect(nextEventTick(r, 1)).toBe(2);
    expect(nextEventTick(r, 20)).toBe(20);
  });
});

describe("prevEventTick", () => {
  it("returns the latest event-bearing tick before current", () => {
    const r = replay([frame(1), frame(5), frame(10)]);
    expect(prevEventTick(r, 10)).toBe(5);
    expect(prevEventTick(r, 5)).toBe(1);
  });

  it("falls back to tick-1 (clamped) before any event", () => {
    const r = replay([frame(5)]);
    expect(prevEventTick(r, 3)).toBe(2);
    expect(prevEventTick(r, 0)).toBe(0);
  });
});

describe("nextBreakpoint", () => {
  it("returns the first breakpoint strictly after tick", () => {
    const r = replay([], [3, 7, 11]);
    expect(nextBreakpoint(r, 0)).toBe(3);
    expect(nextBreakpoint(r, 3)).toBe(7);
    expect(nextBreakpoint(r, 11)).toBeNull();
  });
});
