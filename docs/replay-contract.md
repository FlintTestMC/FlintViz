# Replay Contract

The replay engine turns a Flint `TestSpec` into a compact, serializable
`Replay`. The Rust engine emits ordered events; the frontend derives the
current world and player state by applying those events.

This is a contract between:

- `crates/flint-viz/src/replay/model.rs`
- `crates/flint-viz/src/replay/engine.rs`
- `frontend/src/api/types.ts`
- `frontend/src/store/world.ts`
- `frontend/src/store/replay.ts`
- `frontend/src/store/sourceMap.ts`

Change them together.

## Scope

Replay is static visualization. It does not:

- run a Minecraft server,
- validate whether a placement is legal,
- simulate physics,
- update redstone,
- evaluate loot tables,
- apply block entity logic,
- consume items unless the test action directly changes inventory.

The replay answers: "What does this test JSON describe?"

## Top-Level `Replay`

Rust owner: `Replay` in `replay/model.rs`.

TypeScript mirror: `Replay` in `frontend/src/api/types.ts`.

Fields:

- `name`: copied from `TestSpec.name`.
- `cleanup_region`: `setup.cleanup.region` converted to `{ min, max }`, or
  `null`.
- `initial_player`: player inventory, selected hotbar, and game mode at tick 0.
- `max_tick`: `TestSpec::max_tick()`.
- `frames`: sparse list of ticks that have at least one event.
- `breakpoints`: copied from the test.
- `errors`: engine-level warnings/errors that do not necessarily prevent a
  replay from being emitted.
- `source_map`: pointers back to source timeline entries.

`frames` is sparse by design. A tick with no events does not appear.

## Tick Ordering

The engine iterates `spec.timeline` in source order. For each timeline entry it
iterates every tick in `entry.at.to_vec()`.

Events on the same tick preserve source order. This matters for:

- event picker behavior,
- source maps,
- player snapshot updates that later actions read,
- frontend world reconstruction.

The frontend assumes `event_index` is the direct index into
`TickFrame.events`.

## Player Snapshot

`initial_player` comes from `setup.player` when present. Otherwise it defaults
to:

- empty inventory,
- selected hotbar `1`,
- game mode `Creative`.

The Rust engine keeps an internal mutable player snapshot while it walks the
timeline. That snapshot is used to resolve later events such as `use_item_on`.

The frontend starts from `replay.initial_player` and replays events to derive
the visible player state at a tick.

## Event Semantics

### `place`

Rust event:

```json
{
  "kind": "place",
  "pos": [0, 64, 0],
  "block": { "id": "minecraft:stone" }
}
```

Frontend state effect:

- Set `world[pos] = block`.

### `place_each`

Rust event:

```json
{
  "kind": "place_each",
  "placements": [
    { "pos": [0, 64, 0], "block": { "id": "minecraft:stone" } }
  ]
}
```

Frontend state effect:

- Set each listed position to its block.

### `fill`

Rust event:

```json
{
  "kind": "fill",
  "region": { "min": [0, 64, 0], "max": [2, 66, 2] },
  "block": { "id": "minecraft:stone" }
}
```

Rust behavior:

- Converts the Flint region pair to `Aabb`.
- Computes inclusive volume.
- If volume is `0`, records a `ReplayError` and skips the event.
- If volume is greater than `MAX_FILL_BLOCKS` (`100000`), records a
  `ReplayError` but still emits the event.

Frontend state effect:

- Expands the AABB into positions and sets each position.
- Skips inverted or zero-size regions.
- Skips fills larger than `100000` positions to protect the browser.

The backend intentionally does not expand fills into per-block wire changes.

### `remove`

Rust event:

```json
{
  "kind": "remove",
  "pos": [0, 64, 0]
}
```

Frontend state effect:

- Delete `world[pos]`.

### `set_slot`

Rust event:

```json
{
  "kind": "set_slot",
  "slot": "hotbar1",
  "item": "minecraft:dirt",
  "count": 64
}
```

Rust behavior:

