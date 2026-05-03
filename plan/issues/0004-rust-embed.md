# 0004 — `rust-embed` bundles frontend into binary

**Milestone:** M1
**Depends on:** #0001, #0003

## Goal
Embed `frontend/dist/` into the Rust binary so a release build is a single self-contained executable.

## Outcome
- `npm run build` (in `frontend/`) emits `frontend/dist/`.
- `cargo build --release -p flint-viz` includes those assets.
- The binary serves `/` → `index.html`, `/assets/*` → corresponding files. Unknown paths fall back to `index.html` (SPA routing).

## Implementation notes
- `rust-embed = "8"` with `#[derive(Embed)] #[folder = "../../frontend/dist/"]`.
- A small axum handler that resolves the request path, looks up `Asset::get`, sets correct `Content-Type` from `mime_guess`, returns 200 or falls back to index for client-side routes.
- Dev mode: skip embedding entirely; just rely on Vite proxy. Use a cargo feature `embed-frontend` enabled by `--release`, or always embed and accept that dev runs frontend separately.

## Files
- `crates/flint-viz/src/embed.rs` (new)
- `crates/flint-viz/src/main.rs` (wire embed router after `/api`)
