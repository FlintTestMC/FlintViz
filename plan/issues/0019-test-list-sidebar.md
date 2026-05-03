# 0019 — Test list sidebar

**Milestone:** M4
**Depends on:** #0017, #0018

## Goal
A collapsible left-most sidebar listing all discovered tests, grouped by directory.

## Outcome
- Tree view based on the `id` slash structure.
- Click a test → loads its source into the store, fetches its replay.
- Highlight the currently-open test.
- SSE `file-changed` for the open test triggers a refresh.

## Implementation notes
- Build the tree client-side from the flat `TestSummary[]`.
- A simple recursive component is fine; no virtualization needed at this scale.

## Files
- `frontend/src/panels/TestList.tsx`
- `frontend/src/panels/buildTree.ts`
