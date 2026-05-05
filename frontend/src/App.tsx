import Editor from "./editor/Editor";
import SplitLayout from "./layout/SplitLayout";
import TestList from "./panels/TestList";
import Scene from "./world/Scene";
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
          <header className="border-b border-neutral-800 px-3 py-2 text-sm font-medium">
            Visualization
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
