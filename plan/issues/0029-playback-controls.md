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
