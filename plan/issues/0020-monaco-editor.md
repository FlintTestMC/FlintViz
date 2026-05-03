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
