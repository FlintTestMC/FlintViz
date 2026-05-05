# 0020 — Monaco editor pane

**Milestone:** M4
**Depends on:** #0018

## Goal
Replace the placeholder left pane with a Monaco editor. Edits update `store.source` and trigger debounced re-replay.

## Outcome
- `@monaco-editor/react` mounted in the left pane.
- Theme: VS Dark (or system default).
- 250 ms debounce → `api.replay(source)` → store update.
- Parse errors from the response are translated into Monaco markers (squiggles).
- When the test is reloaded externally, the editor accepts the new content but preserves cursor position if possible.

## Implementation notes
- Schema integration comes in #0021; for now plain JSON mode with built-in validation.

## Files
- `frontend/src/editor/Editor.tsx`
- `frontend/src/editor/markers.ts`

## Handoff from M1
- Add `@monaco-editor/react` and `monaco-editor` to `frontend/package.json`. With Vite 6 + ESM, the loader fetches Monaco from a CDN by default; if you want to vendor it, wire up `loader.config({ paths: { vs: ... } })` or use `?worker` imports. Stick with the CDN default unless offline use is needed (revisit when dockerizing).
- Replace the placeholder right pane in `frontend/src/App.tsx` (currently `<p className="text-sm">Editor placeholder (lands in #0020).</p>` inside a flex column with a header). Keep the `border-b border-neutral-800 px-3 py-2 text-sm font-medium` header bar styling — match the sidebar/visualization headers for consistency.
- The `SplitLayout` `right` slot is where the editor goes. `SplitLayout` is now a 3-panel `PanelGroup` (sidebar 18% / left 50% / right 32%) — don't touch the layout shell, just swap the right-slot contents.
- TS strict + `noUncheckedIndexedAccess` apply — `monaco.editor.getModel(uri)` returns `ITextModel | null`; handle the null branch.
- StrictMode is on in `main.tsx`; `@monaco-editor/react` mounts twice in dev as a result. The lib handles this internally, but if you wire your own `useEffect` for marker updates, key it on a stable model id and clean up on unmount.

## Handoff from #0019 (sidebar)

The sidebar (`frontend/src/panels/TestList.tsx`) already owns part of the load/replay flow that the editor will share state with. Read `TestList.tsx` once before wiring the editor — the responsibilities split as follows:

- **Test selection is sidebar-driven.** When the user clicks a row, the sidebar calls `api.getTest(id) → store.openTest(id, source) → api.replay(source) → store.setReplay(...)`. The editor must **not** also fetch on selection — it just reacts to `store.source` (and `store.testId`) changes. Subscribe with `useReplayStore(s => s.source)` and load that string into the Monaco model whenever it changes from outside (i.e. not from the user typing).
- **Distinguish "external" vs "user" updates.** When `store.source` changes and it differs from `editor.getValue()`, that's an external load (sidebar click or SSE refresh) — call `model.setValue(newSource)` and reset cursor to {1,1} (or preserve if the strings share a common prefix; Monaco doesn't preserve cursor across `setValue`, so you have to capture/restore manually). When the user types, you go the *other* direction: `setSource(value)` + debounced replay.
- **SSE `file-changed` is already handled by the sidebar** for the currently-open test — it re-runs `api.getTest(id) → openTest(...) → setReplay(...)`. **Do not** subscribe to `api.events` from the editor; you'd duplicate the work and race the sidebar. The sidebar's path will update `store.source`, your "external update" branch picks it up automatically. (If the user has local unsaved edits on disk-changed, the current sidebar behavior just clobbers — out of scope here, but if you want a "file changed on disk" banner add it without re-subscribing to SSE.)
- **Initial state:** on app load there's no test open (`testId === null`, `source === ""`). Render the editor read-only or with a placeholder string until a test is selected — the sidebar drives the first `openTest`.
- The sidebar is the only place that calls `store.openTest()` today; the editor should only call `setSource(...)` (not `openTest`). `openTest` resets tick/worldState which would be wrong on every keystroke.
- Sidebar's inline `listError`/`openError` strips already exist — don't add overlapping error UI for sidebar-originated failures. Editor-originated errors (replay 413, network) should surface in the editor's status area until #0033's toast system lands.

## Handoff from #0017 (API client)

`POST /api/replay` is wrapped as `api.replay(source: string): Promise<ReplayResponse>` from `frontend/src/api/client.ts`:

- Always send the **raw editor buffer** as the body — `api.replay` does that already; pass the source string verbatim, no `JSON.stringify`.
- 200 even on parse failure: inspect `result.errors` (`ParseError[]`). `errors.length > 0` ↔ show squiggles. Don't rely on a thrown error.
- `result.errors[i].col` can be `0` (EOF). Monaco markers need `column >= 1` — clamp with `Math.max(1, err.col)` when translating to `IMarkerData`. Keep this clamp in `markers.ts`.
- 413 surfaces as `ApiError` with message `"replay body too large (max 1 MiB)"` — surface in the editor (e.g. status-bar pill) but don't blank the previous replay.
- `ApiError` is the only thrown error path; `result.replay` may be `null` even on a fully valid spec if the M3 engine isn't yet wired (no longer the case post-#0016, but guard anyway).

