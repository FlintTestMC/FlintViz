# 0008 — `POST /api/replay` (stub)

**Milestone:** M2
**Depends on:** #0007

## Goal
Endpoint that takes a raw JSON test body (i.e. unsaved buffer from the editor), parses it, and returns either the parsed `TestSpec` or a structured error. Replay computation comes later in M3.

## Outcome
- 200 with `{ "spec": {...}, "errors": [] }` on success.
- 200 with `{ "spec": null, "errors": [{ "line": N, "col": N, "message": "..." }] }` on parse failure (use `serde_json::Error::line/column`).
- Stub fields `replay: null` exist in the response so the frontend type is stable across M3 work.

## Implementation notes
- Body limit: 1 MiB (axum `DefaultBodyLimit`).
- Don't 4xx on parse errors — the frontend wants to show squiggles, so a parse failure is a normal response.

## Files
- `crates/flint-viz/src/api/replay.rs` (new)
