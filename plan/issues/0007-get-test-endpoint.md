# 0007 — `GET /api/tests/:id`

**Milestone:** M2
**Depends on:** #0006

## Goal
Return the raw source JSON of a specific test plus its parsed `TestSpec` summary, for the editor and metadata panels.

## Outcome
Response:
```json
{
  "id": "subdir/foo.json",
  "source": "{...raw json text...}",
  "spec": { /* serialized TestSpec */ },
  "parse_error": null
}
```
- 404 if the id doesn't resolve to a file under the test root.
- 200 with `parse_error` populated and `spec: null` if parsing fails.

## Implementation notes
- Path safety: resolve `id` against `state.test_root`, canonicalize, ensure the result is *inside* the test root (prevent `../` traversal). Reject otherwise with 400.
- Parse via `serde_json::from_slice::<flint_core::test_spec::TestSpec>`. Do **not** use `flint_core::loader::TestLoader` — it has filesystem side effects (writes an `index.json` into the test root via `Index::load`) that we don't want.

## Files
- `crates/flint-viz/src/api/tests.rs` (extend)

## Handoff from #0006
- `crates/flint-viz/src/api/mod.rs` exposes `pub fn router() -> Router<Arc<AppState>>` and is merged into the `api` router in `main.rs` *before* `.with_state(state)`. Add the `:id` route in `api::tests::router()` next to the existing `GET /api/tests` (e.g. `.route("/api/tests/{*id}", get(get_test))`). Axum 0.8 uses `{*id}` (not `:id`) for capture-rest segments.
- The id format from #0006 is the path relative to `test_root`, joined with forward slashes (`subdir/foo.json`). On Linux this maps cleanly to `test_root.join(id)`; on Windows you'd need to convert slashes — out of scope for v1 (we run on Linux).
- For path-traversal safety: after `test_root.join(id)`, call `.canonicalize()` and verify the result `starts_with(&state.test_root)` (which is already canonicalized in `resolve_test_root`). Reject with 400 otherwise.
- `flint-core` is already a dep at rev `b04ad23` and `serde`/`serde_json` are wired. `TestSpec` derives `Serialize`, so `spec` can be returned directly in the JSON response.
- Pinned rev caveat: at `b04ad23`, `MinimalTestSpec` does **not** exist (it's added in a later flint-core version). Use full `TestSpec` for parsing. If a file fails the strict `TestSpec` deserialize (e.g. missing `timeline`), still return 200 with `parse_error` populated and `spec: null`.
