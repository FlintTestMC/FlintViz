import type { editor } from "monaco-editor";

import type { ParseError } from "../api/types";

export const MARKER_OWNER = "flint-replay";

export function parseErrorsToMarkers(
  errors: ParseError[],
): editor.IMarkerData[] {
  return errors.map((err) => {
    const line = Math.max(1, err.line);
    const col = Math.max(1, err.col);
    return {
      severity: 8, // monaco.MarkerSeverity.Error
      message: err.message,
      startLineNumber: line,
      endLineNumber: line,
      startColumn: col,
      endColumn: col + 1,
    };
  });
}
