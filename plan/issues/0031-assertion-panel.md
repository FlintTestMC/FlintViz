# 0031 — Assertion panel

**Milestone:** M6
**Depends on:** #0018, #0024

## Goal
List all assertions at the current tick in a side panel, with click-to-fly camera behavior.

## Outcome
- Each row: kind icon (block/inventory/other), summary text ("expect stone @ (0,100,0)"), and a "📍" button.
- Clicking 📍 on a block assertion flies the camera to that position.
- Inventory assertions highlight the relevant slot in the inventory panel.
- Empty state when no assertions at this tick.

## Implementation notes
- "Fly to" is a smooth lerp of the OrbitControls target; about 400 ms feels right.

## Files
- `frontend/src/panels/Assertions.tsx`
- `frontend/src/world/cameraFlyTo.ts`

## Status (post-#0015)

The replay engine now populates `TickFrame.assertions`. Wire shape this panel reads:

```ts
type AssertionView =
  | { kind: "block"; position: [number, number, number]; expected: Block }
  | { kind: "inventory"; slot: PlayerSlot; expected: Item | null }
  | { kind: "other"; description: string };
```

(`kind` is serde-tagged, `snake_case` — match on it directly, don't sniff field presence.)

Key engine-side behaviors to render correctly:

- **`BlockSpec::Multiple` expands per-alternative.** A single `assert` entry like `{"pos": [0,0,0], "is": [{"id":"stone"}, {"id":"dirt"}]}` produces **two** `AssertionView::Block` entries at the same `position`. The panel should detect this (group by `position`) and render as one row with alternatives ("expect stone OR dirt @ (0,0,0)") rather than two adjacent rows that look duplicative. Click-to-fly should target that single position.
- **Inventory assertions** use `expected: Item | null`. `null` means "expect this slot to be empty" — render as "expect empty @ hotbar2", not as a placeholder item. The `slot` is a `PlayerSlot` enum value (`"hotbar1".."hotbar9"`, `"head"`, `"chest"`, `"legs"`, `"feet"`, `"offhand"`, `"crafting1".."crafting4"`, `"crafting_result"`); reuse whatever slot-label lookup the inventory panel (#0030) already has.
- **`AssertionView::Other`** is reserved for state-style checks and is **not currently emitted** by the engine — flint-core v1.1.3 has no matching grammar. Safe to render as a free-text fallback line (`description` field) without investing in special UI.
- **`assert` emits zero `ActionEvent`s** and never appears on `frame.actions`. The "list assertions at the current tick" source is `frame.assertions` exclusively.
- **Assert-only ticks now materialise as frames.** `basic_placement.json` produces `frames.length === 4` (was 2 pre-#0015) — assert-only ticks at `at: 1` and `at: 3` show up with empty `actions`/`block_diff` and populated `assertions`. The panel only needs to read `frame.assertions`; nothing changes structurally, just expect more frames.
- **No `inventory_diff` is ever attached to an `assert` entry.** Inventory assertions are descriptive, not prescriptive — they don't write state. Don't try to highlight the slot via the same path as a real `set_slot` change; it's a separate UI signal driven only by the assertion view.

## Status (post-#0016)

`replay.source_map` is now populated and is the path the panel should use to deep-link from an assertion row back to the JSON `assert` entry (when #0032 wires the "click row → editor" interaction):

- The lookup key is `(tick, event_index)`. `event_index` indexes the **merged list `(actions ++ assertions)`**, so for an assertion at `frame.assertions[j]` on a tick where `frame.actions.length === A`, the matching span lives at `event_index === A + j`. Don't look up assertions with bare `j`; you'll get the wrong entry on any tick that also has a `place`/`fill`/etc.
- `BlockSpec::Multiple` produces multiple `AssertionView::Block` entries at the same position **and** multiple `SourceSpan`s — all sharing the same `/timeline/N` pointer, with consecutive `event_index` values. If the panel renders these as a single grouped row ("expect stone OR dirt @ (0,0,0)" per the existing convention), any of the group's `event_index` values yields the same JSON pointer, so picking the first is fine.
- Inventory assertions get one span each. Same `(tick, A + j)` lookup, same `/timeline/N` shape.
- The pointer is always to the parent timeline entry (`/timeline/N`), never to a specific check inside (`/timeline/N/checks/M` is intentionally not produced — see post-#0015 status in 0016). So "click-to-editor" lands on the whole `assert` entry, which matches the existing UX intent.

## Handoff from #0024 (camera + fly-to)

The camera lives at `frontend/src/world/Camera.tsx` and owns `OrbitControls` (Scene.tsx no longer mounts its own). Imperative camera commands flow through a small zustand slice — **do not import `Camera.tsx` or grab a controls ref**; publish via the store and the Camera component animates next frame.

- Store: `frontend/src/world/cameraStore.ts`, hook `useCameraStore`. Methods: `flyTo(target: Vec3)` and `resetView()`. The store keeps monotonically-increasing `flyToToken` / `resetToken` so the Camera component picks up each call exactly once via `subscribe` even when the same target is published twice.
- Wire-up shape for the 📍 button (assumes `view.kind === "block"`):
  ```ts
  const flyTo = useCameraStore((s) => s.flyTo);
  // visual centre of the target block — same `+ 0.5` convention the camera framing uses
  const center: Vec3 = [view.position[0] + 0.5, view.position[1] + 0.5, view.position[2] + 0.5];
  flyTo(center);
  ```
- Animation: Camera lerps `controls.target` with `t = 1 - exp(-6 * dt)`, so a fly-to converges in roughly 0.4 s with no further work — that's the timing #0031 calls for. Camera **position** is *not* lerped on `flyTo`; only the orbit target moves, preserving the user's current angle and distance. This is intentional. If a future requirement wants the camera to move too, extend the cameraStore (e.g. add a `flyToOptions` field) — don't introduce a second imperative path.
- The optional file `frontend/src/world/cameraFlyTo.ts` listed in #0031's "Files" can be a thin wrapper that re-exports `useCameraStore`'s `flyTo`, or you may delete it from the plan and import `useCameraStore` directly. Either is fine; nothing in #0024 depends on the wrapper existing.
- Inventory assertions (slot highlight) and `kind: "other"` rows do not call `flyTo`. Only block-position rows publish a target.
- Auto-framing: when a new test loads, the Camera component runs a *one-shot* fit-to-cleanup-region animation, then leaves the camera alone. Subsequent `worldState` edits do not re-frame. So a 📍 click during ongoing playback just lerps the target — no fight with auto-frame.

## Handoff from #0018 (replay store)

Store at `frontend/src/store/replay.ts`:

- Selector: `useReplayStore(s => { const f = s.replay?.frames.find(f => f.tick === s.tick); return f?.assertions ?? []; })`. The frame list is sparse — most ticks return `[]` (empty state).
- `tick` reads `useReplayStore(s => s.tick)`; subscribe separately so the panel re-renders only on tick / replay changes.
- "Click-to-fly" needs the camera ref from #0024; the panel just publishes the target position. Keep that decoupled — pass via a lifted callback or a small `cameraTarget` zustand slice (your call; nothing in #0018 dictates this).
- Inventory-row highlight integration with #0030: both panels source `slot: PlayerSlot` from the same enum string set; agree on a single label/order helper (note in #0030 says the same).
- The store does not separately surface "assertions at tick" — pull off `replay.frames`. If you need O(1) lookup, build `Map<number, TickFrame>` once per `replay` (memoize on `replay` identity, which only changes when `setReplay` runs).
