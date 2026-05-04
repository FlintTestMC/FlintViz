# 0017 — Frontend API client

**Milestone:** M4
**Depends on:** #0006, #0007, #0008, #0009

## Goal
A small typed wrapper around `fetch` for `/api/*` endpoints, plus an SSE helper.

## Outcome
- `api.listTests(): Promise<TestSummary[]>`
- `api.getTest(id): Promise<TestDetail>`
- `api.replay(source): Promise<ReplayResponse>`
- `api.events(onEvent): () => void` — opens SSE, returns disposer.
- Types live in `frontend/src/api/types.ts`, hand-written to mirror the Rust serde shapes.

## Implementation notes
- Don't pull in a heavy client lib; native `fetch` + `EventSource` is enough.
- Throw on non-2xx with a typed `ApiError`.

## Files
- `frontend/src/api/client.ts`
- `frontend/src/api/types.ts`
- `frontend/src/api/events.ts`

## Handoff from M1
- Vite dev server runs on `:5173` and proxies both `/api` and `/api/events` to `http://localhost:7878` (configured in `frontend/vite.config.ts`). Use **relative URLs** in the client (`fetch("/api/tests")`, `new EventSource("/api/events")`) so the same code works in dev (proxied), in the embedded release build (same origin), and in the future docker split (frontend container reverse-proxies `/api` to backend container).
- TS is strict with `noUncheckedIndexedAccess`. Array/Map lookups return `T | undefined`; handle it explicitly (no `!` non-null assertions).
- No client lib — keep `fetch` + `EventSource` as the issue specifies. React 18 is in use, so async data fetching can rely on `useEffect` + abort controllers; no Suspense-for-data is required.

## Handoff from #0006 (TestSummary shape)
The Rust serde shape returned from `GET /api/tests` is a flat array. Mirror it in `frontend/src/api/types.ts` as:
```ts
export interface TestSummary {
  id: string;          // forward-slash path relative to the test root, e.g. "redstone/lever_basic.json"
  path: string;        // absolute on-disk path
  name: string;        // `name` field from the test JSON, OR the file stem when parse_error is set
  tags: string[];      // [] when parse_error is set
  parse_error?: string;// snake_case in the wire format; field is omitted (not null) when parsing succeeded
}
```
Notes:
- The wire field is `parse_error` (snake_case from serde), NOT `parseError`. Either match it directly in TS or rename in the client.
- The field is **omitted** from the JSON (via `skip_serializing_if`) on success — code defensively (`summary.parse_error ?? null`).
- `name` is **never** null. On parse failure it falls back to the file stem so the sidebar can still render the file.
- Order is sorted by `id` (ascending) on the server; clients can rely on it.

