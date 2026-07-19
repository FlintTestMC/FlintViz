import { describe, expect, it } from "vitest";
import { localReplay } from "../localEngine";

describe("localReplay", () => {
  it("fails on invalid JSON syntax", async () => {
    const response = await localReplay("{ invalid json");
    expect(response.replay).toBeNull();
    expect(response.spec).toBeNull();
    expect(response.errors.length).toBe(1);
    expect(response.errors[0]!.message.length).toBeGreaterThan(0);
    expect(response.errors[0]!.line).toBe(1);
  });

  it("fails on missing root object type", async () => {
    const response = await localReplay("[]");
    expect(response.replay).toBeNull();
    expect(response.errors[0]!.message).toContain("TestSpec");
  });

  it("fails on missing name field", async () => {
    const response = await localReplay('{"timeline": []}');
    expect(response.replay).toBeNull();
    expect(response.errors[0]!.message).toContain("name");
  });

  it("fails on missing timeline field", async () => {
    const response = await localReplay('{"name": "test"}');
    expect(response.replay).toBeNull();
    expect(response.errors[0]!.message).toContain("timeline");
  });

  it("parses a valid simple Flint test spec correctly", async () => {
    const source = JSON.stringify({
      flintVersion: "1.0",
      name: "basic-test",
      description: "A basic test",
      tags: ["basic"],
      setup: {
        cleanup: {
          region: [
            [0, 0, 0],
            [10, 10, 10],
          ],
        },
        player: {
          selected_hotbar: 3,
          game_mode: "Survival",
          inventory: {
            hotbar1: { id: "minecraft:stone", count: 64 },
          },
        },
      },
      timeline: [
        { at: 1, do: "place", pos: [1, 2, 3], block: { id: "minecraft:stone" } },
        { at: 2, do: "remove", pos: [1, 2, 3] },
        { at: 3, do: "select_hotbar", slot: 4 },
        {
          at: 4,
          do: "set_slot",
          slot: "hotbar4",
          item: "minecraft:dirt",
          count: 10,
        },
        { at: 5, do: "interact" },
        {
          at: 6,
          do: "assert",
          checks: [
            { pos: [1, 2, 3], is: { id: "minecraft:stone" } },
            { slot: "hotbar4", is: { id: "minecraft:dirt", count: 10 } },
          ],
        },
      ],
      breakpoints: [2, 4],
    });

    const response = await localReplay(source);
    expect(response.errors.length).toBe(0);
    expect(response.spec).not.toBeNull();
    expect(response.replay).not.toBeNull();

    const replay = response.replay!;
    expect(replay.name).toBe("basic-test");
    expect(replay.cleanup_region).toEqual({ min: [0, 0, 0], max: [10, 10, 10] });
    expect(replay.breakpoints).toEqual([2, 4]);
    expect(replay.initial_player.selected_hotbar).toBe(3);
    expect(replay.initial_player.game_mode).toBe("Survival");
    expect(replay.initial_player.inventory.hotbar1).toEqual({
      id: "minecraft:stone",
      count: 64,
    });

    // Check frames mapping
    expect(replay.frames.length).toBe(6);
    expect(replay.frames[0]!.tick).toBe(1);
    expect(replay.frames[0]!.events[0]).toEqual({
      kind: "place",
      pos: [1, 2, 3],
      block: { id: "minecraft:stone" },
    });

    expect(replay.frames[1]!.tick).toBe(2);
    expect(replay.frames[1]!.events[0]).toEqual({
      kind: "remove",
      pos: [1, 2, 3],
    });

    expect(replay.frames[2]!.tick).toBe(3);
    expect(replay.frames[2]!.events[0]).toEqual({
      kind: "select_hotbar",
      slot: 4,
    });

    expect(replay.frames[3]!.tick).toBe(4);
    expect(replay.frames[3]!.events[0]).toEqual({
      kind: "set_slot",
      slot: "hotbar4",
      item: "minecraft:dirt",
      count: 10,
    });

    // interact resolves the item from the selected slot (slot 4), now dirt.
    expect(replay.frames[4]!.tick).toBe(5);
    expect(replay.frames[4]!.events[0]).toEqual({
      kind: "interact",
      item: null,
      resolved_item: { id: "minecraft:dirt", count: 10 },
    });

    // assertion view check
    expect(replay.frames[5]!.tick).toBe(6);
    expect(replay.frames[5]!.events[0]!.kind).toBe("assert");
    const event = replay.frames[5]!.events[0];
    expect(event).toBeDefined();
    expect(event!.kind).toBe("assert");
    if (!event || event.kind !== "assert") {
      throw new Error("expected assert event");
    }
    expect(event.views.length).toBe(2);
    expect(event.views[0]).toEqual({
      kind: "block",
      position: [1, 2, 3],
      expected: { id: "minecraft:stone" },
    });
    expect(event.views[1]).toEqual({
      kind: "inventory",
      slot: "hotbar4",
      expected: { id: "minecraft:dirt", count: 10 },
    });

    // Source map checks
    expect(replay.source_map.length).toBe(6); // 6 timeline entries mapped to 6 tick events
    expect(replay.source_map[0]).toEqual({
      tick: 1,
      event_index: 0,
      json_pointer: "/timeline/0",
    });
  });
});
