# 0017 — Frontend API client

**Milestone:** M4
**Depends on:** #0006, #0007, #0008, #0009

## Goal
A small typed wrapper around `fetch` for `/api/*` endpoints, plus an SSE helper.

## Outcome
- `api.listTests(): Promise<TestSummary[]>`
- `api.getTest(id): Promise<TestDetail>`
- `api.replay(source): Promise<ReplayResponse>`
- `api.events(onEvent): () => void` — opens SSE, returns disposer.
- Types live in `frontend/src/api/types.ts`, hand-written to mirror the Rust serde shapes.

## Implementation notes
- Don't pull in a heavy client lib; native `fetch` + `EventSource` is enough.
- Throw on non-2xx with a typed `ApiError`.

## Files
- `frontend/src/api/client.ts`
- `frontend/src/api/types.ts`
- `frontend/src/api/events.ts`

## Handoff from M1
- Vite dev server runs on `:5173` and proxies both `/api` and `/api/events` to `http://localhost:7878` (configured in `frontend/vite.config.ts`). Use **relative URLs** in the client (`fetch("/api/tests")`, `new EventSource("/api/events")`) so the same code works in dev (proxied), in the embedded release build (same origin), and in the future docker split (frontend container reverse-proxies `/api` to backend container).
- TS is strict with `noUncheckedIndexedAccess`. Array/Map lookups return `T | undefined`; handle it explicitly (no `!` non-null assertions).
- No client lib — keep `fetch` + `EventSource` as the issue specifies. React 18 is in use, so async data fetching can rely on `useEffect` + abort controllers; no Suspense-for-data is required.

## Handoff from #0006 (TestSummary shape)
The Rust serde shape returned from `GET /api/tests` is a flat array. Mirror it in `frontend/src/api/types.ts` as:
```ts
export interface TestSummary {
  id: string;          // forward-slash path relative to the test root, e.g. "redstone/lever_basic.json"
  path: string;        // absolute on-disk path
  name: string;        // `name` field from the test JSON, OR the file stem when parse_error is set
  tags: string[];      // [] when parse_error is set
  parse_error?: string;// snake_case in the wire format; field is omitted (not null) when parsing succeeded
}
```
Notes:
- The wire field is `parse_error` (snake_case from serde), NOT `parseError`. Either match it directly in TS or rename in the client.
- The field is **omitted** from the JSON (via `skip_serializing_if`) on success — code defensively (`summary.parse_error ?? null`).
- `name` is **never** null. On parse failure it falls back to the file stem so the sidebar can still render the file.
- Order is sorted by `id` (ascending) on the server; clients can rely on it.

## Handoff from #0007 (TestDetail shape + status codes)
`GET /api/tests/:id` is wired as `/api/tests/{*id}` (axum 0.8 wildcard). The handler returns `TestDetail`:
```ts
export interface TestDetail {
  id: string;                  // canonicalized id; may differ from the id sent if the URL contained "./" or symlinks
  source: string;              // raw file contents, exactly as on disk (preserve newlines for Monaco)
  spec: TestSpec | null;       // null when parse_error is set
  parse_error: string | null;  // null on success — these two fields are NOT omitted, unlike TestSummary
}
```
Status codes the client must handle:
- **200** — success (incl. parse failures: `spec=null`, `parse_error` set, `source` always present).
- **400** — id escapes the test root (path-traversal attempt). Body: plain text `"id escapes test root"`.
- **404** — id doesn't resolve to a file under the test root (missing, or points to a directory). Body: plain text `"test not found"`.
- **500** — task join failure (shouldn't happen in practice).

Notes:
- Error bodies are `text/plain`, **not** JSON. `ApiError` should fall back to `await res.text()` on non-2xx instead of assuming JSON.
- `id` in the response is the *normalized* form (after canonicalization, with forward slashes). Use `detail.id` rather than the request id when keying caches/store entries — `"sub/./a.json"` becomes `"sub/a.json"`.
- `TestSpec` mirrors `flint_core::test_spec::TestSpec` at rev `b04ad23` (camelCase via serde): `flintVersion: string | null`, `name: string`, `description: string | null`, `tags: string[]`, `dependencies: string[]`, `setup: SetupSpec | null` (with `cleanup: { region: [[i32;3];2] }`), `timeline: TimelineEntry[]`, `breakpoints: number[]`. The `TimelineEntry` shape is a tagged union via the `do` discriminant — don't try to fully type it in this issue; treat it as `unknown` or a permissive `Record<string, unknown>` and let #0021 (JSON schema) drive validation.
- The client should encode each path segment of `id` (e.g. `id.split('/').map(encodeURIComponent).join('/')`) before interpolating into the URL, so block ids with spaces or `+` survive the round-trip.
