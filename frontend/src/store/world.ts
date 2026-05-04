// Pure helpers for forward-/reverse-applying replay diffs to the world map and
// player snapshot. No store coupling so they're trivially testable.

import type {
  Block,
  PlayerDelta,
  PlayerSnapshot,
  Replay,
  TickFrame,
  Vec3,
} from "../api/types";

export type PosKey = string;

export function posKey(pos: Vec3): PosKey {
  return `${pos[0]},${pos[1]},${pos[2]}`;
}

export function clonePlayer(p: PlayerSnapshot): PlayerSnapshot {
  return {
    inventory: { ...p.inventory },
    selected_hotbar: p.selected_hotbar,
    game_mode: p.game_mode,
  };
}

// Mutates `world` and `player` to apply one frame's diffs forward.
export function applyForward(
  world: Map<PosKey, Block>,
  player: PlayerSnapshot,
  frame: TickFrame,
): void {
  for (const change of frame.block_diff) {
    if (change.kind === "set") {
      world.set(posKey(change.pos), change.block);
    } else {
      world.delete(posKey(change.pos));
    }
  }
  if (frame.inventory_diff) {
    applyPlayerForward(player, frame.inventory_diff);
  }
}

function applyPlayerForward(
  player: PlayerSnapshot,
  delta: PlayerDelta,
): void {
  if (delta.slots) {
    for (const s of delta.slots) {
      if (s.item == null) {
        delete player.inventory[s.slot];
      } else {
        player.inventory[s.slot] = s.item;
      }
    }
  }
  if (delta.selected_hotbar) {
    player.selected_hotbar = delta.selected_hotbar.slot;
  }
  if (delta.game_mode) {
    player.game_mode = delta.game_mode.mode;
  }
}

// Reverses a player delta using its `previous` fields. Used for backward
// scrubbing of player state. Block reverse-scrub is not supported here — the
// store rebuilds the world map from initial state instead, since `BlockChange`
// carries no `previous` payload.
export function applyPlayerReverse(
  player: PlayerSnapshot,
  delta: PlayerDelta,
): void {
  if (delta.game_mode) {
    player.game_mode = delta.game_mode.previous;
  }
  if (delta.selected_hotbar) {
    player.selected_hotbar = delta.selected_hotbar.previous;
  }
  if (delta.slots) {
    for (let i = delta.slots.length - 1; i >= 0; i--) {
      const s = delta.slots[i]!;
      if (s.previous == null) {
        delete player.inventory[s.slot];
      } else {
        player.inventory[s.slot] = s.previous;
      }
    }
  }
}

// Rebuilds the full state at `targetTick` from the initial player snapshot,
// walking the sparse frames. O(N) where N = frames with tick <= targetTick.
export function rebuildAt(
  replay: Replay,
  targetTick: number,
): { world: Map<PosKey, Block>; player: PlayerSnapshot } {
  const world = new Map<PosKey, Block>();
  const player = clonePlayer(replay.initial_player);
  for (const frame of replay.frames) {
    if (frame.tick > targetTick) break;
    applyForward(world, player, frame);
  }
  return { world, player };
}

// Walks frames in `(currentTick, targetTick]` forward and applies them to the
// given `world` and `player` in place. Caller guarantees `targetTick > currentTick`.
export function stepForwardTo(
  replay: Replay,
  world: Map<PosKey, Block>,
  player: PlayerSnapshot,
  currentTick: number,
  targetTick: number,
): void {
  for (const frame of replay.frames) {
    if (frame.tick <= currentTick) continue;
    if (frame.tick > targetTick) break;
    applyForward(world, player, frame);
  }
}
