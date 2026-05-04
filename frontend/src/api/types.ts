// Wire types mirroring `crates/flint-viz` serde shapes. Hand-written; keep in
// lockstep with the Rust source.

export type Vec3 = [number, number, number];

export interface TestSummary {
  id: string;
  path: string;
  name: string;
  tags: string[];
  parse_error?: string;
}

// Permissive — full TimelineEntry typing is deferred to #0021 (JSON schema).
export type TimelineEntry = Record<string, unknown>;

export interface SetupSpec {
  cleanup: { region: [Vec3, Vec3] };
}

export interface PlayerConfig {
  inventory?: Partial<Record<PlayerSlot, Item>>;
  selectedHotbar?: number;
  gameMode?: GameMode;
}

export interface TestSpec {
  flintVersion: string | null;
  name: string;
  description: string | null;
  tags: string[];
  dependencies: string[];
  player?: PlayerConfig | null;
  setup: SetupSpec | null;
  timeline: TimelineEntry[];
  breakpoints: number[];
}

export interface TestDetail {
  id: string;
  source: string;
  spec: TestSpec | null;
  parse_error: string | null;
}

export interface ParseError {
  line: number;
  col: number;
  message: string;
}

export interface ReplayResponse {
  spec: TestSpec | null;
  errors: ParseError[];
  replay: Replay | null;
}

// --- Replay wire shape (post-#0010 / #0016) ----------------------------------

export type PlayerSlot =
  | "hotbar1"
  | "hotbar2"
  | "hotbar3"
  | "hotbar4"
  | "hotbar5"
  | "hotbar6"
  | "hotbar7"
  | "hotbar8"
  | "hotbar9"
  | "off_hand"
  | "helmet"
  | "chestplate"
  | "leggings"
  | "boots";

export type BlockFace =
  | "top"
  | "bottom"
  | "north"
  | "south"
  | "east"
  | "west";

export type GameMode = "Survival" | "Creative" | "Adventure" | "Spectator";

export interface Block {
  id: string;
  [prop: string]: unknown;
}

export interface Item {
  id: string;
  count: number;
  [data: string]: unknown;
}

export interface BlockPlacement {
  pos: Vec3;
  block: Block;
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export type BlockChange =
  | { kind: "set"; pos: Vec3; block: Block }
  | { kind: "remove"; pos: Vec3 };

export type ActionEvent =
  | { kind: "place"; pos: Vec3; block: Block }
  | { kind: "place_each"; placements: BlockPlacement[] }
  | { kind: "fill"; region: Aabb; block: Block }
  | { kind: "remove"; pos: Vec3 }
  | {
      kind: "use_item_on";
      pos: Vec3;
      face: BlockFace;
      item: string | null;
      resolved_item: Item | null;
    }
  | {
      kind: "set_slot";
      slot: PlayerSlot;
      item: string | null;
      count: number;
    }
  | { kind: "select_hotbar"; slot: number };

export type AssertionView =
  | { kind: "block"; position: Vec3; expected: Block }
  | { kind: "inventory"; slot: PlayerSlot; expected: Item | null }
  | { kind: "other"; description: string };

export interface SlotChange {
  slot: PlayerSlot;
  item: Item | null;
  previous: Item | null;
}

export interface HotbarChange {
  slot: number;
  previous: number;
}

export interface GameModeChange {
  mode: GameMode;
  previous: GameMode;
}

// All three fields are omitted (not null) when absent.
export interface PlayerDelta {
  slots?: SlotChange[];
  selected_hotbar?: HotbarChange;
  game_mode?: GameModeChange;
}

export interface PlayerSnapshot {
  inventory: Partial<Record<PlayerSlot, Item>>;
  selected_hotbar: number;
  game_mode: GameMode;
}

export interface SourceSpan {
  tick: number;
  event_index: number;
  json_pointer: string;
}

export interface ReplayError {
  tick: number;
  message: string;
}

export interface TickFrame {
  tick: number;
  actions: ActionEvent[];
  block_diff: BlockChange[];
  inventory_diff: PlayerDelta | null;
  assertions: AssertionView[];
}

export interface Replay {
  name: string;
  cleanup_region: Aabb | null;
  initial_player: PlayerSnapshot;
  max_tick: number;
  frames: TickFrame[];
  breakpoints: number[];
  errors?: ReplayError[];
  source_map: SourceSpan[];
}

// --- SSE -------------------------------------------------------------------

export interface FileChangedEvent {
  id: string;
}
