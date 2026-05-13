# 0048 — Fill in default block properties before rendering

**Milestone:** M5 (rendering polish)
**Depends on:** #0023

> ⚠️ **Before starting:** ask the user for
> 1. the path to the defaults JSON inside the repo (likely under `frontend/public/`, but to be confirmed),
> 2. the exact JSON schema produced by their extractor mod.
>
> Do not begin implementation until both are confirmed. The plan below assumes a flat `{ "minecraft:<id>": { "<prop>": "<value>", … } }` shape — adjust the parsing step if the mod emits something else (e.g. wraps states in a `default: true` entry like Mojang's reports do).

## Problem

When a Flint test specifies a block with no properties (or only a subset), the visualization renders it incorrectly:

- `variants` blockstates (stairs, levers, logs, doors, trapdoors, …) — `BlockDefinition.getModelVariants` requires every property in the matching variant key to equal exactly, so an empty/partial `props` matches **zero variants** and the block disappears.
- `multipart` blockstates (fences, walls, redstone wire, …) — only the unconditional parts render, producing a fence post with no arms, a wall with no connections, etc.

See `frontend/node_modules/deepslate/lib/render/BlockDefinition.js:52-57` for the exact match semantics.

Tests should be allowed to omit properties; the visualizer should fill in Minecraft's default state for that block, the same way the game does when you place it.

## Decisions

- Defaults are filled in on the **frontend visualizer** — tests stay untouched, backend (flint-steel) is not modified.
- Values come from a JSON the user extracts via their existing Minecraft mod.
- Merge semantics: `{ ...defaults, ...userProps }` — user-supplied properties win, missing ones are filled from defaults.
- Delivery: a **separate static file** (not bundled into `mc-assets.zip`), fetched independently.

## Outcome

- A block declared as `{ "id": "minecraft:oak_stairs" }` in a test renders as a complete stair in its default orientation (Minecraft's default: `facing=north, half=bottom, shape=straight, waterlogged=false`).
- A block declared as `{ "id": "minecraft:oak_stairs", "facing": "east" }` renders as an east-facing stair with the remaining properties (`half`, `shape`, `waterlogged`) defaulted.
- A block declared as `{ "id": "minecraft:oak_fence" }` renders as a fence whose connections match the default state (typically all `false`).
- Unknown block ids fall through unchanged — current "skip / null mesh" behavior is preserved.

## Implementation

### 1. Defaults source

Add a static file at the path the user provides (likely `frontend/public/block_defaults.json`). The expected shape is a flat map (confirm with the user before parsing):

```json
{
  "minecraft:oak_stairs": {
    "facing": "north",
    "half": "bottom",
    "shape": "straight",
    "waterlogged": "false"
  },
  "minecraft:oak_fence": {
    "north": "false",
    "east": "false",
    "south": "false",
    "west": "false",
    "waterlogged": "false"
  }
}
```

Values are strings (matching the `Record<string, string>` deepslate expects). Booleans and numbers are `"true"/"false"` / `"0"` etc.

### 2. Loader

New module `frontend/src/world/blockDefaults.ts`:

```ts
let cache: Promise<Record<string, Record<string, string>>> | null = null;

export function loadBlockDefaults(): Promise<Record<string, Record<string, string>>> {
  if (cache) return cache;
  cache = fetch("/block_defaults.json")
    .then((r) => {
      if (!r.ok) throw new Error(
        `Failed to load /block_defaults.json (${r.status}). Run the extractor mod to regenerate it.`
      );
      return r.json();
    });
  return cache;
}

export function resetBlockDefaults(): void {
  cache = null;
}
```

Cache semantics mirror `loadBlockProviders` in `frontend/src/world/atlas.ts` so the file is fetched and parsed exactly once per app load.

### 3. Wire through providers

Extend `BlockProviders` in `frontend/src/world/atlas.ts` with a `defaults: Record<string, Record<string, string>>` field, and load it in parallel with the asset zip inside `doLoad()`. This keeps a single async boundary for "the renderer is ready" and avoids a second loading state in components.

Reset path: add `resetBlockDefaults()` to whatever `resetBlockProviders()` already wipes.

### 4. Merge at the grouping layer

In `frontend/src/world/instancing.ts:38`, change `extractProps(block)` so it merges defaults underneath the user's props:

```ts
function extractProps(
  block: Block,
  defaults: Record<string, Record<string, string>>,
): Record<string, string> {
  const blockDefaults = defaults[block.id] ?? {};
  const merged: Record<string, string> = { ...blockDefaults };
  for (const k of Object.keys(block)) {
    if (k === "id") continue;
    const v = (block as Record<string, unknown>)[k];
    if (v == null) continue;
    merged[k] = String(v);
  }
  // Preserve the existing stable group key: stringify with sorted keys.
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(merged).sort()) sorted[k] = merged[k]!;
  return sorted;
}
```

Thread `defaults` through `groupByState(worldState, defaults)` and the call site in `frontend/src/world/World.tsx`. The grouping key continues to be `(id, JSON.stringify(sortedProps))` — note this means **a block with explicit `facing=north` and a block with no facing (defaulted to `north`) now share a group**, which is correct: they render identically.

### 5. Tests

Extend `frontend/src/world/__tests__/instancing.test.ts`:

- Block with empty props gets defaulted props merged in.
- Block with partial props keeps user-supplied values and gets the rest defaulted.
- Block whose id is missing from the defaults map passes through with whatever was on it (no crash).
- Group key collapses `{id, …defaults}` and `{id}` into the same group.

Optional: add a render snapshot via the existing `BlockGallery` debug view — drop the explicit `properties` from the `oak_stairs`/`lever`/`oak_fence`/`redstone_wire` entries in `frontend/src/world/__debug__/BlockGallery.tsx` and visually confirm they still render correctly with defaults filled in.

## Files

- `frontend/public/block_defaults.json` (new — path TBD, confirm with user)
- `frontend/src/world/blockDefaults.ts` (new) — fetcher + cache
- `frontend/src/world/atlas.ts` — add `defaults` to `BlockProviders`, parallel-load it
- `frontend/src/world/instancing.ts` — merge defaults in `extractProps`, thread through `groupByState`
- `frontend/src/world/World.tsx` — pass `providers.defaults` into `groupByState`
- `frontend/src/world/__tests__/instancing.test.ts` — new cases above

## Out of scope

- Backend (flint-steel) emitting fully-resolved properties — explicitly rejected. The visualizer is the single layer that fills in defaults.
- Hand-curating defaults or inferring "first variant" heuristically — the JSON from the user's extractor mod is authoritative.
- Tinting (grass/leaves/redstone power) — separate concern, see #0023 handoff notes.
- Cull-mask defaulting changes — current `Cull.none()` behavior is untouched.

## Verification

1. `cd frontend && npm run test -- instancing` — new unit cases pass.
2. `npm run dev` and load a test that places a bare `minecraft:oak_stairs` (no properties). Confirm it renders as a north-facing bottom stair instead of disappearing.
3. Same dev session, load a test with `minecraft:oak_fence` and no properties — confirm the fence post renders with the four default connection states (typically no arms, since defaults are usually `false`).
4. Reload a test that *does* set every property (e.g. an existing replay test) — confirm no visual regression (the grouping key must still match its previous shape for fully-specified blocks).
