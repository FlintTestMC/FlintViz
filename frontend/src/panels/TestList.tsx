import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError, api } from "../api/client";
import type { TestSummary } from "../api/types";
import { useReplayStore } from "../store/replay";
import { buildTree, type TreeFolder, type TreeNode } from "./buildTree";

export default function TestList() {
  const [summaries, setSummaries] = useState<TestSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openError, setOpenError] = useState<string | null>(null);

  const testId = useReplayStore((s) => s.testId);
  const testIdRef = useRef(testId);
  useEffect(() => {
    testIdRef.current = testId;
  }, [testId]);

  // Latest open-test request token — drops stale results from concurrent clicks.
  const openTokenRef = useRef(0);

  const refreshList = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await api.listTests(signal);
      setSummaries(list);
      setListError(null);
    } catch (err) {
      if (signal?.aborted) return;
      setListError(formatError(err));
    }
  }, []);

  const openTest = useCallback(async (id: string) => {
    const token = ++openTokenRef.current;
    setOpenError(null);
    try {
      const detail = await api.getTest(id);
      if (token !== openTokenRef.current) return;
      useReplayStore.getState().openTest(detail.id, detail.source);
      const replayResult = await api.replay(detail.source);
      if (token !== openTokenRef.current) return;
      useReplayStore
        .getState()
        .setReplay(replayResult.replay, replayResult.errors);
    } catch (err) {
      if (token === openTokenRef.current) {
        setOpenError(formatError(err));
      }
    }
  }, []);

  // Initial fetch.
  useEffect(() => {
    const ctrl = new AbortController();
    void refreshList(ctrl.signal);
    return () => ctrl.abort();
  }, [refreshList]);

  // SSE subscription.
  useEffect(() => {
    const dispose = api.events((event) => {
      void refreshList();
      if (event.id === testIdRef.current) {
        void openTest(event.id);
      }
    });
    return dispose;
  }, [refreshList, openTest]);

  const tree = useMemo(() => buildTree(summaries), [summaries]);

  const toggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <header className="border-b border-neutral-800 px-3 py-2 text-sm font-medium">
        Tests
      </header>
      <div className="flex-1 overflow-auto py-1 text-sm">
        {listError && (
          <div className="px-3 py-2 text-xs text-red-400">{listError}</div>
        )}
        {!listError && summaries.length === 0 && (
          <div className="px-3 py-2 text-xs text-neutral-500">No tests found.</div>
        )}
        <ul className="select-none">
          {tree.map((node) => (
            <TreeNodeView
              key={nodeKey(node)}
              node={node}
              depth={0}
              currentId={testId}
              collapsed={collapsed}
              onToggle={toggleFolder}
              onOpen={openTest}
            />
          ))}
        </ul>
      </div>
      {openError && (
        <div className="border-t border-neutral-800 px-3 py-2 text-xs text-red-400">
          {openError}
        </div>
      )}
    </div>
  );
}

function nodeKey(node: TreeNode): string {
  return node.kind === "folder" ? `d:${node.path}` : `f:${node.path}`;
}

interface NodeViewProps {
  node: TreeNode;
  depth: number;
  currentId: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (id: string) => void;
}

function TreeNodeView({
  node,
  depth,
  currentId,
  collapsed,
  onToggle,
  onOpen,
}: NodeViewProps) {
  if (node.kind === "folder") {
    return <FolderView node={node} depth={depth} currentId={currentId} collapsed={collapsed} onToggle={onToggle} onOpen={onOpen} />;
  }
  return <FileView node={node} depth={depth} currentId={currentId} onOpen={onOpen} />;
}

function FolderView({
  node,
  depth,
  currentId,
  collapsed,
  onToggle,
  onOpen,
}: NodeViewProps & { node: TreeFolder }) {
  const isCollapsed = collapsed.has(node.path);
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-neutral-300 hover:bg-neutral-900"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span className="w-3 text-xs text-neutral-500">
          {isCollapsed ? "▸" : "▾"}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {!isCollapsed && (
        <ul>
          {node.children.map((child) => (
            <TreeNodeView
              key={nodeKey(child)}
              node={child}
              depth={depth + 1}
              currentId={currentId}
              collapsed={collapsed}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function FileView({
  node,
  depth,
  currentId,
  onOpen,
}: {
  node: Extract<TreeNode, { kind: "file" }>;
  depth: number;
  currentId: string | null;
  onOpen: (id: string) => void;
}) {
  const summary = node.summary;
  const isCurrent = summary.id === currentId;
  const hasError = !!summary.parse_error;
  const tagText = summary.tags.length > 0 ? `\nTags: ${summary.tags.join(", ")}` : "";
  const title = hasError
    ? `Parse error: ${summary.parse_error}${tagText}`
    : `${summary.name}${tagText}`;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(summary.id)}
        title={title}
        className={[
          "flex w-full items-center gap-2 px-2 py-0.5 text-left",
          isCurrent
            ? "bg-neutral-800 text-neutral-50"
            : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100",
          hasError ? "italic" : "",
        ].join(" ")}
        style={{ paddingLeft: `${depth * 12 + 24}px` }}
      >
        {hasError && (
          <span
            aria-label="parse error"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
          />
        )}
        <span className="truncate">{summary.name}</span>
      </button>
    </li>
  );
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
