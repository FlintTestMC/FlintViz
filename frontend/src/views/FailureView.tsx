// Entry view for `/failure` (issue #0035). Reads the URL hash on mount,
// decodes it via `POST /api/failure/decode`, sources the test (file on disk
// when available, inline payload otherwise), populates the replay store, and
// hands the failure context off to `useFailureStore`.
//
// Once the failure is loaded, the regular App UI takes over — the user sees
// the test in the same split-pane layout, with a `FailureBanner` above the
// timeline and the `FailureOverlay` painted in the 3D scene.

import { useEffect, useState } from "react";

import App from "../App";
import { api } from "../api/client";
import type { FailurePayload } from "../api/types";
import { useFailureStore } from "../store/failure";
import { useReplayStore } from "../store/replay";

export default function FailureView() {
  const [bootError, setBootError] = useState<string | null>(null);
  const status = useFailureStore((s) => s.status);

  useEffect(() => {
    const ctrl = new AbortController();
    void boot(ctrl.signal).catch((err) => {
      if (ctrl.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      setBootError(message);
      useFailureStore.getState().setError(message);
    });
    return () => ctrl.abort();
  }, []);

  if (bootError) {
    return <BootErrorView message={bootError} />;
  }
  if (status.kind === "idle" || status.kind === "loading") {
    return <BootSplash />;
  }
  if (status.kind === "error") {
    return <BootErrorView message={status.message} />;
  }
  // Loaded — render the standard app shell. The replay store is already
  // populated; FailureBanner + FailureOverlay are mounted from inside App.
  return <App />;
}

async function boot(signal: AbortSignal): Promise<void> {
  const failureStore = useFailureStore.getState();
  failureStore.setLoading();

  const encoded = readEncodedFromHash();
  if (!encoded) {
    throw new Error(
      "No failure data in URL. Expected `/failure#data=<encoded>`.",
    );
  }

  const decoded = await api.decodeFailure(encoded, signal);
  if (!decoded.ok) {
    if (decoded.aborted) return;
    throw new Error(`Failed to decode failure URL: ${decoded.err}`);
  }
  const payload = decoded.body;

  const sourceMode = await loadIntoReplayStore(payload, signal);
  if (signal.aborted) return;

  failureStore.load(payload, sourceMode);

  // Auto-seek to the earliest failing tick so the user lands on the moment of
  // failure. The user can still freely scrub afterwards.
  const earliest = earliestFailingTick(payload);
  if (earliest != null) {
    useReplayStore.getState().setTick(earliest);
  }
}

function readEncodedFromHash(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get("data");
}

async function loadIntoReplayStore(
  payload: FailurePayload,
  signal: AbortSignal,
): Promise<"disk" | "inline"> {
  const replayStore = useReplayStore.getState();

  // Try to resolve the test from disk so live-editing keeps working.
  const candidateId = candidateIdForSourcePath(payload.source_path);
  if (candidateId) {
    const detail = await api.getTest(candidateId, signal);
    if (detail.ok) {
      replayStore.openTest(detail.body.id, detail.body.source);
      const replayResult = await api.replay(detail.body.source, signal);
      if (replayResult.ok) {
        replayStore.setReplay(
          replayResult.body.replay,
          replayResult.body.errors,
        );
        return "disk";
      }
    }
  }

  // Fallback: use the inline TestSpec from the payload. Editor is still wired
  // to /api/replay-on-edit, but saving back to disk won't work (no test id on
  // the server). Editor surfaces this via the boot banner.
  const inlineSource = JSON.stringify(payload.spec, null, 2);
  const fallbackId = candidateId ?? `inline:${payload.spec.name}`;
  replayStore.openTest(fallbackId, inlineSource);
  const replayResult = await api.replay(inlineSource, signal);
  if (replayResult.ok) {
    replayStore.setReplay(
      replayResult.body.replay,
      replayResult.body.errors,
    );
  }
  return "inline";
}

function candidateIdForSourcePath(source: string | null): string | null {
  if (!source) return null;
  // flint-steel sends an absolute path. The flint-viz API resolves IDs
  // relative to its `--test-root`, so we can't blindly use the absolute
  // path. Fall back to the filename without extension — matches the existing
  // ID convention in api/tests.rs (file stem).
  const slash = source.lastIndexOf("/");
  const file = slash >= 0 ? source.slice(slash + 1) : source;
  return file.replace(/\.json$/i, "");
}

function earliestFailingTick(payload: FailurePayload): number | null {
  let earliest: number | null = null;
  for (const f of payload.failures) {
    if (earliest == null || f.tick < earliest) earliest = f.tick;
  }
  return earliest;
}

function BootSplash() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-sm text-neutral-400">
      Loading failure…
    </div>
  );
}

function BootErrorView({ message }: { message: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 p-6">
      <div className="max-w-lg rounded-md bg-neutral-900 p-4 text-sm text-neutral-200 ring-1 ring-red-900/60">
        <div className="mb-2 font-semibold text-red-400">
          Could not open failure URL
        </div>
        <p className="whitespace-pre-wrap text-xs text-neutral-400">{message}</p>
      </div>
    </div>
  );
}
