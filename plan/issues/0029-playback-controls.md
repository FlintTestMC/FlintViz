# 0029 — Playback controls + keyboard shortcuts

**Milestone:** M6
**Depends on:** #0028

## Goal
Add play/pause/step buttons and keyboard shortcuts for navigation.

## Outcome
- Buttons: ⏮ (start), ◀ step-back, ▶/⏸ play/pause, ▶ step-forward, ⏭ (end), ⏭⚑ (next breakpoint).
- Keyboard: ←/→ step, space play/pause, home/end jump to start/end.
- Playback speed selector: 0.5×, 1×, 2×, 4× (1× = 1 tick / 100 ms).

## Implementation notes
- Step granularity: by *event-bearing* tick (not every game tick). Most empty ticks are uninteresting; if the user wants per-game-tick stepping, expose it as a toggle.
- Use `requestAnimationFrame` rather than `setInterval` for play loop.

## Files
- `frontend/src/timeline/Controls.tsx`
- `frontend/src/timeline/playback.ts`

## Handoff from #0026 (action highlights)

`frontend/src/world/Highlights.tsx` already reads `useReplayStore(s => s.playback)` and renders nothing while `playback === "playing"`. The play loop you build here just needs to set `playback` correctly via `play()` / `pause()` on the existing store — no special call into the highlights system. When playback flips back to `"paused"`, the next frame's highlights pulse normally.

If the "skip pulses while playing" UX turns out to be too austere (no visual feedback while watching a test play through), the cheap fix in `Highlights.tsx` is to keep rendering during play but with a shorter `PULSE_MS` (currently 600 ms, hard-coded). Don't add a new playback state for it — re-use the existing flag.

## Handoff from #0036 (scene rotation)

Rotation is `useReplayStore(s => s.rotation)` (a `0 | 1 | 2 | 3` quarter-turn count). It's reset on test load alongside `tick`/`worldState`, so there's nothing for playback controls to do here. If you add a keyboard shortcut for rotation (e.g. `R` to rotate 90° CCW), `useReplayStore.getState().rotateClockwise()` is already exposed.

Keyboard handler placement: pick one — either the playback controls component or a new `useKeyboardShortcuts` hook — and *don't* split keys across multiple `window.addEventListener("keydown")` registrations. The existing `SceneToolbar` only wires click-driven rotation; if you add a key for `R`, do it in your shortcut hub so all global keys live together.
