# 0009 — File watcher + SSE endpoint

**Milestone:** M2
**Depends on:** #0006

## Goal
Push file-change events to the frontend over SSE so editing a test on disk hot-reloads the UI.

## Outcome
- `GET /api/events` is an SSE stream.
- When any `*.json` under the test root is modified, the server emits `event: file-changed\ndata: {"id": "subdir/foo.json"}`.
- Disconnect/reconnect handled cleanly.

## Implementation notes
- `notify = "6"` (recommended mode).
- A `tokio::sync::broadcast` channel: watcher publishes, SSE handler subscribes per connection.
- Debounce bursts: collapse changes to the same file within 100 ms.
- Filter to `*.json` only.

## Files
- `crates/flint-viz/src/watch.rs` (new)
- `crates/flint-viz/src/api/events.rs` (new)
- `crates/flint-viz/src/state.rs` (add broadcast sender)
