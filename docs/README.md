# Maintainer Docs

This directory documents the code as it exists now. The top-level
`README.md` is for users of `flint-viz`; these pages are for maintainers who
need to review the current code or change it without breaking implicit
contracts between the Rust backend and the React frontend.

The older `plan/` directory is historical planning material. It is useful for
understanding why features were added, but this directory should be treated as
the current maintainer reference.

## Reading Order

1. [Architecture](architecture.md) gives the repository map, process
   lifecycle, and backend-to-frontend data flow.
2. [API contract](api-contract.md) documents the HTTP and SSE surface the
   frontend depends on.
3. [Replay contract](replay-contract.md) documents how Flint JSON becomes a
   static replay and which rules the frontend mirrors.
4. [Frontend maintenance](frontend-maintenance.md) documents store ownership,
   editor behavior, rendering, cross-linking, and fragile UI contracts.
5. [Development](development.md) collects setup, verification, packaging, and
   common change workflows.

## High-Risk Change Areas

- Replay action changes touch both Rust and TypeScript. Update
  `crates/flint-viz/src/replay/engine.rs`,
  `crates/flint-viz/src/replay/model.rs`, `frontend/src/api/types.ts`, and
  `frontend/src/store/world.ts` together.
- API shape changes need backend DTOs, frontend wire types, client calls, error
  UI behavior, and these docs updated in the same patch.
- Asset loading is intentionally cached. Changing
  `frontend/src/world/atlas.ts`, `frontend/src/world/useBlockProviders.ts`, or
  `frontend/src/panels/itemIcons.ts` can affect both the 3D world and inventory
  icons.
- Read-only mode is used both when the server has no test root and when a
  failure URL falls back to inline payload data. Save and format behavior must
  preserve both cases.
