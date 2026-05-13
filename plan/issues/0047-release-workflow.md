# 0047 — GitHub Actions release workflow (linux/mac/windows + `.deb`)

**Milestone:** Packaging & release
**Depends on:** #0005 (cargo xtask build), #0046 (`.deb` packaging)

## Goal
Every published GitHub release of FlintVisualizer automatically gets standalone executable artifacts for Linux, macOS (Intel + Apple Silicon), and Windows, plus a Ubuntu `.deb`, attached as release assets — no manual cross-compiling.

## Outcome
- Workflow lives at `.github/workflows/release.yml`.
- Trigger: `release: published` (also `workflow_dispatch` for re-runs without a release).
- Produces 4 binary artifacts per release:
  - `flint-viz-linux-x86_64.tar.gz` (musl-static, matches existing Dockerfile linking)
  - `flint-viz-macos-x86_64.tar.gz`
  - `flint-viz-macos-aarch64.tar.gz`
  - `flint-viz-windows-x86_64.zip`
- `.deb` job is **wired but off by default**. It's a separate job behind `workflow_dispatch` with a `build_deb: boolean` input (default `false`). When we're ready to ship `.deb`s, flip the input — or fold the deb step into the release path with a one-line change. Until then it's available for manual smoke tests only.
- All built natively on their respective runners — no cross-compile gymnastics (Intel macOS builds on `macos-latest` ARM via the `x86_64-apple-darwin` rustup target, which is supported out of the box).

## Implementation notes

### Jobs

**`build`** — matrix, one entry per platform. Always runs.

| name | runner | target | artifact |
|---|---|---|---|
| linux-x86_64-musl | ubuntu-22.04 | x86_64-unknown-linux-musl | `flint-viz-linux-x86_64.tar.gz` |
| macos-x86_64 | macos-latest | x86_64-apple-darwin | `flint-viz-macos-x86_64.tar.gz` |
| macos-aarch64 | macos-latest | aarch64-apple-darwin | `flint-viz-macos-aarch64.tar.gz` |
| windows-x86_64 | windows-latest | x86_64-pc-windows-msvc | `flint-viz-windows-x86_64.zip` |

**`deb`** — standalone job. `if: github.event_name == 'workflow_dispatch' && inputs.build_deb`. Skipped on release events; only fires when manually dispatched with the `build_deb` checkbox ticked. Rebuilds against `x86_64-unknown-linux-musl` and uploads the `.deb` as a workflow artifact.

### Per-job steps (build matrix)
1. `actions/checkout@v4`
2. `actions/setup-node@v4` — Node 20, npm cache keyed on `frontend/package-lock.json`.
3. `dtolnay/rust-toolchain@stable` with `targets: <triple>`.
4. `Swatinem/rust-cache@v2` keyed by target.
5. Linux musl only: `sudo apt-get install -y musl-tools` (needed by the musl linker).
6. `cargo xtask build --target <triple>`.
7. Package:
   - unix: `tar -czf dist/<basename>.tar.gz -C target/<triple>/release flint-viz`
   - windows: `Compress-Archive target/<triple>/release/flint-viz.exe dist/<basename>.zip`
8. Upload:
   - `release` event → `softprops/action-gh-release@v2` with `files: dist/*` (attaches to the triggering release).
   - `workflow_dispatch` → `actions/upload-artifact@v4` (so manual runs are inspectable without creating a release).

### Per-job steps (deb)
Mirrors the linux build, plus:
- `taiki-e/install-action@v2` with `tool: cargo-deb` (fast precompiled install — avoids a 2+ min `cargo install`).
- `cargo xtask deb --target x86_64-unknown-linux-musl`.
- Uploaded as workflow artifact only (not attached to a release until the deb is promoted out of the optional gate).

### Permissions
`contents: write` at the workflow level — required for `softprops/action-gh-release` to attach assets.

### Why these choices
- **musl on Linux**: matches the existing Dockerfile and ships a fully static binary that runs on any Linux distribution, not just the one the runner built on. The `.deb` still installs fine on Ubuntu; cargo-deb just packages whatever binary it's pointed at.
- **macos-latest for Intel target**: GitHub now defaults `macos-latest` to ARM runners. `x86_64-apple-darwin` is a supported rustup target and cross-compiles cleanly without extra toolchain setup.
- **Native runners over `cross`**: the build needs Node + npm for the frontend, which is much simpler on native runners than inside `cross`'s containers.

## Verification
1. Push a tag and create a draft release locally:
   ```bash
   gh release create v0.1.0-test --draft --notes "smoke"
   ```
2. Publish the draft via the GitHub UI — workflow fires.
3. Confirm all 4 matrix jobs succeed.
4. Confirm 5 assets attached to the release.
5. Download the `.deb` onto a fresh Ubuntu 22.04 + 24.04 box and `sudo apt install ./flint-viz_*.deb`; run `flint-viz serve <dir>`.
6. `file flint-viz` on the macOS artifacts confirms the right Mach-O arch.
7. On Windows, `flint-viz.exe --help` works.
8. Clean up: `gh release delete v0.1.0-test --cleanup-tag`.

## Out of scope
- Codesigning / notarization for macOS — without an Apple Developer account, users see a Gatekeeper prompt. Not blocking initial distribution.
- Windows EV codesigning — same story, SmartScreen warning.
- Publishing to APT repos, Homebrew taps, `winget` manifests — separate, downstream concerns.
- ARM Linux (`aarch64-unknown-linux-musl`) — easy to add to the matrix later if asked.
