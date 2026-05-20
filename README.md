# FlintVisualizer

A local web tool for inspecting [Flint](https://github.com/FlintTestMC/flint-core)
Minecraft test JSON files. Opens any test in an Overleaf-style split view: the
source on the left, a 3D world view + timeline scrubber + inventory and
assertion panels on the right. Editing the JSON re-renders the visualization
live.

Use it to **see the shape of a test** — where the cleanup region sits, where
blocks land, how the inventory evolves, where assertions check things — without
spinning up a real Minecraft server.

## Screenshots

![Split view — editor on the left, 3D world on the right](docs/screenshots/split-view.png)

![Timeline scrubber with event markers and breakpoints](docs/screenshots/timeline.png)

![Inventory + assertion panels](docs/screenshots/inventory.png)

## Install

### From source (single self-contained binary)

```bash
git clone https://github.com/FlintTestMC/FlintViz
cd FlintViz
cargo xtask build           # builds the frontend, then a release binary with assets embedded
./target/x86_64-unknown-linux-gnu/release/flint-viz serve ./path/to/tests --open
```

`cargo xtask build` defaults to Linux. Use `cargo xtask build linux` or
`cargo xtask build windows` to pick an OS explicitly, or pass
`--target <triple>` to override the default target. Every variant runs
`npm ci`, `npm run assets`, and `npm run build` in `frontend/`, then
`cargo build -p flint-viz --features embed-frontend --release`. It bails with a
clear error if `npm` is missing. Pass `--debug` to skip `--release`.

The default targets are:

- Linux: `x86_64-unknown-linux-gnu`
- Windows: `x86_64-pc-windows-gnu`

### `cargo install`

```bash
cargo install --git https://github.com/FlintTestMC/FlintViz \
              --features embed-frontend \
              flint-viz
```

This requires Node.js + npm on PATH while building (the frontend is built as
part of the `embed-frontend` feature) and produces a single binary on `$PATH`.

### Prerequisites

- Rust (stable, edition 2024)
- Node.js + npm (for the frontend build, and once for asset extraction)

## Usage

```bash
flint-viz serve <PATH>
```

- `<PATH>` — directory to scan (recursively) for Flint test JSON. Defaults to
  the current directory. Must exist and be a directory; `flint-viz` exits with
  a `hint:` line if not.
- `--host <IP>` — bind address (default `127.0.0.1`). Use `0.0.0.0` to expose
  the server outside the host, e.g. when running in Docker:
  `docker run -p 7878:7878 flint-viz --host 0.0.0.0`.
- `-p, --port <N>` — bind port (default `7878`).
- `--open` — open the URL in the system browser after start.

Open <http://localhost:7878>. The sidebar lists every test under `<PATH>`;
click one to load it into the editor + 3D view + timeline.

### Keyboard shortcuts

- `Space` — play / pause
- `←` / `→` — step one event back / forward
- `Home` / `End` — jump to first / last tick
- `R` — rotate the scene 90° clockwise (also mirror via the toolbar)

Keys are ignored while the editor or another input is focused.

### What's clickable

The editor and 3D view are cross-linked both ways — these aren't obvious
without trying them:

- **Timeline marker → editor.** Clicking a tick marker on the scrubber pauses
  playback, jumps the playhead to that tick, and reveals the corresponding
  `timeline[N]` entry in the JSON editor.
- **3D block → editor.** Clicking any rendered block reveals the `timeline[N]`
  entry that placed (or last touched) it. For `fill` regions every block in the
  AABB resolves to the same source entry.
- **Editor cursor → timeline.** When the cursor is inside a `timeline[N]`
  entry, the matching tick marker(s) on the scrubber get a cyan ring. Entries
  with `at: [t1, t2, t3]` highlight all three ticks.
- **Assertion row → editor.** Each row in the assertion panel reveals the
  `timeline[N]` entry that produced it. The 📍 button on the row flies the
  camera to the assertion's position.

The cross-link uses RFC 6901 JSON pointers, which is mostly an implementation
detail — but it means assertion failures and source ranges round-trip cleanly
through the API.

## Asset bundle

bash command:
```
./frontend/scripts/fetch-assets.bash
```

The 3D view renders blocks using vanilla Minecraft textures and models. These
are **not** bundled in the repo (license-sensitive, gitignored, ~2 MB) — you
generate them once locally from a vanilla client jar:

```bash
cd frontend
npm install        # first time only
npm run assets     # downloads the jar and writes public/mc-assets.zip
```

What it does:

1. Fetches Mojang's launcher version manifest.
2. Looks up the version (default `26.1.2`) and its `client.jar` URL.
3. Downloads the jar (~36 MB) and verifies the SHA-1.
4. Extracts only `assets/minecraft/{blockstates,models,textures/block,textures/item}/...`.
5. Re-zips into `frontend/public/mc-assets.zip` (~2 MB).

Re-run only if you bump the MC version:

```bash
MC_VERSION=1.21.4 npm run assets
```

**License note:** the extracted assets are Mojang's; do not redistribute the
generated zip. The script is a thin wrapper around the public launcher API and
is only intended to be run by developers with a valid Minecraft license.

## Troubleshooting

- **"Asset bundle missing" panel in the 3D pane.** The card explains how to
  fetch `mc-assets.zip` (`npm run assets` in `frontend/`); follow the
  instructions in the panel. The rest of the UI keeps working without it.
- **Amber "stale" badge on the canvas.** The JSON has a parse error. The 3D
  view freezes on the last good state, the editor squiggles point at the
  problem, and the badge clears once the JSON parses again. The view is not
  broken — it's deliberately holding the last valid frame.
- **Toasts at the bottom-right.** API failures (sidebar list, open-test,
  replay) surface there. They auto-dismiss; the canonical error state lives in
  the editor / stale badge, the toast is just a notice.
- **`flint-viz serve <bad-path>` exits.** A `hint:` line in the error output
  suggests the right invocation shape (path must exist and be a directory).

## Development

For day-to-day frontend work, run the Vite dev server alongside the backend so
you get hot reload. Vite proxies `/api` and `/api/events` to the Rust process.

Terminal 1 — backend:

```bash
cargo run -p flint-viz -- serve ./some-flint-tests
```

Terminal 2 — frontend:

```bash
cd frontend
npm install      # first time only
npm run dev
```

Open <http://localhost:5173>.

Smoke-check the backend independently:

```bash
curl http://localhost:7878/healthz   # → ok
```

Set `RUST_LOG` for more verbose tracing:

```bash
RUST_LOG=flint_viz=debug,tower_http=debug cargo run -p flint-viz -- serve .
```

### Layout

```
crates/flint-viz/   axum server, CLI, replay engine, embed
frontend/           Vite + React + R3F SPA
xtask/              cargo xtask build
plan/               per-issue plan; see plan/README.md
```

## Limitations

- **Static replay, no real game logic.** FlintVisualizer applies pure state
  diffs from the test plan — it does not run a Minecraft server, simulate
  redstone, evaluate loot tables, or otherwise emulate game behavior. The
  visualization shows what the test *describes*, not what would happen in-game.
- **flint-steel mode (real execution) is opt-in and not built by default.**
  M8 adds an optional `flint-steel` runtime behind a cargo feature; until then,
  expect static replay only. See [#0035](plan/issues/0035-flint-steel-runtime.md).
- **No recording, multi-test diffing, or sharing.** Out of scope for v1.

## Related projects

- [flint-core](https://github.com/FlintTestMC/flint-core) — the test-spec
  schema and parser this tool re-uses as a git dependency.
- [FlintCLI](https://github.com/FlintTestMC/FlintCli) — the command-line
  runner that drives Flint tests against a real MC server.
- [flint-steel](https://github.com/FlintTestMC/flint-steel) — the embedded
  runtime targeted by the optional M8 mode.
