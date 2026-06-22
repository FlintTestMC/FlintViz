// Pure helpers for forward-applying replay events to the world map and player
// snapshot. No store coupling so they're trivially testable.
//
// MAINTENANCE NOTE: `applyEvent` must stay in lockstep with the engine's
// `apply_action` in `crates/flint-viz/src/replay/engine.rs`. The Rust engine
// emits TickEvents into the wire; the frontend re-runs the same semantics to
// derive world + inventory state. Any new event kind needs both sides updated.

import type {
  Block,
  Item,
  PlayerSnapshot,
  Replay,
  TickEvent,
  TickFrame,
  Vec3,
} from "../api/types";

export type PosKey = string;

// Mirrors `MAX_FILL_BLOCKS` in the engine. The backend never expanded fills
// since #0040 moved the expansion frontend-side; this is where we draw the
// line.
const MAX_FILL_BLOCKS = 100_000;

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

// Apply a single TickEvent to (world, player). Assertions are no-ops.
function applyEvent(
  world: Map<PosKey, Block>,
  player: PlayerSnapshot,
  event: TickEvent,
): void {
  switch (event.kind) {
    case "place":
      world.set(posKey(event.pos), event.block);
      return;
    case "place_each":
      for (const p of event.placements) {
        world.set(posKey(p.pos), p.block);
      }
      return;
    case "fill": {
      const { min, max } = event.region;
      const dx = max[0] - min[0] + 1;
      const dy = max[1] - min[1] + 1;
      const dz = max[2] - min[2] + 1;
      if (dx <= 0 || dy <= 0 || dz <= 0) return;
      const volume = dx * dy * dz;
      if (volume > MAX_FILL_BLOCKS) {
        console.warn(
          `applyEvent: fill volume ${volume} exceeds cap ${MAX_FILL_BLOCKS}; skipped`,
        );
        return;
      }
      for (let x = min[0]; x <= max[0]; x++) {
        for (let y = min[1]; y <= max[1]; y++) {
          for (let z = min[2]; z <= max[2]; z++) {
            world.set(posKey([x, y, z]), event.block);
          }
        }
      }
      return;
    }
    case "remove":
      world.delete(posKey(event.pos));
      return;
    case "set_slot":
      if (event.item == null) {
        delete player.inventory[event.slot];
      } else {
        player.inventory[event.slot] = {
          id: event.item,
          count: event.count,
        } as Item;
      }
      return;
    case "select_hotbar":
      if (event.slot >= 1 && event.slot <= 9) {
        player.selected_hotbar = event.slot;
      }
      return;
    case "use_item_on":
    case "assert":
      return;
  }
}

// Mutates `world` and `player` to apply one frame's events forward.
function applyForward(
  world: Map<PosKey, Block>,
  player: PlayerSnapshot,
  frame: TickFrame,
): void {
  for (const event of frame.events) {
    applyEvent(world, player, event);
  }
}

interface Checkpoint {
  tick: number;
  world: Map<PosKey, Block>;
  player: PlayerSnapshot;
}

const checkpointCache = new WeakMap<Replay, Checkpoint[]>();
const CHECKPOINT_INTERVAL = 50;

// Rebuild full state at `targetTick` from the initial player snapshot. Optimized
// to use a lazy checkpoint cache (WeakMap-backed) so scrubbing or stepping backward
// does not trigger a full O(N) rebuild from tick 0.
export function rebuildAt(
  replay: Replay,
  targetTick: number,
): { world: Map<PosKey, Block>; player: PlayerSnapshot } {
  let checkpoints = checkpointCache.get(replay);
  if (!checkpoints) {
    checkpoints = [
      {
        tick: -1,
        world: new Map<PosKey, Block>(),
        player: clonePlayer(replay.initial_player),
      },
    ];
    checkpointCache.set(replay, checkpoints);
  }

  // Find the closest checkpoint <= targetTick
  let best = checkpoints[0]!;
  for (const cp of checkpoints) {
    if (cp.tick <= targetTick && cp.tick > best.tick) {
      best = cp;
    }
  }

  const world = new Map(best.world);
  const player = clonePlayer(best.player);

  for (const frame of replay.frames) {
    if (frame.tick <= best.tick) continue;
    if (frame.tick > targetTick) break;
    applyForward(world, player, frame);
  }

  // Lazily save a checkpoint if we scanned a significant distance
  if (targetTick - best.tick >= CHECKPOINT_INTERVAL) {
    checkpoints.push({
      tick: targetTick,
      world: new Map(world),
      player: clonePlayer(player),
    });
  }

  return { world, player };
}

// Walk frames in `(currentTick, targetTick]` forward and apply them in place.
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

// Apply the first `(eventIndex + 1)` events of `frame` to (world, player). For
// the event picker (#0040): user picks event N → rebuild to tick-1, then call
// this with eventIndex=N.
export function applyEventsUpTo(
  world: Map<PosKey, Block>,
  player: PlayerSnapshot,
  frame: TickFrame,
  eventIndex: number,
): void {
  const upTo = Math.min(eventIndex, frame.events.length - 1);
  for (let i = 0; i <= upTo; i++) {
    applyEvent(world, player, frame.events[i]!);
  }
}
