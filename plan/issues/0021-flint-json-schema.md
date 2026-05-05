# 0021 — Vendored Flint JSON schema

**Milestone:** M4
**Depends on:** #0020

## Goal
Provide Monaco with a JSON schema describing Flint test files for autocomplete and inline validation.

## Outcome
- `frontend/src/editor/flint.schema.json` describes the test format (top-level fields, `setup`, `timeline` entries with discriminated `do` actions, breakpoints).
- Registered via `monaco.languages.json.jsonDefaults.setDiagnosticsOptions` with a virtual URL.
- Typing `"do": "p` autocompletes to `place`, `place_each`, `fill`, etc.

## Implementation notes
- The schema can be partial — cover the well-known fields. Don't try to mirror every edge case.
- Cross-check field names against `flint_core::test_spec` so they actually match.
- Consider generating the schema from Rust later (`schemars` on `TestSpec`); manual is fine for now.

## Files
- `frontend/src/editor/flint.schema.json`
- `frontend/src/editor/registerSchema.ts`

## Status (this issue)

Implemented at:

- `frontend/src/editor/flint.schema.json` — Draft-07, hand-written, partial. Top-level `name` and `timeline` are required; covers `flintVersion`, `description`, `tags`, `minecraftIds`, `dependencies`, `setup.cleanup.region`, `setup.player`, `breakpoints`. Field names are camelCase to match the Rust `#[serde(rename_all = "camelCase")]` on `TestSpec` (e.g. `flintVersion`, NOT `flint_version`). Inside `setup.player` (which is `#[serde(rename_all = "snake_case")]` on `PlayerConfig`) the keys are `selected_hotbar` and `game_mode`.
- Timeline entries use the `do` discriminator with `allOf`/`if`/`then` branches — one branch per `ActionType` variant: `place`, `place_each`, `fill`, `remove`, `assert`, `use_item_on`, `set_slot`, `select_hotbar`. Each branch declares its required payload shape (e.g. `place` requires `pos` + `block`). The discriminator is `do`, not `kind`, matching `#[serde(tag = "do", rename_all = "snake_case")]`.
- `Block` schema accepts both flat properties (`{"id": "minecraft:lever", "powered": false}`) and the nested `{"properties": {...}}` form, since the Rust deserializer accepts both. Property values are typed as `string | number | boolean` to match `json_value_to_string`'s coercion.
- `playerSlot` enum matches the `#[serde(rename_all = "snake_case")]` form: `hotbar1..hotbar9`, `off_hand`, `helmet`, `chestplate`, `leggings`, `boots`. `gameMode` enum is **PascalCase** (`Survival`/`Creative`/`Adventure`/`Spectator`) because `GameMode` does NOT have a `rename_all`.
- `assert.checks` is an untagged union of `BlockCheck` (`{pos, is}`) and `InventoryCheck` (`{slot, is?}`). `InventoryCheck.is` accepts an `item` object, the strings `"None"` / `"empty"`, or `null`, mirroring the `deserialize_item_or_none` Rust path.
- `frontend/src/editor/registerSchema.ts` — exposes `registerFlintSchema(monaco)`. Idempotent (`registered` module flag + dedup by URI in the schemas list, so multiple editor mounts don't accumulate duplicates). Calls `monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ ..., validate: true, allowComments: false, schemaValidation: "error", schemas: [{ uri, fileMatch: ["*"], schema }] })`. URI is `flint://schemas/flint-test.json`.
- `fileMatch: ["*"]` — Monaco's JSON service treats every editor model as matching, since the in-memory model URIs are not real paths. If the project ever opens non-Flint JSON in Monaco, narrow this glob.
- Wired in: `Editor.tsx` calls `registerFlintSchema(monaco)` from `onMount`.
- `tsconfig.app.json` already has `resolveJsonModule: true`, so the schema is imported as a typed module.

Not implemented (deferred):

- Schema generation from Rust (`schemars` on `TestSpec`). Manual schema is good enough for v1; revisit when the spec churns or when adding new actions.
- Hover docs on enum values (Monaco supports `markdownDescription` on schema fields — not added; trivial to layer in later if requested).
- Schema versioning per `flintVersion` (the runner gates execution by version, but autocomplete just shows everything; fine for now).

Notes for downstream:

- Schema validation squiggles use Monaco's internal marker owner (separate from `MARKER_OWNER = "flint-replay"` from #0020). So replay parse errors and schema-validation errors can coexist on the same line without one clobbering the other.
- The schema does NOT enforce cleanup-region bounds on `pos` / `region` coordinates — that's a runtime check inside `TestSpec::validate` (uses `MAX_WIDTH = 15`, `MAX_HEIGHT = 384`, `MAX_DEPTH = 15`). Showing those as schema errors would require recomputing on every keystroke; leave them to the replay endpoint.
