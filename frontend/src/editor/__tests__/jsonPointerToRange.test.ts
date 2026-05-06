import { describe, expect, it } from "vitest";

import {
  parseJson,
  pointerAtOffset,
  pointerToSpan,
  timelineEntryPointerAt,
} from "../jsonPointerToRange";

describe("parseJson", () => {
  it("returns null on syntax error", () => {
    expect(parseJson("{")).toBeNull();
    expect(parseJson("not json")).toBeNull();
  });

  it("captures offsets for nested values", () => {
    const src = '{"timeline":[{"action":"place"},{"action":"remove"}]}';
    const root = parseJson(src);
    expect(root?.kind).toBe("object");
    if (root?.kind !== "object") return;
    const tl = root.props.find((p) => p.key === "timeline");
    expect(tl?.node.kind).toBe("array");
    if (tl?.node.kind !== "array") return;
    expect(tl.node.items).toHaveLength(2);
    const first = tl.node.items[0]!;
    expect(src.slice(first.start, first.end)).toBe('{"action":"place"}');
  });
});

describe("pointerToSpan", () => {
  const src = '{"timeline":[{"a":1},{"b":2}],"name":"hi"}';
  const root = parseJson(src)!;

  it("resolves /timeline/N", () => {
    const span = pointerToSpan(root, "/timeline/1")!;
    expect(src.slice(span.start, span.end)).toBe('{"b":2}');
  });

  it("resolves the empty pointer to the document root", () => {
    const span = pointerToSpan(root, "")!;
    expect(span.start).toBe(0);
    expect(span.end).toBe(src.length);
  });

  it("returns null for out-of-range index", () => {
    expect(pointerToSpan(root, "/timeline/9")).toBeNull();
  });

  it("returns null for unknown property", () => {
    expect(pointerToSpan(root, "/missing")).toBeNull();
  });

  it("decodes RFC 6901 escapes", () => {
    const s = '{"a/b":{"~x":1}}';
    const r = parseJson(s)!;
    const span = pointerToSpan(r, "/a~1b/~0x")!;
    expect(s.slice(span.start, span.end)).toBe("1");
  });
});

describe("timelineEntryPointerAt", () => {
  const src = '{"timeline":[{"a":1},{"b":2}]}';
  const root = parseJson(src)!;

  it("returns the enclosing timeline entry pointer", () => {
    const insideFirst = src.indexOf('"a"');
    expect(timelineEntryPointerAt(root, insideFirst)).toBe("/timeline/0");
    const insideSecond = src.indexOf('"b"');
    expect(timelineEntryPointerAt(root, insideSecond)).toBe("/timeline/1");
  });

  it("returns null when outside any timeline entry", () => {
    expect(timelineEntryPointerAt(root, 0)).toBeNull();
  });
});

describe("pointerAtOffset", () => {
  it("returns the deepest pointer at a nested offset", () => {
    const src = '{"timeline":[{"action":"place"}]}';
    const root = parseJson(src)!;
    const offset = src.indexOf('"place"');
    expect(pointerAtOffset(root, offset)).toBe("/timeline/0/action");
  });
});
