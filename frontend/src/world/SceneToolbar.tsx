import type { Rotation } from "../store/replay";
import { useReplayStore } from "../store/replay";
import { useCameraStore } from "./cameraStore";
import { useOverlayStore } from "./overlayStore";

const ROTATIONS: Rotation[] = [0, 1, 2, 3];

// Single overlay-control toolbar for the visualization header. Subsumes the
// cleanup toggle + reset-view button that previously lived in App.tsx, plus
// the new rotation buttons (#0036).
export default function SceneToolbar() {
  return (
    <div className="flex items-center gap-2">
      <RotationButtons />
      <CleanupToggleButton />
      <ResetViewButton />
    </div>
  );
}

function RotationButtons() {
  const rotation = useReplayStore((s) => s.rotation);
  const setRotation = useReplayStore((s) => s.setRotation);
  return (
    <div className="flex items-center gap-1 rounded border border-neutral-700 bg-neutral-900 p-0.5">
      {ROTATIONS.map((r) => {
        const active = r === rotation;
        return (
          <button
            key={r}
            type="button"
            onClick={() => setRotation(r)}
            aria-pressed={active}
            className={`rounded px-2 py-0.5 text-xs font-normal transition-colors ${
              active
                ? "bg-sky-900 text-sky-100"
                : "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
            }`}
          >
            {r * 90}°
          </button>
        );
      })}
    </div>
  );
}

function CleanupToggleButton() {
  const visible = useOverlayStore((s) => s.cleanupVisible);
  const toggle = useOverlayStore((s) => s.toggleCleanup);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={visible}
      className={`rounded border px-2 py-1 text-xs font-normal transition-colors ${
        visible
          ? "border-sky-700 bg-sky-950 text-sky-200 hover:bg-sky-900"
          : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
      }`}
    >
      Cleanup region
    </button>
  );
}

function ResetViewButton() {
  const resetView = useCameraStore((s) => s.resetView);
  return (
    <button
      type="button"
      onClick={resetView}
      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-normal text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
    >
      Reset view
    </button>
  );
}