## Handoff from #0007 (TestDetail shape + status codes)
`GET /api/tests/:id` is wired as `/api/tests/{*id}` (axum 0.8 wildcard). The handler returns `TestDetail`:
```ts
export interface TestDetail {
  id: string;                  // canonicalized id; may differ from the id sent if the URL contained "./" or symlinks
  source: string;              // raw file contents, exactly as on disk (preserve newlines for Monaco)
  spec: TestSpec | null;       // null when parse_error is set
  parse_error: string | null;  // null on success — these two fields are NOT omitted, unlike TestSummary
}
```
Status codes the client must handle:
- **200** — success (incl. parse failures: `spec=null`, `parse_error` set, `source` always present).
- **400** — id escapes the test root (path-traversal attempt). Body: plain text `"id escapes test root"`.
- **404** — id doesn't resolve to a file under the test root (missing, or points to a directory). Body: plain text `"test not found"`.
- **500** — task join failure (shouldn't happen in practice).

Notes:
- Error bodies are `text/plain`, **not** JSON. `ApiError` should fall back to `await res.text()` on non-2xx instead of assuming JSON.
- `id` in the response is the *normalized* form (after canonicalization, with forward slashes). Use `detail.id` rather than the request id when keying caches/store entries — `"sub/./a.json"` becomes `"sub/a.json"`.
- `TestSpec` mirrors `flint_core::test_spec::TestSpec` at rev `b04ad23` (camelCase via serde): `flintVersion: string | null`, `name: string`, `description: string | null`, `tags: string[]`, `dependencies: string[]`, `setup: SetupSpec | null` (with `cleanup: { region: [[i32;3];2] }`), `timeline: TimelineEntry[]`, `breakpoints: number[]`. The `TimelineEntry` shape is a tagged union via the `do` discriminant — don't try to fully type it in this issue; treat it as `unknown` or a permissive `Record<string, unknown>` and let #0021 (JSON schema) drive validation.
- The client should encode each path segment of `id` (e.g. `id.split('/').map(encodeURIComponent).join('/')`) before interpolating into the URL, so block ids with spaces or `+` survive the round-trip.

## Handoff from #0008 (ReplayResponse shape + body semantics)
`POST /api/replay` accepts the **raw editor buffer as the request body** (not wrapped in JSON, not a multipart). Send it as `Content-Type: application/json` with the buffer bytes verbatim:
```ts
fetch("/api/replay", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: editorSource,        // string — exactly what's in the editor, even if malformed
});
```
Response shape (always 200 unless the body is too large):
```ts
export interface ReplayResponse {
  spec: TestSpec | null;            // null when errors is non-empty
  errors: ParseError[];             // empty on success
  replay: null;                     // reserved for M3 — type as `null` for now, will become `Replay | null`
}
export interface ParseError {
  line: number;                     // 1-indexed line where the error was detected
  col: number;                      // 1-indexed column; can be 0 for EOF errors — don't assert >= 1 in Monaco markers
  message: string;
}
```
Status codes:
- **200** — *always* for both success and parse failure. The frontend must inspect `errors.length > 0`, NOT `res.ok`, to decide whether to show squiggles.
- **413** — body exceeded 1 MiB limit. Surface as a typed `ApiError` (`"replay body too large (max 1 MiB)"` or similar). Body comes back as a short text/HTML payload from axum's body-limit layer; don't parse as JSON.
- **5xx** — unexpected server failure; treat as `ApiError`.

Notes:
- `ParseError.col` may be `0` (zero) for EOF errors emitted by `serde_json` — Monaco markers expect `column >= 1`, so clamp with `Math.max(1, err.col)` when translating to markers.
- The body is sent as-is (no JSON.stringify), so an empty editor sends `""` and gets a structured parse error back. That's the desired UX.
- The replay engine is staged for M3; until then `replay` is always `null` even on a fully valid spec. Frontend code that consumes `replay` must guard for `null` and show a "replay not yet computed" placeholder.

### Replay wire shape (post-#0010)

The Rust types live at `crates/flint-viz/src/replay/model.rs` (re-exported from `crates/flint-viz/src/replay/mod.rs`). Wire format uses serde defaults — snake_case field names, internally tagged enums on `kind`. TS mirror:

```ts
export interface Replay {
  name: string;
  cleanup_region: Aabb | null;
  initial_player: PlayerSnapshot;
  max_tick: number;
  frames: TickFrame[];           // sparse — only ticks with at least one event
  breakpoints: number[];
  source_map: SourceSpan[];      // empty until #0016 lands
}

export interface TickFrame {
  tick: number;
  actions: ActionEvent[];
  block_diff: BlockChange[];
  inventory_diff: PlayerDelta | null;
  assertions: AssertionView[];
}

export type BlockChange =
  | { kind: "set"; pos: [number, number, number]; block: Block }
  | { kind: "remove"; pos: [number, number, number] };

export type ActionEvent =
  | { kind: "place"; pos: [number, number, number]; block: Block }
  | { kind: "place_each"; placements: BlockPlacement[] }
  | { kind: "fill"; region: Aabb; block: Block }
  | { kind: "remove"; pos: [number, number, number] }
  | { kind: "use_item_on"; pos: [number, number, number]; face: BlockFace; item: string | null; resolved_item: Item | null }
  | { kind: "set_slot"; slot: PlayerSlot; item: string | null; count: number }
  | { kind: "select_hotbar"; slot: number };

export type AssertionView =
  | { kind: "block"; position: [number, number, number]; expected: Block }
  | { kind: "inventory"; slot: PlayerSlot; expected: Item | null }
  | { kind: "other"; description: string };

export interface PlayerDelta {
  // All three fields are omitted (not null) when absent — code defensively.
  slots?: SlotChange[];
  selected_hotbar?: HotbarChange;
  game_mode?: GameModeChange;
}
export interface SlotChange { slot: PlayerSlot; item: Item | null; previous: Item | null }
export interface HotbarChange { slot: number; previous: number }
export interface GameModeChange { mode: GameMode; previous: GameMode }

export interface PlayerSnapshot {
  inventory: Record<PlayerSlot, Item>;
  selected_hotbar: number;       // 1..=9
  game_mode: GameMode;
}

export interface SourceSpan { tick: number; event_index: number; json_pointer: string }
export interface Aabb { min: [number, number, number]; max: [number, number, number] }

// flint-core re-exports (v1.1.3)
export type PlayerSlot =
  | "hotbar1" | "hotbar2" | "hotbar3" | "hotbar4" | "hotbar5"
  | "hotbar6" | "hotbar7" | "hotbar8" | "hotbar9"
  | "off_hand" | "helmet" | "chestplate" | "leggings" | "boots";
export type BlockFace = "top" | "bottom" | "north" | "south" | "east" | "west";
export type GameMode = "Survival" | "Creative" | "Adventure" | "Spectator"; // PascalCase: GameMode has no rename_all
export interface Block { id: string; [prop: string]: unknown }              // properties flattened onto the object
export interface Item { id: string; count: number; [data: string]: unknown }// data fields flattened onto the object
export interface BlockPlacement { pos: [number, number, number]; block: Block }
```

Notes:
- Once #0011 changes `replay: null` → `replay: Replay | null` on the server, update `ReplayResponse.replay` in lockstep.
- `flint-core` is now pinned to `tag = "v1.1.3"` (was `rev = "b04ad23"`); the `TestSpec` types referenced earlier in this doc are still accurate but now also include `Item`, `PlayerSlot`, `BlockFace`, `GameMode`, `PlayerConfig` (camelCase: `selectedHotbar`, `gameMode`), and the extra `ActionType` variants `UseItemOn`/`SetSlot`/`SelectHotbar`. Mirror them when typing `TimelineEntry` more strictly.

### Status (post-#0037 / #0038)

The wire types listed above are unchanged — they were already locked down by #0010 and remain accurate. What changed is which `ActionEvent` variants the server actually emits today:

- ✅ Emitted: `place`, `place_each`, `fill`, `remove`, `set_slot`, `use_item_on`.
- ⏳ Still no-op (event will be missing until issue lands): `select_hotbar` (#0039). `assert` doesn't appear in `actions` at all — assertions land on `TickFrame.assertions` (#0015).

For `set_slot`, the matching `inventory_diff.slots` entry is also populated (with `previous` captured for O(1) reverse-scrubbing). For `use_item_on`, **no** `inventory_diff` and **no** `block_diff` is emitted — `resolved_item` on the `ActionEvent` is the only state the frontend has to render the action; treat it as a highlight-only event.

### Status (post-#0039)

`select_hotbar` is now wired. Refreshed coverage of the `ActionEvent` variants:

- ✅ Emitted: `place`, `place_each`, `fill`, `remove`, `set_slot`, `use_item_on`, `select_hotbar`.
- ⏳ Still missing: nothing in `actions`. `assert` (#0015) is the only remaining M3 dispatch arm and lands on `TickFrame.assertions` (never on `actions`).

For `select_hotbar`:
- The matching `inventory_diff.selected_hotbar` is a single `HotbarChange { slot, previous }` — `previous` always reflects the value at the start of the tick, so the frontend can reverse-scrub in one hop even when multiple `select_hotbar` entries collapse on the same tick (last write wins).
- Out-of-range slots (`<1` or `>9`) push the `ActionEvent` for timeline visibility but skip the `HotbarChange` and emit a `ReplayError` keyed to that tick. So a frontend handler must:
  - tolerate a `select_hotbar` ActionEvent without a corresponding `HotbarChange` on `inventory_diff`, and
  - surface `replay.errors[i]` near the offending tick (the existing oversize-fill error UX from #0011 already establishes this pattern — keep it identical).
- A `select_hotbar` that *changes* the snapshot **also** changes how a later `use_item_on` resolves on the same replay: `resolved_item` on a `use_item_on` event is computed against the snapshot *after* preceding `select_hotbar` deltas have been applied. The frontend doesn't need to do anything for this — it's already baked into the wire payload — but tests that mock replays should keep that ordering in mind.

With `select_hotbar` wired, the M3 engine surface is feature-complete except for assertions (#0015) and source map (#0016); the wire types in this doc remain authoritative for typing the client.

### Status (post-#0015)

`assert` is now wired and lands on `TickFrame.assertions`. Refreshed coverage:

- ✅ Emitted on `actions`: `place`, `place_each`, `fill`, `remove`, `set_slot`, `use_item_on`, `select_hotbar`. (Unchanged from post-#0039.)
- ✅ Emitted on `assertions`: `assert` — produces `AssertionView::Block { position, expected }` and/or `AssertionView::Inventory { slot, expected }`. `AssertionView::Other { description }` is reserved (see below) but no path in flint-core v1.1.3 currently emits it.
- ⏳ Still missing: source map (#0016) — `replay.source_map` is still `[]`.

Wire shape reminders for the client (already locked by #0010, restated for completeness):

```ts
export type AssertionView =
  | { kind: "block"; position: [number, number, number]; expected: Block }
  | { kind: "inventory"; slot: PlayerSlot; expected: Item | null }
  | { kind: "other"; description: string };
```

Engine-side conventions the client must accommodate:

- One `assert` timeline entry can produce **multiple** `AssertionView`s. Specifically, a `BlockCheck` whose `is` is `BlockSpec::Multiple` expands to **one `AssertionView::Block` per alternative** at the same `position` (e.g. `[stone, dirt]` → two views). The assertion panel (#0031) should render those as a group of alternatives at one position; click-to-fly should navigate to that single position, not to N positions.
- An `assert` entry emits **zero `ActionEvent`s** — assertions never appear on `frame.actions`. Anything that paints the timeline scrubber (#0028) needs to source assertion ticks from `frame.assertions.length > 0`, not from `frame.actions.length > 0`.
- Assert-only ticks now materialise as their own frames. A test like `basic_placement.json` (which has assert-only ticks at `at: 1` and `at: 3`) now produces 4 frames where it produced 2 before. Any client code that assumed `frames.length` matched the count of "block-active" ticks will need to filter on `actions.length > 0` explicitly.
- `AssertionView::Other` is a forward-compat slot for state-style checks (e.g. `expected_count`, comparators). It is **not currently emitted** by the engine — flint-core v1.1.3 has no matching grammar — so the client can render it as a free-text fallback line and not invest in special UI.
- `inventory_diff` is **not** emitted for `assert` entries. They're purely declarative — no snapshot mutation.

### Status (post-#0016)

The M3 engine is now feature-complete. `replay.source_map` is populated; the wire shape was already locked by #0010 and is unchanged:

```ts
export interface SourceSpan { tick: number; event_index: number; json_pointer: string }
```

Conventions the client must rely on:

- **Pointers are top-level only.** Every `json_pointer` is `/timeline/N` (a decimal index into the `timeline` array). The engine intentionally never produces deeper pointers like `/timeline/3/checks/0` or `/timeline/3/blocks/2` — for `place_each` and `assert`-with-multiple-checks, all expanded events still point at the parent timeline entry. This matches how the timeline scrubber (#0028) and assertion panel (#0031) treat each `timeline[N]` entry as the click target.
- **No RFC 6901 escaping appears in practice.** Numeric indices contain no `/` or `~`. The engine ships an `escape_token` helper (`crates/flint-viz/src/replay/source_map.rs`) for future deeper-pointer use, but today's wire bytes are always `/timeline/<digits>`.
- **`(tick, event_index)` is the lookup key.** `event_index` indexes the **merged ordered list `(actions ++ assertions)`** for that tick — i.e. `event_index < frame.actions.length` ↔ `frame.actions[event_index]` and otherwise `frame.assertions[event_index - frame.actions.length]`. Don't index `frame.actions` and `frame.assertions` separately with the same number; you'll mismap any tick where both are populated.
- **One timeline entry can produce multiple spans.** Two cases: (a) `at: [t1, t2, t3]` emits one span per resulting tick, all sharing the same `json_pointer`; (b) `assert` with `BlockSpec::Multiple` emits one span per alternative on the same tick, all sharing the same `json_pointer` with consecutive `event_index` values. The reverse mapping (pointer → set of spans) is many-to-many; the forward mapping (`(tick, event_index)` → pointer) is unique.
- **`place_each` is one span, not one-per-placement.** A `place_each` of N blocks emits a single `ActionEvent::PlaceEach { placements }` and a single `SourceSpan` at `/timeline/N`. The N placements are inspectable off the action event payload, not via separate spans.
- **Rejected actions still get spans.** An oversize `fill` or out-of-range `select_hotbar` still pushes its `ActionEvent` (so the timeline shows the attempt) and therefore still gets a `SourceSpan`. The error is reported separately on `replay.errors[i]`.
- **Span ordering is emission order**, not sorted. Spans are pushed in the order their entries appear in `spec.timeline` (and within an entry, in `at`-tick order, then actions before assertions for that arm). Don't assume sorted by `tick` or `event_index` — build a `Map<tick, Map<event_index, pointer>>` lookup when O(1) reverse access matters (this is what #0032 will do).

The M3 engine surface is now complete. No further `replay.*` shape changes are planned for M3.

## Handoff from #0009 (SSE shape + reconnect semantics)
`GET /api/events` is a long-lived `text/event-stream`. The server only emits one named event today:
```
event: file-changed
data: {"id":"sub/foo.json"}
```
Plus a periodic keep-alive comment line (`: ping`) every 15 s — `EventSource` swallows comments automatically, so client code never sees it.

Wire shape for `data`:
```ts
export interface FileChangedEvent {
  id: string;          // forward-slash path relative to the test root, same id used by /api/tests/:id
}
```

Client implementation notes:
- Use `new EventSource("/api/events")` (relative URL — works in dev via the Vite proxy and in the embedded build at same-origin).
- Listen with `es.addEventListener("file-changed", e => onEvent(JSON.parse(e.data) as FileChangedEvent))`. Do **not** rely on the default `message` handler — the server always names its events.
- `EventSource` reconnects automatically on transport drop, so `api.events(onEvent)` only needs to expose a disposer that calls `es.close()`. No manual retry/backoff loop required.
- Treat the event as a **cache-bust signal**, not a payload. After receiving a `file-changed` for `id`, re-fetch via `api.getTest(id)` (or re-run replay if that file is currently open). The event carries no content — by design, to keep the channel cheap.
- The server debounces bursts to **at most one event per file per 100 ms**, so editors that write+rename or save twice in quick succession yield a single notification. Client code should still be idempotent (e.g. dedupe a re-fetch for the same id within a frame) because multiple distinct files can each fire within the same tick.
- Events fire for `*.json` only, anywhere under the test root (recursive). Non-JSON files and the watcher's own internal directory creates are filtered out server-side; the client doesn't need to filter again.
- Both create and modify surface as `file-changed` (atomic-rename writes show up as a Create on the new path). Removes also fire `file-changed` — there is currently no `file-removed` event. If the frontend cares about deletions specifically, fall back to detecting via a follow-up `getTest` returning 404, or wait for a future iteration to introduce a distinct event name.
- Lagged subscribers (more than 64 unread events buffered) silently miss the overflow rather than disconnecting. In practice this only matters under pathological churn; if it bites, the client can recover by re-listing tests.
- Don't gzip the response on any reverse proxy you put in front of this — `EventSource` and most proxies handle SSE+gzip badly. The Vite dev proxy is already configured correctly (`frontend/vite.config.ts`) and the embedded build doesn't compress.
