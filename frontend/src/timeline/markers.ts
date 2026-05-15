import type {
  AssertionView,
  Replay,
  TickEvent,
  TickFrame,
  Vec3,
} from "../api/types";

// One marker per event-bearing tick. `kind === "assertion"` is reserved for
// assert-only ticks (no non-assert events on the frame); a frame with mixed
// events is rendered with the action style — actions are the "primary" event.
export interface Marker {
  tick: number;
  kind: "action" | "assertion";
  summary: string;
  // True iff the frame has ≥ 2 events — the scrubber picker UI (#0040) is
  // available for these markers.
  hasMultipleEvents: boolean;
}

function isAssertion(e: TickEvent): boolean {
  return e.kind === "assert";
}

export function buildMarkers(replay: Replay | null): Marker[] {
  if (!replay) return [];
  const out: Marker[] = [];
  for (const frame of replay.frames) {
    if (frame.events.length === 0) continue;
    const hasAction = frame.events.some((e) => !isAssertion(e));
    out.push({
      tick: frame.tick,
      kind: hasAction ? "action" : "assertion",
      summary: summariseFrame(frame),
      hasMultipleEvents: frame.events.length >= 2,
    });
  }
  return out;
}

// Tooltip text. Renders the non-assert events on this tick, falling back to an
// assertion summary for assert-only ticks. Block assertions at the same
// position collapse into one "expect A OR B @ pos" line.
export function summariseFrame(frame: TickFrame): string {
  const parts: string[] = [];
  const actions = frame.events.filter((e) => !isAssertion(e));
  for (const a of actions) parts.push(summariseEvent(a));
  if (parts.length === 0) {
    const allViews: AssertionView[] = [];
    for (const e of frame.events) {
      if (e.kind === "assert") allViews.push(...e.views);
    }
    const grouped = groupAssertions(allViews);
    for (const g of grouped) parts.push(g);
  }
  if (parts.length === 0) return `tick ${frame.tick}`;
  if (parts.length === 1) return parts[0]!;
  if (parts.length <= 3) return parts.join(" • ");
  return `${parts.slice(0, 2).join(" • ")} • +${parts.length - 2} more`;
}

function summariseEvent(event: TickEvent): string {
  switch (event.kind) {
    case "place":
      return `place ${shortBlockId(event.block.id)} @ ${pos(event.pos)}`;
    case "place_each":
      return `place_each ×${event.placements.length}`;
    case "fill": {
      const dx = event.region.max[0] - event.region.min[0] + 1;
      const dy = event.region.max[1] - event.region.min[1] + 1;
      const dz = event.region.max[2] - event.region.min[2] + 1;
      return `fill ${dx}×${dy}×${dz} ${shortBlockId(event.block.id)}`;
    }
    case "remove":
      return `remove ${pos(event.pos)}`;
    case "use_item_on":
      return `use ${event.item ? shortItemId(event.item) : "(empty hand)"} @ ${pos(event.pos)} ${event.face}`;
    case "set_slot":
      return `set_slot ${event.slot} = ${event.item ? `${shortItemId(event.item)}×${event.count}` : "empty"}`;
    case "select_hotbar":
      return `select_hotbar ${event.slot}`;
    case "assert": {
      const lines = groupAssertions(event.views);
      if (lines.length === 0) return "assert";
      if (lines.length === 1) return lines[0]!;
      return `${lines[0]} • +${lines.length - 1} more`;
    }
  }
}

// Short label used by the picker popup: just the event kind.
export function eventKindLabel(event: TickEvent): string {
  return event.kind;
}

function groupAssertions(views: AssertionView[]): string[] {
  const blocksByPos = new Map<string, { pos: Vec3; ids: string[] }>();
  const others: string[] = [];
  for (const v of views) {
    if (v.kind === "block") {
      const key = `${v.position[0]},${v.position[1]},${v.position[2]}`;
      const existing = blocksByPos.get(key);
      if (existing) {
        existing.ids.push(shortBlockId(v.expected.id));
      } else {
        blocksByPos.set(key, {
          pos: v.position,
          ids: [shortBlockId(v.expected.id)],
        });
      }
    } else if (v.kind === "inventory") {
      others.push(
        v.expected
          ? `expect ${shortItemId(v.expected.id)} @ ${v.slot}`
          : `expect empty @ ${v.slot}`,
      );
    } else {
      others.push(v.description);
    }
  }
  const lines: string[] = [];
  for (const g of blocksByPos.values()) {
    lines.push(`expect ${g.ids.join(" OR ")} @ ${pos(g.pos)}`);
  }
  return lines.concat(others);
}

function pos(v: Vec3): string {
  return `(${v[0]},${v[1]},${v[2]})`;
}

function shortBlockId(id: string): string {
  return id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id;
}

function shortItemId(id: string): string {
  return id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id;
}
