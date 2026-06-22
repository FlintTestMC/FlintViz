# 0040 — Separate events (step inside a tick)

## Goal

Let users step through the individual events of a tick — actions and
assertions in source order — to see exactly what each one does, and to
visualize ordering between asserts and actions ("does the assert run
before or after the place on tick T?").

## Outcome

- A **picker popup** appears when the user **clicks the marker of a tick
  with ≥2 events**. (Hover was tried and broke; we use click now.)
- The picker is a **vertical list, positioned above the marker**:
  - `[all]` — full-tick state (default).
  - One row per event, in source order, labeled with the event kind
    only: `place`, `place_each`, `fill`, `remove`, `set_slot`,
    `use_item_on`, `select_hotbar`, `assert`, `assert_state`.
    (Custom labels are out of scope — placeholder for later.)
- Selecting event N is an **instant switch**: rebuild world to
  `tick - 1`, then apply events `0..=N` by walking
  `frame.events` and dispatching on kind. No animation.
- Selecting `[all]` resets to the full-tick state.
- Clicking the marker of the **currently navigated-to tick** toggles
  the picker for that tick.
- Clicking **outside** the picker closes it. If the outside click
  lands on the timeline track, it **also performs the scrub/jump**
  (the click is not consumed by the picker).
- Markers for ticks with `events.length ≥ 2` render with a **subtle
  ring** (or +1 radius) so users know a picker is available.
- The **play button is unaffected** — playback always shows the
  full-tick state and ignores `eventIndex`.
- Ticks with only 1 event do **not** show the picker.

## Bug history

The previous (Sonnet) attempt used **hover** to open the picker and was
killed by a `setPointerCapture` issue in the SVG `onPointerDown` handler:
clicking a marker captured the pointer, which fired `pointerleave` on
the marker `<g>`, clearing the hover state and preventing the picker
from rendering. **Click-to-open removes the hover dependency entirely**,
so the bug cannot recur in the new design.

## Wire-shape change (required)

The current `TickFrame` keeps `actions: ActionEvent[]` and
`assertions: AssertionView[]` in separate arrays, which **loses source
order** between e.g. an `assert` and a `place` on the same tick. The
feature explicitly requires that ordering.

**Change:**

```rust
// crates/flint-viz/src/replay/model.rs
pub struct TickFrame {
    pub tick: u32,
    pub events: Vec<TickEvent>,      // ordered union (was actions + assertions)
    // block_diff, inventory_diff removed — frontend derives from events
}

#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TickEvent {
    // existing ActionEvent variants...
    Place { pos: Vec3, block: Block },
    Fill { region: Aabb, block: Block },
    PlaceEach { placements: Vec<BlockPlacement> },
    Remove { pos: Vec3 },
    UseItemOn { pos: Vec3, face: BlockFace, item: Option<String>, resolved_item: Option<Item> },
    SetSlot { slot: PlayerSlot, item: Option<String>, count: u32 },
    SelectHotbar { slot: u32 },
    // assertion variants merged in:
    AssertBlock { position: Vec3, expected: Block },
    AssertInventory { slot: PlayerSlot, expected: Option<Item> },
    AssertOther { description: String },
}
```

- `source_map`'s `event_index` already indexes the merged stream; with
  the unification it becomes a direct index into `events` (engine no
  longer needs the `actions_in_frame + local_idx` offset trick at
  `engine.rs:113-127`).
- `FILL_BLOCK_CHANGE_CAP` (currently in `engine.rs:196-205`) is no
  longer enforced backend-side because no block changes are emitted.
  **Move the cap to the frontend** so `applyEvent` skips Fill bodies
  with `volume > MAX_FILL_BLOCKS` and surfaces the same error via a
  toast or the existing `replay.errors` channel (TBD by implementer —
  simplest: hardcode the cap in `world.ts` and emit a console warn).

## Frontend changes

### Replay store (`frontend/src/store/replay.ts`)

- Add `eventIndex: number | null` to `ReplayState` (null = "all").
- Reset `eventIndex` to `null` on: tick change (`setTick`), test open,
  replay load. Already-implemented reset hooks line up at
  `replay.ts:66-79, 83-102, 104-121`.
- New action: `setEventIndex(idx: number | null)`. When non-null:
  1. `const { world, player } = rebuildAt(replay, tick - 1);`
  2. Walk `frame.events[0..=idx]` applying each via the new
     `applyEvent` helper.
  3. `set({ eventIndex: idx, worldState: world, player })`.
- When `eventIndex !== null` and `playback === 'playing'`, calling
  `play()` must reset `eventIndex` to `null` (playback only operates
  on full-tick state).

### Event semantics (`frontend/src/store/world.ts`)

- New `applyEvent(world, player, event)` mirroring
  `crates/flint-viz/src/replay/engine.rs::apply_action` exactly. This
  is the **maintenance cost** of "frontend re-runs semantics" — the
  helper must stay in lockstep with the engine. Add a comment header
  flagging this and pointing at `apply_action`.
- Variants to implement:
  - `Place` → `world.set(posKey, block)`
  - `Fill` → iterate AABB, set each (honor MAX_FILL_BLOCKS cap)
  - `PlaceEach` → iterate placements, set each
  - `Remove` → `world.delete(posKey)`
  - `SetSlot` → mutate `player.inventory`
  - `SelectHotbar` → mutate `player.selected_hotbar`
  - `UseItemOn` → no-op for world/player (event-only)
  - `AssertBlock` / `AssertInventory` / `AssertOther` → no-op
- Replace `applyForward(world, player, frame)` to loop
  `frame.events` calling `applyEvent` (since `block_diff` /
  `inventory_diff` are gone).
- `rebuildAt` keeps its signature.

### Scrubber (`frontend/src/timeline/Scrubber.tsx`)

- Marker styling: if `events.length >= 2`, render with `r = MARKER_R + 1.5`
  and a `stroke="#7dd3fc"` ring (or similar — bikeshed).
- New `pickerForTick: number | null` state (which marker's picker is
  open; null = none).
- `onMarkerClick(m)` behavior:
  1. `pause()` + `setTick(m.tick)` + reveal pointer (existing).
  2. If `frame.events.length >= 2` and `pickerForTick === m.tick`,
     close (`pickerForTick = null`); else open (`pickerForTick = m.tick`).
- Picker `<div>` rendered above the SVG at the marker's x-coordinate,
  `bottom: calc(100% + 4px)`. Use a portal only if z-index issues arise.
- Clamp the picker's `left` so it doesn't overflow the scrubber's
  container edges.
- Outside-click handling: a `pointerdown` listener on `document` (added
  while `pickerForTick !== null`). If target is **not** inside the
  picker, close the picker. **Do not stop propagation** — let the
  scrubber's existing pointer-down handler run so the scrub-drag still
  starts.
- Picker row click:
  - `[all]`: `setEventIndex(null)`.
  - row k: `setEventIndex(k)`, then reveal the JSON pointer via
    `pointerForEvent(sourceIndices, tick, k)` — this helper exists in
    spirit in `store/sourceMap.ts:81-99` and may need a tiny
    extension to take an event index.

### Highlights (`frontend/src/world/Highlights.tsx`)

- Read `eventIndex` from the replay store.
- When `eventIndex === null`: existing behavior (all of current tick's
  block changes flash).
- When `eventIndex !== null`: highlight only the block positions
  touched by `frame.events[eventIndex]` (e.g. for `Fill`, all AABB
  cells; for `Place`/`Remove`, one cell; for assertions / inventory
  events, nothing).

### Assertion ghosts (`frontend/src/world/AssertionGhosts.tsx`)

- Read `eventIndex`.
- When `null`: existing behavior (all assertions on the tick render as
  ghosts).
- When non-null and the picked event is an `AssertBlock`: render only
  that single assertion's ghost.
- When non-null and the picked event is anything else: render no
  ghosts (the user is focused on what that action does).

### Assertion panel (`frontend/src/panels/Assertions.tsx`)

- Same rule as ghosts: if `eventIndex` points at an `AssertBlock` /
  `AssertInventory` / `AssertOther`, show only that one; otherwise
  hide the panel content (or show "no assertion at this event").

### Source crosslink

- `store/sourceMap.ts` currently builds per-event indices; verify
  that `event_index` semantics still line up after the wire-shape
  unification (it should, since the engine's source_map already used
  the merged ordering — see `engine.rs:113-127`). Remove the
  `actions_in_frame + local_idx` offset trick on the Rust side and
  update `sourceMap.ts:81-99` accordingly.

### Markers (`frontend/src/timeline/markers.ts`)

- `buildMarkers`: use `frame.events.length` instead of
  `actions.length + assertions.length`. Marker `kind` is `"action"`
  if any non-assert event exists, otherwise `"assertion"`.
- `summariseFrame`: walk `frame.events` and call a new
  `summariseEvent(e)` that dispatches on kind (action variants reuse
  the existing `summariseAction` body; assertion variants reuse
  `groupAssertions`-style text).

### Playback (`frontend/src/timeline/playback.ts`)

- Update both `nextEventTick` / `prevEventTick` to use
  `frame.events.length > 0` (replaces the
  `actions.length > 0 || assertions.length > 0` test at
  `playback.ts:18, 28`).

## Backend changes

- `crates/flint-viz/src/replay/model.rs`: define `TickEvent` enum;
  replace `actions` / `assertions` / `block_diff` / `inventory_diff`
  fields on `TickFrame` with `events`.
- `crates/flint-viz/src/replay/engine.rs`:
  - In `apply_action`, push every action/assertion into `frame.events`
    in the order the timeline produces them. Drop block_diff /
    inventory_diff emission.
  - Drop `FILL_BLOCK_CHANGE_CAP` enforcement (or keep emitting a
    `ReplayError` for huge fills as a warning — implementer choice).
  - Simplify the source-map logic at lines 65-83, 104-127: with a
    single `events` stream, `event_index = local_idx` directly.
- `crates/flint-viz/src/replay/player.rs`: the inventory delta
  builder can be deleted (frontend derives it).
- Adjust all backend tests that check `frame.block_diff` /
  `frame.inventory_diff` / `frame.actions` / `frame.assertions` —
  rewrite to walk `frame.events`.

## Critical files

- `crates/flint-viz/src/replay/model.rs` — wire types
- `crates/flint-viz/src/replay/engine.rs:46-138` — emit logic + source map
- `crates/flint-viz/src/replay/player.rs` — inventory delta builder (delete)
- `frontend/src/api/types.ts` — TS wire types
- `frontend/src/store/replay.ts` — `eventIndex` state + setter
- `frontend/src/store/world.ts` — `applyEvent` (NEW), update `applyForward` / `rebuildAt`
- `frontend/src/store/sourceMap.ts` — confirm event_index alignment, add `pointerForEvent`
- `frontend/src/timeline/Scrubber.tsx` — picker UI + click-to-open
- `frontend/src/timeline/markers.ts` — `events`-based marker building
- `frontend/src/timeline/playback.ts` — events-length check
- `frontend/src/world/Highlights.tsx` — per-event highlight filter
- `frontend/src/world/AssertionGhosts.tsx` — per-event ghost filter
- `frontend/src/panels/Assertions.tsx` — per-event assertion display

## Out of scope

- Keyboard shortcuts for event stepping.
- Custom human-readable labels for events (placeholder text only).
- Reverse-scrubbing optimization using `inventory_diff.previous`
  (since we drop the diff; `rebuildAt` handles backward seeks).

## Verification

- Open a test with a multi-event tick (need a new fixture — see
  below). Click its marker → picker appears.
- Pick each event in turn → world updates instantly; editor scrolls
  to the matching JSON range.
- Pick `[all]` → reset to full-tick state.
- Click outside the picker on a different marker → picker closes,
  navigation jumps.
- Click outside on empty track → picker closes AND scrub jumps.
- Scrub away → `eventIndex` resets to `null`.
- Press play → playback runs full-tick state regardless of prior
  `eventIndex`.
- Run `cargo test -p flint-viz` and `bun test` in `frontend/` — all
  passes after the wire-shape rewrite.

## Test fixtures

No multi-event tick fixture exists today. Add at least one in
`~/flint/FlintCLI/example_tests/` (or `FlintBenchmark/tests/`) that
includes a tick with both an `assert` and a `place` in the same tick
in **both orders** (assert-before-place, place-before-assert) so the
ordering UI is exercised end-to-end. Without this fixture the bug
hunter can't tell ordering broke.
