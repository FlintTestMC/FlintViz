# API Contract

The frontend talks to the Rust server through a small HTTP and SSE surface.
Handlers live under `crates/flint-viz/src/api/`; TypeScript mirrors live in
`frontend/src/api/types.ts` and `frontend/src/api/client.ts`.

When changing any response shape, update both sides in the same patch.

## Shared Rules

- API routes are mounted before the embedded frontend router.
- JSON bodies use serde's current field names unless explicitly documented.
- Test IDs are path-like strings relative to the configured test root and use
  forward slashes.
- The server starts in read-only mode when `flint-viz serve` is run without a
  path.
- Body limits are route-local. Oversized requests usually surface as axum
  body-limit errors rather than the route's normal JSON shape.

## `GET /healthz`

Returns plain text:

```text
ok
```

This route is useful for checking that the backend process is alive without
loading the SPA.

## `GET /api/config`

Returns runtime capabilities used by `App` before it chooses a layout.

```json
{
  "readonly": false
}
```

`readonly` is true when writes are not allowed. Today that happens when no test
root was supplied, but the state is intentionally independent from `test_root`
so future virtual-directory modes can choose their own policy.

Frontend owner:

- `frontend/src/store/config.ts`
- `frontend/src/App.tsx`

## `GET /api/tests`

Returns a sorted list of JSON test files under the configured test root.

```json
[
  {
    "id": "redstone/basic.json",
    "path": "/absolute/root/redstone/basic.json",
    "name": "basic",
    "tags": ["redstone"]
  },
  {
    "id": "broken.json",
    "path": "/absolute/root/broken.json",
    "name": "broken",
    "tags": [],
    "parse_error": "..."
  }
]
```

Behavior:

- If there is no test root, returns `[]`.
- Walks recursively with `walkdir`.
- Includes only files with extension `json`.
- Sorts by `id`.
- Parses each file as `flint_core::test_spec::TestSpec`.
- On parse or read failure, keeps the file visible and fills `parse_error`.
- On parse failure, `name` falls back to the file stem and `tags` is empty.

The absolute `path` is exposed for display/debugging. Do not use it as an API
ID; use `id`.

## `GET /api/tests/{id}`

Loads one test file by root-relative ID.

Success:

```json
{
  "id": "redstone/basic.json",
  "source": "{...raw JSON...}",
  "spec": { "...": "parsed TestSpec" },
  "parse_error": null
}
```

Parse failure still returns success:

```json
{
  "id": "broken.json",
  "source": "{",
  "spec": null,
  "parse_error": "EOF while parsing..."
}
```

Error cases:

- `404 "no test root"` when the server has no root.
- `400 "id must not be empty"` for an empty ID.
- `404 "test not found"` when the path cannot be canonicalized or is not a
  file.
- `400 "id escapes test root"` when the canonical path is outside the root.
- `500 "task join failed"` if the blocking task panics or is cancelled.

Path safety:

- The candidate path is `root.join(id)`.
- The candidate must canonicalize successfully.
- The canonical path must start with the canonical root.
- The final path must be a file.

## `PUT /api/tests/{id}`

Saves source into an existing test file.

Request body is the raw source string. The frontend sends
`Content-Type: application/json`, but the handler receives the body as text.

Success:

- `204 No Content`

Error cases:

- `403 "server is read-only"` when writes are disabled.
- `404 "no test root"` when there is no root.
- Same path-resolution errors as `GET /api/tests/{id}`.
- `404 "test not found"` when the resolved path is not an existing file.
- `500 "write failed"` on filesystem write failure.
- `500 "task join failed"` on blocking task failure.

Body limit:

- 1 MiB.

## `POST /api/tests/{id}`

Creates a new test file.

Request body is the raw source string. Unlike `PUT`, the target file must not
already exist.

Success:

- `201 Created`

Error cases:

- `403 "server is read-only"` when writes are disabled.
- `404 "no test root"` when there is no root.
- `400 "id must not be empty"` for an empty ID.
- `400 "id contains invalid segment"` for empty path segments or `..`.
- `400 "id must end with .json"` for non-JSON target names.
- `400 "id has no parent"` or `400 "id has no file name"` for malformed IDs.
- `404 "parent directory not found"` when the parent does not exist.
- `400 "id escapes test root"` when the canonical parent is outside the root.
- `409 "file already exists"` when the target already exists.
- `500 "write failed"` on filesystem write failure.
- `500 "task join failed"` on blocking task failure.

Creation intentionally requires an existing parent directory. The API does not
create folders today.

Body limit:

- 1 MiB.

## `POST /api/replay`

Parses raw editor JSON and computes a static replay.

Request body:

- Raw JSON source for one Flint test.

Success with valid `TestSpec`:

```json
{
  "spec": { "...": "parsed TestSpec" },
  "errors": [],
  "replay": { "...": "Replay" }
}
```

Success with invalid JSON or invalid `TestSpec`:

```json
{
  "spec": null,
  "errors": [
    {
      "line": 2,
      "col": 1,
      "message": "..."
    }
  ],
  "replay": null
}
```

Notes:

- Parse errors are returned in the JSON body, not as a non-2xx response.
- `line` and `col` come from `serde_json::Error`.
- The frontend converts these to Monaco markers.
- When parsing fails, the frontend keeps the last good world state and shows
  stale/error UI.

Body limit:

- 1 MiB.

## `GET /api/events`

Opens a Server-Sent Events stream for file changes.

Event:

```text
event: file-changed
data: {"id":"redstone/basic.json"}
```

Behavior:

- Each connection subscribes to the shared broadcast channel.
- `EventSource` handles reconnects in the browser.
- Keepalive comments are sent every 15 seconds with text `ping`.
- Lagged broadcast receivers skip missed events instead of closing.
- The watcher emits only JSON file changes.
- Watcher events are debounced per ID for 100 ms.

The `id` matches the same root-relative ID used by `/api/tests/{id}`.

## `POST /api/failure/decode`

Decodes a flint-steel failure URL payload.

flint-steel failure URLs look like:

```text
http://localhost:7878/failure#data=<base64url-gzip-json>
```

The URL fragment is not sent to the server automatically, so the SPA reads the
fragment and posts the encoded value here.

Request:

```json
{
  "encoded": "..."
}
```

Success:

- Returns `flint_core::viz_link::FailurePayload`.

Failure:

```json
{
  "message": "..."
}
```

with status `400 Bad Request`.

Body limit:

- 256 KiB.

Frontend owner:

- `frontend/src/views/FailureView.tsx`
- `frontend/src/store/failure.ts`
- `frontend/src/api/types.ts`

## API Change Checklist

Before changing an API:

- Update the Rust DTO or handler.
- Update `frontend/src/api/types.ts`.
- Update `frontend/src/api/client.ts` if request or status handling changes.
- Update stores/components that consume the response.
- Add or update Rust handler tests.
- Add or update frontend tests when client/store behavior changes.
- Update this document.
- Preserve read-only behavior unless the change explicitly targets it.
