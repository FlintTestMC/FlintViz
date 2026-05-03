# 0005 — `cargo xtask build`

**Milestone:** M1
**Depends on:** #0003, #0004

## Goal
A single command that builds the frontend then the backend, producing the releasable binary.

## Outcome
- `cargo xtask build` runs `npm ci && npm run build` in `frontend/`, then `cargo build --release -p flint-viz`.
- `cargo xtask build --debug` skips `--release`.

## Implementation notes
- Cargo xtask pattern: a small `xtask` binary crate added to the workspace.
- Use `std::process::Command`; bail with a clear error if `npm` is missing.
- Optional: `cargo xtask dev` runs Vite and `cargo run` concurrently — nice-to-have, not required.

## Files
- `xtask/Cargo.toml`
- `xtask/src/main.rs`
- Workspace `Cargo.toml` (add `xtask` to members)
