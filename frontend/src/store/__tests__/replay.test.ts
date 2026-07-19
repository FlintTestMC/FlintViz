import { describe, expect, it } from "vitest";

import type { Replay, TickFrame } from "../../api/types";
import { useReplayStore } from "../replay";
import { posKey, rebuildAt } from "../world";

function makeReplay(overrides: Partial<Replay> = {}): Replay {
  const frames: TickFrame[] = [
    {
      tick: 1,
      events: [{ kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } }],
    },
    {
      tick: 3,
      events: [
        { kind: "place", pos: [1, 0, 0], block: { id: "minecraft:dirt" } },
        {
          kind: "set_slot",
          slot: "hotbar1",
          item: "minecraft:dirt",
          count: 63,
        },
        { kind: "select_hotbar", slot: 2 },
      ],
    },
    {
      tick: 5,
      events: [{ kind: "remove", pos: [0, 0, 0] }],
    },
  ];

  return {
    name: "synthetic",
    cleanup_region: { min: [-2, -2, -2], max: [2, 2, 2] },
    initial_player: {
      inventory: { hotbar1: { id: "minecraft:dirt", count: 64 } },
      selected_hotbar: 1,
      game_mode: "Creative",
    },
    max_tick: 6,
    frames,
    breakpoints: [],
    source_map: [],
    ...overrides,
  };
}

function resetStore(): void {
  useReplayStore.setState({
    testId: null,
    source: "",
    replay: null,
    parseErrors: [],
    tick: 0,
    eventIndex: null,
    worldState: new Map(),
    entityState: new Map(),
    player: { inventory: {}, selected_hotbar: 1, game_mode: "Creative" },
    playback: "paused",
  });
}

describe("rebuildAt", () => {
  it("returns initial state for tick 0", () => {
    const replay = makeReplay();
    const { world, player } = rebuildAt(replay, 0);
    expect(world.size).toBe(0);
    expect(player.selected_hotbar).toBe(1);
    expect(player.inventory.hotbar1).toEqual({ id: "minecraft:dirt", count: 64 });
  });

  it("applies all frames whose tick <= target", () => {
    const replay = makeReplay();
    const { world, player } = rebuildAt(replay, 3);
    expect(world.get(posKey([0, 0, 0]))).toEqual({ id: "minecraft:stone" });
    expect(world.get(posKey([1, 0, 0]))).toEqual({ id: "minecraft:dirt" });
    expect(player.selected_hotbar).toBe(2);
    expect(player.inventory.hotbar1).toEqual({ id: "minecraft:dirt", count: 63 });
  });

  it("removes blocks per Remove event", () => {
    const replay = makeReplay();
    const { world } = rebuildAt(replay, 5);
    expect(world.has(posKey([0, 0, 0]))).toBe(false);
    expect(world.get(posKey([1, 0, 0]))).toEqual({ id: "minecraft:dirt" });
  });

  it("tracks summoned entities and teleports by alias", () => {
    const replay = makeReplay({
      max_tick: 2,
      frames: [
        {
          tick: 0,
          events: [
            {
              kind: "summon",
              entity_alias: "falling",
              entity_type: "minecraft:falling_block",
              pos: [1.5, 64, 2.5],
              nbt: { BlockState: { Name: "minecraft:sand" } },
            },
          ],
        },
        {
          tick: 2,
          events: [
            {
              kind: "tp",
              entity_alias: "falling",
              pos: [3.5, 65, 4.5],
              rot: [90, 0],
            },
          ],
        },
      ],
    });

    expect(rebuildAt(replay, 0).entities.get("falling")?.pos).toEqual([1.5, 64, 2.5]);
    const moved = rebuildAt(replay, 2).entities.get("falling");
    expect(moved?.pos).toEqual([3.5, 65, 4.5]);
    expect(moved?.rot).toEqual([90, 0]);
    expect(moved?.nbt).toEqual({ BlockState: { Name: "minecraft:sand" } });
  });

  it("creates the reserved player entity on first tp", () => {
    const replay = makeReplay({
      max_tick: 1,
      frames: [
        {
          tick: 0,
          events: [
            {
              kind: "tp",
              entity_alias: "player",
              pos: [0.5, 64, 0.5],
              rot: [0, 0],
            },
          ],
        },
        {
          tick: 1,
          events: [
            {
              kind: "tp",
              entity_alias: "player",
              pos: [1.5, 64, 2.5],
              rot: [90, 0],
            },
          ],
        },
      ],
    });

    const initial = rebuildAt(replay, 0).entities.get("player");
    expect(initial).toEqual({
      alias: "player",
      entity_type: "minecraft:player",
      pos: [0.5, 64, 0.5],
      rot: [0, 0],
      nbt: null,
    });

    const moved = rebuildAt(replay, 1).entities.get("player");
    expect(moved?.pos).toEqual([1.5, 64, 2.5]);
    expect(moved?.rot).toEqual([90, 0]);
  });
});

