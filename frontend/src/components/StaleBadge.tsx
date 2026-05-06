import { useReplayStore } from "../store/replay";

// Top-right "stale" indicator for the 3D pane — shown when the source has
// parse errors but a previous valid replay survives, so the world view is
// freezing on the last good state (#0033). Subscribe selector matches the
// store's preserved-state contract: `parseErrors.length > 0 && replay !== null`.
export default function StaleBadge() {
  const stale = useReplayStore(
    (s) => s.parseErrors.length > 0 && s.replay !== null,
  );
  if (!stale) return null;
  return (
    <div
      className="pointer-events-auto absolute right-3 top-3 z-10 rounded-md bg-amber-950/80 px-2 py-1 text-[11px] font-medium text-amber-200 ring-1 ring-amber-700/60"
      title="showing last valid replay"
    >
      stale
    </div>
  );
}
