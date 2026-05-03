import type { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

type Props = {
  left: ReactNode;
  right: ReactNode;
};

export default function SplitLayout({ left, right }: Props) {
  return (
    <PanelGroup direction="horizontal" className="h-screen w-screen">
      <Panel defaultSize={60} minSize={20}>
        {left}
      </Panel>
      <PanelResizeHandle className="w-px bg-neutral-800 transition-colors hover:bg-neutral-600" />
      <Panel defaultSize={40} minSize={20}>
        {right}
      </Panel>
    </PanelGroup>
  );
}
