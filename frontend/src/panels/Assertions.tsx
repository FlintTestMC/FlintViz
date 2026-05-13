import { useMemo } from "react";

import type {
  AssertionView,
  Block,
  Item,
  PlayerSlot,
  TickEvent,
  Vec3,
} from "../api/types";
import { useCrosslinkStore } from "../store/crosslink";
import { useReplayStore } from "../store/replay";
import { pointerForEvent } from "../store/sourceMap";
import { useCameraStore } from "../world/cameraStore";
import { slotLabel } from "./Inventory";

// Current-tick assertion list. Reads the assert-kind entries from
// `frame.events`. Block-position rows expose a 📍 button that publishes a
// fly-to target via `cameraStore` — inventory and `other` rows are read-only
// summaries.
//
// `BlockSpec::Multiple` produces N adjacent `assert_block` events at the same
// coord; we group by position and render one row per group with the
// alternatives joined by "OR" (mirrors the AssertionGhosts label).
//
// When the event picker (#0040) has selected event N: show that single
// assertion if it is an assert_*; otherwise show nothing.
export default function Assertions() {
  const tick = useReplayStore((s) => s.tick);
  const eventIndex = useReplayStore((s) => s.eventIndex);
  const frames = useReplayStore((s) => s.replay?.frames ?? null);
  const sourceIndices = useReplayStore((s) => s.sourceIndices);
  const revealPointer = useCrosslinkStore((s) => s.revealPointer);

  const groups = useMemo(() => {
    if (!frames) return [];
    const frame = frames.find((f) => f.tick === tick);
    if (!frame) return [];
    const events: TickEvent[] =
      eventIndex != null
        ? frame.events[eventIndex]
          ? [frame.events[eventIndex]!]
          : []
        : frame.events;
    const all: { idx: number; view: AssertionView }[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      if (ev.kind !== "assert") continue;
      // Reveal-in-editor maps to the parent event's index, not the view's
      // position within the assert. eventIndex (when set) is the real index.
      const parentIdx = eventIndex != null ? eventIndex : i;
      for (const v of ev.views) all.push({ idx: parentIdx, view: v });
    }
    return groupAssertions(all);
  }, [frames, tick, eventIndex]);

  const onRowClick = (firstEventIndex: number) => {
    const pointer = pointerForEvent(sourceIndices, tick, firstEventIndex);
    if (pointer) revealPointer(pointer);
  };

  return (
    <div className="flex h-full flex-col bg-neutral-950 p-2 text-xs text-neutral-200">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium uppercase tracking-wider text-neutral-400">
          Assertions
        </span>
        <span className="text-xs text-neutral-500">tick {tick}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] italic text-neutral-500">
            No assertions at this tick
          </div>
        ) : (
          <ul className="space-y-1">
            {groups.map((g, i) => (
              <Row key={`${g.kind}-${i}`} group={g} onReveal={onRowClick} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type AssertionGroup =
  | {
      kind: "block";
      position: Vec3;
      expecteds: Block[];
      firstEventIndex: number;
    }
  | {
      kind: "inventory";
      slot: PlayerSlot;
      expected: Item | null;
      firstEventIndex: number;
    }
  | { kind: "other"; description: string; firstEventIndex: number };

function groupAssertions(
  entries: { idx: number; view: AssertionView }[],
): AssertionGroup[] {
  const blocksByPos = new Map<
    string,
    { position: Vec3; expecteds: Block[]; firstEventIndex: number }
  >();
  const others: AssertionGroup[] = [];
  for (const { idx, view } of entries) {
    if (view.kind === "block") {
      const key = `${view.position[0]},${view.position[1]},${view.position[2]}`;
      const existing = blocksByPos.get(key);
      if (existing) {
        existing.expecteds.push(view.expected);
      } else {
        blocksByPos.set(key, {
          position: view.position,
          expecteds: [view.expected],
          firstEventIndex: idx,
        });
      }
    } else if (view.kind === "inventory") {
      others.push({
        kind: "inventory",
        slot: view.slot,
        expected: view.expected,
        firstEventIndex: idx,
      });
    } else {
      others.push({
        kind: "other",
        description: view.description,
        firstEventIndex: idx,
      });
    }
  }
  const grouped: AssertionGroup[] = [];
  for (const g of blocksByPos.values()) {
    grouped.push({
      kind: "block",
      position: g.position,
      expecteds: g.expecteds,
      firstEventIndex: g.firstEventIndex,
    });
  }
  return grouped.concat(others);
}

function Row({
  group,
  onReveal,
}: {
  group: AssertionGroup;
  onReveal: (firstEventIndex: number) => void;
}) {
  switch (group.kind) {
    case "block":
      return (
        <BlockRow
          position={group.position}
          expecteds={group.expecteds}
          onReveal={() => onReveal(group.firstEventIndex)}
        />
      );
    case "inventory":
      return (
        <InventoryRow
          slot={group.slot}
          expected={group.expected}
          onReveal={() => onReveal(group.firstEventIndex)}
        />
      );
    case "other":
      return (
        <OtherRow
          description={group.description}
          onReveal={() => onReveal(group.firstEventIndex)}
        />
      );
  }
}

function BlockRow({
  position,
  expecteds,
  onReveal,
}: {
  position: Vec3;
  expecteds: Block[];
  onReveal: () => void;
}) {
  const flyTo = useCameraStore((s) => s.flyTo);
  const ids = expecteds.map((b) => shortId(b.id)).join(" OR ");
  const onFly = () => {
    flyTo([position[0] + 0.5, position[1] + 0.5, position[2] + 0.5]);
  };
  return (
    <li className="flex items-center gap-2 rounded bg-neutral-900 px-2 py-1 ring-1 ring-neutral-800">
      <KindBadge label="block" color="amber" />
      <button
        type="button"
        onClick={onReveal}
        title="Reveal in editor"
        className="flex-1 truncate text-left hover:underline"
      >
        expect <span className="text-neutral-100">{ids}</span>
        <span className="text-neutral-500"> @ ({position.join(",")})</span>
      </button>
      <button
        type="button"
        onClick={onFly}
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
  onReveal,
}: {
  slot: PlayerSlot;
  expected: Item | null;
  onReveal: () => void;
}) {
  const text = expected
    ? `expect ${shortId(expected.id)}${expected.count > 1 ? ` × ${expected.count}` : ""} @ ${slotLabel(slot)}`
    : `expect empty @ ${slotLabel(slot)}`;
  return (
    <li className="flex items-center gap-2 rounded bg-neutral-900 px-2 py-1 ring-1 ring-neutral-800">
      <KindBadge label="inv" color="emerald" />
      <button
        type="button"
        onClick={onReveal}
        title="Reveal in editor"
        className="flex-1 truncate text-left hover:underline"
      >
        {text}
      </button>
    </li>
  );
}

function OtherRow({
  description,
  onReveal,
}: {
  description: string;
  onReveal: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded bg-neutral-900 px-2 py-1 ring-1 ring-neutral-800">
      <KindBadge label="other" color="neutral" />
      <button
        type="button"
        onClick={onReveal}
        title="Reveal in editor"
        className="flex-1 truncate text-left hover:underline"
      >
        {description}
      </button>
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
