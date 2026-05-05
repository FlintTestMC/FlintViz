# FlintVisualizer

Local web tool for inspecting Flint test JSON files in a 3D world view.
Status: **M1 scaffolding only** — backend boots, frontend renders, packaging works. No replay logic or API surface yet (see `plan/` for the roadmap).

## Stack

- **Backend** — Rust + axum, binary `flint-viz`, listens on `127.0.0.1:7878`.
- **Frontend** — Vite + React + TypeScript, dev server on `127.0.0.1:5173`, proxies `/api` and `/api/events` to the backend.
- **Packaging** — `rust-embed` bundles `frontend/dist/` into the release binary behind the `embed-frontend` cargo feature.

## Prerequisites

- Rust (stable, edition 2024 — recent toolchain)
- Node.js + npm (for the frontend)

## Minecraft assets

The 3D view renders blocks using vanilla Minecraft textures and models. These are
**not** bundled in the repo (gitignored, license-sensitive, ~2 MB) — you generate
them once locally from a vanilla client jar:

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

Re-run only if you bump the MC version. Override with:

```bash
MC_VERSION=1.21.4 npm run assets
```

If the zip is missing at runtime, the visualization pane shows an error and the
3D view stays empty. The dev/release backend still boots and the rest of the UI
works without it.

License note: the extracted assets are Mojang's; do not redistribute the
generated zip. The script is a thin wrapper around the public launcher API and
is only intended to be run by developers with a valid Minecraft license.

## Two ways to run

### A. Dev mode — two processes, hot reload

Use this for day-to-day testing. The Vite dev server proxies API calls to the Rust backend, so you edit frontend code and it hot-reloads while the backend stays up.

Terminal 1 — backend:

```bash
cargo run -p flint-viz -- serve [PATH]
# e.g.
cargo run -p flint-viz -- serve ./some-flint-tests
```

Flags (from `flint-viz serve --help`):
- `[PATH]` — directory to scan for Flint test JSON. Defaults to `.`. Must exist and be a directory.
- `-p, --port <N>` — bind port (default `7878`).
- `--open` — open the URL in the system browser after start.

Terminal 2 — frontend:

```bash
cd frontend
npm install      # first time only
npm run dev
```

Open <http://localhost:5173>. You should see the split layout with the R3F smoke-test cube on the visualization side.

Smoke check the backend independently:

```bash
curl http://localhost:7878/healthz   # → ok
```

### B. Release mode — single self-contained binary

Builds the frontend, then a release `flint-viz` with the assets embedded. No Vite needed at runtime.

```bash
cargo xtask build           # release
cargo xtask build --debug   # skip --release
```

Output:
- `target/release/flint-viz` (or `target/debug/flint-viz` with `--debug`)

Run it:

```bash
./target/release/flint-viz serve ./some-flint-tests --open
```

The binary serves both the API and the SPA on port 7878 (unknown paths fall back to `index.html` for client-side routing).

`cargo xtask build` is just `npm ci && npm run build` in `frontend/` followed by `cargo build -p flint-viz --features embed-frontend [--release]`. It bails with a clear error if `npm` is missing.

## Layout

```
crates/flint-viz/   # axum server, CLI, embed
frontend/           # Vite + React + R3F SPA
xtask/              # cargo xtask build
plan/               # per-issue plan; see plan/README.md
```

## Logs

`tracing-subscriber` reads `RUST_LOG`. Default is `info`. Example:

```bash
RUST_LOG=flint_viz=debug,tower_http=debug cargo run -p flint-viz -- serve .
```
