# 0046 — `.deb` package for Ubuntu via `cargo-deb`

**Milestone:** Packaging & release
**Depends on:** #0005 (cargo xtask build)

## Goal
Produce a working `.deb` package for `flint-viz` so users on Ubuntu can install with `sudo apt install ./flint-viz_<ver>_amd64.deb` and get `flint-viz` on their PATH. This is the prerequisite for #0047 (release workflow) — the workflow just runs the xtask task added here.

## Outcome
- `cargo xtask deb` produces `target/debian/flint-viz_0.1.0-1_amd64.deb` (or the target-suffixed dir when `--target` is passed).
- The installed binary serves the embedded frontend correctly — i.e. it was built with `--features embed-frontend`.
- `apt install` is clean; `apt remove` is clean; `flint-viz --help` works on PATH.
- Works for both the host triple and `x86_64-unknown-linux-musl`.

## Implementation notes

### Tooling
[`cargo-deb`](https://crates.io/crates/cargo-deb). Declarative: reads `[package.metadata.deb]`. Used with `--no-build --no-strip` so we reuse the binary that `cargo xtask build` produced (cargo-deb's own build wouldn't enable the `embed-frontend` feature without making it default, which would break `cargo run` workflows).

### `crates/flint-viz/Cargo.toml`
Add package metadata (needed by cargo-deb to derive Debian fields) and a `[package.metadata.deb]` block:

```toml
[package]
# ...
description = "Web-based 3D visualizer for Flint Minecraft tests"
license = "GPL-2.0-only"
authors = ["JunkyDeveloper <jonas.bauer.edv@gmail.com>"]
homepage = "https://github.com/FlintTestMC/FlintVisulizer"
repository = "https://github.com/FlintTestMC/FlintVisulizer"
readme = "../../README.md"

[package.metadata.deb]
maintainer = "JunkyDeveloper <jonas.bauer.edv@gmail.com>"
copyright = "2026, JunkyDeveloper. Licensed under GPL-2.0-only."
section = "utility"
priority = "optional"
extended-description = """..."""
depends = "$auto"
assets = [
    ["target/release/flint-viz", "usr/bin/", "755"],
    ["../../README.md", "usr/share/doc/flint-viz/README", "644"],
    ["../../LICENSE", "usr/share/doc/flint-viz/copyright", "644"],
]
```

`target/release/` is auto-rewritten to `target/<triple>/release/` by cargo-deb when `--target` is passed, so the same metadata serves both host and musl builds.

### `xtask/src/main.rs`
- Add `deb` subcommand alongside `build`. Keeps the hand-rolled arg parsing — no clap migration.
- Add `--target <triple>` (also accepts `--target=<triple>`) to **both** `build` and `deb`. Appended to the underlying `cargo build` / `cargo deb` invocations.
- `deb` flow: ensure `cargo-deb` is installed (`cargo deb --version`; print install hint on miss — don't auto-install), call `build` so the frontend + embed-frontend binary exist, then `cargo deb -p flint-viz --no-build --no-strip [--target <triple>]`.
- Reject `--debug` on `deb` (cargo-deb expects a release binary).
- **Windows-friendly npm:** switch `Command::new("npm")` to a `npm_cmd()` helper returning `"npm.cmd"` on Windows, `"npm"` elsewhere. (`npm` is a `.cmd` shim on Windows and won't resolve via `CreateProcess` without the extension.) This is needed by #0047 but lives here.
- **Add `npm run assets` step:** the Dockerfile runs `npm run assets` (the Minecraft asset jar fetcher in `frontend/scripts/fetch-assets.ts`) before `npm run build`. The xtask was previously missing this step; without it, embedded textures would be missing in the `.deb`'s binary. Added before `npm run build`.

## Verification
On Ubuntu:
```bash
cargo install cargo-deb --locked
cargo xtask deb
sudo apt install ./target/debian/flint-viz_0.1.0-1_amd64.deb
flint-viz --help
flint-viz serve ./tests/fixtures   # or any test dir; confirm UI loads with textures
sudo apt remove flint-viz
```

Musl variant (matches Dockerfile linking):
```bash
rustup target add x86_64-unknown-linux-musl
sudo apt-get install -y musl-tools
cargo xtask deb --target x86_64-unknown-linux-musl
# .deb in target/x86_64-unknown-linux-musl/debian/
```

## Out of scope
- APT repository publishing (PPA / Cloudsmith / self-hosted) — separate concern.
- systemd unit / desktop file — `flint-viz` is a foreground CLI, not a daemon.
- `aarch64` `.deb` — easy to add later via the xtask `--target` flag; not requested.
