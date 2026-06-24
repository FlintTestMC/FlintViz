import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import type { editor as monacoEditor, IDisposable } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";

import { api } from "../api/client";
import type { TestSpec } from "../api/types";
import { showToast } from "../components/toastStore";
import { isEffectivelyReadOnly, useConfigStore } from "../store/config";
import { useCrosslinkStore, ticksAtOffset } from "../store/crosslink";
import { useReplayStore } from "../store/replay";
import { formatJsonText } from "./formatJson";
import { MARKER_OWNER, parseErrorsToMarkers } from "./markers";
import { registerFlintSchema } from "./registerSchema";

const DEBOUNCE_MS = 250;

export default function Editor() {
  const source = useReplayStore((s) => s.source);
  const testId = useReplayStore((s) => s.testId);
  const parseErrors = useReplayStore((s) => s.parseErrors);
  const standalone = useConfigStore((s) => s.standalone);

  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const debounceRef = useRef<number | null>(null);
  const replayTokenRef = useRef(0);
  // Set true while we're applying an external setValue, so onChange can ignore
  // its own programmatic update and not loop back into the debounced replay.
  const applyingExternalRef = useRef(false);
  // Last error message we already toasted, so a single failure mode (e.g. a
  // 413 that fires every keystroke) doesn't carpet-bomb the toast channel.
  const lastErrorRef = useRef<string | null>(null);

  const cursorDisposableRef = useRef<IDisposable | null>(null);

  const handleMount = useCallback<OnMount>(
    (ed, monaco) => {
      editorRef.current = ed;
      monacoRef.current = monaco;
      registerFlintSchema(monaco);
      // Publish the editor handle so non-editor panes (timeline, world,
      // assertion panel) can reveal ranges without prop-drilling refs.
      useCrosslinkStore.getState().setEditor(ed, monaco);
      // Seed initial markers in case parseErrors arrived before mount.
      const model = ed.getModel();
      if (model) {
        const markers = parseErrorsToMarkers(parseErrors).map((m) => ({
          ...m,
          severity: monaco.MarkerSeverity.Error,
        }));
        monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
      }
      // Ctrl+S — save the current editor content to disk.
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const { testId, source } = useReplayStore.getState();
        if (!testId) return;
        if (isEffectivelyReadOnly() && !standalone) {
          showToast({ kind: "info", message: "Read-only mode — not saved" });
          return;
        }
        void api.saveTest(testId, source).then((result) => {
          if (!result.ok) {
            showToast({ kind: "error", message: `Save failed: ${result.err}` });
          } else {
            showToast({ kind: "info", message: standalone ? "Saved to browser storage" : "Saved" });
          }
        });
      });
      // Cursor → timeline highlight (#0032). Resolve the enclosing
      // `/timeline/N` and dispatch the highlighted-tick set on every move.
      const updateHighlight = () => {
        const m = ed.getModel();
        if (!m) return;
        const pos = ed.getPosition();
        if (!pos) return;
        const offset = m.getOffsetAt(pos);
        const indices = useReplayStore.getState().sourceIndices;
        const ticks = ticksAtOffset(m.getValue(), offset, indices.pointerToTicks);
        useCrosslinkStore.getState().setHighlightedTicks(ticks);
      };
      cursorDisposableRef.current = ed.onDidChangeCursorPosition(updateHighlight);
      updateHighlight();
    },
    // parseErrors intentionally captured at mount only; the marker effect below
    // keeps them in sync after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // External source updates (sidebar click, SSE refresh) — push into the model
  // imperatively. Skip when the editor's value already matches (the user just
  // typed and we already updated the store).
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (ed.getValue() === source) return;
    const position = ed.getPosition();
    applyingExternalRef.current = true;
    try {
      ed.setValue(source);
      if (position) ed.setPosition(position);
    } finally {
      applyingExternalRef.current = false;
    }
  }, [source]);

  // Apply parse-error markers to the model whenever errors change.
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const model = ed.getModel();
    if (!model) return;
    const markers = parseErrorsToMarkers(parseErrors).map((m) => ({
      ...m,
      severity: monaco.MarkerSeverity.Error,
    }));
    monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
  }, [parseErrors]);

  const runReplay = useCallback(async (text: string) => {
    const token = ++replayTokenRef.current;
    const result = await api.replay(text);
    if (token !== replayTokenRef.current) return;
    if (!result.ok) {
      if (result.aborted) return;
      const msg = result.status === 413
        ? "replay body too large (max 1 MiB)"
        : result.err;
      if (msg !== lastErrorRef.current) {
        showToast({ kind: "error", message: msg });
        lastErrorRef.current = msg;
      }
      return;
    }
    const store = useReplayStore.getState();
    const prevTick = store.tick;
    store.setReplay(result.body.replay, result.body.errors);
    if (result.body.replay && result.body.errors.length === 0 && prevTick > 0) {
      useReplayStore.getState().setTick(prevTick);
    }
    lastErrorRef.current = null;
  }, []);

  // Format the current buffer with FracturedJson and write it back to disk.
  // setValue feeds through the normal onChange path, so the store + debounced
  // replay update themselves; we just save in parallel.
  const handleFormat = useCallback(async () => {
    const { source: currentSource, testId: currentTestId } =
      useReplayStore.getState();
    if (!currentTestId) return;
    const result = formatJsonText(currentSource);
    if (!result.ok) {
      showToast({ kind: "error", message: `Format failed: ${result.error}` });
      return;
    }
    const ed = editorRef.current;
    if (ed && ed.getValue() !== result.text) {
      const position = ed.getPosition();
      ed.setValue(result.text);
      if (position) ed.setPosition(position);
    }
    if (isEffectivelyReadOnly() && !standalone) {
      showToast({ kind: "info", message: "Formatted (read-only, not saved)" });
      return;
    }
    const saveResult = await api.saveTest(currentTestId, result.text);
    if (!saveResult.ok) {
      showToast({ kind: "error", message: `Save failed: ${saveResult.err}` });
    } else {
      showToast({
        kind: "info",
        message: standalone ? "Formatted and saved to browser storage" : "Formatted and saved",
      });
    }
  }, [standalone]);

  const handleShare = useCallback(async () => {
    const currentSource = useReplayStore.getState().source;
    if (!currentSource) return;

    let parsedSpec: TestSpec;
    try {
      parsedSpec = JSON.parse(currentSource) as TestSpec;
    } catch (err) {
      showToast({
        kind: "error",
        message: `Cannot share: invalid JSON (${err instanceof Error ? err.message : String(err)})`,
      });
      return;
    }

    try {
      const payload = {
        version: 1,
        spec: parsedSpec,
        source_path: null,
        failures: [],
        total_ticks: 0,
      };

      const encoded = await api.encodeFailure(payload);
      const url = `${window.location.origin}${window.location.pathname}#/share#data=${encoded}`;
      
      await navigator.clipboard.writeText(url);
      showToast({ kind: "info", message: "Shareable link copied to clipboard!" });
    } catch (err) {
      showToast({
        kind: "error",
        message: `Failed to create shareable link: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, []);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return;
      if (applyingExternalRef.current) return;
      useReplayStore.getState().setSource(value);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        void runReplay(value);
      }, DEBOUNCE_MS);
    },
    [runReplay],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      cursorDisposableRef.current?.dispose();
      cursorDisposableRef.current = null;
      useCrosslinkStore.getState().setHighlightedTicks(new Set());
      // Clear the editor handle so non-editor panes bail silently instead of
      // revealing on a disposed model.
      useCrosslinkStore.getState().setEditor(null, null);
    };
  }, []);

  if (testId === null) {
    return (
      <div className="flex h-full flex-col">
        <header className="border-b border-neutral-800 px-3 py-2 text-sm font-medium">
          Editor
        </header>
        <div className="flex-1 p-3 text-sm text-neutral-500">
          Select a test from the sidebar to start editing.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-sm font-medium">
        <span>Editor {standalone && "(Offline)"}</span>
        <div className="flex gap-2">
          {standalone && (
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([source], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = testId || "test.json";
                a.click();
                URL.revokeObjectURL(url);
                showToast({ kind: "info", message: "Downloaded test JSON" });
              }}
              title="Download JSON to your computer"
              className="rounded px-2 py-0.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 cursor-pointer"
            >
              Export
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleFormat()}
            title={standalone ? "Format JSON" : "Format JSON and save"}
            aria-label={standalone ? "Format JSON" : "Format JSON and save"}
            className="rounded px-2 py-0.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 cursor-pointer"
          >
            Format
          </button>
          <button
            type="button"
            onClick={() => void handleShare()}
            title="Create a shareable link to this test"
            aria-label="Create a shareable link to this test"
            className="rounded px-2 py-0.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-800 hover:text-neutral-100 cursor-pointer"
          >
            Share
          </button>
        </div>
      </header>
      <div className="flex-1">
        <MonacoEditor
          height="100%"
          defaultLanguage="json"
          theme="vs-dark"
          defaultValue={source}
          onMount={handleMount}
          onChange={handleChange}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            tabSize: 2,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}

