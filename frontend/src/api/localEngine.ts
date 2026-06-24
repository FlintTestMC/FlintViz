import type {
  AssertionView,
  Block,
  BlockFace,
  BlockPlacement,
  GameMode,
  Item,
  PlayerSlot,
  PlayerSnapshot,
  Replay,
  ReplayError,
  ReplayResponse,
  SourceSpan,
  TestSpec,
  TickFrame,
  TimelineEntry,
  Vec3,
} from "./types";

const PLAYER_SLOTS: readonly PlayerSlot[] = [
  "hotbar1",
  "hotbar2",
  "hotbar3",
  "hotbar4",
  "hotbar5",
  "hotbar6",
  "hotbar7",
  "hotbar8",
  "hotbar9",
  "off_hand",
  "helmet",
  "chestplate",
  "leggings",
  "boots",
];

const BLOCK_FACES: readonly BlockFace[] = [
  "top",
  "bottom",
  "north",
  "south",
  "east",
  "west",
];

const GAME_MODES: readonly GameMode[] = [
  "Survival",
  "Creative",
  "Adventure",
  "Spectator",
];

/** Raw JSON shape the local replay engine reads (snake_case timeline fields). */
interface LocalParsedSpec {
  name: string;
  setup?: {
    cleanup?: { region?: [Vec3, Vec3] };
    player?: {
      selected_hotbar?: number;
      game_mode?: GameMode;
      inventory?: Record<string, unknown>;
    };
  };
  timeline: TimelineEntry[];
  breakpoints?: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [x, y, z] = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") {
    return null;
  }
  return [x, y, z];
}

function asVec3Pair(value: unknown): [Vec3, Vec3] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const min = asVec3(value[0]);
  const max = asVec3(value[1]);
  if (!min || !max) return null;
  return [min, max];
}

function asBlock(value: unknown): Block | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return value as Block;
}

function asPlayerSlot(value: unknown): PlayerSlot | null {
  if (typeof value !== "string") return null;
  return PLAYER_SLOTS.includes(value as PlayerSlot) ? (value as PlayerSlot) : null;
}

function asBlockFace(value: unknown): BlockFace | null {
  if (typeof value !== "string") return null;
  return BLOCK_FACES.includes(value as BlockFace) ? (value as BlockFace) : null;
}

function asGameMode(value: unknown): GameMode | null {
  if (typeof value !== "string") return null;
  return GAME_MODES.includes(value as GameMode) ? (value as GameMode) : null;
}

function asItem(value: unknown): Item | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const count = typeof value.count === "number" ? value.count : 1;
  return { ...value, id: value.id, count } as Item;
}

