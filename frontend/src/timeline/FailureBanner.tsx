// Above-the-timeline banner for issue #0035. Hidden when no failure is loaded.
// Compact when there's exactly one failure (the common case today). Expandable
// list of rows when the runner ever produces multiple failures per run — each
// row jumps the scrubber + recenters the camera on the failing position.

import { useState } from "react";

import { failureCoordinate, failureMessage, failureTick, useFailureStore } from "../store/failure";
import { useReplayStore } from "../store/replay";
import { useCameraStore } from "../world/cameraStore";
import type { AssertFailure } from "../api/types";

export default function FailureBanner() {
  const status = useFailureStore((s) => s.status);
  const visible = useFailureStore((s) => s.visible);
  const setVisible = useFailureStore((s) => s.setVisible);
  const sourceMode = status.kind === "loaded" ? status.sourceMode : null;
  const [expanded, setExpanded] = useState(false);

  if (status.kind !== "loaded") return null;
  const { failures } = status.payload;
  if (failures.length === 0) return null;

  const count = failures.length;
  const headline =
    count === 1
      ? singleHeadline(failures[0]!)
      : `${count} failures detected`;

  return (
    <div className="border-b border-red-900/60 bg-red-950/40 px-3 py-1.5 text-xs text-red-100">
      <div className="flex items-center gap-2">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-red-500" />
        <span className="font-medium">{headline}</span>
        {sourceMode === "inline" ? (
          <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
            inline
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {count > 1 ? (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="rounded px-1.5 py-0.5 text-[11px] text-red-200 hover:bg-red-900/40"
            >
              {expanded ? "Hide list" : "Show list"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="rounded px-1.5 py-0.5 text-[11px] text-red-200 hover:bg-red-900/40"
          >
            {visible ? "Hide overlay" : "Show overlay"}
          </button>
        </div>
      </div>
      {sourceMode === "inline" ? (
        <div className="mt-0.5 text-[11px] text-amber-300/80">
          Viewing inline test from URL — file not found on disk; editor is
          read-only.
        </div>
      ) : null}
      {count > 1 && expanded ? (
        <ul className="mt-1.5 space-y-0.5">
          {failures.map((f, i) => (
            <FailureRow key={i} failure={f} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function singleHeadline(f: AssertFailure): string {
  const where = positionLabel(f);
  return `Failed at tick ${failureTick(f)}${where ? ` · ${where}` : ""} — ${failureMessage(f)}`;
}

function positionLabel(f: AssertFailure): string | null {
  const coord = failureCoordinate(f);
  if (coord) return `(${coord.join(", ")})`;
  if ("Inventory" in f) return `slot ${f.Inventory.slot}`;
  return null;
}

function FailureRow({ failure }: { failure: AssertFailure }) {
  const where = positionLabel(failure);
  const onClick = () => {
    useReplayStore.getState().setTick(failureTick(failure));
    const coord = failureCoordinate(failure);
    if (coord) {
      // Center the camera on the failure cell. `flyTo` handles tweening.
      const [x, y, z] = coord;
      useCameraStore.getState().flyTo([x + 0.5, y + 0.5, z + 0.5]);
    }
  };
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-red-900/40"
      >
        <span className="font-mono text-red-300">tick {failureTick(failure)}</span>
        {where ? <span className="text-red-200/80">{where}</span> : null}
        <span className="truncate text-red-100/90">{failureMessage(failure)}</span>
      </button>
    </li>
  );
}
