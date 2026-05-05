import { describe, expect, it } from "vitest";

import type { Replay, TickFrame } from "../../api/types";
import { useReplayStore } from "../replay";
import { posKey, rebuildAt } from "../world";

function makeReplay(overrides: Partial<Replay> = {}): Replay {
  const frames: TickFrame[] = [
    {
      tick: 1,
      actions: [
        { kind: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
      ],
      block_diff: [
        { kind: "set", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
      ],
      inventory_diff: null,
      assertions: [],
    },
    {
      tick: 3,
      actions: [
        { kind: "place", pos: [1, 0, 0], block: { id: "minecraft:dirt" } },
      ],
      block_diff: [
        { kind: "set", pos: [1, 0, 0], block: { id: "minecraft:dirt" } },
      ],
      inventory_diff: {
        slots: [
          {
            slot: "hotbar1",
            item: { id: "minecraft:dirt", count: 63 },
            previous: { id: "minecraft:dirt", count: 64 },
          },
        ],
        selected_hotbar: { slot: 2, previous: 1 },
      },
      assertions: [],
    },
    {
      tick: 5,
      actions: [{ kind: "remove", pos: [0, 0, 0] }],
      block_diff: [{ kind: "remove", pos: [0, 0, 0] }],
      inventory_diff: null,
      assertions: [],
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
    worldState: new Map(),
    player: { inventory: {}, selected_hotbar: 1, game_mode: "Creative" },
    playback: "paused",
    rotation: 0,
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

  it("removes blocks per BlockChange::Remove", () => {
    const replay = makeReplay();
    const { world } = rebuildAt(replay, 5);
    expect(world.has(posKey([0, 0, 0]))).toBe(false);
    expect(world.get(posKey([1, 0, 0]))).toEqual({ id: "minecraft:dirt" });
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

    // Forward across more frames.
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
    // Tick 1 frame is included; tick 3 is not.
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

describe("rotation", () => {
  it("setRotation writes the explicit value", () => {
    resetStore();
    useReplayStore.getState().setRotation(2);
    expect(useReplayStore.getState().rotation).toBe(2);
  });

  it("rotateClockwise wraps after 270°", () => {
    resetStore();
    const { rotateClockwise } = useReplayStore.getState();
    rotateClockwise();
    rotateClockwise();
    rotateClockwise();
    rotateClockwise();
    expect(useReplayStore.getState().rotation).toBe(0);
  });

  it("setReplay resets rotation to 0", () => {
    resetStore();
    useReplayStore.getState().setRotation(3);
    const replay = makeReplay();
    useReplayStore.getState().setReplay(replay, []);
    expect(useReplayStore.getState().rotation).toBe(0);
  });

  it("openTest resets rotation to 0", () => {
    resetStore();
    useReplayStore.getState().setRotation(2);
    useReplayStore.getState().openTest("foo", "{}");
    expect(useReplayStore.getState().rotation).toBe(0);
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
    useReplayStore.getState().setReplay(null, [
      { line: 1, col: 1, message: "bad" },
    ]);
    const { replay: r, parseErrors, tick, worldState } = useReplayStore.getState();
    expect(r).toBeNull();
    expect(parseErrors.length).toBe(1);
    // tick + worldState are intentionally retained — last-good state UX (#0033).
    expect(tick).toBe(3);
    expect(worldState.size).toBe(2);
  });
});
