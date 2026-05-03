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