- Emits the event.
- Updates the internal player snapshot.

Frontend state effect:

- If `item` is `null`, remove that inventory slot.
- Otherwise set that slot to `{ id: item, count }`.

### `select_hotbar`

Rust event:

```json
{
  "kind": "select_hotbar",
  "slot": 2
}
```

Rust behavior:

- Emits the event even for out-of-range slots.
- If slot is outside `1..=9`, records a `ReplayError` and does not update the
  internal player snapshot.
- If valid, updates `selected_hotbar`.

Frontend state effect:

- Applies only valid slots in `1..=9`.

### `use_item_on`

Rust event:

```json
{
  "kind": "use_item_on",
  "pos": [0, 64, 0],
  "face": "top",
  "item": null,
  "resolved_item": { "id": "minecraft:dirt", "count": 64 }
}
```

Rust behavior:

- Resolves the active item from the explicit `item` override or selected
  hotbar slot.
- Emits the resolved item for display.
- Does not mutate world or inventory.

Frontend state effect:

- No world or inventory state change.
- Other UI can render markers or item badges from the event.

This is deliberate. Static replay cannot know whether the item places a block,
gets consumed, opens a GUI, or performs another game-specific action.

### `assert`

Rust event:

```json
{
  "kind": "assert",
  "views": [
    {
      "kind": "block",
      "position": [0, 64, 0],
      "expected": { "id": "minecraft:stone" }
    }
  ]
}
```

Rust behavior:

- Converts Flint assertion checks into `AssertionView`s.
- Skips empty assert check lists.
- Groups all views from one timeline action into one `TickEvent::Assert`.

Frontend state effect:

- Assertions do not mutate world or player state.
- The assertion panel and ghost overlay render from the event.

Assertion view variants:

- `block`: position plus expected block.
- `inventory`: slot plus expected item or `null`.
- `other`: text description for checks without a richer visual form.

For multi-block alternatives, `pointer_suffix` can point deeper into the
original JSON, such as `/is/1`.

## Source Maps

`Replay.source_map` is a list of:

```json
{
  "tick": 3,
  "event_index": 0,
  "json_pointer": "/timeline/2"
}
```

Rules:

- One source span is emitted for each event that survives into `frames`.
- `event_index` is dense per tick and indexes directly into
  `TickFrame.events`.
- `json_pointer` points to the originating timeline entry.
- Multiple ticks can point to the same timeline entry when `at` contains more
  than one tick.
- Assertion alternatives can append `pointer_suffix` on the frontend to reach a
  deeper source node.

Frontend consumers:

- Timeline marker click uses source indices to reveal a pointer.
- World block click builds a position-to-source map at the current tick.
- Editor cursor movement maps the cursor offset back to the enclosing
  `/timeline/N` pointer and highlights related ticks.
- Assertion rows reveal the pointer for their parent event, optionally with a
  suffix.

## Frontend Replay Mirror

The frontend mirror lives mainly in `frontend/src/store/world.ts`.

Important invariants:

- `applyEvent` must support every `TickEvent` variant.
- `rebuildAt` starts from `replay.initial_player`.
- Forward stepping may mutate a cloned map/player for performance.
- Backward stepping rebuilds from the beginning.
- Event picker mode rebuilds to `tick - 1` and applies events up to the chosen
  event index.
- Failed parse responses must not clear the last good world/player state.

When adding a new event variant:

1. Add or update the Rust `TickEvent` variant.
2. Emit it from `engine.rs`.
3. Add serde tests for its wire shape.
4. Update `frontend/src/api/types.ts`.
5. Update `frontend/src/store/world.ts`.
6. Update source-map or position-source behavior if the event should be
   clickable.
7. Add backend and frontend tests.
8. Update this document.

## Known Limits

- Large fills are protected by a `100000` block cap.
- `Aabb::from_pair` does not reorder coordinates; inverted regions produce
  zero volume.
- `use_item_on` is visual-only.
- The replay does not track entity state.
- The replay model is optimized for display, not for losslessly reserializing
  the original test.
