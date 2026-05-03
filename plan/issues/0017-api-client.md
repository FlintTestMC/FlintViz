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
