# Frontend Maintenance

The frontend is a Vite + React + TypeScript SPA with Monaco for editing,
Zustand for state, and React Three Fiber for 3D rendering.

The main rule for maintainers: keep wire types, stores, and visual consumers in
sync. Most frontend bugs come from changing one side of a contract and leaving
another side stale.

## Entry Points

- `frontend/src/main.tsx` chooses between the normal app and `/failure` view.
- `frontend/src/App.tsx` builds the main split layout.
- `frontend/src/api/client.ts` wraps fetch calls.
- `frontend/src/api/types.ts` mirrors backend serde shapes by hand.
- `frontend/src/index.css` owns global styling and Tailwind setup.

There is no router dependency today. `main.tsx` switches on `window.location`.

## Application Modes

### Normal Browsing Mode

Used when the server has a test root.

Flow:

1. `App` fetches `/api/config`.
2. `TestList` lists tests.
3. Opening a test populates the replay store source.
4. `Editor` displays the source and posts changes to `/api/replay`.
5. Replay results update stores.
6. Scene, timeline, inventory, and assertion panels render from stores.

### Read-Only Server Mode

Used when the backend started without a path.

Behavior:

- `/api/config` returns `{ readonly: true }`.
- `App` suppresses the test sidebar.
- If no test is loaded, `ReadOnlyLanding` is shown.
- The intended entry path is a flint-steel failure URL.

### Failure & Share URL Mode

Used for `/failure#data=...` (failing runs) and `/#/share#data=...` (generic test sharing).

Owner: `frontend/src/views/FailureView.tsx`.

Flow:

1. Read encoded data from the URL hash (using regex to parse the data parameter).
2. POST it to `/api/failure/decode`.
3. **Fallback:** If the API POST fails (e.g., HTTP 500/404) or the app is standalone, decode the base64-gzip payload client-side in the browser.
4. Try to resolve the source file from disk (if `source_path` is present).
5. If disk source loads, open it as a normal test.
6. Otherwise serialize the inline `FailurePayload.spec` and open that (e.g. for shared links).
7. Store failure context in `useFailureStore` (hidden if the failures array is empty).
8. Seek to the earliest failing tick (if any).
9. Render the normal `App`.

Inline failure/share payloads are effectively read-only because there is no reliable
file path to save to (though edits compile live in-memory).

## Store Ownership

### `useConfigStore`

Owner: `frontend/src/store/config.ts`.

Tracks backend read-only capability. `readonly` starts as `null` so `App` can
avoid rendering the wrong layout before config arrives.

`isEffectivelyReadOnly()` combines server read-only mode with inline failure
mode.

### `useReplayStore`

Owner: `frontend/src/store/replay.ts`.

Owns:

- active test ID,
- editor source,
- parsed replay,
- parse errors,
- current tick,
- optional event picker index,
- derived world map,
- derived player snapshot,
- playback state,
- source-map indices.

Important behavior:

- `openTest` resets all replay-derived state.
- `setReplay(null, errors)` preserves last good world/player/tick state.
- `setTick` clamps to replay bounds.
- Forward ticking applies diffs from the current state.
- Backward ticking rebuilds from scratch.
- Event picker mode displays partial state within a single tick.
- Playback always clears event picker mode first.

### `world.ts`

Owner: `frontend/src/store/world.ts`.

Contains pure helpers for applying replay events to world/player state. This is
the TypeScript mirror of Rust replay event semantics. See
[Replay contract](replay-contract.md).

### `sourceMap.ts`

Owner: `frontend/src/store/sourceMap.ts`.

Builds lookup indices from `Replay.source_map`:

- `(tick, event_index) -> json_pointer`,
- `json_pointer -> ticks`,
- position-source maps for world clicks.

The position-source map is built lazily on click instead of cached, which keeps
invalidation simple when the user scrubs or edits.

### `crosslink.ts`

Owner: `frontend/src/store/crosslink.ts`.

Stores the Monaco editor handle and highlighted ticks. It is intentionally
separate from the replay store so editor mount/unmount does not disturb replay
state.

### `assertions.ts`

Owner: `frontend/src/store/assertions.ts`.

Tracks multi-alternative assertion cycling and per-position locks. It has a
module-scope 1 Hz timer in browser environments and clears locks when the
active test changes.

### `failure.ts`

Owner: `frontend/src/store/failure.ts`.

Stores decoded failure payload context independently from replay state. Clearing
or hiding failures should not reset the underlying replay.

## Editor Behavior

Owner: `frontend/src/editor/Editor.tsx`.

Responsibilities:

- Mount Monaco and register the Flint JSON schema.
- Keep Monaco model text in sync with `useReplayStore.source`.
- Debounce replay requests by 250 ms after user edits.
- Convert parse errors into Monaco markers.
- Preserve last good visualization state when replay parsing fails.
- Save with Ctrl/Cmd+S.
- Format JSON and save through the normal replay path.
- Publish cursor-driven timeline highlights.
- Expose the editor handle through `useCrosslinkStore`.

Important contracts:

- Programmatic `setValue` calls set `applyingExternalRef` so they do not loop
  back into debounced replay.
