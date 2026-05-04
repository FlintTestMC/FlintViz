import { create } from "zustand";

import type {
  Block,
  ParseError,
  PlayerSnapshot,
  Replay,
} from "../api/types";
import {
  clonePlayer,
  rebuildAt,
  stepForwardTo,
  type PosKey,
} from "./world";

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
  worldState: Map<PosKey, Block>;
  player: PlayerSnapshot;
  playback: Playback;

  openTest: (testId: string, source: string) => void;
  setSource: (source: string) => void;
  setReplay: (replay: Replay | null, parseErrors: ParseError[]) => void;
  setTick: (tick: number) => void;
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
  worldState: new Map(),
  player: { ...DEFAULT_PLAYER, inventory: {} },
  playback: "paused",

  openTest: (testId, source) => {
    set({
      testId,
      source,
      replay: null,
      parseErrors: [],
      tick: 0,
      worldState: new Map(),
      player: { ...DEFAULT_PLAYER, inventory: {} },
      playback: "paused",
    });
  },

  setSource: (source) => set({ source }),

  setReplay: (replay, parseErrors) => {
    if (!replay) {
      set({ replay: null, parseErrors });
      return;
    }
    set({
      replay,
      parseErrors,
      tick: 0,
      worldState: new Map(),
      player: clonePlayer(replay.initial_player),
    });
  },

  setTick: (target) => {
    const { replay, tick, worldState, player } = get();
    if (!replay) {
      set({ tick: Math.max(0, target) });
      return;
    }
    const clamped = Math.max(0, Math.min(target, replay.max_tick));
    if (clamped === tick) return;
    if (clamped > tick) {
      const nextWorld = new Map(worldState);
      const nextPlayer = clonePlayer(player);
      stepForwardTo(replay, nextWorld, nextPlayer, tick, clamped);
      set({ tick: clamped, worldState: nextWorld, player: nextPlayer });
    } else {
      const { world, player: rebuilt } = rebuildAt(replay, clamped);
      set({ tick: clamped, worldState: world, player: rebuilt });
    }
  },

  play: () => set({ playback: "playing" }),
  pause: () => set({ playback: "paused" }),
  stepForward: () => get().setTick(get().tick + 1),
  stepBack: () => get().setTick(get().tick - 1),
}));
