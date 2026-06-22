import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeAltIndex,
  stopAssertionCycleForTests,
  useAssertionsStore,
} from "../assertions";
import { useReplayStore } from "../replay";

// Reset module-level state between tests so the wall-clock timer set up at
// import time doesn't interfere.
beforeEach(() => {
  stopAssertionCycleForTests();
  useAssertionsStore.setState({ cycleIndex: 0, locks: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("activeAltIndex", () => {
  it("returns 0 for empty groups", () => {
    expect(activeAltIndex(0, 5, undefined, null)).toBe(0);
  });

  it("cycles when no lock and no picker", () => {
    expect(activeAltIndex(3, 0, undefined, null)).toBe(0);
    expect(activeAltIndex(3, 1, undefined, null)).toBe(1);
    expect(activeAltIndex(3, 5, undefined, null)).toBe(2);
  });

  it("respects a lock over cycling", () => {
    expect(activeAltIndex(3, 99, 1, null)).toBe(1);
  });

  it("clamps stale locks via Math.min", () => {
    expect(activeAltIndex(2, 0, 5, null)).toBe(1);
  });

  it("picker overrides lock and cycle", () => {
    expect(activeAltIndex(3, 99, 1, 2)).toBe(2);
  });
});

describe("useAssertionsStore", () => {
  it("lock / unlock add and remove entries", () => {
    const { lock, unlock } = useAssertionsStore.getState();
    lock("0,0,0", 2);
    expect(useAssertionsStore.getState().locks).toEqual({ "0,0,0": 2 });
    unlock("0,0,0");
    expect(useAssertionsStore.getState().locks).toEqual({});
  });

  it("clearLocks wipes the map", () => {
    useAssertionsStore.setState({ locks: { a: 0, b: 1 } });
    useAssertionsStore.getState().clearLocks();
    expect(useAssertionsStore.getState().locks).toEqual({});
  });

  it("tickCycle advances the cycle index", () => {
    const tick = useAssertionsStore.getState().tickCycle;
    tick();
    tick();
    expect(useAssertionsStore.getState().cycleIndex).toBe(2);
  });

  it("wipes locks when the replay store testId changes", () => {
    useAssertionsStore.setState({ locks: { "1,2,3": 1 } });
    useReplayStore.setState({ testId: "abc" });
    expect(useAssertionsStore.getState().locks).toEqual({});
  });
});
