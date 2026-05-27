# Architecture

`flint-viz` is a local web tool for inspecting Flint test JSON. It runs as one
Rust binary that serves a JSON API, optional file watching, and either an
embedded production frontend or a Vite-powered development frontend.

The core runtime is intentionally simple:

```text
Flint JSON file/editor buffer
  -> flint_core::test_spec::TestSpec
  -> Rust static replay engine
  -> JSON Replay wire shape
  -> TypeScript wire types
  -> Zustand stores
  -> React panels and R3F world renderer
```

The visualizer does not run Minecraft and does not simulate game logic. It
renders what the test describes.

## Repository Map

- `crates/flint-viz/` is the Rust binary crate. It owns the CLI, axum server,
  API handlers, static replay engine, file watcher, and embedded frontend
  serving.
- `frontend/` is the Vite + React + TypeScript SPA. It owns the editor, test
  list, replay state, panels, 3D scene, and asset loading.
- `xtask/` is the hand-written workspace task runner for production builds and
  `.deb` packaging.
- `plan/` is historical issue planning. It is not the current architecture
  reference.
- `bugs/` records security and dependency findings.
- `docs/` is the maintainer documentation set.

## Backend Lifecycle

The process starts in `crates/flint-viz/src/main.rs`.

1. `clap` parses `flint-viz serve [PATH]`.
2. `resolve_test_root` validates `PATH` when one is supplied:
   - missing path is an error,
   - file path is an error,
   - directory path is canonicalized.
3. If no path is supplied, `test_root` is `None` and the server runs in
   read-only failure-viewer mode.
4. `AppState::new` stores the optional canonical test root, read-only flag, and
   a `tokio::sync::broadcast` sender for file-change events.
5. If a test root exists, `watch::spawn` starts a recursive `notify` watcher.
6. axum builds the API router and, with the `embed-frontend` feature, merges
   the embedded frontend router.
7. The server binds to `--host` and `--port`; `--open` asks `webbrowser` to
   open the displayed URL.

The backend is not a library crate today. Most Rust modules are private to the
binary, and their public items are public for module sharing and tests rather
than for external consumers.

## Backend Modules

- `cli.rs` defines the command-line shape.
- `state.rs` defines `AppState`, including read-only mode and the file-event
  broadcast channel.
- `api/mod.rs` merges all API subrouters.
- `api/config.rs` exposes runtime capabilities used during frontend boot.
- `api/tests.rs` lists, loads, saves, and creates test JSON files under the
  configured root.
- `api/replay.rs` parses editor JSON and runs the replay engine.
- `api/events.rs` exposes file-change Server-Sent Events.
- `api/failure.rs` decodes flint-steel failure URL payloads.
- `watch.rs` bridges `notify` events to the SSE broadcast channel.
- `embed.rs` serves the built frontend when the binary is compiled with
  `embed-frontend`.
- `replay/` converts `flint_core::test_spec::TestSpec` into the wire `Replay`
  model.

## Frontend Lifecycle

The SPA entry point is `frontend/src/main.tsx`.

Routing is intentionally tiny:

- `/` and normal paths render `App`.
- `/failure` and `/failure/*` render `FailureView`, which decodes the URL
  payload and then renders the regular `App` shell once state is populated.

`App` fetches `/api/config` before choosing the layout. This avoids remounting
the WebGL canvas after the app discovers read-only mode; remounting the canvas
after switching layout has previously produced a black scene.

In normal writable mode:

1. `TestList` loads `/api/tests`.
2. Selecting a test calls `/api/tests/{id}`.
3. The replay store receives the source and resets playback state.
4. The editor sends the source to `/api/replay`.
5. A successful replay response updates `Replay`, source-map indices, tick,
   world state, and player state.
6. The scene, timeline, inventory, and assertion panels subscribe to stores and
   re-render from the shared state.

In read-only server mode:

- There is no test sidebar because `/api/tests` is empty.
- The landing page tells the user to open a failure URL.
- Failure URLs can still populate the replay store from inline payload data.

## Data Flow

```text
Disk JSON
  -> GET /api/tests/{id}
  -> TestDetail { id, source, spec, parse_error }
  -> useReplayStore.openTest
  -> Editor displays source

Editor source
  -> POST /api/replay
  -> ReplayResponse { spec, errors, replay }
  -> useReplayStore.setReplay
  -> source-map indices + tick/world/player rebuild
  -> Scene, Scrubber, Inventory, Assertions

Disk change
  -> notify watcher
  -> debounce/filter by .json path
  -> broadcast FileEvent { id }
  -> GET /api/events SSE event "file-changed"
  -> frontend reloads affected source/list as needed
```

## Static Replay Boundary

The replay engine emits ordered `TickEvent`s. It does not compute Minecraft
physics, block updates, placement legality, loot tables, redstone behavior, or
item consumption. Some events intentionally have no world-state side effect in
static replay. For example, `use_item_on` records position, face, explicit
item, and resolved active item, but does not mutate the world.

The frontend derives world and player state by applying the same event
semantics in TypeScript. This mirror is a deliberate contract so the backend
can return compact sparse frames instead of expanding a full world snapshot for
every tick.

## Build And Packaging Shape

Development uses two processes:

- `cargo run -p flint-viz -- serve <tests>`
- `cd frontend && npm run dev`

Production uses `cargo xtask build`, which runs the frontend build and then
builds `flint-viz` with `--features embed-frontend`. The default build target
is Linux; `cargo xtask build windows` selects the Windows target. See
[Development](development.md) for commands.

## Where To Start Reading

- Backend boot and routing: `crates/flint-viz/src/main.rs` and
  `crates/flint-viz/src/api/mod.rs`.
- Test file API behavior: `crates/flint-viz/src/api/tests.rs`.
- Replay model and engine: `crates/flint-viz/src/replay/model.rs` and
  `crates/flint-viz/src/replay/engine.rs`.
- Frontend shell: `frontend/src/App.tsx`.
- Frontend API types: `frontend/src/api/types.ts`.
- Replay state: `frontend/src/store/replay.ts` and
  `frontend/src/store/world.ts`.
- 3D world rendering: `frontend/src/world/World.tsx`,
  `frontend/src/world/instancing.ts`, and `frontend/src/world/atlas.ts`.
- Packaging: `xtask/src/main.rs`.
