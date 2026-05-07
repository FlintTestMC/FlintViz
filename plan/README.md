# FlintVisualizer — Plan

## Context

Flint is a Minecraft testing framework. Tests are JSON files with a tick-based timeline of actions
(`place`, `place_each`, `fill`, `remove`, `assert`, `assert_state`, `set_slot`, `use_item_on`), a `setup.cleanup.region`
bounding box, and a player/inventory configuration. Today the only ways to "see" a test are reading
the JSON, watching `flintmc` drive a real MC server, or running it via `flint-steel`. None of these
let you quickly grasp the *shape* of a test: where the cleanup region is, where blocks land, how
the inventory evolves, where assertions check things.

**FlintVisualizer** is a local web tool that opens any Flint test JSON in an Overleaf-style split
view: source on the left, 3D world view + timeline scrubber + inventory/assertion panels on the
right. Editing JSON re-renders the visualization live.

Out of scope for v1: real game-logic execution, recording new tests, multi-test diffing, sharing.
The optional flint-steel runtime is staged in M8.

## Decisions

| Concern             | Choice                                                            |
| ------------------- | ----------------------------------------------------------------- |
| Backend             | Rust + axum, embeds `flint-core` as a git dep                     |
| Execution model     | **Static plan replay** — pure state diffs, no real MC logic       |
| Frontend            | Vite + React + TypeScript                                         |
| Editor              | Monaco with vendored Flint JSON schema                            |
| 3D framework        | **react-three-fiber** + **@react-three/drei** (declarative Three.js) |
| Block geometry      | `deepslate` used as a *geometry/icon adapter* (parses MC models, builds atlas, renders item icons); rendering itself is R3F |
| Styling             | **Tailwind CSS** + a few headless Radix primitives where needed   |
| Layout              | `react-resizable-panels`                                          |
| Store               | Zustand (also drives R3F via its built-in store integration)      |
| Distribution        | Single binary: `rust-embed` bundles frontend, `flint-viz serve`   |
| Hot-reload          | `notify` file watcher → SSE                                       |

## Architecture

```
┌─ Rust binary ─────────────────────────────────────────┐
│  flint-viz serve [PATH]                                │
│  ├─ axum on localhost:7878                             │
│  ├─ flint-core (git dep, pinned to FlintCli's rev)     │
│  ├─ Replay engine: TestSpec → Vec<TickFrame>           │
│  ├─ rust-embed → frontend/dist/                        │
│  └─ notify → SSE for file changes                      │
└────────────────────────────────────────────────────────┘
                  ▲ JSON over HTTP / SSE
┌─ Frontend (SPA) ──────────────────────────────────────┐
│ 3D view (R3F)         │ Monaco editor                  │
│ Inventory │ Assertions│                                │
│ Timeline scrubber     │                                │
└────────────────────────────────────────────────────────┘
```

## Milestones

| ID  | Goal                                                            |
| --- | --------------------------------------------------------------- |
| M1  | Scaffolding — cargo workspace, frontend, packaging              |
| M2  | Test discovery & HTTP API surface (no replay logic yet)         |
| M3  | Replay engine — `TestSpec` → per-tick state                     |
| M4  | Frontend foundations — store, sidebar, editor                   |
| M5  | 3D rendering — deepslate, overlays, action highlights           |
| M6  | Timeline & side panels                                          |
| M7  | Cross-linking & polish                                          |
| M8  | (Stretch) Real execution via flint-steel                        |
| M9  | Fixes |

## Issues

