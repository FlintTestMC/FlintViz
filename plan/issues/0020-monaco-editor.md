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
