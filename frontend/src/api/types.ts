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

export interface ServerConfig {
  readonly: boolean;
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

// Ordered union of actions + assertions on a tick. Matches `TickEvent` in
// `crates/flint-viz/src/replay/model.rs`.
export type TickEvent =
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
  | { kind: "select_hotbar"; slot: number }
  | { kind: "assert"; views: AssertionView[] };

// One check inside a `TickEvent::Assert`. BlockSpec::Multiple alternatives
// expand to one `block` view per alternative; all share the same parent event.
export type AssertionView =
  | { kind: "block"; position: Vec3; expected: Block }
  | { kind: "inventory"; slot: PlayerSlot; expected: Item | null }
  | { kind: "other"; description: string };

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
  events: TickEvent[];
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

// --- Failure URL payload (#0035) -------------------------------------------
//
// Mirrors `flint_core::viz_link::FailurePayload` and friends. Rust enums are
// serialized externally-tagged by default (no `#[serde(...)]` overrides on
// these types), so e.g. `InfoType::Block(b)` becomes `{ "Block": b }`.

export type AssertPosition =
  | { Coordinate: { x: number; y: number; z: number } }
  | { Slot: { slot: PlayerSlot } };

export type InfoType =
  | { String: string }
  | { Block: Block }
  | { Blocks: Block[] }
  | { Item: Item }
  | { Slot: PlayerSlot };

export interface AssertFailure {
  tick: number;
  error_message: string;
  position: AssertPosition;
  execution_time_ms: number | null;
  expected: InfoType;
  actual: InfoType;
}

export interface FailurePayload {
  version: number;
  spec: TestSpec;
  source_path: string | null;
  failures: AssertFailure[];
  total_ticks: number;
}
