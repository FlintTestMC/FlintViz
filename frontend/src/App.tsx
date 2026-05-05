import Editor from "./editor/Editor";
import SplitLayout from "./layout/SplitLayout";
import TestList from "./panels/TestList";
import Scene from "./world/Scene";
import { useCameraStore } from "./world/cameraStore";
import BlockGallery from "./world/__debug__/BlockGallery";

export default function App() {
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

  return (
    <SplitLayout
      sidebar={<TestList />}
      left={
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-sm font-medium">
            <span>Visualization</span>
            <ResetViewButton />
          </header>
          <div className="flex-1">
            <Scene />
          </div>
        </div>
      }
      right={<Editor />}
    />
  );
}

function ResetViewButton() {
  const resetView = useCameraStore((s) => s.resetView);
  return (
    <button
      type="button"
      onClick={resetView}
      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-normal text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
    >
      Reset view
    </button>
  );
}
