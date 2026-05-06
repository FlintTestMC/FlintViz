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

## Handoff from #0023 (world renderer)

`frontend/src/world/World.tsx` renders one `<instancedMesh>` per `(blockId, propsKey)` group via the helper in `frontend/src/world/instancing.ts`. The world component lives inside `Scene.tsx`'s `<SceneRoot>` group so picking respects #0036's rotation automatically.

For the click-to-source path:

- Add `onClick={(e) => …}` on the `<instancedMesh>` inside `World.tsx`'s `InstancedNode` (or lift the handler so each `InstanceGroupMesh` receives the group + a callback). The R3F event carries `event.instanceId: number | undefined`.
- `instanceId` indexes into the **rendered** instances `0 .. mesh.count - 1`, which is `group.positions.length`. The mapping `group.positions[instanceId]` recovers the world `[x, y, z]` clicked. (The capacity-bucket trick — backing buffer rounded up to a power of two — does not affect indexing, since we set `mesh.count = positions.length` and only the first `count` instances render.)
- To go from `[x, y, z]` to a JSON pointer, the store needs a reverse index `Map<PosKey, { tick: number; eventIndex: number }>` populated as `applyForward` mutates `worldState`. For `Place`/`PlaceEach`/`Remove`/`UseItemOn`, the `event_index` is the action's index in `frame.actions`. For `Fill`, every position the action expanded into shares the same `event_index` (that of the single `ActionEvent::Fill` in `frame.actions`) — track the source action index, not the per-position diff index.
- `frame.block_diff` does not carry the originating action index. Two safe options: (a) re-derive it by walking `frame.actions` in spec order and recomputing which positions each action would touch, or (b) extend the wire model in a follow-up to attach an `action_index` to each `BlockChange`. (a) is the cheaper path for v1 since the action types are small in count.
- `posKey([x,y,z])` from `frontend/src/store/world.ts` is the canonical key format for the reverse index — match it exactly so lookups work.
- The current `instancing.ts` group key is `${blockId}|${JSON.stringify(sortedProps)}` — opaque to this issue, but if you later need to pick *the block id at* a position without reverse-indexing, the worldState Map is still the source of truth.

For "hover to highlight in editor" (if you add it): R3F supplies `onPointerOver` / `onPointerOut` on the same `<instancedMesh>`. Beware: with `frustumCulled={false}` (set in `World.tsx`), every group is hit-tested every frame; dense worlds may want a coarser hover policy.

## Handoff from #0020 (Monaco editor)

The editor lives at `frontend/src/editor/Editor.tsx` and exposes its Monaco instance via the `onMount` callback (`editor`, `monaco` parameters). For this issue you'll want a stable handle to the editor so other panes (timeline, world) can call `revealRangeInCenter` / `setSelection` on it. Two viable approaches:

- **Lift the editor ref into a Zustand slice** (e.g. `editorRef: IStandaloneCodeEditor | null` set inside `onMount`). Then any pane can grab it from the store without React refs being shared across panels.
- **Or expose an event bus** (`useEditorBus.send({ type: "reveal", range })`) and let the editor subscribe to it. Keeps the editor self-contained but adds a layer.

Either is fine; recommended is the store-ref approach for symmetry with the existing `useReplayStore` pattern.

Constraints to respect when implementing the cross-link in the editor:

- The editor uses **imperative value management** (`defaultValue` + ref + an `applyingExternalRef` guard). Do NOT add a `value` prop to fix issues — it loops with `onChange`. If you need to programmatically replace text (e.g. a "jump and select" action), call `editor.setSelection(range)` + `editor.revealRangeInCenter(range)`; don't `setValue`.
- The editor's marker owner is `MARKER_OWNER = "flint-replay"` (exported from `editor/markers.ts`). The cross-link decorations should NOT use that owner — use Monaco **decorations** (`editor.deltaDecorations`) for highlights, not markers.
- For the cursor → timeline highlight, subscribe to `editor.onDidChangeCursorPosition`. Re-parsing the source on every move is fine (the buffers are small, ≤1 MiB by replay limit) — `jsonc-parser`'s incremental walker is cheap.
- The editor preserves cursor across external reloads (sidebar click / SSE) by snapshotting `Position` and restoring it after `setValue`. If your "click block → highlight in editor" path also wants to preserve scroll, use `editor.setScrollTop(editor.getTopForLineNumber(...))` after `revealRangeInCenter`.
- Empty state: when `testId === null` the editor renders a placeholder `<div>` instead of mounting Monaco. Cross-link triggers must handle the case where `editorRef` is `null` (test not yet selected) — bail silently.

