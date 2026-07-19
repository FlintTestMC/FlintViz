import { create } from "zustand";

import type { Block, ParseError, PlayerSnapshot, EntitySnapshot, Replay } from "../api/types";
import { buildSourceIndices, type SourceIndices } from "./sourceMap";
import { applyEventsUpTo, clonePlayer, rebuildAt, stepForwardTo, type PosKey } from "./world";

export type Playback = "paused" | "playing";

const DEFAULT_PLAYER: PlayerSnapshot = {
  inventory: {},
  selected_hotbar: 1,
  game_mode: "Creative",
};

export interface ReplayState {
  testId: string | null;
  source: string;
  replay: Replay | null;
  parseErrors: ParseError[];
  tick: number;
  // null = "all events" (default). non-null = picker is locked on event N of
  // the current tick; world/player reflect tick-1 + events[0..=eventIndex].
  eventIndex: number | null;
  worldState: Map<PosKey, Block>;
  entityState: Map<string, EntitySnapshot>;
  player: PlayerSnapshot;
  playback: Playback;
  sourceIndices: SourceIndices;

  openTest: (testId: string, source: string) => void;
  setSource: (source: string) => void;
  setReplay: (replay: Replay | null, parseErrors: ParseError[]) => void;
  setTick: (tick: number) => void;
  setEventIndex: (idx: number | null) => void;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBack: () => void;
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  testId: null,
  source: "",
  replay: null,
  parseErrors: [],
  tick: 0,
  eventIndex: null,
  worldState: new Map(),
  entityState: new Map(),
  player: { ...DEFAULT_PLAYER, inventory: {} },
  playback: "paused",
  sourceIndices: buildSourceIndices(null),

  openTest: (testId, source) => {
    set({
      testId,
      source,
      replay: null,
      parseErrors: [],
      tick: 0,
      eventIndex: null,
      worldState: new Map(),
      entityState: new Map(),
      player: { ...DEFAULT_PLAYER, inventory: {} },
      playback: "paused",
      sourceIndices: buildSourceIndices(null),
    });
  },

  setSource: (source) => set({ source }),

  setReplay: (replay, parseErrors) => {
    if (!replay) {
      // Preserve worldState/player/tick so the 3D view stays on the last good
      // state when JSON parse fails (#0033 stale-badge contract).
      set({ replay: null, parseErrors });
      return;
    }
    const { world, player, entities } = rebuildAt(replay, 0);
    set({
      replay,
      parseErrors,
      tick: 0,
      eventIndex: null,
      worldState: world,
      entityState: entities,
      player,
      sourceIndices: buildSourceIndices(replay),
    });
  },

  setTick: (target) => {
    const { replay, tick, worldState, entityState, player } = get();
    if (!replay) {
      set({ tick: Math.max(0, target), eventIndex: null });
      return;
    }
    const clamped = Math.max(0, Math.min(target, replay.max_tick));
    if (clamped === tick) {
      // Even if tick is unchanged, calling setTick implies a navigation away
      // from any event-step selection.
      if (get().eventIndex !== null) set({ eventIndex: null });
      return;
    }
    if (clamped > tick) {
      const nextWorld = new Map(worldState);
      const nextPlayer = clonePlayer(player);
      const nextEntities = new Map(entityState);
      stepForwardTo(replay, nextWorld, nextPlayer, nextEntities, tick, clamped);
      set({
        tick: clamped,
        eventIndex: null,
        worldState: nextWorld,
        entityState: nextEntities,
        player: nextPlayer,
      });
    } else {
      const { world, player: rebuilt, entities } = rebuildAt(replay, clamped);
      set({
        tick: clamped,
        eventIndex: null,
        worldState: world,
        entityState: entities,
        player: rebuilt,
      });
    }
  },

  setEventIndex: (idx) => {
    const { replay, tick } = get();
    if (!replay) return;
    if (idx === null) {
      const { world, player, entities } = rebuildAt(replay, tick);
      set({ eventIndex: null, worldState: world, entityState: entities, player });
      return;
    }
    const frame = replay.frames.find((f) => f.tick === tick);
    if (!frame || frame.events.length === 0) {
      set({ eventIndex: null });
      return;
    }
    const clamped = Math.max(0, Math.min(idx, frame.events.length - 1));
    // Rebuild from initial state to just before this tick, then walk
    // events[0..=clamped] forward.
    const base = rebuildAt(replay, tick === 0 ? -1 : tick - 1);
    applyEventsUpTo(base.world, base.player, base.entities, frame, clamped);
    set({
      eventIndex: clamped,
      worldState: base.world,
      entityState: base.entities,
      player: base.player,
    });
  },

  play: () => {
    const { eventIndex, replay, tick } = get();
    if (eventIndex !== null && replay) {
      // Playback always operates on full-tick state; reset the picker first.
      const { world, player, entities } = rebuildAt(replay, tick);
      set({ eventIndex: null, worldState: world, entityState: entities, player });
    }
    set({ playback: "playing" });
  },
  pause: () => set({ playback: "paused" }),
  stepForward: () => get().setTick(get().tick + 1),
  stepBack: () => get().setTick(get().tick - 1),
}));
