import { describe, expect, it } from "vitest";

import { parseErrorsToMarkers } from "../markers";

describe("parseErrorsToMarkers", () => {
  it("translates errors to monaco marker shape", () => {
    const markers = parseErrorsToMarkers([
      { line: 4, col: 7, message: "expected ','" },
    ]);
    expect(markers).toEqual([
      {
        severity: 8,
        message: "expected ','",
        startLineNumber: 4,
        endLineNumber: 4,
        startColumn: 7,
        endColumn: 8,
      },
    ]);
  });

  it("clamps column 0 (EOF) to 1", () => {
    const [marker] = parseErrorsToMarkers([
      { line: 12, col: 0, message: "unexpected EOF" },
    ]);
    expect(marker?.startColumn).toBe(1);
    expect(marker?.endColumn).toBe(2);
  });

  it("clamps line 0 to 1", () => {
    const [marker] = parseErrorsToMarkers([
      { line: 0, col: 5, message: "?" },
    ]);
    expect(marker?.startLineNumber).toBe(1);
    expect(marker?.endLineNumber).toBe(1);
  });

  it("returns empty for empty input", () => {
    expect(parseErrorsToMarkers([])).toEqual([]);
  });
});
