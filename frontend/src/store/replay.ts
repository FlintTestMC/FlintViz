import { create } from "zustand";

import type {
  Block,
  ParseError,
  PlayerSnapshot,
  Replay,
} from "../api/types";
import { buildSourceIndices, type SourceIndices } from "./sourceMap";
import {
  clonePlayer,
  rebuildAt,
  stepForwardTo,
  type PosKey,
} from "./world";

export type Playback = "paused" | "playing";

// Quarter-turn rotations around Y. 0 = identity; 1 = 90° CCW (looking down -Y).
// Persisted in the replay store (not overlayStore) because it must reset on
// test load alongside `tick` / `worldState` (#0036 handoff).
export type Rotation = 0 | 1 | 2 | 3;

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
  rotation: Rotation;
  sourceIndices: SourceIndices;

  openTest: (testId: string, source: string) => void;
  setSource: (source: string) => void;
  setReplay: (replay: Replay | null, parseErrors: ParseError[]) => void;
  setTick: (tick: number) => void;
  play: () => void;
  pause: () => void;
  stepForward: () => void;
  stepBack: () => void;
  setRotation: (rotation: Rotation) => void;
  rotateClockwise: () => void;
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
  rotation: 0,
  sourceIndices: buildSourceIndices(null),

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
      rotation: 0,
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
    // Seed via rebuildAt so any tick-0 frame is applied. setTick's forward path
    // assumes the current tick's frames are already in worldState.
    const { world, player } = rebuildAt(replay, 0);
    set({
      replay,
      parseErrors,
      tick: 0,
      worldState: world,
      player,
      rotation: 0,
      sourceIndices: buildSourceIndices(replay),
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

  setRotation: (rotation) => set({ rotation }),
  rotateClockwise: () =>
    set((s) => ({ rotation: (((s.rotation + 1) % 4) as Rotation) })),
}));
