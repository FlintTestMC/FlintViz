import { useEffect } from "react";

import type { Replay } from "../api/types";
import { useReplayStore } from "../store/replay";

// 1× = 1 tick per 1000 ms (#0029).
export const TICK_MS = 1000;

export type Speed = 0.5 | 1 | 2 | 4;
export const SPEEDS: Speed[] = [0.5, 1, 2, 4];

// Next event-bearing tick strictly greater than `tick`. Step granularity is
// per-event by default (#0029) — empty ticks between actions are uninteresting
// to scrub through one at a time. Falls back to `tick + 1` clamped to maxTick
// when no later event exists, so stepping never silently no-ops at end-of-test.
export function nextEventTick(replay: Replay, tick: number): number {
  for (const f of replay.frames) {
    if (f.tick > tick && (f.actions.length > 0 || f.assertions.length > 0)) {
      return f.tick;
    }
  }
  return Math.min(tick + 1, replay.max_tick);
}

export function prevEventTick(replay: Replay, tick: number): number {
  let best = -1;
  for (const f of replay.frames) {
    if (f.tick < tick && (f.actions.length > 0 || f.assertions.length > 0)) {
      best = f.tick;
    } else if (f.tick >= tick) {
      break;
    }
  }
  return best >= 0 ? best : Math.max(tick - 1, 0);
}

export function nextBreakpoint(replay: Replay, tick: number): number | null {
  for (const b of replay.breakpoints) {
    if (b > tick) return b;
  }
  return null;
}

// rAF-driven play loop. While `playback === "playing"`, advance the playhead
// by `Δticks = (elapsed_ms / TICK_MS) * speed`. Pauses automatically at
// max_tick. Skipping by *game tick* (not event tick) here keeps playback
// timing accurate — event-tick stepping is for the manual step buttons.
export function usePlaybackLoop(speed: Speed): void {
  const playback = useReplayStore((s) => s.playback);

  useEffect(() => {
    if (playback !== "playing") return;
    let raf = 0;
    let prev = performance.now();
    let acc = 0;

    const step = (now: number) => {
      const dt = now - prev;
      prev = now;
      acc += (dt / TICK_MS) * speed;
      if (acc >= 1) {
        const advance = Math.floor(acc);
        acc -= advance;
        const { replay, tick, setTick, pause } = useReplayStore.getState();
        if (!replay) {
          pause();
          return;
        }
        const target = Math.min(tick + advance, replay.max_tick);
        setTick(target);
        if (target >= replay.max_tick) {
          pause();
          return;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playback, speed]);
}
