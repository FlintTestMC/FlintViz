# Development

This page collects maintainer workflows for local development, verification,
and packaging.

## Prerequisites

- Rust stable with edition 2024 support.
- Node.js and npm.
- A local Flint test directory for interactive testing.
- Optional: `cargo-deb` for `.deb` packaging.
- Optional: Windows target for cross-building Windows binaries.

The frontend asset script downloads a vanilla Minecraft client jar and extracts
only the assets needed by the visualizer. The generated asset zip is ignored by
git and must not be redistributed.

## Local Development

Run backend and frontend as two processes.

Backend:

```bash
cargo run -p flint-viz -- serve ./path/to/tests
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Vite proxies `/api` and `/api/events` to the Rust backend.

## Updating flint-core

Replay compatibility lives in `crates/flint-viz-replay`. The native server and
standalone browser build both use this crate, so action and assertion changes
only need to be implemented there.

After updating `flint-core`, regenerate the checked-in browser module:

```bash
cargo update -p flint-core
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked # first time only
npm --prefix frontend run wasm:build
```

Commit the generated files under
`frontend/src/wasm/flint-viz-replay/` together with the Rust changes. Ordinary
frontend builds consume these checked-in bindings and do not require a Rust
toolchain or wasm-pack.

## Read-Only Failure Viewer

Run without a path:

```bash
cargo run -p flint-viz -- serve
```

This starts the server in read-only mode. Normal browsing is unavailable, but
`/failure#data=...` URLs can still load inline failure payloads.

## Asset Generation

Generate the local Minecraft asset bundle:

```bash
cd frontend
npm run assets
```

The script:

1. fetches Mojang's version manifest,
2. downloads the selected client jar,
3. verifies SHA-1,
4. extracts blockstates, models, block textures, and item textures,
5. writes `frontend/public/mc-assets.zip`.

To use another Minecraft version:

```bash
cd frontend
MC_VERSION=1.21.4 npm run assets
```

The extracted assets belong to Mojang. Do not commit or redistribute the
generated zip.

## Verification Commands

Rust backend tests:

```bash
cargo test -p flint-viz --no-fail-fast
```

xtask tests:

```bash
cargo test -p xtask --no-fail-fast
```

Frontend tests:

```bash
cd frontend
npm test
```

Frontend lint:

```bash
cd frontend
npm run lint
```

Frontend production build:

```bash
cd frontend
npm run build
```

Whitespace check:

```bash
git diff --check
```

Use the smallest set that covers the change. For docs-only changes, `git diff
--check` is usually enough. For replay/API/frontend behavior changes, run the
Rust tests and frontend tests at minimum.

## Production Build

Build the self-contained binary:

```bash
cargo xtask build
```

This defaults to Linux and runs:

1. `npm ci` in `frontend/`,
2. `npm run assets`,
3. `npm run build`,
4. `cargo build -p flint-viz --features embed-frontend --release --target x86_64-unknown-linux-gnu`.

Explicit Linux build:

```bash
cargo xtask build linux
```

Windows build:

```bash
cargo xtask build windows
```

Override target:

```bash
cargo xtask build --target x86_64-pc-windows-gnu
```

Debug build:

```bash
cargo xtask build --debug
```

`xtask` is hand-written in `xtask/src/main.rs`; it does not use `clap`.
Unsupported build OS tokens should fail clearly instead of silently selecting a
default target.

## Debian Package

Install `cargo-deb` if needed:

```bash
cargo install cargo-deb --locked
```

Build the package:

```bash
cargo xtask deb
```

`cargo xtask deb` always builds release artifacts, reuses the frontend
embedding flow, and then runs `cargo deb -p flint-viz --no-build --no-strip`.

## Browser Smoke Test

After behavior changes, run:

```bash
cargo run -p flint-viz -- serve ./path/to/tests
cd frontend
npm run dev
```

Then check:

- sidebar lists tests,
- opening a test populates editor and scene,
- malformed JSON shows markers and keeps the last good scene,
- timeline scrubber changes world/player state,
- editor cursor highlights timeline markers,
- clicking a block reveals source,
- Ctrl/Cmd+S saves in writable mode,
- read-only mode blocks saves,
- `/failure#data=...` still loads when available.

For 3D/rendering changes, also check that `/mc-assets.zip` missing-state UI is
still useful.

## Change Workflow: New Replay Action

1. Inspect upstream `flint-core` serde shape for the action.
2. Add or update Rust wire model in `replay/model.rs`.
3. Emit the event in `replay/engine.rs`.
4. Decide whether it mutates the internal Rust player snapshot.
5. Add Rust tests for parse, event emission, source-map index, and wire serde.
6. Update `frontend/src/api/types.ts`.
7. Update `frontend/src/store/world.ts`.
8. Update `frontend/src/store/sourceMap.ts` if the event should resolve from a
   world click.
9. Update timeline labels, panels, or overlays as needed.
10. Add frontend pure tests.
11. Update `docs/replay-contract.md`.

## Change Workflow: API Behavior

1. Update the route handler and DTO.
2. Preserve current status codes unless intentionally changing the contract.
3. Update TypeScript types and client methods.
4. Update store/component handling.
5. Add backend tests for success and important error cases.
6. Add frontend tests for client/store changes where useful.
7. Update `docs/api-contract.md`.

## Change Workflow: Frontend Rendering

1. Identify which store owns the data.
2. Keep derivation pure when possible.
3. Avoid remounting the WebGL canvas from layout changes.
4. Preserve asset-loader caching.
5. Handle missing assets without breaking non-3D UI.
6. Add tests around pure helpers.
7. Browser-smoke-test normal and read-only modes.

## Dirty Worktree Discipline

Before changing files:

```bash
git status --short --untracked-files=all
```

Do not overwrite unrelated local edits. If a change touches a file that already
has unrelated edits, inspect that file and work with the existing changes.

## Current Test Baseline

At the time these docs were added:

- `cargo test -p flint-viz --no-fail-fast` passed 58 tests.
- `npm test` in `frontend/` passed 12 test files and 84 tests.

Treat these numbers as a snapshot, not a permanent expectation.
