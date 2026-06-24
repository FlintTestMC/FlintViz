// Default block-state properties (#0048).
//
// The extractor mod emits `frontend/public/blocks.json` as
// `{ "blocks": [ { "name": "oak_stairs", "default_properties": ["HORIZONTAL_FACING=north", …] }, … ] }`.
//
// Two transforms are needed before deepslate can use these:
//
// 1. The mod emits Minecraft's Java `BlockStateProperties` *constant* names
//    (`HORIZONTAL_FACING`, `STAIRS_SHAPE`, `EAST_REDSTONE`, `AGE_7`), but the
//    blockstate JSON deepslate matches against uses the *serialized* property
//    name (`facing`, `shape`, `east`, `age`). The mapping is not mechanical
//    (`HORIZONTAL_FACING`→`facing`, `DOUBLE_BLOCK_HALF`→`half`), so it is
//    table-driven below. Unknown constants fall back to a lowercased form and
//    warn — graceful: the property is simply not defaulted.
// 2. `name` has no namespace; deepslate ids are `minecraft:<name>`. The parsed
//    map is keyed `minecraft:<name>` so `instancing.ts` can look up by
//    `block.id` directly.
//
// Cache semantics mirror `loadAssetZip` / `loadBlockProviders` in `atlas.ts`:
// the file is fetched and parsed exactly once per app load.

// Java `BlockStateProperties` constant name -> serialized blockstate property
// name. Covers every constant currently present in blocks.json (120 distinct).
const PROPERTY_NAME_MAP: Record<string, string> = {
  AGE_1: "age",
  AGE_2: "age",
  AGE_3: "age",
  AGE_4: "age",
  AGE_5: "age",
  AGE_7: "age",
  AGE_15: "age",
  AGE_25: "age",
  ATTACHED: "attached",
  ATTACH_FACE: "face",
  AXIS: "axis",
  BAMBOO_LEAVES: "leaves",
  BED_PART: "part",
  BELL_ATTACHMENT: "attachment",
  BERRIES: "berries",
  BITES: "bites",
  BLOOM: "bloom",
  BOTTOM: "bottom",
  CANDLES: "candles",
  CAN_SUMMON: "can_summon",
  CHEST_TYPE: "type",
  CONDITIONAL: "conditional",
  COPPER_GOLEM_POSE: "pose",
  CRACKED: "cracked",
  CRAFTING: "crafting",
  CREAKING_HEART_STATE: "creaking_heart_state",
  DELAY: "delay",
  DISARMED: "disarmed",
  DISTANCE: "distance",
  DOOR_HINGE: "hinge",
  DOUBLE_BLOCK_HALF: "half",
  DOWN: "down",
  DRAG: "drag",
  DRIED_GHAST_HYDRATION_LEVELS: "hydration",
  DRIPSTONE_THICKNESS: "thickness",
  DUSTED: "dusted",
  EAST: "east",
  EAST_REDSTONE: "east",
  EAST_WALL: "east",
  EGGS: "eggs",
  ENABLED: "enabled",
  EXTENDED: "extended",
  EYE: "eye",
  FACING: "facing",
  FACING_HOPPER: "facing",
  FLOWER_AMOUNT: "flower_amount",
  HALF: "half",
  HANGING: "hanging",
  HAS_BOOK: "has_book",
  HAS_BOTTLE_0: "has_bottle_0",
  HAS_BOTTLE_1: "has_bottle_1",
  HAS_BOTTLE_2: "has_bottle_2",
  HAS_RECORD: "has_record",
  HATCH: "hatch",
  HORIZONTAL_AXIS: "axis",
  HORIZONTAL_FACING: "facing",
  INVERTED: "inverted",
  IN_WALL: "in_wall",
  LAYERS: "layers",
  LEVEL: "level",
  LEVEL_CAULDRON: "level",
  LEVEL_COMPOSTER: "level",
  LEVEL_HONEY: "honey_level",
  LIT: "lit",
  LOCKED: "locked",
  MODE_COMPARATOR: "mode",
  MOISTURE: "moisture",
  NATURAL: "natural",
  NORTH: "north",
  NORTH_REDSTONE: "north",
  NORTH_WALL: "north",
  NOTE: "note",
  NOTEBLOCK_INSTRUMENT: "instrument",
  OCCUPIED: "occupied",
  OMINOUS: "ominous",
  OPEN: "open",
  ORIENTATION: "orientation",
  PERSISTENT: "persistent",
  PICKLES: "pickles",
  PISTON_TYPE: "type",
  POWER: "power",
  POWERED: "powered",
  RAIL_SHAPE: "shape",
  RAIL_SHAPE_STRAIGHT: "shape",
  RESPAWN_ANCHOR_CHARGES: "charges",
  ROTATION_16: "rotation",
  SCULK_SENSOR_PHASE: "sculk_sensor_phase",
  SEGMENT_AMOUNT: "segment_amount",
  SHORT: "short",
  SHRIEKING: "shrieking",
  SIDE_CHAIN_PART: "part",
  SIGNAL_FIRE: "signal_fire",
  SLAB_TYPE: "type",
  SLOT_0_OCCUPIED: "slot_0_occupied",
  SLOT_1_OCCUPIED: "slot_1_occupied",
  SLOT_2_OCCUPIED: "slot_2_occupied",
  SLOT_3_OCCUPIED: "slot_3_occupied",
  SLOT_4_OCCUPIED: "slot_4_occupied",
  SLOT_5_OCCUPIED: "slot_5_occupied",
  SNOWY: "snowy",
  SOUTH: "south",
  SOUTH_REDSTONE: "south",
  SOUTH_WALL: "south",
  STABILITY_DISTANCE: "distance",
  STAGE: "stage",
  STAIRS_SHAPE: "shape",
  STRUCTUREBLOCK_MODE: "mode",
  TEST_BLOCK_MODE: "mode",
  TILT: "tilt",
  TIP: "tip",
  TRIAL_SPAWNER_STATE: "trial_spawner_state",
  TRIGGERED: "triggered",
  UNSTABLE: "unstable",
  UP: "up",
  VAULT_STATE: "vault_state",
  VERTICAL_DIRECTION: "vertical_direction",
  WATERLOGGED: "waterlogged",
  WEST: "west",
  WEST_REDSTONE: "west",
  WEST_WALL: "west",
};

