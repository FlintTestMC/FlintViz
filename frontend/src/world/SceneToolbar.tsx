import { useCameraStore } from "./cameraStore";
import { useOverlayStore } from "./overlayStore";

// Single overlay-control toolbar for the visualization header. Subsumes the
// cleanup toggle + reset-view button that previously lived in App.tsx.
export default function SceneToolbar() {
  return (
    <div className="flex items-center gap-2">
      <CleanupToggleButton />
      <ResetViewButton />
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
