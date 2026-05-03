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

## Handoff from M1 + #0006
- `AppState::new(test_root)` is the only constructor today; extend its signature to accept (or build) the `tokio::sync::broadcast::Sender<FileEvent>` and update the call site in `main.rs::run_serve`. Spawn the watcher task in `run_serve` after `AppState` construction and before `axum::serve`.
- The Vite dev proxy already forwards `/api/events` to the backend (`frontend/vite.config.ts`), so SSE is reachable from the frontend in dev without extra config. Don't gzip the SSE response — most reverse proxies (and `EventSource`) misbehave with it.
- The api sub-router lives in `crates/flint-viz/src/api/mod.rs` and exposes `pub fn router() -> Router<Arc<AppState>>`. Add `pub mod events;` and merge it from `mod.rs::router()` next to `tests::router()`. The route handler reads `State<Arc<AppState>>` to subscribe to the broadcast.
- Computing the `id` for the SSE payload: replicate the helper from `crates/flint-viz/src/api/tests.rs::relative_id` (strip `state.test_root` prefix, join components with `/`). Consider lifting it to `api/mod.rs` as a shared helper rather than duplicating — small enough that either is fine.
- `walkdir` is already a dep from #0006 (you don't need it here — `notify` walks for you). `serde`/`serde_json` are already wired.
- The watcher's root is `state.test_root` (canonicalized absolute path). Use recursive mode (`RecursiveMode::Recursive`).
