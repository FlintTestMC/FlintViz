# 0032 — Source ↔ visual cross-linking

**Milestone:** M7
**Depends on:** #0016, #0020, #0023, #0028, #0036

## Goal
Bidirectional cross-link so users can navigate between the JSON and the 3D/timeline views.

## Outcome
- **Timeline → editor**: clicking a tick marker scrolls the editor to the matching JSON range and selects it.
- **3D → editor**: clicking a placed block highlights the JSON object in the editor that placed (or last touched) it.
- **Editor → timeline**: when the cursor is inside a `timeline` entry, the timeline highlights that entry's tick.

## Implementation notes
- Convert `json_pointer` (from #0016) into a Monaco `Range` using `jsonc-parser` to walk the source CST.
- Maintain a reverse index `pos → last source pointer` while applying diffs in the store.
- 3D picking: R3F handles raycasting natively. Add `onClick` to the `<instancedMesh>` and use `event.instanceId` to recover which block was clicked. Because picking is on world-space rays through the rotated `<group>` (#0036), Three.js inversely transforms automatically — no manual math needed.
- Cursor → timeline: re-parse the source on cursor move (cheap), find the enclosing `timeline[N]`, dispatch.

## Files
- `frontend/src/editor/jsonPointerToRange.ts`
- `frontend/src/store/replay.ts` (extend with reverse index)
- `frontend/src/timeline/Scrubber.tsx` (handle click)
- `frontend/src/world/World.tsx` (instance click handler)

## Status (post-#0016)

`replay.source_map` is now populated by the engine — this is the only piece of the M3 surface this issue depends on, and its conventions strongly shape how this issue should be implemented.

### Source-map shape and conventions

- Wire type: `SourceSpan { tick: number; event_index: number; json_pointer: string }`. Re-stated from #0010, unchanged.
- **Pointers are top-level only.** `json_pointer` is always `/timeline/N` for some decimal `N`. The engine intentionally does not emit deeper pointers (no `/timeline/3/blocks/2`, no `/timeline/3/checks/0`), even when one timeline entry expands into many events:
  - `place_each` of N placements → 1 `ActionEvent::PlaceEach`, 1 `SourceSpan`. The N placements live inside the action payload; if you want per-placement source highlighting, that's its own future issue, not this one.
  - `assert` with `BlockSpec::Multiple` → N `AssertionView::Block`s, N `SourceSpan`s, all with the **same** `/timeline/N` pointer and consecutive `event_index` values.
  - This means `jsonPointerToRange` only needs to handle the `/timeline/N` shape today. The general RFC-6901 walker is still worth writing (the engine ships an `escape_token` helper for future deeper pointers), but every pointer the wire produces today is just `["timeline", N]`.
- **`event_index` indexes the merged list `(frame.actions ++ frame.assertions)`.** This matters in two places:
  - Reverse index from world block → source pointer: when the store applies a `BlockChange` from `frame.block_diff`, the corresponding `ActionEvent` lives at the same index in `frame.actions` (same emission order — except for `Fill`, where one `ActionEvent::Fill` corresponds to a *range* of `BlockChange::Set`s; see Fill notes below). To get the source pointer for the i-th action, look up `(tick, event_index = i)` in the source map.
  - Reverse index from assertion row → source pointer: for `frame.assertions[j]` on a tick with `A = frame.actions.length`, look up `(tick, event_index = A + j)`. Don't look up bare `j` or you'll mismap any tick that also has actions.
- **One timeline entry can produce multiple spans.** `at: [t1, t2, t3]` produces three frames, three spans, all with the same `/timeline/N` pointer. `BlockSpec::Multiple` produces N spans on the same tick, same pointer, consecutive `event_index`. The forward map (`(tick, event_index) → pointer`) is unique; the reverse map (`pointer → spans`) is many-to-many. For "cursor in `timeline[N]` highlights tick", the reverse map collapses to "any tick that has at least one span pointing here", which is just `Set<tick>` per pointer.
- **Span emission order is spec-order, not sorted.** Spans appear in `replay.source_map` in the order their entries appear in `spec.timeline` (and within an entry, in `at`-tick order). Don't binary-search by tick — build a `Map<tick, Map<event_index, pointer>>` (or `Map<tick, string[]>` indexed by event_index since event_index is dense per tick) once when the replay loads.
- **Rejected actions still get spans.** Oversize `fill` and out-of-range `select_hotbar` push their `ActionEvent` and their `SourceSpan` even when the side-effect is skipped. So clicks on those still resolve to a JSON range.

### Implementation notes specific to this issue

- **Forward index (`event → pointer`)**: build `frontIndex: Map<tick, string[]>` where `frontIndex[tick][event_index] = json_pointer`. O(1) lookup for both timeline-marker clicks and assertion-row clicks.
- **Reverse index for "cursor → tick highlight"**: `pointerToTicks: Map<string, Set<number>>` from `json_pointer → set of ticks that span lands on`. Cheap to build; covers `at: [t1, t2, t3]` (same pointer, multiple ticks) without special-casing.
- **Block-click → source pointer**: the world store already forward-applies `block_diff` — extend it to track the **last** `(tick, event_index)` that wrote each position. For `Place`/`Remove`/`PlaceEach`, the `ActionEvent` index in `frame.actions` is the `event_index`. For `Fill`, the single `ActionEvent::Fill` covers `volume(region)` positions — every position in the fill's AABB maps to the same source pointer (`/timeline/N` of the fill entry). Use `iter_aabb` semantics matching the engine's expansion (see `crates/flint-viz/src/replay/aabb.rs`).
- **Editor → timeline highlight**: when the cursor moves, parse the source to find the enclosing `timeline[N]` index, build the pointer string `/timeline/N`, look it up in `pointerToTicks`. Highlight all returned ticks (typically just one; for `at: [...]` entries, multiple).
- **`jsonPointerToRange`**: only `/timeline/N` ships today, but write the general RFC 6901 walker so deeper pointers don't break it later. Use `jsonc-parser`'s CST visitor; the `N` in `/timeline/N` becomes an array-index lookup at depth 2.

### What `source_map` does NOT cover

- **Block placements inside `place_each`**: there's one span for the whole entry, not per placement. Clicking the block in 3D resolves to the parent `/timeline/N`; if you want to highlight a specific `blocks[k]` inside the editor that's a follow-up enhancement.
- **Individual `checks[k]` inside an `assert`**: same story — one span per resulting `AssertionView`, all pointing at the parent `/timeline/N`. The assertion panel (#0031) renders multi-alternative checks as one grouped row, so this matches.
- **`inventory_diff` entries**: not tracked. The corresponding `ActionEvent` (`SetSlot`, `SelectHotbar`) carries the source pointer; the inventory-diff entries are a derived view of that, not their own events.