### M1 — Scaffolding
- [#0001](issues/0001-cargo-workspace.md) — Cargo workspace + axum healthz
- [#0002](issues/0002-cli-args.md) — CLI args (clap): `serve`, `--port`, `--open`
- [#0003](issues/0003-frontend-scaffold.md) — Vite/React/TS scaffold + split-pane layout
- [#0004](issues/0004-rust-embed.md) — `rust-embed` bundles frontend into binary
- [#0005](issues/0005-xtask-build.md) — `cargo xtask build` builds frontend then backend

### M2 — Test discovery & API
- [#0006](issues/0006-list-tests-endpoint.md) — `GET /api/tests` (recursive walk)
- [#0007](issues/0007-get-test-endpoint.md) — `GET /api/tests/:id` returns raw JSON + parsed metadata
- [#0008](issues/0008-replay-endpoint-stub.md) — `POST /api/replay` — parse-only stub, structured errors
- [#0009](issues/0009-file-watcher-sse.md) — `notify` watcher + `GET /api/events` SSE

### M3 — Replay engine
- [#0010](issues/0010-replay-data-model.md) — `Replay`, `TickFrame`, `BlockChange`, `PlayerDelta`, `AssertionView`
- [#0011](issues/0011-replay-place-fill.md) — Implement `place` and `fill` actions
- [#0012](issues/0012-replay-place-each.md) — Implement `place_each`
- [#0013](issues/0013-replay-remove.md) — Implement `remove`
- [#0014](issues/0014-replay-player-actions.md) — Player snapshot foundation (`PlayerSnapshot`, `PlayerDelta`, apply logic; no per-tick actions)
- [#0037](issues/0037-replay-set-slot.md) — `set_slot` action
- [#0038](issues/0038-replay-use-item-on.md) — `use_item_on` action (event only, no side effects)
- [#0039](issues/0039-replay-select-hotbar.md) — `select_hotbar` action
- [#0015](issues/0015-replay-assertions.md) — Collect `assert` / `assert_state` as `AssertionView`s
- [#0016](issues/0016-replay-source-map.md) — JSON-pointer source map per timeline event

### M4 — Frontend foundations
- [#0017](issues/0017-api-client.md) — Typed fetch wrapper for `/api/*`
- [#0018](issues/0018-zustand-store.md) — Replay store with forward-diff `WorldState` reconstruction
- [#0019](issues/0019-test-list-sidebar.md) — Tree view sidebar
- [#0020](issues/0020-monaco-editor.md) — Monaco pane with debounced re-replay
- [#0021](issues/0021-flint-json-schema.md) — Vendored Flint test JSON schema for validation/completion

### M5 — 3D rendering
- [#0022](issues/0022-deepslate-canvas.md) — deepslate + Three.js canvas + asset pipeline
- [#0023](issues/0023-render-world-state.md) — Render current `WorldState` as a deepslate Structure
- [#0024](issues/0024-camera-controls.md) — Orbit camera centered on cleanup region
- [#0025](issues/0025-cleanup-region-overlay.md) — Wire-frame box for cleanup region
- [#0026](issues/0026-action-highlights.md) — Per-tick placed/removed/filled visual highlights
- [#0027](issues/0027-assertion-ghost-overlay.md) — Ghost-render asserted blocks at current tick
- [#0036](issues/0036-rotate-blocks.md) — Rotate the entire test scene (90°/180°/270° + mirror)

### M6 — Timeline & panels
- [#0028](issues/0028-timeline-scrubber.md) — Horizontal scrubber with event markers + breakpoints
- [#0029](issues/0029-playback-controls.md) — Play/pause/step + keyboard shortcuts
- [#0030](issues/0030-inventory-panel.md) — Hotbar + armor + off-hand with item icons
- [#0031](issues/0031-assertion-panel.md) — Current-tick assertion list + click-to-fly

### M7 — Cross-linking & polish
- [#0032](issues/0032-source-visual-crosslink.md) — Timeline event ↔ JSON range; click block → editor
- [#0033](issues/0033-error-states.md) — Friendly UI for invalid JSON, missing path, no tests
- [#0034](issues/0034-readme.md) — README with screenshots and usage

### M8 — Stretch: real execution
- [#0035](issues/0035-flint-steel-runtime.md) — Cargo feature gating real flint-steel execution + UI overlay

### M9 - Fixes
- [#0040](issues/0040-seperate-actions.md)
- [#0041](issues/0041-multi-assert.md)
- [#0042](issues/0042-brighter-background.md)
- [#0043](issues/0043-fire-texture-missing.md)

## Verification (end-to-end after M1–M7)

1. `cargo run -p flint-viz -- serve ~/flint/FlintCLI/FlintBenchmark/tests --open`
2. Browser opens at `http://localhost:7878`; sidebar lists tests.
3. Open `nether_portal_in_endportal.json` → editor + 3D view + timeline populate.
4. Drag scrubber → blocks appear/disappear at correct ticks; inventory updates.
5. ←/→ key for tick-by-tick stepping; space for play/pause.
6. Edit a `place`'s `pos` → after ~250 ms, 3D view reflects change.
7. Modify file on disk via `echo` → SSE refreshes editor + view.
8. Click event marker → editor scrolls to matching JSON object.
9. Malformed JSON → editor squiggles, view shows last-good state with stale badge.

## Critical references

- `~/flint/flint-core/src/test_spec.rs` — `TestSpec`, `TimelineEntry`, `ActionType`, `Block`, `PlayerSlot`
- `~/flint/flint-core/src/timeline.rs` — `TimelineAggregate`, breakpoints
- `~/flint/flint-core/src/loader.rs` — `TestLoader`
- `~/flint/flint-core/src/results.rs` — `AssertionResult`, `AssertFailure` (M8 only)
- `~/flint/FlintCLI/Cargo.toml` line 17 — flint-core git rev FlintCLI pins to (we no longer match it; see below)
- `crates/flint-viz/Cargo.toml` — pinned to `tag = "v1.1.3"` since #0010 (FlintCLI's older `b04ad23` lacked `Item`, `PlayerSlot`, `BlockFace`, `GameMode`, and the `UseItemOn`/`SetSlot`/`SelectHotbar` action variants needed by M3 issues #0014/#0037–#0039).
- `~/flint/FlintCLI/example_tests/basic_placement.json` — fixture for replay engine tests
- `~/flint/FlintCLI/FlintBenchmark/tests/*.json` — broader fixture set
