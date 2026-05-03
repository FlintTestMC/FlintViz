# 0017 — Frontend API client

**Milestone:** M4
**Depends on:** #0006, #0007, #0008, #0009

## Goal
A small typed wrapper around `fetch` for `/api/*` endpoints, plus an SSE helper.

## Outcome
- `api.listTests(): Promise<TestSummary[]>`
- `api.getTest(id): Promise<TestDetail>`
- `api.replay(source): Promise<ReplayResponse>`
- `api.events(onEvent): () => void` — opens SSE, returns disposer.
- Types live in `frontend/src/api/types.ts`, hand-written to mirror the Rust serde shapes.

## Implementation notes
- Don't pull in a heavy client lib; native `fetch` + `EventSource` is enough.
- Throw on non-2xx with a typed `ApiError`.

## Files
- `frontend/src/api/client.ts`
- `frontend/src/api/types.ts`
- `frontend/src/api/events.ts`

## Handoff from M1
- Vite dev server runs on `:5173` and proxies both `/api` and `/api/events` to `http://localhost:7878` (configured in `frontend/vite.config.ts`). Use **relative URLs** in the client (`fetch("/api/tests")`, `new EventSource("/api/events")`) so the same code works in dev (proxied), in the embedded release build (same origin), and in the future docker split (frontend container reverse-proxies `/api` to backend container).
- TS is strict with `noUncheckedIndexedAccess`. Array/Map lookups return `T | undefined`; handle it explicitly (no `!` non-null assertions).
- No client lib — keep `fetch` + `EventSource` as the issue specifies. React 18 is in use, so async data fetching can rely on `useEffect` + abort controllers; no Suspense-for-data is required.
