// Source-map indices derived from `Replay.source_map` (#0016) for the
// cross-link feature (#0032). Forward index lets the timeline marker /
// assertion row resolve `(tick, event_index) → json_pointer`. Reverse index
// lets the editor cursor resolve `pointer → set of ticks`. Per-position index
// is computed lazily from `frame.actions` because `BlockChange` doesn't carry
// `event_index`.

import type { Replay, TickEvent, Vec3 } from "../api/types";
import { posKey, type PosKey } from "./world";

export interface SourceIndices {
  // tick → array indexed by event_index, where actions come first then
  // assertions (the merged-list convention from #0016 status note).
  byTickEvent: Map<number, string[]>;
  // pointer → set of ticks containing at least one span pointing to it.
  // Many-to-many because `at: [t1,t2,t3]` and `BlockSpec::Multiple` produce
  // multiple spans on the same pointer.
  pointerToTicks: Map<string, Set<number>>;
}

const EMPTY: SourceIndices = {
  byTickEvent: new Map(),
  pointerToTicks: new Map(),
};

export function buildSourceIndices(replay: Replay | null): SourceIndices {
  if (!replay) return EMPTY;
  const byTickEvent = new Map<number, string[]>();
  const pointerToTicks = new Map<string, Set<number>>();
  for (const span of replay.source_map) {
    let arr = byTickEvent.get(span.tick);
    if (!arr) {
      arr = [];
      byTickEvent.set(span.tick, arr);
    }
    // event_index is dense per tick.
    arr[span.event_index] = span.json_pointer;
    let ticks = pointerToTicks.get(span.json_pointer);
    if (!ticks) {
      ticks = new Set();
      pointerToTicks.set(span.json_pointer, ticks);
    }
    ticks.add(span.tick);
  }
  return { byTickEvent, pointerToTicks };
}

// Lookup helpers --------------------------------------------------------------

// Returns the json_pointer for `(tick, event_index)`, or null. When `suffix`
// is provided, appends it to the resolved base pointer (used by #0041 to
// deep-link to a specific alternative inside an assert's `is` array).
export function pointerForEvent(
  indices: SourceIndices,
  tick: number,
  eventIndex: number,
  suffix?: string | null,
): string | null {
  const arr = indices.byTickEvent.get(tick);
  if (!arr) return null;
  const base = arr[eventIndex] ?? null;
  if (base == null) return null;
  return suffix ? `${base}${suffix}` : base;
}

// Returns the json_pointer for the *first* event on a tick. Convention from
// the #0028 handoff: timeline-marker click uses event_index=0 (action when
// present, else assertion).
export function pointerForTick(
  indices: SourceIndices,
  tick: number,
): string | null {
  const arr = indices.byTickEvent.get(tick);
  if (!arr) return null;
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i];
    if (p) return p;
  }
  return null;
}

// Position → source pointer ---------------------------------------------------
//
// Walks `replay.frames` up to `targetTick` inclusive in spec order, applying
// each `ActionEvent` to a position-keyed map. Mirrors the engine's emission
// order so `event_index` matches `frame.actions[i]`. For `Fill`, every position
// in the AABB shares the same `event_index` (the index of `ActionEvent::Fill`
// in `frame.actions`). Cheap enough to call on every world click — the work is
// O(sum of action expansions up to tick), no different from the existing
// `rebuildAt` cost path.
export interface PosSourceEntry {
  tick: number;
  eventIndex: number;
}

export function buildPosSourceMap(
  replay: Replay,
  targetTick: number,
): Map<PosKey, PosSourceEntry> {
  const map = new Map<PosKey, PosSourceEntry>();
  for (const frame of replay.frames) {
    if (frame.tick > targetTick) break;
    for (let e = 0; e < frame.events.length; e++) {
      writeEventPositions(frame.events[e]!, frame.tick, e, map);
    }
  }
  return map;
}

function writeEventPositions(
  event: TickEvent,
  tick: number,
  eventIndex: number,
  out: Map<PosKey, PosSourceEntry>,
): void {
  switch (event.kind) {
    case "place":
      out.set(posKey(event.pos), { tick, eventIndex });
      return;
    case "place_each":
      for (const pl of event.placements) {
        out.set(posKey(pl.pos), { tick, eventIndex });
      }
      return;
    case "fill":
      for (const pos of iterAabb(event.region.min, event.region.max)) {
        out.set(posKey(pos), { tick, eventIndex });
      }
      return;
    case "remove":
      out.set(posKey(event.pos), { tick, eventIndex });
      return;
    case "use_item_on":
      out.set(posKey(event.pos), { tick, eventIndex });
      return;
    case "set_slot":
    case "select_hotbar":
    case "assert":
      return;
  }
}

function* iterAabb(min: Vec3, max: Vec3): Iterable<Vec3> {
  for (let x = min[0]; x <= max[0]; x++) {
    for (let y = min[1]; y <= max[1]; y++) {
      for (let z = min[2]; z <= max[2]; z++) {
        yield [x, y, z];
      }
    }
  }
}