describe("setTick — forward", () => {
  it("walks sparse frames incrementally", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);

    useReplayStore.getState().setTick(3);
    let { tick, worldState, player } = useReplayStore.getState();
    expect(tick).toBe(3);
    expect(worldState.size).toBe(2);
    expect(player.selected_hotbar).toBe(2);

    useReplayStore.getState().setTick(5);
    ({ tick, worldState } = useReplayStore.getState());
    expect(tick).toBe(5);
    expect(worldState.has(posKey([0, 0, 0]))).toBe(false);
  });

  it("clamps target tick to max_tick", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    useReplayStore.getState().setTick(999);
    expect(useReplayStore.getState().tick).toBe(replay.max_tick);
  });
});

describe("setTick — backward", () => {
  it("rebuilds state when target < current", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    useReplayStore.getState().setTick(5);
    useReplayStore.getState().setTick(2);
    const { tick, worldState, player } = useReplayStore.getState();
    expect(tick).toBe(2);
    expect(worldState.size).toBe(1);
    expect(worldState.get(posKey([0, 0, 0]))).toEqual({ id: "minecraft:stone" });
    expect(player.selected_hotbar).toBe(1);
    expect(player.inventory.hotbar1).toEqual({ id: "minecraft:dirt", count: 64 });
  });

  it("returns to tick 0 with initial player + empty world", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    useReplayStore.getState().setTick(5);
    useReplayStore.getState().setTick(0);
    const { worldState, player } = useReplayStore.getState();
    expect(worldState.size).toBe(0);
    expect(player.selected_hotbar).toBe(1);
  });

  it("clamps target tick to 0", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    useReplayStore.getState().setTick(3);
    useReplayStore.getState().setTick(-5);
    expect(useReplayStore.getState().tick).toBe(0);
  });
});

describe("playback controls", () => {
  it("play/pause toggles playback flag", () => {
    resetStore();
    useReplayStore.getState().play();
    expect(useReplayStore.getState().playback).toBe("playing");
    useReplayStore.getState().pause();
    expect(useReplayStore.getState().playback).toBe("paused");
  });

  it("stepForward / stepBack delegate to setTick", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    useReplayStore.getState().stepForward();
    expect(useReplayStore.getState().tick).toBe(1);
    useReplayStore.getState().stepBack();
    expect(useReplayStore.getState().tick).toBe(0);
  });
});

describe("setReplay", () => {
  it("seeds tick 0 with initial player snapshot", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    const { tick, worldState, player } = useReplayStore.getState();
    expect(tick).toBe(0);
    expect(worldState.size).toBe(0);
    expect(player.inventory.hotbar1).toEqual({ id: "minecraft:dirt", count: 64 });
  });

  it("clears replay but keeps parseErrors when null", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    useReplayStore.getState().setTick(3);
    useReplayStore.getState().setReplay(null, [{ line: 1, col: 1, message: "bad" }]);
    const { replay: r, parseErrors, tick, worldState } = useReplayStore.getState();
    expect(r).toBeNull();
    expect(parseErrors.length).toBe(1);
    expect(tick).toBe(3);
    expect(worldState.size).toBe(2);
  });
});

describe("setEventIndex", () => {
  it("locks world to tick-1 + events[0..=idx]", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    // Multi-event tick 3: [place dirt @ (1,0,0), set_slot, select_hotbar].
    useReplayStore.getState().setTick(3);
    // After tick 3 default, two blocks placed, hotbar=2, hotbar1.count=63.
    expect(useReplayStore.getState().player.selected_hotbar).toBe(2);

    // Step to event 0 only: only first event (place dirt) applied on top of
    // the tick-2 state (which has place stone from tick 1). Inventory should
    // be back to initial (count 64, hotbar=1).
    useReplayStore.getState().setEventIndex(0);
    const after0 = useReplayStore.getState();
    expect(after0.eventIndex).toBe(0);
    expect(after0.worldState.get(posKey([1, 0, 0]))).toEqual({
      id: "minecraft:dirt",
    });
    expect(after0.player.selected_hotbar).toBe(1);
    expect(after0.player.inventory.hotbar1).toEqual({
      id: "minecraft:dirt",
      count: 64,
    });

    // Step to event 1: set_slot applied.
    useReplayStore.getState().setEventIndex(1);
    expect(useReplayStore.getState().player.inventory.hotbar1).toEqual({
      id: "minecraft:dirt",
      count: 63,
    });
    expect(useReplayStore.getState().player.selected_hotbar).toBe(1);

    // [all] resets to full-tick state.
    useReplayStore.getState().setEventIndex(null);
    expect(useReplayStore.getState().eventIndex).toBeNull();
    expect(useReplayStore.getState().player.selected_hotbar).toBe(2);
  });

  it("setTick resets eventIndex to null", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    useReplayStore.getState().setTick(3);
    useReplayStore.getState().setEventIndex(1);
    expect(useReplayStore.getState().eventIndex).toBe(1);
    useReplayStore.getState().setTick(5);
    expect(useReplayStore.getState().eventIndex).toBeNull();
  });

  it("play() resets eventIndex to null and restores full-tick state", () => {
    resetStore();
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    useReplayStore.getState().setTick(3);
    useReplayStore.getState().setEventIndex(0);
    expect(useReplayStore.getState().player.selected_hotbar).toBe(1);
    useReplayStore.getState().play();
    expect(useReplayStore.getState().eventIndex).toBeNull();
    expect(useReplayStore.getState().player.selected_hotbar).toBe(2);
    expect(useReplayStore.getState().playback).toBe("playing");
  });
});