export interface RawBlocksFile {
  blocks?: Array<{ name?: unknown; default_properties?: unknown }>;
}

export type BlockDefaults = Record<string, Record<string, string>>;

const warnedUnmapped = new Set<string>();

// Pure transform — exported so unit tests exercise it without a `fetch`.
export function parseBlockDefaults(raw: RawBlocksFile): BlockDefaults {
  const out: BlockDefaults = {};
  for (const entry of raw.blocks ?? []) {
    if (!entry || typeof entry.name !== "string") continue;
    const props: Record<string, string> = {};
    const list = Array.isArray(entry.default_properties)
      ? entry.default_properties
      : [];
    for (const pair of list) {
      if (typeof pair !== "string") continue;
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const rawKey = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const mapped = PROPERTY_NAME_MAP[rawKey];
      const key = mapped ?? rawKey.toLowerCase();
      if (!mapped && !warnedUnmapped.has(rawKey)) {
        warnedUnmapped.add(rawKey);
        console.warn(
          `blockDefaults: unmapped property constant ${rawKey} (block ${entry.name}); ` +
            `falling back to "${key}". Add it to PROPERTY_NAME_MAP if it should be defaulted.`,
        );
      }
      props[key] = value;
    }
    out[`minecraft:${entry.name}`] = props;
  }
  return out;
}

let cache: Promise<BlockDefaults> | null = null;

export function loadBlockDefaults(): Promise<BlockDefaults> {
  if (cache) return cache;
  cache = fetch(`${import.meta.env.BASE_URL}blocks.json`)
    .then((r) => {
      if (!r.ok) {
        throw new Error(
          `Failed to load ${import.meta.env.BASE_URL}blocks.json (${r.status}). Run the extractor mod to regenerate it.`,
        );
      }
      return r.json() as Promise<RawBlocksFile>;
    })
    .then(parseBlockDefaults);
  return cache;
}

export function resetBlockDefaults(): void {
  cache = null;
}
