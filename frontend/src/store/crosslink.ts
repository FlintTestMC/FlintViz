// Cross-link state shared by the editor, world, scrubber, and panels (#0032).
// Holds: the editor handle (so non-editor panes can call `revealRangeInCenter`
// without prop-drilling refs) and the current cursor-driven set of highlighted
// ticks. Decoupled from `useReplayStore` so editor mount/unmount doesn't
// invalidate replay-store selectors.

import type { editor as monacoEditor } from "monaco-editor";
import { create } from "zustand";

import {
  parseJson,
  pointerToSpan,
  timelineEntryPointerAt,
} from "../editor/jsonPointerToRange";

type MonacoNs = typeof import("monaco-editor");

export interface CrosslinkState {
  editor: monacoEditor.IStandaloneCodeEditor | null;
  monaco: MonacoNs | null;
  // Ticks the cursor's enclosing `/timeline/N` resolves to. Empty when the
  // cursor isn't in a timeline entry. Multiple ticks for `at: [t1,t2,t3]`.
  highlightedTicks: Set<number>;

  setEditor: (
    editor: monacoEditor.IStandaloneCodeEditor | null,
    monaco: MonacoNs | null,
  ) => void;
  setHighlightedTicks: (ticks: Set<number>) => void;

  // Reveal + select the range of `pointer` in the editor. Bails silently when
  // the editor is unmounted (e.g. test not selected) or the pointer doesn't
  // resolve.
  revealPointer: (pointer: string) => void;
}

export const useCrosslinkStore = create<CrosslinkState>((set, get) => ({
  editor: null,
  monaco: null,
  highlightedTicks: new Set(),

  setEditor: (editor, monaco) => set({ editor, monaco }),

  setHighlightedTicks: (ticks) => {
    // Reference-equality fast path so subscribers don't churn on every cursor
    // tick when the resolved pointer is the same.
    const prev = get().highlightedTicks;
    if (sameTickSet(prev, ticks)) return;
    set({ highlightedTicks: ticks });
  },

  revealPointer: (pointer) => {
    const { editor, monaco } = get();
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    const root = parseJson(model.getValue());
    if (!root) return;
    const span = pointerToSpan(root, pointer);
    if (!span) return;
    const startPos = model.getPositionAt(span.start);
    const endPos = model.getPositionAt(span.end);
    const range = new monaco.Range(
      startPos.lineNumber,
      startPos.column,
      endPos.lineNumber,
      endPos.column,
    );
    editor.setSelection(range);
    editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
    editor.focus();
  },
}));

function sameTickSet(a: Set<number>, b: Set<number>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// Pure helper exported for the editor — finds the `/timeline/N` pointer that
// encloses a Monaco offset, then projects to the highlighted-tick set via the
// supplied source-map index. Lives here (not in the editor module) so the
// editor stays free of source-map plumbing.
export function ticksAtOffset(
  source: string,
  offset: number,
  pointerToTicks: Map<string, Set<number>>,
): Set<number> {
  const root = parseJson(source);
  if (!root) return new Set();
  const pointer = timelineEntryPointerAt(root, offset);
  if (!pointer) return new Set();
  return pointerToTicks.get(pointer) ?? new Set();
}