function resolveTicks(at: unknown): number[] {
  if (typeof at === "number") return [at];
  if (!Array.isArray(at)) return [];
  return at.filter((tick): tick is number => typeof tick === "number");
}

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < Math.min(offset, text.length); i++) {
    if (text[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

function parseJsonSyntaxError(source: string, err: unknown): ReplayResponse {
  const message = err instanceof Error ? err.message : String(err);
  let line = 1;
  let col = 1;

  const posMatch = message.match(/at position (\d+)/i) || message.match(/position (\d+)/i);
  if (posMatch?.[1]) {
    const pos = parseInt(posMatch[1], 10);
    const loc = offsetToLineCol(source, pos);
    line = loc.line;
    col = loc.col;
  } else {
    const lineColMatch =
      message.match(/line (\d+)\s+column\s+(\d+)/i) ||
      message.match(/line (\d+)\s+col\s+(\d+)/i);
    if (lineColMatch?.[1] && lineColMatch[2]) {
      line = parseInt(lineColMatch[1], 10);
      col = parseInt(lineColMatch[2], 10);
    }
  }

  return {
    spec: null,
    errors: [{ line, col, message }],
    replay: null,
  };
}

function parseLocalSpec(raw: unknown): LocalParsedSpec | ReplayResponse {
  if (!isRecord(raw) || Array.isArray(raw)) {
    return {
      spec: null,
      errors: [{ line: 1, col: 1, message: "JSON root must be an object." }],
      replay: null,
    };
  }
  if (typeof raw.name !== "string") {
    return {
      spec: null,
      errors: [{ line: 1, col: 1, message: "Missing or invalid 'name' field." }],
      replay: null,
    };
  }
  if (!Array.isArray(raw.timeline)) {
    return {
      spec: null,
      errors: [{ line: 1, col: 1, message: "Missing or invalid 'timeline' field." }],
      replay: null,
    };
  }

  const setup = isRecord(raw.setup) ? raw.setup : undefined;
  const cleanup = setup && isRecord(setup.cleanup) ? setup.cleanup : undefined;
  const region = cleanup ? asVec3Pair(cleanup.region) : null;
  const playerRaw = setup && isRecord(setup.player) ? setup.player : undefined;

  const player = playerRaw
    ? {
        selected_hotbar: asNumber(playerRaw.selected_hotbar),
        game_mode: asGameMode(playerRaw.game_mode) ?? undefined,
        inventory: isRecord(playerRaw.inventory) ? playerRaw.inventory : undefined,
      }
    : undefined;

  const breakpoints = Array.isArray(raw.breakpoints)
    ? raw.breakpoints.filter((tick): tick is number => typeof tick === "number")
    : undefined;

  return {
    name: raw.name,
    setup: {
      cleanup: region ? { region } : undefined,
      player,
    },
    timeline: raw.timeline as TimelineEntry[],
    breakpoints,
  };
}

export function localReplay(source: string): ReplayResponse {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (err) {
    return parseJsonSyntaxError(source, err);
  }

  const parsed = parseLocalSpec(raw);
  if ("errors" in parsed && "replay" in parsed) {
    return parsed;
  }

  const spec = parsed as LocalParsedSpec;

  try {
    const replay = buildReplayFromSpec(spec);
    return {
      spec: raw as TestSpec,
      errors: [],
      replay,
    };
  } catch (err) {
    return {
      spec: raw as TestSpec,
      errors: [
        {
          line: 1,
          col: 1,
          message: `Replay build error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      replay: null,
    };
  }
}

function buildReplayFromSpec(spec: LocalParsedSpec): Replay {
  const cleanupRegion = spec.setup?.cleanup?.region
    ? {
        min: spec.setup.cleanup.region[0],
        max: spec.setup.cleanup.region[1],
      }
    : null;

  const initialPlayer: PlayerSnapshot = {
    inventory: {},
    selected_hotbar: 1,
    game_mode: "Creative",
  };

  const setupPlayer = spec.setup?.player;
  if (setupPlayer) {
    if (setupPlayer.selected_hotbar !== undefined) {
      initialPlayer.selected_hotbar = setupPlayer.selected_hotbar;
    }
    if (setupPlayer.game_mode !== undefined) {
      initialPlayer.game_mode = setupPlayer.game_mode;
    }
    if (setupPlayer.inventory) {
      for (const [slot, item] of Object.entries(setupPlayer.inventory)) {
        const parsedItem = asItem(item);
        if (parsedItem && asPlayerSlot(slot)) {
          initialPlayer.inventory[slot as PlayerSlot] = parsedItem;
        }
      }
    }
  }

  let maxTick = 0;
  for (const entry of spec.timeline) {
    for (const tick of resolveTicks(entry.at)) {
      maxTick = Math.max(maxTick, tick);
    }
  }
  if (spec.breakpoints) {
    for (const tick of spec.breakpoints) {
      maxTick = Math.max(maxTick, tick);
    }
  }

  const framesMap = new Map<number, TickFrame>();
  const errors: ReplayError[] = [];
  const snapshot: PlayerSnapshot = {
    ...initialPlayer,
    inventory: { ...initialPlayer.inventory },
  };
  const pendingSpans: Array<{
    tick: number;
    timelineIdx: number;
    localIdx: number;
  }> = [];

  for (let timelineIdx = 0; timelineIdx < spec.timeline.length; timelineIdx++) {
    const entry = spec.timeline[timelineIdx];
    if (!isRecord(entry)) continue;

    for (const tick of resolveTicks(entry.at)) {
      let frame = framesMap.get(tick);
      if (!frame) {
        frame = { tick, events: [] };
        framesMap.set(tick, frame);
      }
      const eventsBefore = frame.events.length;

      applyActionLocal(frame, entry, snapshot, errors);

      for (let localIdx = eventsBefore; localIdx < frame.events.length; localIdx++) {
        pendingSpans.push({ tick, timelineIdx, localIdx });
      }
    }
  }

  const filteredFrames = Array.from(framesMap.values())
    .filter((f) => f.events.length > 0)
    .sort((a, b) => a.tick - b.tick);

  const sourceMap: SourceSpan[] = pendingSpans.map((p) => ({
    tick: p.tick,
    event_index: p.localIdx,
    json_pointer: `/timeline/${p.timelineIdx}`,
  }));

  return {
    name: spec.name,
    cleanup_region: cleanupRegion,
    initial_player: initialPlayer,
    max_tick: maxTick,
    frames: filteredFrames,
    breakpoints: spec.breakpoints ?? [],
    errors,
    source_map: sourceMap,
  };
}

function applyActionLocal(
  frame: TickFrame,
  entry: TimelineEntry,
  snapshot: PlayerSnapshot,
  errors: ReplayError[],
) {
  const actionType = asString(entry.do);
  if (!actionType) return;

  switch (actionType) {
    case "place": {
      const pos = asVec3(entry.pos);
      const block = asBlock(entry.block);
      if (pos && block) {
        frame.events.push({ kind: "place", pos, block });
      }
      break;
    }
    case "fill": {
      const region = asVec3Pair(entry.region);
      const block = asBlock(entry.with);
      if (!region || !block) break;

      const min = region[0];
      const max = region[1];
      const dx = max[0] - min[0] + 1;
      const dy = max[1] - min[1] + 1;
      const dz = max[2] - min[2] + 1;
      const volume = dx * dy * dz;

      if (dx <= 0 || dy <= 0 || dz <= 0) {
        errors.push({
          tick: frame.tick,
          message: `fill at tick ${frame.tick} has an inverted region (min > max on some axis); skipped`,
        });
        return;
      }

      const MAX_FILL_BLOCKS = 100000;
      if (volume > MAX_FILL_BLOCKS) {
        errors.push({
          tick: frame.tick,
          message: `fill at tick ${frame.tick} would emit ${volume} block changes (cap is ${MAX_FILL_BLOCKS}); visualization may degrade`,
        });
      }

      frame.events.push({
        kind: "fill",
        region: { min, max },
        block,
      });
      break;
    }
    case "place_each": {
      const blocks = entry.blocks;
      if (!Array.isArray(blocks)) break;
      const placements = blocks
        .map((placement) => {
          if (!isRecord(placement)) return null;
          const pos = asVec3(placement.pos);
          const block = asBlock(placement.block);
          return pos && block ? { pos, block } : null;
        })
        .filter((placement): placement is BlockPlacement => placement !== null);
      if (placements.length > 0) {
        frame.events.push({ kind: "place_each", placements });
      }
      break;
    }
    case "remove": {
      const pos = asVec3(entry.pos);
      if (pos) {
        frame.events.push({ kind: "remove", pos });
      }
      break;
    }
    case "set_slot": {
      const slot = asPlayerSlot(entry.slot);
      if (!slot) break;
      const rawItem = entry.item;
      const item =
        rawItem === undefined || rawItem === null
          ? null
          : (asString(rawItem) ?? null);
      const count = asNumber(entry.count) ?? 1;

      frame.events.push({
        kind: "set_slot",
        slot,
        item,
        count,
      });

      if (item == null) {
        delete snapshot.inventory[slot];
      } else {
        snapshot.inventory[slot] = { id: item, count };
      }
      break;
    }
    case "use_item_on": {
      const pos = asVec3(entry.pos);
      const face = asBlockFace(entry.face);
      if (!pos || !face) break;

      const item = asString(entry.item) ?? null;

      let resolved_item: Item | null = null;
      if (item) {
        resolved_item = { id: item, count: 1 };
      } else {
        const slotName = `hotbar${snapshot.selected_hotbar}` as PlayerSlot;
        const activeItem = snapshot.inventory[slotName];
        if (activeItem) {
          resolved_item = { ...activeItem };
        }
      }

      frame.events.push({
        kind: "use_item_on",
        pos,
        face,
        item,
        resolved_item,
      });
      break;
    }
    case "select_hotbar": {
      const slot = asNumber(entry.slot);
      if (slot === undefined) break;

      frame.events.push({ kind: "select_hotbar", slot });

      if (slot < 1 || slot > 9) {
        errors.push({
          tick: frame.tick,
          message: `select_hotbar at tick ${frame.tick} has slot ${slot} out of range (1..=9); skipped`,
        });
        return;
      }
      snapshot.selected_hotbar = slot;
      break;
    }
    case "assert": {
      const checks = entry.checks;
      if (!Array.isArray(checks)) break;

      const views: AssertionView[] = [];
      for (const check of checks) {
        if (!isRecord(check)) continue;

        const pos = asVec3(check.pos);
        if (pos && check.is !== undefined) {
          if (Array.isArray(check.is)) {
            for (let i = 0; i < check.is.length; i++) {
              const expected = asBlock(check.is[i]);
              if (!expected) continue;
              views.push({
                kind: "block",
                position: pos,
                expected,
                pointer_suffix: `/is/${i}`,
              });
            }
          } else {
            const expected = asBlock(check.is);
            if (expected) {
              views.push({
                kind: "block",
                position: pos,
                expected,
              });
            }
          }
          continue;
        }

        const slot = asPlayerSlot(check.slot);
        if (slot) {
          let expected: Item | null = null;
          if (check.is !== undefined && check.is !== null) {
            expected = asItem(check.is);
          }
          views.push({
            kind: "inventory",
            slot,
            expected,
          });
        }
      }

      if (views.length > 0) {
        frame.events.push({ kind: "assert", views });
      }
      break;
    }
  }
}