## Handoff from #0018 (replay store)

Store at `frontend/src/store/replay.ts`:

- `setSource(source)` updates `store.source` only — does not trigger replay. Use this on every Monaco `onChange`.
- After the 250 ms debounce fires, call `api.replay(source)` then `useReplayStore.getState().setReplay(replay, errors)`. Do this **outside React** (in the debounce callback) so it works without re-running the editor effect.
- `setReplay(null, errors)` is the failure path — it preserves the previous `tick`/`worldState` (last-good state UX from #0033) and just records the new `parseErrors`. So a malformed edit keeps the 3D view stable while squiggles appear.
- `setReplay(replay, [])` resets `tick` to 0 and seeds `worldState`/`player` from `replay.initial_player`. If you want to **preserve the user's current tick across re-replay** (better UX during live editing), capture `tick` before, then `setTick(prevTick)` after — the store clamps to `replay.max_tick` so a now-shorter timeline is safe.
- `parseErrors` is exposed on the store — selecting it directly (`useReplayStore(s => s.parseErrors)`) is the canonical way to drive marker re-application from anywhere in the tree, but the editor's own debounce path can also pass them through directly without going through the store.
- For external file refresh (SSE `file-changed`): if the test is open and the user hasn't typed since the last save, call `setSource(newSource)` and re-replay; if they have local edits, prefer to ignore (or surface a "file changed on disk" banner — out of scope here, see #0033).

## Status (this issue)

Implemented at:

- `frontend/src/editor/Editor.tsx` — `<MonacoEditor>` from `@monaco-editor/react` (CDN-loaded `monaco-editor`, vs-dark theme, JSON language). Mounted in `App.tsx` as the `right` slot (replaced the placeholder).
- `frontend/src/editor/markers.ts` — `parseErrorsToMarkers` translates `ParseError[]` to `editor.IMarkerData[]`. Both `line` and `col` are clamped to `>= 1` (server can emit `col: 0` on EOF, `line: 0` is a defensive guard). Marker owner string is exported as `MARKER_OWNER = "flint-replay"` so other code can clear/inspect them. The hard-coded `severity: 8` is rewritten to `monaco.MarkerSeverity.Error` at apply time inside `Editor.tsx`.
- 4 vitest cases in `__tests__/markers.test.ts`. No tests for `Editor.tsx` itself — Monaco doesn't run in jsdom; test the surface (markers, registerSchema) instead.
- **Imperative value management** via `defaultValue` + ref. The `value` prop pattern would loop because `setValue` re-fires `onChange`. An `applyingExternalRef` boolean guards the brief window between programmatic `setValue` and the resulting `onChange` callback, so external loads don't bounce back through the debounced replay.
- External-update path: `useEffect` on `store.source` compares `editor.getValue()` to detect a change from outside (sidebar click / SSE), captures cursor `Position`, calls `setValue`, restores cursor. Cursor restoration is best-effort — line/column may now point past EOF after a shrink, in which case Monaco silently clamps.
- User-edit path: `onChange` → `store.setSource(value)` immediately + 250ms debounced `api.replay(value)`. After the response, `store.setReplay(...)`. **Tick is preserved across re-replay**: capture `prevTick` before `setReplay`, and if the new replay parsed cleanly call `setTick(prevTick)` (the store clamps to `replay.max_tick`, so a now-shorter timeline is safe). Stale-result protection via a token ref so out-of-order responses don't clobber the latest result.
- Marker re-application: `useEffect` on `store.parseErrors` reapplies markers via `monaco.editor.setModelMarkers(model, MARKER_OWNER, ...)`. Initial markers (case where `parseErrors` arrives before mount) are also seeded inside `onMount`.
- Status pill: 413 / network errors surface as a small red header pill (`statusError` local state). Per the handoff, this is a temporary UX until #0033 toasts land. Replay errors that the server returns as `result.errors` (the common case for invalid-but-200 responses) are NOT surfaced as status errors — they show as squiggles in the buffer.
- Empty-state: when `testId === null` the component renders a "Select a test from the sidebar" placeholder instead of the Monaco instance, so the editor doesn't flash an empty buffer on first paint.
- Schema registration is wired via `registerFlintSchema(monaco)` from `onMount` (idempotent guard inside that helper); see #0021.

Notes for downstream:

- The editor does NOT subscribe to `api.events` SSE — the sidebar handles `file-changed` and propagates via `store.source`, which the editor's external-update effect picks up.
- `MARKER_OWNER` is exported and reserved for replay parse errors. Other features (e.g. semantic lint, schema-only diagnostics) should use a different owner so clearing one doesn't wipe the other. Monaco's own JSON service uses its own internal owner already, so the schema-validation squiggles from #0021 don't collide.
