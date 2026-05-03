import SplitLayout from "./layout/SplitLayout";
import CanvasShell from "./world/CanvasShell";

export default function App() {
  return (
    <SplitLayout
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
            <p className="text-red-500">Tailwind smoke test (red).</p>
            <p className="mt-2 text-sm">Editor placeholder.</p>
          </div>
        </div>
      }
    />
  );
}