- `replayTokenRef` ignores stale replay responses.
- Repeated identical API errors are de-duplicated before showing toasts.
- A `413` replay response is displayed as `replay body too large (max 1 MiB)`.

## Cross-Linking

Cross-linking connects the editor, timeline, 3D scene, and assertion panel.

Current directions:

- Timeline marker -> editor range.
- 3D block -> editor range.
- Editor cursor -> highlighted timeline ticks.
- Assertion row -> editor range.
- Assertion location button -> camera target.

Data sources:

- Backend source maps map events back to `/timeline/N`.
- `jsonPointerToRange.ts` parses source text and resolves JSON pointers to
  Monaco ranges.
- `sourceMap.ts` builds forward and reverse indices.
- `crosslink.ts` performs editor reveal operations.

The source pointer format is RFC 6901 JSON pointer. Do not invent a parallel
pointer format for new cross-link features.

## Rendering Pipeline

Main scene owner: `frontend/src/world/Scene.tsx`.

World mesh owner: `frontend/src/world/World.tsx`.

Pipeline:

1. `useBlockProvidersState` loads cached block providers.
2. `atlas.ts` fetches `/mc-assets.zip`, parses blockstates, models, and block
   textures.
3. `blockDefaults.ts` loads `/blocks.json` default block properties.
4. `instancing.ts` groups current world blocks by block ID and properties.
5. `blockAdapter.ts` converts deepslate model output into Three geometry and
   material.
6. `World.tsx` renders one instanced mesh per block-state group.
7. Overlays render cleanup region, highlights, assertion ghosts, failure
   markers, camera controls, and compass.

Asset loading is cached. `loadAssetZip()` and `loadBlockProviders()` are
singletons for one app load, so multiple consumers do not repeatedly parse the
asset zip.

## Asset Loading & Failure Behavior

Assets (`mc-assets.zip` and `blocks.json`) are fetched relative to `import.meta.env.BASE_URL` to support subfolder hosting (such as GitHub Pages).

If pre-built assets are missing from the server:
- The app displays a EULA prompt in the 3D pane.
- Once accepted, the app fetches the vanilla client jar from Mojang, extracts the assets, and stores them in browser `CacheStorage` client-side.
- If this client-side extraction also fails, the 3D pane shows a fallback missing-assets warning card.

Texture/model parsing is defensive:

- malformed model/blockstate JSON is skipped with a console warning,
- undecodable PNG textures are skipped with a console warning,
- unsupported entity-rendered blocks may fall back to simple cube rendering
  from their particle texture.

Do not make one bad asset fail the whole app unless the failure is truly
unrecoverable.

## Layout And WebGL Contract

`App` waits for `/api/config` before rendering the split layout. This is
intentional. Switching between the sidebar and no-sidebar structure after mount
can unmount/remount the canvas and leave a black WebGL scene.

When changing layout:

- avoid remounting the canvas unnecessarily,
- keep the scene area stable inside the split panes,
- test both normal mode and read-only/failure mode.

## API Type Maintenance

`frontend/src/api/types.ts` is hand-written. There is no generated TypeScript
client.

When backend serde shapes change:

- update `types.ts`,
- update `api/client.ts` if request/response handling changes,
- update stores and UI consumers,
- update tests,
- update `docs/api-contract.md` and `docs/replay-contract.md`.

Field-name traps:

- API response fields such as `parse_error`, `cleanup_region`,
  `initial_player`, and `source_map` are snake_case.
- Flint `TestSpec` fields may use the upstream `flint-core` serde shape, which
  includes camelCase fields like `flintVersion` in JSON.
- `TickEvent` and `AssertionView` use `kind` discriminants in snake_case.
- Some flint-core failure payload enums are externally tagged.

## Test Coverage

Frontend tests are focused around pure logic:

- editor JSON pointer/range mapping,
- editor marker conversion,
- source-map indices,
- replay store/world reconstruction,
- assertion alternative selection,
- timeline marker text/playback helpers,
- tree building,
- block defaults and instancing,
- camera framing and overlay store.

Prefer adding pure helper tests when changing logic. Component-level rendering
tests are not the current pattern.

## Common Frontend Change Workflows

### Add A New Replay Event

1. Update Rust replay model and engine.
2. Update `api/types.ts`.
3. Update `store/world.ts`.
4. Update `store/sourceMap.ts` if it should be clickable.
5. Add UI rendering in timeline/world/panels as needed.
6. Add tests for Rust serde/engine behavior and TS state behavior.
7. Update replay docs.

### Add A New API Endpoint

1. Add a Rust subrouter or handler under `api/`.
2. Merge it from `api/mod.rs`.
3. Add TypeScript request/response types.
4. Add a client method in `api/client.ts`.
5. Decide whether failures should toast, mark editor state, or enter a store.
6. Add tests.
7. Update API docs.

### Change Asset Loading

1. Check both world rendering and item icons.
2. Preserve caching unless there is a strong reason not to.
3. Preserve useful missing-assets errors.
4. Avoid redistributing Mojang assets in the repo.
5. Run frontend tests and a browser smoke test if possible.
