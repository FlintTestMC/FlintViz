# 0006 — `GET /api/tests`

**Milestone:** M2
**Depends on:** #0002

## Goal
Recursively walk the test root and return a flat list of discovered Flint test files with parsed metadata.

## Outcome
Response shape:
```json
[
  { "id": "subdir/foo.json", "path": "/abs/path/foo.json", "name": "basic_block_placement", "tags": ["basic"] }
]
```
- `id` is the path relative to the test root, used in subsequent endpoints.
- Files that fail to parse are still returned with `name = file stem`, `tags = []`, and a `parse_error` field.

## Implementation notes
- `walkdir` crate.
- Use `flint_core::loader::TestLoader` (or direct `serde_json::from_str::<TestSpec>`) — prefer the loader for consistency.
- Accept only `*.json`.
- Cache: not now. Re-walk on each request. Watcher (#0009) handles change notifications, not caching.

## Files
- `crates/flint-viz/src/api/tests.rs` (new)
- `crates/flint-viz/src/api/mod.rs` (router wiring)

## Handoff from #0002 + M1
- `AppState` lives in `crates/flint-viz/src/state.rs` and is shared as `Arc<AppState>` via axum `with_state`. It currently has one field: `test_root: PathBuf` (already canonicalized to an absolute path; existence + is-dir validated at startup).
- Handlers extract it with `axum::extract::State`, e.g.
  ```rust
  use axum::extract::State;
  use std::sync::Arc;
  use crate::state::AppState;

  pub async fn list_tests(State(state): State<Arc<AppState>>) -> impl IntoResponse {
      let root = &state.test_root;
      // walkdir from `root`, build `id` as the path relative to `root`.
  }
  ```
- Current `main.rs` builds the api router and applies state to it directly, then optionally merges the (stateless) embed router behind `cfg(feature = "embed-frontend")`:
  ```rust
  let api = Router::new()
      .route("/healthz", get(healthz))
      .with_state(state);

  #[cfg(feature = "embed-frontend")]
  let app = api.merge(embed::router());
  #[cfg(not(feature = "embed-frontend"))]
  let app = api;
  ```
  When you add `crates/flint-viz/src/api/mod.rs`, expose `pub fn router() -> Router<Arc<AppState>>` and merge it into the `api` router *before* `.with_state(state)`. The embed router (see `crates/flint-viz/src/embed.rs`) is the existing template for a stateless sub-router merged after.
- The `#[allow(dead_code)]` on `AppState::test_root` is a temporary marker — remove it as part of this issue once the field is read.
- New deps you'll likely add: `walkdir`, `serde`, `serde_json`. The `flint-core` git dep is **not yet** in `Cargo.toml` — pin it from `~/flint/FlintCLI/Cargo.toml` line 17 when you add it (per #0001's note). If using `flint_core::loader::TestLoader`, confirm its public surface in `~/flint/flint-core/src/loader.rs` first.
- The `embed-frontend` cargo feature is off by default; you don't need to interact with it. Just keep the API router stateful and stateless-mergeable so the conditional compile keeps working.
