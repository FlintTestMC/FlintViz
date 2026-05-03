# 0002 — CLI args (clap)

**Milestone:** M1
**Depends on:** #0001

## Goal
Replace the hard-coded server boot with a proper CLI: `flint-viz serve [PATH] --port <N> --open`.

## Outcome
- `flint-viz --help` prints subcommand and flag help.
- `flint-viz serve ./tests` boots the server with `./tests` as the test root path (stored in app state for later).
- `--port 9000` overrides the default 7878.
- `--open` opens the URL in the system browser (`open` crate or `webbrowser`).

## Implementation notes
- `clap` with `derive` feature.
- Subcommand `Serve { path: Option<PathBuf>, #[arg(short, long, default = 7878)] port: u16, #[arg(long)] open: bool }`.
- App state struct holding `test_root: PathBuf`. Default to `"."` if no path given.
- Validate that `path` exists; error early with a helpful message.

## Files
- `crates/flint-viz/src/main.rs`
- `crates/flint-viz/src/cli.rs` (new)
- `crates/flint-viz/src/state.rs` (new) — `AppState`
