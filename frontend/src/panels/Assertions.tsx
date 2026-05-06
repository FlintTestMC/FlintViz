import { useMemo } from "react";

import type { AssertionView, Block, Item, PlayerSlot, Vec3 } from "../api/types";
import { useReplayStore } from "../store/replay";
import { useCameraStore } from "../world/cameraStore";
import { slotLabel } from "./Inventory";

// Current-tick assertion list. Reads `frame.assertions` directly (the engine
// emits assert-only ticks as their own frames per #0015). Block-position rows
// expose a 📍 button that publishes a fly-to target via `cameraStore` —
// inventory and `other` rows are read-only summaries.
//
// `BlockSpec::Multiple` produces N adjacent `AssertionView::Block` entries at
// the same coord; we group by position and render one row per group with the
// alternatives joined by "OR" (mirrors the AssertionGhosts label).
export default function Assertions() {
  const tick = useReplayStore((s) => s.tick);
  const frames = useReplayStore((s) => s.replay?.frames ?? null);

  const groups = useMemo(() => {
    if (!frames) return [];
    const frame = frames.find((f) => f.tick === tick);
    if (!frame) return [];
    return groupAssertions(frame.assertions);
  }, [frames, tick]);

  return (
    <div className="flex h-full flex-col bg-neutral-950 p-2 text-xs text-neutral-200">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium uppercase tracking-wider text-neutral-400">
          Assertions
        </span>
        <span className="text-[10px] text-neutral-500">tick {tick}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] italic text-neutral-500">
            No assertions at this tick
          </div>
        ) : (
          <ul className="space-y-1">
            {groups.map((g, i) => (
              <Row key={`${g.kind}-${i}`} group={g} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type AssertionGroup =
  | { kind: "block"; position: Vec3; expecteds: Block[] }
  | { kind: "inventory"; slot: PlayerSlot; expected: Item | null }
  | { kind: "other"; description: string };

function groupAssertions(views: AssertionView[]): AssertionGroup[] {
  const blocksByPos = new Map<string, { position: Vec3; expecteds: Block[] }>();
  const others: AssertionGroup[] = [];
  for (const v of views) {
    if (v.kind === "block") {
      const key = `${v.position[0]},${v.position[1]},${v.position[2]}`;
      const existing = blocksByPos.get(key);
      if (existing) existing.expecteds.push(v.expected);
      else
        blocksByPos.set(key, {
          position: v.position,
          expecteds: [v.expected],
        });
    } else if (v.kind === "inventory") {
      others.push({ kind: "inventory", slot: v.slot, expected: v.expected });
    } else {
      others.push({ kind: "other", description: v.description });
    }
  }
  const grouped: AssertionGroup[] = [];
  for (const g of blocksByPos.values()) {
    grouped.push({ kind: "block", position: g.position, expecteds: g.expecteds });
  }
  return grouped.concat(others);
}

function Row({ group }: { group: AssertionGroup }) {
  switch (group.kind) {
    case "block":
      return <BlockRow position={group.position} expecteds={group.expecteds} />;
    case "inventory":
      return <InventoryRow slot={group.slot} expected={group.expected} />;
    case "other":
      return <OtherRow description={group.description} />;
  }
}

function BlockRow({
  position,
  expecteds,
}: {
  position: Vec3;
  expecteds: Block[];
}) {
  const flyTo = useCameraStore((s) => s.flyTo);
  const ids = expecteds.map((b) => shortId(b.id)).join(" OR ");
  const onClick = () => {
    // Visual centre of the block — same `+ 0.5` convention the camera framing
    // uses (#0031 handoff from #0024).
    flyTo([position[0] + 0.5, position[1] + 0.5, position[2] + 0.5]);
  };
  return (
    <li className="flex items-center gap-2 rounded bg-neutral-900 px-2 py-1 ring-1 ring-neutral-800">
      <KindBadge label="block" color="amber" />
      <span className="flex-1 truncate" title={`expect ${ids} @ (${position.join(",")})`}>
        expect <span className="text-neutral-100">{ids}</span>
        <span className="text-neutral-500"> @ ({position.join(",")})</span>
      </span>
      <button
        type="button"
        onClick={onClick}
        title="Fly camera here"
        aria-label="Fly camera to block"
        className="rounded px-1.5 py-0.5 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
      >
        📍
      </button>
    </li>
  );
}

function InventoryRow({
  slot,
  expected,
}: {
  slot: PlayerSlot;
  expected: Item | null;
}) {
  const text = expected
    ? `expect ${shortId(expected.id)}${expected.count > 1 ? ` × ${expected.count}` : ""} @ ${slotLabel(slot)}`
    : `expect empty @ ${slotLabel(slot)}`;
  return (
    <li className="flex items-center gap-2 rounded bg-neutral-900 px-2 py-1 ring-1 ring-neutral-800">
      <KindBadge label="inv" color="emerald" />
      <span className="flex-1 truncate" title={text}>
        {text}
      </span>
    </li>
  );
}

function OtherRow({ description }: { description: string }) {
  return (
    <li className="flex items-center gap-2 rounded bg-neutral-900 px-2 py-1 ring-1 ring-neutral-800">
      <KindBadge label="other" color="neutral" />
      <span className="flex-1 truncate" title={description}>
        {description}
      </span>
    </li>
  );
}

function KindBadge({
  label,
  color,
}: {
  label: string;
  color: "amber" | "emerald" | "neutral";
}) {
  const cls = {
    amber: "bg-amber-900/40 text-amber-200 ring-amber-800/60",
    emerald: "bg-emerald-900/40 text-emerald-200 ring-emerald-800/60",
    neutral: "bg-neutral-800 text-neutral-300 ring-neutral-700",
  }[color];
  return (
    <span
      className={`inline-flex w-12 justify-center rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider ring-1 ${cls}`}
    >
      {label}
    </span>
  );
}

function shortId(id: string): string {
  return id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id;
}
