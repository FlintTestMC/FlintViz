import type { ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

type Props = {
  left: ReactNode;
  right: ReactNode;
  sidebar?: ReactNode;
};

export default function SplitLayout({ left, right, sidebar }: Props) {
  const hasSidebar = !!sidebar;

  return (
    <PanelGroup direction="horizontal" className="h-screen w-screen">
      {hasSidebar && (
        <Panel key="sidebar" id="sidebar" defaultSize={18} minSize={10} maxSize={40} order={1}>
          {sidebar}
        </Panel>
      )}
      {hasSidebar && (
        <PanelResizeHandle
          key="handle-sidebar"
          className="w-px bg-neutral-800 transition-colors hover:bg-neutral-600"
        />
      )}
      <Panel key="left" id="left" defaultSize={hasSidebar ? 50 : 60} minSize={20} order={3}>
        {left}
      </Panel>
      <PanelResizeHandle
        key="handle-main"
        className="w-px bg-neutral-800 transition-colors hover:bg-neutral-600"
      />
      <Panel key="right" id="right" defaultSize={hasSidebar ? 32 : 40} minSize={20} order={5}>
        {right}
      </Panel>
    </PanelGroup>
  );
}

