import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCrosslinkStore } from "../store/crosslink";
import { useReplayStore } from "../store/replay";
import { pointerForEvent, pointerForTick } from "../store/sourceMap";
import { buildMarkers, eventKindLabel, type Marker } from "./markers";

const TRACK_HEIGHT = 36;
const PADDING_X = 12;
const MARKER_R = 3.5;

// Horizontal SVG scrubber. Drag the playhead to move `tick`; markers light up
// every event-bearing tick (bolder for assert-only ticks, ringed for ticks
// with ≥ 2 events) and breakpoints render as red flags.
//
// Marker click jumps + reveals source. For multi-event ticks, clicking opens
// a vertical picker popup above the marker; rows let the user step inside
// the tick (#0040).
export default function Scrubber() {
  const replay = useReplayStore((s) => s.replay);
  const tick = useReplayStore((s) => s.tick);
  const setTick = useReplayStore((s) => s.setTick);
  const setEventIndex = useReplayStore((s) => s.setEventIndex);
  const eventIndex = useReplayStore((s) => s.eventIndex);
  const pause = useReplayStore((s) => s.pause);

  const markers = useMemo(() => buildMarkers(replay), [replay]);
  const breakpoints = replay?.breakpoints ?? [];
  const maxTick = replay?.max_tick ?? 0;
  const sourceIndices = useReplayStore((s) => s.sourceIndices);
  const highlightedTicks = useCrosslinkStore((s) => s.highlightedTicks);
  const revealPointer = useCrosslinkStore((s) => s.revealPointer);

  const [pickerForTick, setPickerForTick] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const onMarkerClick = useCallback(
    (m: Marker) => {
      pause();
      const wasOnSameTick = tick === m.tick;
      setTick(m.tick);
      const pointer = pointerForTick(sourceIndices, m.tick);
      if (pointer) revealPointer(pointer);
      if (m.hasMultipleEvents) {
        if (wasOnSameTick && pickerForTick === m.tick) {
          setPickerForTick(null);
        } else {
          setPickerForTick(m.tick);
        }
      } else {
        setPickerForTick(null);
      }
    },
    [pause, setTick, sourceIndices, revealPointer, tick, pickerForTick],
  );

  // Close the picker on outside click. We *don't* stopPropagation so a click
  // on the scrubber track still scrubs (#0040 outcome).
  useEffect(() => {
    if (pickerForTick === null) return;
    const onDocDown = (e: PointerEvent) => {
      const picker = pickerRef.current;
      if (picker && e.target instanceof Node && picker.contains(e.target)) {
        return;
      }
      // Marker click handles toggle itself; doc handler must not race ahead.
      if (
        e.target instanceof Element &&
        e.target.closest('[data-marker="1"]')
      ) {
        return;
      }
      setPickerForTick(null);
    };
    document.addEventListener("pointerdown", onDocDown);
    return () => document.removeEventListener("pointerdown", onDocDown);
  }, [pickerForTick]);

  // Picker only makes sense while on its tick; if the user navigates away
  // (via setTick from another route), close it.
  useEffect(() => {
    if (pickerForTick !== null && pickerForTick !== tick) {
      setPickerForTick(null);
    }
  }, [tick, pickerForTick]);

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

  const pickerFrame =
    pickerForTick !== null
      ? replay.frames.find((f) => f.tick === pickerForTick)
      : null;

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
          const baseR = isAssertion ? MARKER_R + 1.5 : MARKER_R;
          const r = m.hasMultipleEvents ? baseR + 1 : baseR;
          return (
            <g
              key={`m-${m.tick}`}
              onPointerEnter={() => setHover({ marker: m, x: cx })}
              onPointerLeave={() =>
                setHover((h) => (h?.marker === m ? null : h))
              }
              onPointerDown={(e) => {
                // Block svg's drag-to-scrub handler (which calls
                // setPointerCapture and can eat the subsequent click).
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onMarkerClick(m);
              }}
              style={{ cursor: "pointer" }}
            >
              {isHighlighted && (
                <circle
                  cx={cx}
                  cy={TRACK_HEIGHT / 2}
                  r={r + 4}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                  opacity={0.9}
                />
              )}
              {m.hasMultipleEvents && !isHighlighted && (
                <circle
                  cx={cx}
                  cy={TRACK_HEIGHT / 2}
                  r={r + 2}
                  fill="none"
                  stroke="#7dd3fc"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  opacity={0.6}
                />
              )}
              <circle
                cx={cx}
                cy={TRACK_HEIGHT / 2}
                r={r}
                fill={isAssertion ? "#fbbf24" : "#a3a3a3"}
                stroke={isAssertion ? "#facc15" : "transparent"}
                strokeWidth={isAssertion ? 1.5 : 0}
                vectorEffect="non-scaling-stroke"
              />
              {/* Larger invisible hit region for hover/click on dense tracks.
                  Tall + wide so clicks anywhere near the marker land. The
                  data-marker attr lets the document-level outside-click
                  handler distinguish a marker click from a track click. */}
              <rect
                data-marker="1"
                x={cx - 12}
                y={0}
                width={24}
                height={TRACK_HEIGHT}
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

      {hover && pickerForTick === null && (
        <div
          className="pointer-events-none absolute -top-7 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-100 shadow-lg ring-1 ring-neutral-700"
          style={{ left: `${(hover.x / 1000) * 100}%` }}
        >
          <span className="text-neutral-400">t={hover.marker.tick}</span>{" "}
          {hover.marker.summary}
        </div>
      )}

      {pickerFrame && (
        <div
          ref={pickerRef}
          className="absolute z-20"
          style={{
            left: `${(tickToX(pickerFrame.tick, 1000) / 1000) * 100}%`,
            bottom: "calc(100% + 4px)",
            transform: "translateX(-50%)",
          }}
        >
          <div className="flex min-w-[120px] flex-col gap-0.5 rounded bg-neutral-900 p-1 text-[11px] text-neutral-100 shadow-xl ring-1 ring-neutral-700">
            <button
              type="button"
              onClick={() => {
                setEventIndex(null);
              }}
              className={`rounded px-2 py-0.5 text-left hover:bg-neutral-800 ${
                eventIndex === null ? "bg-neutral-800 text-sky-300" : ""
              }`}
            >
              [all]
            </button>
            {pickerFrame.events.map((ev, i) => (
              <button
                key={`pe-${i}`}
                type="button"
                onClick={() => {
                  setEventIndex(i);
                  const ptr = pointerForEvent(
                    sourceIndices,
                    pickerFrame.tick,
                    i,
                  );
                  if (ptr) revealPointer(ptr);
                }}
                className={`rounded px-2 py-0.5 text-left hover:bg-neutral-800 ${
                  eventIndex === i ? "bg-neutral-800 text-sky-300" : ""
                }`}
              >
                <span className="mr-1 text-neutral-500 tabular-nums">
                  {i}.
                </span>
                {eventKindLabel(ev)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
