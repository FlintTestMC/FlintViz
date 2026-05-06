# 0034 — README

**Milestone:** M7
**Depends on:** all of M1–M6

## Goal
A README that gets a new user from zero to running tool in under 5 minutes.

## Outcome
- Section: What is FlintVisualizer
- Section: Install (single binary or `cargo install`)
- Section: Usage — `flint-viz serve <path>`
- Section: Screenshots — at least the split view, timeline, and inventory panel
- Section: Asset bundle — note about Mojang-owned assets, instructions for `npm run assets`
- Section: Limitations — static replay, no real game logic; flint-steel mode (M8) is opt-in

## Implementation notes
- Link to flint-core, FlintCli, flint-steel.

## Files
- `README.md`
- `docs/screenshots/*.png`

## Handoff from #0032 (source ↔ visual cross-link)

The README should call out what's clickable and what each click does — these aren't obvious without trying them:

- **Timeline marker → editor**: clicking a tick marker on the scrubber pauses
  playback, jumps the playhead to that tick, and reveals + selects the
  corresponding `timeline[N]` entry in the JSON editor.
- **3D block → editor**: clicking any rendered block in the 3D view reveals the
  `timeline[N]` entry that placed (or last touched) it. For `fill` regions every
  block in the AABB resolves to the same source entry.
- **Editor cursor → timeline**: when the cursor is inside a `timeline[N]` entry
  (anywhere in the object), the matching tick marker(s) on the scrubber get a
  cyan ring. `at: [t1, t2, t3]` entries highlight all three ticks.
- **Assertion row → editor**: each row in the assertion panel reveals the
  `timeline[N]` entry that produced it. The 📍 button is unchanged — it flies
  the camera to the assertion's position; the row text is the editor jump.

Worth a one-line mention that the cross-link uses RFC 6901 JSON pointers if the
README has a "for advanced users" section, but not required.

## Handoff from #0033 (error states & empty UI)

The error-handling surface added in #0033 is worth two sentences in a
"troubleshooting" section so users know what they're seeing:

- **Asset-bundle missing panel**: the 3D pane renders a card explaining how to
  fetch `mc-assets.zip` if it's missing. The exact instruction (`npm run assets`
  in the `frontend/` directory) is part of the panel — don't re-paraphrase it
  in the README's main flow, just mention that the panel surfaces the command.
- **Stale badge**: when the JSON has a parse error, the 3D view freezes on the
  last good state and an amber "stale" badge appears top-right of the canvas.
  The editor squiggles point at the parse error; once it's fixed the badge
  clears. Worth one sentence so users don't think the view is broken.
- **Toast channel**: API failures (sidebar list, open-test, replay) surface via
  toasts at the bottom-right. They're auto-dismissed; the underlying state
  (parse errors, last-good replay) lives in the store, so the toast is just a
  notice, not the canonical error surface.
- **Server path validation**: `flint-viz serve <bad-path>` exits with a
  multiline message including a `hint:` line that suggests the right shape of
  invocation. The README's "Usage" section can rely on that — no need to
  reproduce all the failure modes.

The only file added at the Rust side is `crates/flint-viz/src/main.rs`'s
`resolve_test_root` improvement; everything else (toast, error boundary, stale
badge, asset-missing panel) is in `frontend/src/components/`,
`frontend/src/world/Scene.tsx`, and `frontend/src/world/useBlockProviders.ts`.

## Handoff from #0035 (flint-steel runtime, M8 stretch)

The README's "Limitations" section should note that flint-steel mode is opt-in
(M8), and link to #0035 for the gating story. Out of scope for M7 verification,
but the wording lives here to keep the README authoritative.
