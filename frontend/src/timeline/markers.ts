import type {
  ActionEvent,
  AssertionView,
  Replay,
  TickFrame,
  Vec3,
} from "../api/types";

// One marker per event-bearing tick. `kind === "assertion"` is reserved for
// assert-only ticks (no actions on the frame); a frame with both actions and
// assertions is rendered with the action style — actions are the "primary"
// event (#0028 status note).
export interface Marker {
  tick: number;
  kind: "action" | "assertion";
  summary: string;
}

export function buildMarkers(replay: Replay | null): Marker[] {
  if (!replay) return [];
  const out: Marker[] = [];
  for (const frame of replay.frames) {
    if (frame.actions.length === 0 && frame.assertions.length === 0) continue;
    const kind: Marker["kind"] =
      frame.actions.length > 0 ? "action" : "assertion";
    out.push({ tick: frame.tick, kind, summary: summariseFrame(frame) });
  }
  return out;
}

// Tooltip text. Renders the action(s) on this tick, falling back to an
// assertion summary for assert-only ticks. The `BlockSpec::Multiple` grouping
// rule from the issue status note is mirrored from AssertionGhosts: assertions
// at the same position collapse into one "expect A OR B @ pos" line.
export function summariseFrame(frame: TickFrame): string {
  const parts: string[] = [];
  for (const a of frame.actions) parts.push(summariseAction(a));
  if (parts.length === 0) {
    const grouped = groupAssertions(frame.assertions);
    for (const g of grouped) parts.push(g);
  }
  if (parts.length === 0) return `tick ${frame.tick}`;
  if (parts.length === 1) return parts[0]!;
  if (parts.length <= 3) return parts.join(" • ");
  return `${parts.slice(0, 2).join(" • ")} • +${parts.length - 2} more`;
}

function summariseAction(action: ActionEvent): string {
  switch (action.kind) {
    case "place":
      return `place ${shortBlockId(action.block.id)} @ ${pos(action.pos)}`;
    case "place_each":
      return `place_each ×${action.placements.length}`;
    case "fill": {
      const dx = action.region.max[0] - action.region.min[0] + 1;
      const dy = action.region.max[1] - action.region.min[1] + 1;
      const dz = action.region.max[2] - action.region.min[2] + 1;
      return `fill ${dx}×${dy}×${dz} ${shortBlockId(action.block.id)}`;
    }
    case "remove":
      return `remove ${pos(action.pos)}`;
    case "use_item_on":
      return `use ${action.item ? shortItemId(action.item) : "(empty hand)"} @ ${pos(action.pos)} ${action.face}`;
    case "set_slot":
      return `set_slot ${action.slot} = ${action.item ? `${shortItemId(action.item)}×${action.count}` : "empty"}`;
    case "select_hotbar":
      return `select_hotbar ${action.slot}`;
  }
}

function groupAssertions(assertions: AssertionView[]): string[] {
  // Group block-kind assertions by position; produce one line per group.
  const blocksByPos = new Map<string, { pos: Vec3; ids: string[] }>();
  const others: string[] = [];
  for (const v of assertions) {
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
