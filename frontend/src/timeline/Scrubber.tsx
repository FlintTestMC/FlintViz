import { useCallback, useMemo, useRef, useState } from "react";

import { useCrosslinkStore } from "../store/crosslink";
import { useReplayStore } from "../store/replay";
import { pointerForTick } from "../store/sourceMap";
import { buildMarkers, type Marker } from "./markers";

const TRACK_HEIGHT = 36;
const PADDING_X = 12;
const MARKER_R = 3.5;

// Horizontal SVG scrubber. Drag the playhead to move `tick`; markers light up
// every event-bearing tick (bolder for assert-only ticks) and breakpoints
// render as red flags.
//
// Memoization: marker positions derive only from `replay`. Tick changes never
// recompute markers; only the playhead/tooltip move. The store clamps + early-
// returns equal targets, so pointermove handlers fire setTick directly without
// throttling.
export default function Scrubber() {
  const replay = useReplayStore((s) => s.replay);
  const tick = useReplayStore((s) => s.tick);
  const setTick = useReplayStore((s) => s.setTick);
  const pause = useReplayStore((s) => s.pause);

  const markers = useMemo(() => buildMarkers(replay), [replay]);
  const breakpoints = replay?.breakpoints ?? [];
  const maxTick = replay?.max_tick ?? 0;
  const sourceIndices = useReplayStore((s) => s.sourceIndices);
  const highlightedTicks = useCrosslinkStore((s) => s.highlightedTicks);
  const revealPointer = useCrosslinkStore((s) => s.revealPointer);

  const onMarkerClick = useCallback(
    (m: Marker) => {
      // Pause + jump first so playback state matches the navigation, then
      // route to the editor. Order matches the #0028 / #0029 handoff
      // expectations.
      pause();
      setTick(m.tick);
      const pointer = pointerForTick(sourceIndices, m.tick);
      if (pointer) revealPointer(pointer);
    },
    [pause, setTick, sourceIndices, revealPointer],
  );

  const trackRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef(false);
  const [hover, setHover] = useState<{ marker: Marker; x: number } | null>(
    null,
  );

  const tickToX = useCallback(
    (t: number, width: number) => {
      if (maxTick <= 0) return PADDING_X;
      const inner = width - 2 * PADDING_X;
      return PADDING_X + (t / maxTick) * inner;
    },
    [maxTick],
  );

  const xToTick = useCallback(
    (x: number, width: number) => {
      if (maxTick <= 0) return 0;
      const inner = width - 2 * PADDING_X;
      const clamped = Math.max(0, Math.min(inner, x - PADDING_X));
      return Math.round((clamped / inner) * maxTick);
    },
    [maxTick],
  );

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!replay) return;
    draggingRef.current = true;
    pause();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    setTick(xToTick(e.clientX - rect.left, rect.width));
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!replay || !draggingRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTick(xToTick(e.clientX - rect.left, rect.width));
  };

  const onPointerUp = () => {
    draggingRef.current = false;
  };

  if (!replay) {
    return (
      <div
        className="flex h-12 items-center border-t border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-500"
        aria-label="Timeline (no replay)"
      >
        No replay loaded
      </div>
    );
  }

  return (
    <div className="relative border-t border-neutral-800 bg-neutral-950">
      <svg
        ref={trackRef}
        className="block h-12 w-full cursor-pointer touch-none select-none"
        viewBox={`0 0 1000 ${TRACK_HEIGHT + 12}`}
        preserveAspectRatio="none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        aria-label="Timeline scrubber"
        aria-valuemin={0}
        aria-valuemax={maxTick}
        aria-valuenow={tick}
      >
        {/* Track line */}
        <line
          x1={PADDING_X}
          y1={TRACK_HEIGHT / 2}
          x2={1000 - PADDING_X}
          y2={TRACK_HEIGHT / 2}
          stroke="#262626"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />

        {/* Played portion */}
        <line
          x1={PADDING_X}
          y1={TRACK_HEIGHT / 2}
          x2={tickToX(tick, 1000)}
          y2={TRACK_HEIGHT / 2}
          stroke="#0ea5e9"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />

        {/* Markers */}
        {markers.map((m) => {
          const cx = tickToX(m.tick, 1000);
          const isAssertion = m.kind === "assertion";
          const isHighlighted = highlightedTicks.has(m.tick);
          return (
            <g
              key={`m-${m.tick}`}
              onPointerEnter={() => setHover({ marker: m, x: cx })}
              onPointerLeave={() =>
                setHover((h) => (h?.marker === m ? null : h))
              }
              onClick={(e) => {
                // Stop propagation so the surrounding `<svg>`'s drag-to-scrub
                // pointerdown handler doesn't also re-pause + re-set the tick.
                e.stopPropagation();
                onMarkerClick(m);
              }}
              style={{ cursor: "pointer" }}
            >
              {isHighlighted && (
                <circle
                  cx={cx}
                  cy={TRACK_HEIGHT / 2}
                  r={MARKER_R + 4}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  opacity={0.9}
                />
              )}
              <circle
                cx={cx}
                cy={TRACK_HEIGHT / 2}
                r={isAssertion ? MARKER_R + 1.5 : MARKER_R}
                fill={isAssertion ? "#fbbf24" : "#a3a3a3"}
                stroke={isAssertion ? "#facc15" : "transparent"}
                strokeWidth={isAssertion ? 1.5 : 0}
                vectorEffect="non-scaling-stroke"
              />
              {/* Larger invisible hit region for hover/click on dense tracks */}
              <circle
                cx={cx}
                cy={TRACK_HEIGHT / 2}
                r={8}
                fill="transparent"
              />
            </g>
          );
        })}

        {/* Breakpoint flags */}
        {breakpoints.map((t) => {
          const x = tickToX(t, 1000);
          return (
            <g key={`b-${t}`}>
              <line
                x1={x}
                y1={TRACK_HEIGHT / 2 - 14}
                x2={x}
                y2={TRACK_HEIGHT / 2 + 6}
                stroke="#ef4444"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              <polygon
                points={`${x},${TRACK_HEIGHT / 2 - 14} ${x + 8},${TRACK_HEIGHT / 2 - 11} ${x},${TRACK_HEIGHT / 2 - 8}`}
                fill="#ef4444"
              />
            </g>
          );
        })}

        {/* Playhead */}
        <g>
          <line
            x1={tickToX(tick, 1000)}
            y1={4}
            x2={tickToX(tick, 1000)}
            y2={TRACK_HEIGHT - 4}
            stroke="#38bdf8"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={tickToX(tick, 1000)}
            cy={TRACK_HEIGHT / 2}
            r={5}
            fill="#38bdf8"
          />
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-0.5 right-3 text-[10px] tabular-nums text-neutral-500">
        tick {tick} / {maxTick}
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-100 shadow-lg ring-1 ring-neutral-700"
          style={{ left: `${(hover.x / 1000) * 100}%` }}
        >
          <span className="text-neutral-400">t={hover.marker.tick}</span>{" "}
          {hover.marker.summary}
        </div>
      )}
    </div>
  );
}
