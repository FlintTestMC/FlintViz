import { useEffect } from "react";

import ErrorBoundary from "./components/ErrorBoundary";
import StaleBadge from "./components/StaleBadge";
import Toast from "./components/Toast";
import Editor from "./editor/Editor";
import SplitLayout from "./layout/SplitLayout";
import Assertions from "./panels/Assertions";
import Inventory from "./panels/Inventory";
import TestList from "./panels/TestList";
import { useConfigStore } from "./store/config";
import { useReplayStore } from "./store/replay";
import Controls from "./timeline/Controls";
import FailureBanner from "./timeline/FailureBanner";
import Scrubber from "./timeline/Scrubber";
import Scene from "./world/Scene";
import SceneToolbar from "./world/SceneToolbar";
import BlockGallery from "./world/__debug__/BlockGallery";

export default function App() {
  const readonly = useConfigStore((s) => s.readonly);
  const testId = useReplayStore((s) => s.testId);
  useEffect(() => {
    void useConfigStore.getState().fetch();
  }, []);

  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "blocks") {
      return (
        <div className="h-screen w-screen">
          <BlockGallery />
        </div>
      );
    }
  }

  // Wait for /api/config before picking a layout. Switching SplitLayout between
  // its 3-pane and 2-pane structures *after* mount unmounts the 3D Canvas, and
  // the remounted WebGL context doesn't recover — the user sees a black scene.
  if (readonly === null) {
    return <BootSplash />;
  }

  if (readonly && testId === null) {
    return <ReadOnlyLanding />;
  }

  const sidebar = readonly
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
              <div className="relative flex-1 min-h-0">
                <Scene />
                <StaleBadge />
              </div>
            </ErrorBoundary>
            <ErrorBoundary label="Failure banner">
              <FailureBanner />
            </ErrorBoundary>
            <ErrorBoundary label="Timeline">
              <Scrubber />
            </ErrorBoundary>
            <div
              className="grid grid-cols-2 border-t border-neutral-800"
              style={{ height: 180 }}
            >
              <div className="border-r border-neutral-800">
                <ErrorBoundary label="Inventory">
                  <Inventory />
                </ErrorBoundary>
              </div>
              <ErrorBoundary label="Assertions">
                <Assertions />
              </ErrorBoundary>
            </div>
          </div>
        }
        right={
          <ErrorBoundary label="Editor">
            <Editor />
          </ErrorBoundary>
        }
      />
      <Toast />
    </>
  );
}

function BootSplash() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-neutral-950 text-sm text-neutral-500">
      Loading…
    </div>
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
