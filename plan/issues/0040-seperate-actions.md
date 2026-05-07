# 0040 - Separate actions

## Goal
Give users the option to step through individual actions within a single tick.

## Outcome
- A **picker popup** appears when the user hovers over the marker of the **currently navigated-to tick**, but only when that tick has **2 or more actions** (`currentActions.length >= 2`).
- The picker shows an **"all"** button (full-tick state) plus one button per action, labeled via `summariseAction()`.
- Selecting action N is an **instant switch**: rebuild world to `tick - 1`, then apply actions `0..N`. No animation or visual emphasis.
- Selecting "all" resets to the full-tick state (all actions + block_diff applied).
- The **play button is unaffected** — playback always shows the full-tick state and ignores `actionIndex`.
- Ticks with only 1 action do **not** show the picker.

## Bug (Sonnet implementation)
The picker never appears. Root cause: `setPointerCapture` in the SVG `onPointerDown` handler fires even when clicking on a marker. This triggers a `pointerleave` on the marker `<g>`, clearing the `hover` state. Since the picker requires `hover` to be set, it never renders.

**Fix:** Prevent `setPointerCapture` (and the drag-to-scrub `setTick`) from firing when the pointerdown target is inside a marker `<g>`. The marker's own `onClick` handler already calls `setTick` via `onMarkerClick`.

## Implementation notes
- Store: `actionIndex: number | null` in `ReplayState`, reset to `null` on tick change, test load, and replay load. `setActionIndex` rebuilds via `rebuildAt(replay, tick - 1)` then applies actions incrementally.
- Scrubber: picker div positioned above the timeline bar (`bottom: calc(100% + 4px)`), uses `pickerRef` to keep hover alive when pointer moves from marker to picker.
- No test data with multi-action ticks exists yet, but the feature must work when such data arrives.
