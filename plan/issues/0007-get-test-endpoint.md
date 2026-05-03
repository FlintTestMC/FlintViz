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
- Reuse `TestLoader` for the parse step.

## Files
- `crates/flint-viz/src/api/tests.rs` (extend)
