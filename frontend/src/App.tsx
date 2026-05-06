import Editor from "./editor/Editor";
import SplitLayout from "./layout/SplitLayout";
import Assertions from "./panels/Assertions";
import Inventory from "./panels/Inventory";
import TestList from "./panels/TestList";
import Controls from "./timeline/Controls";
import Scrubber from "./timeline/Scrubber";
import Scene from "./world/Scene";
import SceneToolbar from "./world/SceneToolbar";
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
          <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-3 py-2 text-sm font-medium">
            <div className="flex items-center gap-3">
              <span>Visualization</span>
              <SceneToolbar />
            </div>
            <Controls />
          </header>
          <div className="flex-1 min-h-0">
            <Scene />
          </div>
          <Scrubber />
          <div
            className="grid grid-cols-2 border-t border-neutral-800"
            style={{ height: 140 }}
          >
            <div className="border-r border-neutral-800">
              <Inventory />
            </div>
            <Assertions />
          </div>
        </div>
      }
      right={<Editor />}
    />
  );
}
