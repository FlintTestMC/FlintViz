# 0001 — Cargo workspace + axum healthz

**Milestone:** M1
**Depends on:** —

## Goal
Stand up a Rust cargo workspace at the repo root containing a `flint-viz` binary crate. Boot a minimal axum HTTP server with a `/healthz` endpoint so we have a backbone to grow against.

## Outcome
- `cargo run -p flint-viz` starts a server on `127.0.0.1:7878`.
- `curl localhost:7878/healthz` returns `200 OK` with body `ok`.

## Implementation notes
- `Cargo.toml` (workspace) with `members = ["crates/flint-viz"]` and `resolver = "2"`.
- `crates/flint-viz/Cargo.toml`: `axum`, `tokio` (`features = ["rt-multi-thread", "macros"]`), `tracing`, `tracing-subscriber`.
- Hard-code port for now; CLI args come in #0002.
- `flint-core` git dep — pin rev to whatever `~/flint/FlintCLI/Cargo.toml` line 17 specifies. Do **not** use `path =`.

## Files
- `Cargo.toml` (workspace)
- `crates/flint-viz/Cargo.toml`
- `crates/flint-viz/src/main.rs`
