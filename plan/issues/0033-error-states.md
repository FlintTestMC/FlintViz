# 0033 — Error states & empty UI

**Milestone:** M7
**Depends on:** #0019, #0020, #0023

## Goal
Make the tool gentle to use when things go wrong.

## Outcome
- Path doesn't exist on `flint-viz serve` → backend exits with a clear message; instructions in stderr.
- Empty test root → sidebar shows "No tests found in <path>" with a hint.
- JSON parse error → editor squiggles, 3D view freezes on the last good state with a small "stale" badge top-right and a tooltip "showing last valid replay".
- Asset bundle missing → 3D pane shows a panel explaining how to fetch assets (`npm run assets`).
- API request fails → toast with the error.

## Implementation notes
- A single `<ErrorBoundary>` wraps each pane to prevent a single failure from killing the whole UI.

## Files
- `frontend/src/components/ErrorBoundary.tsx`
- `frontend/src/components/StaleBadge.tsx`
- `frontend/src/components/Toast.tsx`
- `crates/flint-viz/src/main.rs` (path validation message)

## Handoff from #0019 (test list sidebar)

The sidebar (`frontend/src/panels/TestList.tsx`) already does limited error rendering — `listError` and `openError` strings render inline at the top/bottom of the panel. It uses `ApiError.message` (with the body baked in) for most cases. When this issue lands:

- Move the `listError`/`openError` strings out of `TestList.tsx` into your global `<Toast />` channel; the sidebar should fire a toast and stay otherwise quiet (it currently shows red footer text, which is acceptable for v1 but redundant once toasts exist).
- The "No tests found" copy lives in the sidebar today; keep it there but extend it with the served `path` (currently the frontend has no API for that — either expose it via a new `/api/info` endpoint or include it in the `listTests` response). Out of scope unless this issue picks it up.
- Files with `summary.parse_error` set are rendered with a red dot + italic + native `title` tooltip. If you adopt Radix tooltips for the rest of the app, swap the `title` for a Radix tooltip here too — keep the red dot.
- Last-good replay state: `setReplay(null, errors)` already preserves `tick`/`worldState`/`player`. So a stale badge just needs a selector like `useReplayStore(s => s.parseErrors.length > 0 && s.replay !== null)` (or "had a replay before this error"). The sidebar already calls `setReplay(replay.replay, replay.errors)` regardless — when `errors.length > 0` the world view stays on the previous frame.

## Handoff from #0017/#0018 (referenced indirectly)

- `ApiError` from `frontend/src/api/client.ts` is the only thrown error type from the API layer; switch on `err instanceof ApiError && err.status === N` for status-specific UX (e.g. 413 → "test file too big", 404 → "test was deleted").
- The store's `parseErrors: ParseError[]` is already the canonical "current replay errors" source; toasts and stale badges should subscribe to it, not duplicate state.

## Handoff from #0020 (Monaco editor)

The editor (`frontend/src/editor/Editor.tsx`) already does limited error rendering — when the debounced replay throws (typically `ApiError` with status 413, or a network failure), it sets a local `statusError` string that renders as a small red pill in the editor's header bar. When this issue lands:

- Migrate the editor's `statusError` pill to your global toast channel. Like the sidebar's strips, the pill is acceptable for v1 but should fire a toast and stay otherwise quiet once toasts exist.
- 413 specifically is already wrapped: `ApiError` with `status: 413` and `message: "replay body too large (max 1 MiB)"` is the contract — don't re-derive the message, surface `err.message`.
- The editor does NOT subscribe to `api.events`. Don't add SSE-driven errors here either; the sidebar owns that channel.
- For the **stale badge** UX: the editor preserves the user's previous `tick` across re-replay (only when `result.replay && errors.length === 0`). When `errors.length > 0`, the store's `setReplay(null, errors)` already preserves the prior `worldState`/`player`, so the 3D view freezes on the last good state automatically. The badge selector should be `s => s.parseErrors.length > 0 && s.replay !== null` — `replay !== null` distinguishes "had a valid replay before this error" from "no test loaded yet".
- Marker owner: the editor uses `MARKER_OWNER = "flint-replay"` (exported from `editor/markers.ts`) for replay errors. If you add semantic lint or other diagnostic sources, use a different owner so clearing one doesn't wipe the other.

## Handoff from #0021 (JSON schema)

