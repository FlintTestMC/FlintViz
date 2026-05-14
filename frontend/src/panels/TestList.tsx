import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { api } from "../api/client";
import { toastOnError } from "../api/toast";
import type { TestSummary } from "../api/types";
import { showToast } from "../components/toastStore";
import { useConfigStore } from "../store/config";
import { useReplayStore } from "../store/replay";
import { buildTree, type TreeFolder, type TreeNode } from "./buildTree";
import { newTestTemplate } from "./newTestTemplate";

interface ContextMenu {
  x: number;
  y: number;
  target: string; // "" = root, otherwise folder path
}

export default function TestList() {
  const [summaries, setSummaries] = useState<TestSummary[]>([]);
  const [listFailed, setListFailed] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creatingAt, setCreatingAt] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenu | null>(null);

  const readonly = useConfigStore((s) => s.readonly);
  const canCreate = readonly !== true;

  const testId = useReplayStore((s) => s.testId);
  const testIdRef = useRef(testId);
  useEffect(() => {
    testIdRef.current = testId;
  }, [testId]);

  // Latest open-test request token — drops stale results from concurrent clicks.
  const openTokenRef = useRef(0);

  const refreshList = useCallback(async (signal?: AbortSignal) => {
    const result = await api.listTests(signal);
    if (!toastOnError(result, "Failed to list tests")) {
      if (!result.aborted) setListFailed(true);
      return;
    }
    setSummaries(result.body);
    setListFailed(false);
  }, []);

  const openTest = useCallback(async (id: string) => {
    const token = ++openTokenRef.current;
    const detail = await api.getTest(id);
    if (token !== openTokenRef.current) return;
    if (!detail.ok) {
      if (!detail.aborted) {
        const msg = detail.status === 404
          ? `Test ${id} was deleted`
          : `Failed to open ${id}: ${detail.err}`;
        showToast({ kind: "error", message: msg });
      }
      return;
    }
    useReplayStore.getState().openTest(detail.body.id, detail.body.source);
    const replayResult = await api.replay(detail.body.source);
    if (token !== openTokenRef.current) return;
    if (!toastOnError(replayResult, `Failed to open ${id}`)) return;
    useReplayStore
      .getState()
      .setReplay(replayResult.body.replay, replayResult.body.errors);
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

  // Dismiss the context menu on outside click / Esc.
  useEffect(() => {
    if (!menu) return;
    const onDocMouseDown = () => setMenu(null);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const tree = useMemo(() => buildTree(summaries), [summaries]);

  const toggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openContextMenu = useCallback(
    (e: MouseEvent, target: string) => {
      if (!canCreate) return;
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, target });
    },
    [canCreate],
  );

  const startCreate = useCallback((target: string) => {
    setCreatingAt(target);
    setMenu(null);
    // Ensure the parent folder is expanded so the input is visible.
    if (target !== "") {
      setCollapsed((prev) => {
        if (!prev.has(target)) return prev;
        const next = new Set(prev);
        next.delete(target);
        return next;
      });
    }
  }, []);

  const submitCreate = useCallback(
    async (parent: string, rawName: string) => {
      const trimmed = rawName.trim();
      if (trimmed === "" || trimmed.includes("/") || trimmed.includes("..")) {
        showToast({ kind: "error", message: "Invalid filename" });
        return;
      }
      const fileName = trimmed.endsWith(".json") ? trimmed : `${trimmed}.json`;
      const stem = fileName.slice(0, -".json".length);
      const id = parent === "" ? fileName : `${parent}/${fileName}`;
      const body = newTestTemplate(stem);
      const result = await api.createTest(id, body);
      if (result.ok) {
        setCreatingAt(null);
        return;
      }
      if (result.aborted) return;
      if (result.status === 409) {
        showToast({ kind: "error", message: "File already exists" });
        return; // keep input open so user can rename
      }
      showToast({
        kind: "error",
        message: `Failed to create ${id}: ${result.err}`,
      });
      setCreatingAt(null);
    },
    [],
  );

  const cancelCreate = useCallback(() => setCreatingAt(null), []);

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      <header
        className="border-b border-neutral-800 px-3 py-2 text-sm font-medium"
        onContextMenu={(e) => openContextMenu(e, "")}
      >
        Tests
      </header>
      <div className="flex-1 overflow-auto py-1 text-sm">
        {!listFailed && summaries.length === 0 && creatingAt !== "" && (
          <div className="px-3 py-2 text-xs text-neutral-500">
            No tests found in this directory.{" "}
            <span className="text-neutral-600">
              Pass a path to <code>flint-viz serve</code> to point at a different one.
            </span>
          </div>
        )}
        <ul className="select-none">
          {creatingAt === "" && (
            <NewFileInput
              depth={0}
              onSubmit={(name) => submitCreate("", name)}
              onCancel={cancelCreate}
            />
          )}
          {tree.map((node) => (
            <TreeNodeView
              key={nodeKey(node)}
              node={node}
              depth={0}
              currentId={testId}
              collapsed={collapsed}
              creatingAt={creatingAt}
              canCreate={canCreate}
              onToggle={toggleFolder}
              onOpen={openTest}
              onContextMenuFolder={openContextMenu}
              onSubmitNew={submitCreate}
              onCancelNew={cancelCreate}
            />
          ))}
        </ul>
      </div>
      {menu && (
        <ContextMenuView
          menu={menu}
          onPick={() => startCreate(menu.target)}
        />
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
  creatingAt: string | null;
  canCreate: boolean;
  onToggle: (path: string) => void;
  onOpen: (id: string) => void;
  onContextMenuFolder: (e: MouseEvent, target: string) => void;
  onSubmitNew: (parent: string, name: string) => void;
  onCancelNew: () => void;
}

function TreeNodeView(props: NodeViewProps) {
  if (props.node.kind === "folder") {
    return <FolderView {...props} node={props.node} />;
  }
  return (
    <FileView
      node={props.node}
      depth={props.depth}
      currentId={props.currentId}
      onOpen={props.onOpen}
    />
  );
}

function FolderView({
  node,
  depth,
  currentId,
  collapsed,
  creatingAt,
  canCreate,
  onToggle,
  onOpen,
  onContextMenuFolder,
  onSubmitNew,
  onCancelNew,
}: NodeViewProps & { node: TreeFolder }) {
  const isCollapsed = collapsed.has(node.path);
  const showInput = creatingAt === node.path;
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        onContextMenu={(e) => onContextMenuFolder(e, node.path)}
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
          {showInput && (
            <NewFileInput
              depth={depth + 1}
              onSubmit={(name) => onSubmitNew(node.path, name)}
              onCancel={onCancelNew}
            />
          )}
          {node.children.map((child) => (
            <TreeNodeView
              key={nodeKey(child)}
              node={child}
              depth={depth + 1}
              currentId={currentId}
              collapsed={collapsed}
              creatingAt={creatingAt}
              canCreate={canCreate}
              onToggle={onToggle}
              onOpen={onOpen}
              onContextMenuFolder={onContextMenuFolder}
              onSubmitNew={onSubmitNew}
              onCancelNew={onCancelNew}
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

function NewFileInput({
  depth,
  onSubmit,
  onCancel,
}: {
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSubmit(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <li>
      <div
        className="flex items-center px-2 py-0.5"
        style={{ paddingLeft: `${depth * 12 + 24}px` }}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder="new_test.json"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={onCancel}
          className="w-full rounded-sm border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-neutral-100 outline-none focus:border-blue-500"
        />
      </div>
    </li>
  );
}

function ContextMenuView({
  menu,
  onPick,
}: {
  menu: ContextMenu;
  onPick: () => void;
}) {
  return (
    <div
      className="fixed z-50 min-w-[140px] rounded-sm border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-lg"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="block w-full px-3 py-1 text-left text-neutral-200 hover:bg-neutral-800"
        onClick={onPick}
      >
        New file…
      </button>
    </div>
  );
}
