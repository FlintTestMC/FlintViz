import { lazy, Suspense, useEffect } from "react";

import BootSplash from "./components/BootSplash";
import ErrorBoundary from "./components/ErrorBoundary";
import PaneFallback from "./components/PaneFallback";
import StaleBadge from "./components/StaleBadge";
import Toast from "./components/Toast";
import SplitLayout from "./layout/SplitLayout";
import Assertions from "./panels/Assertions";
import Inventory from "./panels/Inventory";
import TestList from "./panels/TestList";
import { useConfigStore } from "./store/config";
import { useReplayStore } from "./store/replay";
import Controls from "./timeline/Controls";
import FailureBanner from "./timeline/FailureBanner";
import Scrubber from "./timeline/Scrubber";
import SceneToolbar from "./world/SceneToolbar";

const Editor = lazy(() => import("./editor/Editor"));
const Scene = lazy(() => import("./world/Scene"));
const CompassGizmo = lazy(() => import("./world/CompassGizmo"));

export default function App() {
  const readonly = useConfigStore((s) => s.readonly);
  const standalone = useConfigStore((s) => s.standalone);
  const testId = useReplayStore((s) => s.testId);
  useEffect(() => {
    void useConfigStore.getState().fetch();
  }, []);

  // Wait for /api/config before picking a layout. Switching SplitLayout between
  // its 3-pane and 2-pane structures *after* mount unmounts the 3D Canvas, and
  // the remounted WebGL context doesn't recover — the user sees a black scene.
  if (readonly === null) {
    return <BootSplash />;
  }

  if (readonly && testId === null && !standalone) {
    return <ReadOnlyLanding />;
  }

  const sidebar = (readonly && !standalone)
    ? undefined
    : (
        <ErrorBoundary label="Sidebar">
          <div className="app-bigger h-full">
            <TestList />
          </div>
        </ErrorBoundary>
      );

  return (
    <>
      <SplitLayout
        sidebar={sidebar}
        left={
          <div className="app-bigger flex h-full flex-col">
            <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-3 py-2 text-sm font-medium">
              <div className="flex items-center gap-3">
                <span>Visualization</span>
                <SceneToolbar />
              </div>
              <Controls />
            </header>
            <ErrorBoundary label="3D view">
              <Suspense fallback={<PaneFallback label="3D view" />}>
                <div className="relative flex-1 min-h-0">
                  <Scene />
                  <StaleBadge />
                  <ErrorBoundary label="Compass">
                    <Suspense fallback={null}>
                      <CompassGizmo />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </Suspense>
            </ErrorBoundary>
            <ErrorBoundary label="Failure banner">
              <FailureBanner />
            </ErrorBoundary>
            <ErrorBoundary label="Timeline">
              <Scrubber />
            </ErrorBoundary>
            <div
              className="grid grid-cols-2 grid-rows-1 border-t border-neutral-800"
              style={{ height: 180 }}
            >
              <div className="min-h-0 overflow-hidden border-r border-neutral-800">
                <ErrorBoundary label="Inventory">
                  <Inventory />
                </ErrorBoundary>
              </div>
              <div className="min-h-0 overflow-hidden">
                <ErrorBoundary label="Assertions">
                  <Assertions />
                </ErrorBoundary>
              </div>
            </div>
          </div>
        }
        right={
          <ErrorBoundary label="Editor">
            <Suspense fallback={<PaneFallback label="editor" />}>
              <Editor />
            </Suspense>
          </ErrorBoundary>
        }
      />
      <Toast />
    </>
  );
}

function ReadOnlyLanding() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 p-6 text-neutral-200">
      <div className="max-w-lg rounded-md bg-neutral-900 p-5 text-sm ring-1 ring-neutral-800">
        <div className="mb-2 text-base font-semibold">flint-viz — read-only</div>
        <p className="text-neutral-400">
          Started without a test directory, so there's nothing to browse here.
          Open a failure URL emitted by <code>flint-steel</code> (something like{" "}
          <code>/failure#data=…</code>) to load a test.
        </p>
        <p className="mt-3 text-xs text-neutral-500">
          To browse tests instead, restart with{" "}
          <code>flint-viz serve &lt;path&gt;</code>.
        </p>
      </div>
      <Toast />
    </div>
  );
}