## Handoff from #0021 (JSON schema)

- Schema-validation squiggles use Monaco's internal marker owner; replay-error squiggles use `MARKER_OWNER`. Cross-link decorations (a third visual layer) should be plain decorations, not markers, to avoid touching either set.

## Handoff from #0028 (timeline scrubber)

`frontend/src/timeline/Scrubber.tsx` already renders one marker per event-bearing tick (and the helper `buildMarkers` in `frontend/src/timeline/markers.ts` produces them). The scrubber doesn't yet emit a click-to-source signal — wire that here:

- Markers carry just `{ tick, kind, summary }` today. To resolve "tick was clicked" → source pointer, use the existing rule: `event_index = 0` is the natural target (first emitted entry on that tick — first action when present, else first assertion). Look up `(tick, 0)` in the forward index this issue builds.
- The `<g>` per marker already binds `onPointerEnter`/`onPointerLeave` for tooltips. Add `onClick` on the same group; don't add it on the surrounding `<svg>` (which owns the drag-to-scrub handler) or the click will fire on every drag.
- Drag-to-scrub calls `setTick` continuously and pauses playback on pointer-down; both behaviors should remain unchanged when the click-to-source path is added — clicking a marker to navigate the editor should *also* set the playhead, so calling `setTick(marker.tick)` first and then routing the editor reveal afterwards is fine.
- The scrubber's `<svg>` uses a fixed `viewBox` of 1000×… and `preserveAspectRatio="none"` for horizontal scaling. If you ever surface marker positions to non-SVG consumers, the source of truth for tick→pixel is `tickToX` inside `Scrubber.tsx` — do not duplicate.
- Tooltips are inline (custom div positioned via `%`). If you replace them with Radix tooltips when wiring click-to-source, that's fine; the existing positioning is %-based off the `viewBox` so pixel math still works.

## Handoff from #0029 (playback controls)

Global keyboard shortcuts now live in `frontend/src/timeline/Controls.tsx` behind the `isEditableTarget` guard (skips when an `<input>`/`<textarea>`/`<select>`/contentEditable element has focus). When you add cursor-driven editor↔timeline highlighting:

- The Monaco editor's textarea host is contentEditable — `isEditableTarget` already excludes it, so playback shortcuts (←/→, space, Home/End, R) never steal keystrokes from the editor. Don't add a second keydown listener; extend the existing one in `Controls.tsx` if you need new shortcuts.
- `R` is already bound to `rotateClockwise()`. If "click in editor → highlight tick" wants its own shortcut, pick a non-conflicting key.

## Handoff from #0031 (assertion panel)

`frontend/src/panels/Assertions.tsx` groups `AssertionView::Block` by position (`BlockSpec::Multiple` becomes one row). When wiring "click row → editor":

- The grouped row's natural `event_index` is the first of the consecutive run for that group; per the issue's status note, all members of a `BlockSpec::Multiple` group share the same `/timeline/N` pointer, so picking the first event_index is fine. The panel currently doesn't track `event_index` per row — extend `AssertionGroup` with the originating frame index range, or pass the entire frame to `groupAssertions` and have the panel keep a `firstEventIndex` per group.
- Inventory and `other` rows are one assertion each; their `event_index` is `frame.actions.length + j` where `j` is their offset within `frame.assertions`.
- The 📍 button publishes via `useCameraStore.flyTo`. Editor reveal should route through the editor-ref store (or event bus) you choose for #0032; the panel already imports `useCameraStore`, so reusing the same module-store pattern keeps imports symmetric.

## Handoff from #0030 (inventory panel)

`frontend/src/panels/Inventory.tsx` reads `frame.inventory_diff?.slots` for its change-glow signal. Reverse indexing inventory clicks → source pointer is *not* tracked by `inventory_diff` itself (the source pointer lives on the originating `ActionEvent`, e.g. `set_slot` / `select_hotbar`, in `frame.actions`). If a future "click slot → editor" path is added: walk `frame.actions` for the matching `set_slot` whose `slot` field equals the clicked slot, and reuse that action's `event_index`.
