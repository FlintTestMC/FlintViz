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
- Replace the placeholder right pane in `frontend/src/App.tsx` (currently a `<p>` with the Tailwind smoke-test text). The `SplitLayout` `right` slot is where the editor goes.
- TS strict + `noUncheckedIndexedAccess` apply — `monaco.editor.getModel(uri)` returns `ITextModel | null`; handle the null branch.
- StrictMode is on in `main.tsx`; `@monaco-editor/react` mounts twice in dev as a result. The lib handles this internally, but if you wire your own `useEffect` for marker updates, key it on a stable model id and clean up on unmount.