- Schema validation squiggles come from Monaco's built-in JSON language service (separate marker owner) and live alongside the replay-error squiggles from #0020 without conflict.
- For the "asset bundle missing" panel and other 3D-pane errors (out of scope for editor handoff), the world view is now rendered at `frontend/src/world/Scene.tsx` (post-#0023; `CanvasShell.tsx` was deleted). The editor and world panes are siblings under `SplitLayout`, so wrap each in its own `<ErrorBoundary>` independently.

## Handoff from #0023 (world renderer)

`frontend/src/world/Scene.tsx` is now the 3D-pane composition root, mounted directly from `App.tsx` (no `<CanvasShell>` indirection). For the asset-bundle-missing UX:

- `frontend/src/world/atlas.ts`'s `loadBlockProviders()` rejects with the literal message `Failed to load /mc-assets.zip (<status>). Run \`npm run assets\` to generate it.` when the zip is absent. The string is intentionally surface-ready — render it verbatim in the panel rather than re-wording.
- Today, `frontend/src/world/World.tsx` swallows that rejection in a `useEffect` and only `console.error`s. To trigger a panel, swap the silent catch for one of:
  - **Lift the providers loader.** Move `useBlockProviders` out of `World.tsx` (currently private) into a shared module, surface a `{ providers, error }` tuple, and render the asset-error panel from `Scene.tsx` (or App-level) when `error !== null`. Recommended.
  - **Throw inside the component.** Replace the `console.error` with `throw err`, wrap the 3D pane in an `<ErrorBoundary>` that detects the `Failed to load /mc-assets.zip` substring and renders the asset panel; fall back to a generic error panel otherwise.
- Last-good-state badge: the world view is already correct here. `World.tsx` reads `worldState` directly from the store; `setReplay(null, errors)` preserves the previous Map, so the rendered scene stays on the last good state when JSON parse fails. The `<StaleBadge />` should overlay on top of `<Scene />` (e.g. as an absolutely-positioned sibling inside the `<div className="flex-1">` that hosts it in `App.tsx`), not inside the `<Canvas>` — HTML-in-3D needs `<Html>` from drei and is overkill for a status badge.
- `<World />` returns `null` when `worldState.size === 0` or providers haven't loaded. That keeps the canvas visible (background, lights, OrbitControls still active) so the user sees an empty scene rather than a blank pane while loading.

## Handoff from #0028 (timeline scrubber)

`frontend/src/timeline/Scrubber.tsx` already handles its own empty state — when `replay === null` it renders a thin disabled bar with "No replay loaded". That copy is fine for v1; it should *not* fire the global toast, since "no test selected yet" isn't an error. The same goes for the playback controls (`Controls.tsx`), which disable buttons via the `disabled` prop but emit no errors.

When parse errors land but a previous replay survived (`s.parseErrors.length > 0 && s.replay !== null`), the scrubber renders against the *last good* replay, so the playhead and markers continue to work. The stale badge should overlay the 3D pane only — don't gray out or banner the scrubber, since users actively need to scrub through the last-good replay while reviewing the parse error.

## Status (post-implementation, 2026-05-06)

Landed. Surface for downstream consumers (#0034 README, future error-handling
work):

- `frontend/src/components/ErrorBoundary.tsx` — class boundary with optional
  `label` and `fallback`. Wraps each pane in `App.tsx` (Sidebar, 3D view,
  Timeline, Inventory, Assertions, Editor) so a render-time failure in one
  pane doesn't blank the whole UI.
- `frontend/src/components/Toast.tsx` + `toastStore.ts` — module-scope zustand
  store with `showToast({ kind, message, ttlMs? })`. Default TTL 6 s; pass
  `ttlMs: 0` for sticky. `<Toast />` is mounted once in `App.tsx`.
- `frontend/src/components/StaleBadge.tsx` — reads
  `s.parseErrors.length > 0 && s.replay !== null` and renders an amber
  "stale" pill absolutely-positioned over the 3D pane. Sits as a sibling of
  `<Scene />` inside `App.tsx`; not inside the `<Canvas>`.
- `frontend/src/world/useBlockProviders.ts` — now exports
  `useBlockProvidersState` returning `{ providers, error }`. The legacy
  `useBlockProviders()` hook still returns `BlockProviders | null` and is
  unchanged for `World.tsx` / `AssertionGhosts.tsx` consumers.
- `frontend/src/world/Scene.tsx` — when the providers loader errors, renders
  `<AssetMissingPanel>` in place of the `<Canvas>`. The panel surfaces the
  loader's message verbatim (`Failed to load /mc-assets.zip …`) and follows up
  with a `npm run assets` instruction.
- `frontend/src/panels/TestList.tsx` — no longer renders inline `listError` /
  `openError` strips. Both failures route through `showToast`. The empty-state
  copy has been extended with a hint about pointing at a different directory.
- `frontend/src/editor/Editor.tsx` — the `statusError` pill is gone; replay
  failures fire toasts. A `lastErrorRef` dedups identical errors so a 413 that
  fires every keystroke doesn't carpet-bomb the channel.
- `crates/flint-viz/src/main.rs::resolve_test_root` — error messages now
  include a `hint:` line per failure mode (missing path, file-not-directory,
  canonicalize failure).

Inventory icon-load failures keep the existing console.warn + 4-letter text
fallback per the original handoff — single missing-zip toast surface is the
3D-view panel, no need to duplicate.

The Monaco MARKER_OWNER (`flint-replay`) is preserved; cross-link decorations
in #0032 use selection ranges, not markers, so the two layers stay decoupled.

## Handoff from #0030 (inventory panel)

`frontend/src/panels/itemIcons.ts` is the second consumer of the asset zip after `world/atlas.ts`. The shared loader `loadAssetZip()` (now in `world/atlas.ts`) memoizes the parsed `JSZip` so a missing zip rejects from both consumers with the same surface message. For this issue:

- A single missing-zip toast (or panel) is correct UX — both `loadBlockProviders()` and `loadItemIcons()` will reject. Subscribe the toast channel once to whichever loader you prefer (recommend `loadBlockProviders()` since the world view fails more visibly); the inventory panel quietly falls back to a text label per item, so missing icons alone don't need their own error surface.
- `panels/Inventory.tsx` currently catches icon-load failures with a `console.warn` and renders a 4-letter id stub for every slot. That's the v1 "graceful degrade" — when this issue lands, keep the fallback rendering and just route the warn through the toast channel (deduplicate against the world-view toast for the same root cause).
- `loadItemIcons()` exposes `resetItemIcons()` for tests; if you add a "retry assets" UX, call both `resetBlockProviders()` and `resetItemIcons()` to invalidate the shared zip cache as well (it lives behind `resetBlockProviders()` in `atlas.ts`).
