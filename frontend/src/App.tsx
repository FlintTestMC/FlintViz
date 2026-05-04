import SplitLayout from "./layout/SplitLayout";
import TestList from "./panels/TestList";
import CanvasShell from "./world/CanvasShell";

export default function App() {
  return (
    <SplitLayout
      sidebar={<TestList />}
      left={
        <div className="flex h-full flex-col">
          <header className="border-b border-neutral-800 px-3 py-2 text-sm font-medium">
            Visualization
          </header>
          <div className="flex-1">
            <CanvasShell />
          </div>
        </div>
      }
      right={
        <div className="flex h-full flex-col">
          <header className="border-b border-neutral-800 px-3 py-2 text-sm font-medium">
            Editor
          </header>
          <div className="flex-1 p-3 text-neutral-400">
            <p className="text-sm">Editor placeholder (lands in #0020).</p>
          </div>
        </div>
      }
    />
  );
}
