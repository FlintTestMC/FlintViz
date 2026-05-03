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

## Handoff from M1
- Add `zustand` and `vitest` to `frontend/package.json` — neither is installed yet. For Vitest, add `vitest` (devDep) and a `test` script (`"test": "vitest run"`). No jsdom needed for the store tests (they're pure logic).
- `tsconfig.app.json` has `noUncheckedIndexedAccess: true`. Map/Object lookups are `T | undefined`; selectors must reflect that in their return types.
- Three.js (`three@^0.171`) is already installed and exports `Vector3` etc. if you want a richer `PosKey` than `"x,y,z"` — but the issue's string-key choice is fine and avoids GC pressure during scrubbing.

## Status (post-#0010)

- See #0017 "Replay wire shape (post-#0010)" for the canonical TS types — import `Replay`, `TickFrame`, `BlockChange`, `PlayerDelta`, `PlayerSnapshot`, `Block`, etc. from `frontend/src/api/types.ts` rather than redefining.
- `Replay.frames` is **sparse** — only ticks with at least one event appear. When stepping `tick → tick+1`, walk frames whose `tick <= newTick` and `tick > oldTick`, in order. Don't iterate `0..max_tick`.
- Forward apply: `BlockChange::Set` → `worldState.set(key, block)`; `BlockChange::Remove` → `worldState.delete(key)`. For `PlayerDelta`, apply `slots[]` (set/clear inventory entries), then `selected_hotbar` (`{slot}`), then `game_mode` (`{mode}`).
- Reverse apply uses the `previous` field carried by every `SlotChange` / `HotbarChange` / `GameModeChange` — restore from those instead of rebuilding from `initial_player`. (Block reverse-scrub still rebuilds, since `BlockChange` carries no `previous` to keep the wire small. Acceptable: world rebuild is cheap unless tests get huge.)
- `inventory_diff` is `PlayerDelta | null` and the `PlayerDelta` fields (`slots`, `selected_hotbar`, `game_mode`) are all *omitted* from JSON when empty (`skip_serializing_if`). Treat any missing field as "no change" — don't crash on `delta.slots === undefined`.
