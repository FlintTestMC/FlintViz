import { useEffect, useState } from "react";

import { useReplayStore } from "../store/replay";
import {
  nextBreakpoint,
  nextEventTick,
  prevEventTick,
  SPEEDS,
  type Speed,
  usePlaybackLoop,
} from "./playback";

// Playback transport: ⏮ ◀ ▶/⏸ ▶ ⏭ ⏭⚑ + speed selector. Owns the keyboard
// shortcut hub for the app (←/→ step, space play/pause, home/end, R rotate
// CCW per #0036). Per the #0029 handoff note, all global keys live here so we
// don't fragment keydown listeners across components.
export default function Controls() {
  const [speed, setSpeed] = useState<Speed>(1);
  usePlaybackLoop(speed);

  const replay = useReplayStore((s) => s.replay);
  const tick = useReplayStore((s) => s.tick);
  const playback = useReplayStore((s) => s.playback);
  const setTick = useReplayStore((s) => s.setTick);
  const play = useReplayStore((s) => s.play);
  const pause = useReplayStore((s) => s.pause);

  const disabled = !replay;
  const atEnd = !!replay && tick >= replay.max_tick;
  const atStart = tick <= 0;

  const togglePlay = () => {
    if (!replay) return;
    if (playback === "playing") {
      pause();
    } else {
      // Auto-rewind when starting from the end so space at end-of-test plays
      // again from tick 0 rather than no-op'ing.
      if (tick >= replay.max_tick) setTick(0);
      play();
    }
  };

  const goStart = () => {
    pause();
    setTick(0);
  };

  const goEnd = () => {
    pause();
    if (replay) setTick(replay.max_tick);
  };

  const stepFwd = () => {
    pause();
    if (!replay) return;
    setTick(nextEventTick(replay, tick));
  };

  const stepBack = () => {
    pause();
    if (!replay) return;
    setTick(prevEventTick(replay, tick));
  };

  const goNextBreakpoint = () => {
    pause();
    if (!replay) return;
    const bp = nextBreakpoint(replay, tick);
    if (bp != null) setTick(bp);
  };

  // Keyboard shortcuts — single global registration. Skip when the active
  // element is editable (Monaco / inputs) so typing in the editor doesn't
  // scrub the playhead.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          stepFwd();
          break;
        case "ArrowLeft":
          e.preventDefault();
          stepBack();
          break;
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "Home":
          e.preventDefault();
          goStart();
          break;
        case "End":
          e.preventDefault();
          goEnd();
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // togglePlay/stepFwd/stepBack/goStart/goEnd are stable closures
    // over store getters — re-binding on every render is not necessary, but cheap.
  });

  return (
    <div className="flex items-center gap-1">
      <IconButton
        onClick={goStart}
        disabled={disabled || atStart}
        title="Jump to start (Home)"
        label="⏮"
      />
      <IconButton
        onClick={stepBack}
        disabled={disabled || atStart}
        title="Step back (←)"
        label="◀"
      />
      <IconButton
        onClick={togglePlay}
        disabled={disabled}
        title={playback === "playing" ? "Pause (space)" : "Play (space)"}
        label={playback === "playing" ? "⏸" : "▶"}
        primary
      />
      <IconButton
        onClick={stepFwd}
        disabled={disabled || atEnd}
        title="Step forward (→)"
        label="▶"
      />
      <IconButton
        onClick={goEnd}
        disabled={disabled || atEnd}
        title="Jump to end (End)"
        label="⏭"
      />
      <IconButton
        onClick={goNextBreakpoint}
        disabled={disabled || !replay?.breakpoints.length}
        title="Next breakpoint"
        label="⏭⚑"
      />
      <select
        value={speed}
        onChange={(e) => setSpeed(Number(e.target.value) as Speed)}
        className="ml-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-200 hover:bg-neutral-800"
        aria-label="Playback speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
}

function IconButton({
  onClick,
  disabled,
  title,
  label,
  primary,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`rounded px-2 py-0.5 text-sm transition-colors disabled:opacity-30 ${
        primary
          ? "bg-sky-900 text-sky-100 hover:bg-sky-800 disabled:hover:bg-sky-900"
          : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
      }`}
    >
      {label}
    </button>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
