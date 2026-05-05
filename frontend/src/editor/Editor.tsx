import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import type { editor as monacoEditor } from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api } from "../api/client";
import { useReplayStore } from "../store/replay";
import { MARKER_OWNER, parseErrorsToMarkers } from "./markers";
import { registerFlintSchema } from "./registerSchema";

const DEBOUNCE_MS = 250;

export default function Editor() {
  const source = useReplayStore((s) => s.source);
  const testId = useReplayStore((s) => s.testId);
  const parseErrors = useReplayStore((s) => s.parseErrors);

  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const debounceRef = useRef<number | null>(null);
  const replayTokenRef = useRef(0);
  // Set true while we're applying an external setValue, so onChange can ignore
  // its own programmatic update and not loop back into the debounced replay.
  const applyingExternalRef = useRef(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const handleMount = useCallback<OnMount>(
    (ed, monaco) => {
      editorRef.current = ed;
      monacoRef.current = monaco;
      registerFlintSchema(monaco);
      // Seed initial markers in case parseErrors arrived before mount.
      const model = ed.getModel();
      if (model) {
        const markers = parseErrorsToMarkers(parseErrors).map((m) => ({
          ...m,
          severity: monaco.MarkerSeverity.Error,
        }));
        monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
      }
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
    try {
      const result = await api.replay(text);
      if (token !== replayTokenRef.current) return;
      const store = useReplayStore.getState();
      const prevTick = store.tick;
      store.setReplay(result.replay, result.errors);
      if (result.replay && result.errors.length === 0 && prevTick > 0) {
        useReplayStore.getState().setTick(prevTick);
      }
      setStatusError(null);
    } catch (err) {
      if (token !== replayTokenRef.current) return;
      setStatusError(formatError(err));
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
        <span>Editor</span>
        {statusError && (
          <span
            className="rounded bg-red-900/40 px-2 py-0.5 text-xs text-red-300"
            title={statusError}
          >
            {statusError}
          </span>
        )}
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

function formatError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
