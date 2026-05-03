# 0018 — Replay store (Zustand)

**Milestone:** M4
**Depends on:** #0017

## Goal
Central state for the open test, current tick, derived `WorldState`, playback. Keeps `WorldState` reconstruction efficient when scrubbing.

## Outcome
Store shape:
```ts
{
  testId: string | null,
  source: string,                  // current editor buffer
  replay: Replay | null,
  parseErrors: ParseError[],
  tick: number,
  worldState: Map<PosKey, Block>,  // derived
  player: PlayerSnapshot,          // derived
  playback: 'paused' | 'playing',
  setSource(s), setTick(t), play(), pause(), stepForward(), stepBack()
}
```
- `setTick` reuses the previous `worldState` and applies forward (or rewinds) just the diffs between old and new tick — `O(Δticks)`, not `O(N)`.
- For backward scrubbing: maintain reverse-diffs alongside, or rebuild from initial state when target < current.

## Implementation notes
- `PosKey = "x,y,z"` for Map keying.
- Keep derived state inside selectors so React only re-renders affected components.
- Tests with Vitest for forward/backward correctness against a synthetic `Replay`.

## Files
- `frontend/src/store/replay.ts`
- `frontend/src/store/world.ts` — pure helpers `applyForward`, `applyReverse`
- `frontend/src/store/__tests__/replay.test.ts`
