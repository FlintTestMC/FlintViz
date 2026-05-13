# 0041 Support Multi Assert

**Milestone**: M9
**Depends on**: #0040 (wire-shape rewrite — assertions live in `frame.events` as
`TickEvent::AssertBlock`; this issue extends that shape).

## Goal

When a `BlockCheck` uses `BlockSpec::Multiple`, today only the first alternative
is visible in the 3D scene (the AssertionGhosts grouping keeps an
`alternativeCount` but still renders the first encountered block). Make every
alternative inspectable in both the 3D overlay and the assertion panel, with a
way to pin a specific one.

## flint-core reference

`~/flint/flint-core/src/test_spec.rs` line 414:

```rust
pub enum BlockSpec {
    Single(Block),
    Multiple(Vec<Block>),
}
```

After #0040, a `BlockCheck` with `BlockSpec::Multiple` emits **N** consecutive
`TickEvent::AssertBlock` entries at the same `position` (one per alternative).
The assertion panel already joins same-position alternatives as
`"stone OR dirt OR planks"`. What's missing: 3D cycling + a per-position lock,
plus a way to deep-link to the specific alternative inside the source JSON.

## Design

- **Cycling ghost.** When the per-event picker is **off** (`eventIndex === null`),
  the 3D ghost rotates through alternatives at **1 wall-clock second per alt**,
  all positions in sync via one global counter. Cycling continues even when
  playback is paused.
- **Per-position lock.** Each multi-assert row in the assertion panel gains a
  `<select>` with `Auto (cycling)` + one entry per alternative. Picking an
  alternative locks that position (stops cycling for it only); picking
  `Auto` resumes cycling.
- **Picker interaction (from #0040).** When `eventIndex !== null` and the
  picked event is an `AssertBlock` that is one alt of a Multiple, the ghost
  renders **only the picked alt**. Cycling and the per-position lock UI are
  suppressed for that position until `[all]` is reselected — the picker is
  the lock. The picker itself shows N raw rows (one per `AssertBlock`); no
  collapsing.
- **Panel rendering.** Keep `"expect stone OR dirt OR planks @ (x,y,z)"`,
  with the currently-shown alternative **bolded** (the cycling alt, or the
  locked alt, or — when `eventIndex !== null` — the picked alt). Dropdown
  rendered next to the text; hidden when `eventIndex !== null`.
- **Ghost label.** Cycling → `"stone …+2"`. Locked → `"stone 🔒"`.
  Picker-pinned (eventIndex !== null) → `"stone"` (no decoration — the picker
  is the explanation). Single-alt groups keep today's `"asserted"`.
- **Click-to-reveal.** Clicking a panel row jumps to the **currently-shown
  alternative's** JSON pointer (e.g. `/timeline/N/is/1`), composed from the
  event's `source_map` entry plus the new `pointer_suffix`.
- **Lock lifetime.** Locks survive tick scrubbing, editor edits, and picker
  toggling. **Wiped on test switch.** No localStorage.
- **Grouping unchanged.** Continue grouping `AssertBlock` events by position
  alone — a Single + Multi at the same coord (rare edge case) still merges
  into one row's dropdown.
- **Lock-stale safety.** If a locked alt index exceeds the new alt count after
  a JSON edit, clamp via `Math.min(lock, len - 1)` rather than wiping
  (preserves user intent across small edits).

## Backend changes

- `crates/flint-viz/src/replay/model.rs` — `TickEvent::AssertBlock` gains
  `pointer_suffix: Option<String>` (added alongside the variant definition #0040
  introduces).
- Wherever #0040 ends up expanding `BlockSpec::Multiple` into
  `TickEvent::AssertBlock` events (the body that replaces today's
  `views_from_check`): fill `Some("/is/<i>")` for each alt, `None` for
  `Single`.
- `source_map.json_pointer` stays at `/timeline/N` (tick-level). The frontend
  composes `base + suffix` at reveal time — no per-alt SourceSpan entries.
- Tests: the multi-block expansion test that survives the #0040 refactor
  must assert `pointer_suffix` is `Some("/is/0")`, `Some("/is/1")`,
  `Some("/is/2")` in order. Single-spec expansion test asserts `None`.

## Frontend changes

- `frontend/src/api/types.ts` — mirror `pointerSuffix?: string` on the
  `assert_block` event variant.
- **New** `frontend/src/store/assertions.ts` — Zustand store with
  `cycleIndex` (advanced by a module-scope `setInterval` at 1 Hz),
  `locks: Record<PosKey, number>`, and `lock` / `unlock` actions.
  Subscribes to `useReplayStore` on `testId` and wipes `locks` on change.
  (Inject at the same store-creation site #0040 uses for its
  `eventIndex` reset hooks.)
- `frontend/src/panels/Assertions.tsx` — the same `AssertBlock`-filter the
  panel uses post-#0040 now groups by position into a single row carrying
  `expecteds[]`, `pointerSuffixes[]`, `eventIndices[]`. `BlockRow` reads
  `cycleIndex` / `locks` / `eventIndex`, bolds the current alt, renders the
  `<select>` when `expecteds.length > 1` **and** `eventIndex === null`,
  resolves reveal via `pointerForEvent(sourceIndices, tick, eventIndices[current], pointerSuffixes[current])`.
- `frontend/src/world/AssertionGhosts.tsx` — the same `AssertBlock`-filter
  the file uses post-#0040, grouped by position into `GhostGroup { pos,
  expecteds[], pointerSuffixes[], eventIndices[] }`. `Ghost` reads
  `cycleIndex` / `locks` / `eventIndex`, picks the active alt (picker > lock
  > cycle), rebuilds the mesh on change, and updates the label per rules
  above.
- `frontend/src/store/sourceMap.ts` — extend `pointerForEvent` to accept an
  optional suffix and append it to the resolved `json_pointer`. Existing
  call sites (#0040's `[all]`/per-event reveal) pass `undefined` and behave
  identically.

## Tests

- Rust: per-alt `pointer_suffix` on the multi-block expansion test (renamed
  by #0040 if applicable); single-spec test asserts `None`.
- Frontend: new `store/__tests__/assertions.test.ts` (cycleIndex advance,
  lock/unlock, test-switch wipe — mocked timer). Extend panel + ghost tests
  for bolding, dropdown wiring, label switching, picker-suppresses-lock-UI,
  and reveal pointer composition (`base + suffix`).

## Outcome

- Multi-assert positions cycle through every alternative in the 3D scene.
- Per-row dropdown locks a position to one alternative; `Auto` resumes
  cycling.
- When the per-event picker (#0040) selects one alt, only that alt renders;
  cycling/lock UI is suppressed at that position.
- Reveal-in-editor jumps to the currently-shown alternative's JSON element.
- Locks reset on test switch.
