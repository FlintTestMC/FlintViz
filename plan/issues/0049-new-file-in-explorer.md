# 0049 — New test file from explorer context menu

**Milestone:** M9
**Depends on:** #0019 (sidebar)

## Goal
Create a new Flint test JSON from the left-panel file explorer without leaving the app.

## Outcome
- Right-click on a folder row (or the root header) opens a context menu with a "New file…" entry.
- Clicking the entry inserts an inline `<input>` row at that location with focus.
- Typing a filename and pressing Enter sends `POST /api/tests/{folder/name.json}` with the template body.
- The new file shows up in the tree via the existing SSE watcher; the user clicks it to open.
- Esc cancels the inline input.
- When the server is in read-only mode (`useConfigStore.readonly === true`), the menu item is not rendered.

## Backend (`crates/flint-viz/src/api/tests.rs`)
- Mount a new handler on the existing path:
  `.route("/api/tests/{*id}", get(get_test).put(save_test).post(create_test))`
- `create_test(State, Path(id), body: String)` semantics:
  - `state.readonly` → `403 Forbidden`.
  - Empty id, `id` containing `..`, or id not ending in `.json` → `400 Bad Request`.
  - Target file already exists → `409 Conflict`.
  - Success → write bytes verbatim and return `201 Created`.
- Resolution helper: the current `resolve_under_root` calls `canonicalize` on the full candidate, which fails when the file doesn't exist yet. Split it: canonicalize the parent directory, then join the file name, then assert the result starts with `root`. The parent must already exist (folder creation is out of scope — return 404 if the parent doesn't exist).
- Tests (Tokio + tempdir, mirroring existing style):
  - `create_test_writes_new_file` — success path; bytes on disk match request body.
  - `create_test_rejects_when_readonly` — 403.
  - `create_test_returns_conflict_when_file_exists` — 409.
  - `create_test_rejects_traversal` — `../escape.json` → 400.
  - `create_test_rejects_non_json_extension` — `foo.txt` → 400.
  - `create_test_returns_not_found_for_missing_parent` — `nope/foo.json` → 404.

## Frontend

### `frontend/src/api/client.ts`
- Add `createTest(id: string, body: string, signal?: AbortSignal): Promise<Result<…, …>>` matching the existing wrapper conventions in this file (typed `ApiError`-style failures, `aborted` flag, etc.).

### `frontend/src/panels/newTestTemplate.ts` (new)
- Export `newTestTemplate(stem: string): string` returning the JSON below with `<stem>` substituted into `name`:

```json
{
  "$schema": "https://raw.githubusercontent.com/FlintTestMC/flint-core/refs/heads/main/flint-content/test_spec_schema.json",
  "flintVersion": "1.0",
  "name": "<stem>",
  "description": "TODO: describe what this test verifies",
  "tags": [],
  "minecraftIds": ["minecraft:stone"],
  "setup": {
    "cleanup": {
      "region": [[0, 0, 0], [0, 0, 0]]
    }
  },
  "timeline": [
    { "at": 0, "do": "place", "pos": [0, 0, 0], "block": { "id": "minecraft:stone" } },
    { "at": 1, "do": "assert", "checks": [ { "pos": [0, 0, 0], "is": { "id": "minecraft:stone" } } ] }
  ]
}
```

### `frontend/src/panels/TestList.tsx`
- Add `creatingAt: string | null` state — folder path where the inline input is mounted, or `""` for root, `null` when no input is showing.
- Read `readonly` from `useConfigStore`; if `true`, do not render the context menu item.
- Context menu: a lightweight absolutely-positioned `<div>` rendered on `onContextMenu` of the header (root) and of each `FolderView`. Items: `New file…`. Dismiss on outside click and on Esc.
- Inline input: when `creatingAt` matches a folder (or root), render an `<input>` row inside that folder's `<ul>` (or at the top of the tree for root), auto-focused.
  - Enter → submit.
  - Esc or blur → cancel (set `creatingAt = null`).
- Submit logic:
  - Trim input.
  - Reject empty, names containing `/`, names containing `..` → show toast "Invalid filename" and keep the input open.
  - If the name does not end with `.json`, append `.json`.
  - Compute id: `creatingAt === ""` → just the filename, else `${creatingAt}/${filename}`.
  - `await api.createTest(id, newTestTemplate(stem))`.
  - On 409 → toast "File already exists"; keep input open so the user can rename.
  - On other errors → toast via the existing `toastOnError` helper; close input.
  - On success → close input. SSE will refresh the list within ~100 ms.

## Files
- `crates/flint-viz/src/api/tests.rs`
- `frontend/src/api/client.ts`
- `frontend/src/api/types.ts` (only if a new response/error variant is needed)
- `frontend/src/panels/TestList.tsx`
- `frontend/src/panels/newTestTemplate.ts` (new)

## Out of scope
- Folder creation (mkdir) — track separately if needed.
- A `+` button in the sidebar header (right-click only for v1).
- Auto-opening the new file after creation.
- Renaming / deleting existing files.

## Verification
1. `cargo run -p flint-viz -- serve ~/flint/FlintCLI/FlintBenchmark/tests`
2. Right-click the `redstone` folder → "New file…" → type `lever_new` → Enter.
3. Within ~250 ms, `redstone/lever_new.json` appears in the tree (SSE).
4. Click it → editor and 3D view populate from the template (stone block at origin, asserted at tick 1).
5. Repeat the same name → toast "File already exists" (409).
6. Try the name `../escape` → toast "Invalid filename" (rejected client-side).
7. Start with no path argument (`flint-viz serve`) → server is read-only → no "New file…" menu item appears on right-click.
8. `cargo test -p flint-viz` passes including the new `create_test_*` cases.
