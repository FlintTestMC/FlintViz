# 0041 Support Multi Assert

**Milestone**: M9

## Goal

When a `BlockCheck` uses `BlockSpec::Multiple`, today only the first alternative
is visible in the 3D scene (`AssertionGhosts.tsx:67` keeps `existing.alternativeCount += 1`
but still renders `g.expected` — the first encountered block). Make every alternative
inspectable in both the 3D overlay and the assertion panel, with a way to pin a
specific one.

## flint-core reference

`~/flint/flint-core/src/test_spec.rs` line 414:

```rust
pub enum BlockSpec {
    Single(Block),
    Multiple(Vec<Block>),
}
```

The backend already expands `Multiple` into N `AssertionView::Block` entries at
the same coord (`crates/flint-viz/src/replay/assertions.rs`). The frontend panel
already joins them as `"stone OR dirt OR planks"`. What's missing: 3D cycling +
a per-position lock.

## Design

- **Cycling ghost.** 3D ghost rotates through alternatives at **1 wall-clock
  second per alt**, all positions in sync via one global counter. Cycling
  continues even when playback is paused.
- **Per-position lock.** Each multi-assert row in the assertion panel gains a
  `<select>` with `Auto (cycling)` + one entry per alternative. Picking an
  alternative locks that position to it (stops cycling for it only); picking
  `Auto` resumes cycling.
- **Panel rendering.** Keep `"expect stone OR dirt OR planks @ (x,y,z)"`, with
  the currently-shown alternative **bolded**. Dropdown rendered next to the text.
- **Ghost label.** Cycling → `"stone …+2"`. Locked → `"stone 🔒"`. Single-alt
  groups keep today's `"asserted"`.
- **Click-to-reveal.** Clicking a panel row jumps to the **selected
  alternative**'s JSON pointer (e.g. `/timeline/N/is/1`), not the BlockCheck
  root.
- **Lock lifetime.** Locks survive tick scrubbing and editor edits. **Wiped on
  test switch.** No localStorage.
- **Grouping unchanged.** Continue grouping AssertionView entries by position
  alone — a Single + Multi at the same coord (rare edge case) still merges into
  one row's dropdown.
- **Lock-stale safety.** If a locked alt index exceeds the new alt count after a
  JSON edit, clamp via `Math.min(lock, len - 1)` rather than wiping (preserves
  user intent across small edits).

## Backend changes

- `crates/flint-viz/src/replay/model.rs` — `AssertionView::Block` gains
  `pointer_suffix: Option<String>`.
- `crates/flint-viz/src/replay/assertions.rs` — `views_from_check` fills
  `Some("/is/<i>")` for each alt of a `BlockSpec::Multiple`, `None` for
  `Single`.
- Tests: extend `block_check_with_multiple_spec_emits_one_view_per_block` and
  `block_check_with_single_spec_emits_one_view` to assert the new field.
- Source map at `engine.rs:113-127` stays tick-level — the frontend composes
  `base_pointer + suffix` at reveal time.

## Frontend changes

- `frontend/src/api/types.ts` — mirror `pointerSuffix` on the block variant.
- **New** `frontend/src/store/assertions.ts` — Zustand store with
  `cycleIndex` (advanced by a module-scope `setInterval` at 1 Hz), `locks: Record<PosKey, number>`,
  and `lock`/`unlock` actions. Subscribes to `useReplayStore` on `testId`
  (clean injection point at `frontend/src/store/replay.ts:66-78`) and wipes
  `locks` on change.
- `frontend/src/panels/Assertions.tsx` — `AssertionGroup.block` carries
  `pointerSuffixes[]` + `eventIndices[]`. `BlockRow` reads `cycleIndex`/`locks`,
  bolds the current alt, renders the `<select>` when `expecteds.length > 1`,
  resolves reveal via `eventIndices[current]` + `pointerSuffixes[current]`.
- `frontend/src/world/AssertionGhosts.tsx` — `GhostGroup` carries `expecteds[]`
  (drop the single `expected` field). `Ghost` reads `cycleIndex`/`locks`, picks
  the active alt, rebuilds the mesh on change, and updates the label.
- `frontend/src/store/sourceMap.ts` — `pointerForEvent` (or sibling helper)
  accepts an optional suffix to append.

## Tests

- Rust: per-alt `pointer_suffix` on the two existing multi-block tests.
- Frontend: new `store/__tests__/assertions.test.ts` (cycleIndex advance,
  lock/unlock, test-switch wipe — mocked timer). Extend panel + ghost tests for
  bolding, dropdown wiring, label switching, and reveal pointer composition.

## Outcome

- Multi-assert positions cycle through every alternative in the 3D scene.
- Per-row dropdown locks a position to one alternative; `Auto` resumes cycling.
- Reveal-in-editor jumps to the selected alternative's JSON element.
- Locks reset on test switch.
