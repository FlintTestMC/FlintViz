// RFC 6901 JSON pointer ↔ source span helpers for the cross-link feature
// (#0032). Avoids a `jsonc-parser` dependency by walking the source with a
// small recursive-descent parser that records UTF-16 offsets per node. Offsets
// match Monaco's `model.getOffsetAt` / `getPositionAt` codomain.
//
// Today the engine only emits `/timeline/N` pointers (#0016), but the walker
// is full RFC 6901 so deeper pointers don't break it later.

export type JsonNode =
  | { kind: "object"; start: number; end: number; props: JsonProp[] }
  | { kind: "array"; start: number; end: number; items: JsonNode[] }
  | { kind: "string"; start: number; end: number; value: string }
  | { kind: "number"; start: number; end: number }
  | { kind: "boolean"; start: number; end: number }
  | { kind: "null"; start: number; end: number };

interface JsonProp {
  keyStart: number;
  keyEnd: number;
  key: string;
  node: JsonNode;
}

export interface OffsetSpan {
  start: number;
  end: number;
}

class ParseFailed extends Error {}

// Best-effort parse. Returns null on syntax error — callers fall back silently
// (cross-link is a navigation aid, not a required path).
export function parseJson(src: string): JsonNode | null {
  const p = { i: 0 };
  try {
    skipWs(src, p);
    if (p.i >= src.length) return null;
    const node = parseValue(src, p);
    return node;
  } catch {
    return null;
  }
}

// Walks `pointer` (RFC 6901) against `root`. Returns the offset span of the
// matched value node, or null if the pointer doesn't resolve.
export function pointerToSpan(
  root: JsonNode,
  pointer: string,
): OffsetSpan | null {
  const node = resolvePointer(root, pointer);
  if (!node) return null;
  return { start: node.start, end: node.end };
}

// Returns the deepest pointer whose value-node range contains `offset`. For
// the cursor → timeline highlight we typically truncate to top-level (cursor
// inside `timeline[N]` → `/timeline/N`) — the caller handles that.
export function pointerAtOffset(root: JsonNode, offset: number): string | null {
  const path: string[] = [];
  if (!walkAtOffset(root, offset, path)) return null;
  return "/" + path.map(escapeToken).join("/");
}

// Variant for the cursor → tick highlight: returns `/timeline/N` if the cursor
// is anywhere inside a `timeline` array entry, else null. Using this directly
// (rather than truncating `pointerAtOffset`) avoids a wasted walk past depth 2.
export function timelineEntryPointerAt(
  root: JsonNode,
  offset: number,
): string | null {
  if (root.kind !== "object") return null;
  const tl = root.props.find((p) => p.key === "timeline");
  if (!tl || tl.node.kind !== "array") return null;
  const items = tl.node.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (offset >= item.start && offset <= item.end) {
      return `/timeline/${i}`;
    }
  }
  return null;
}

// --- Pointer walker ---------------------------------------------------------

function resolvePointer(root: JsonNode, pointer: string): JsonNode | null {
  if (pointer === "") return root;
  if (!pointer.startsWith("/")) return null;
  const tokens = pointer
    .slice(1)
    .split("/")
    .map(unescapeToken);
  let cur: JsonNode = root;
  for (const tok of tokens) {
    if (cur.kind === "object") {
      const found = cur.props.find((p) => p.key === tok);
      if (!found) return null;
      cur = found.node;
    } else if (cur.kind === "array") {
      const idx = parseArrayIndex(tok);
      if (idx === null || idx < 0 || idx >= cur.items.length) return null;
      cur = cur.items[idx]!;
    } else {
      return null;
    }
  }
  return cur;
}

function walkAtOffset(node: JsonNode, offset: number, path: string[]): boolean {
  if (offset < node.start || offset > node.end) return false;
  if (node.kind === "object") {
    for (const prop of node.props) {
      if (offset >= prop.node.start && offset <= prop.node.end) {
        path.push(prop.key);
        walkAtOffset(prop.node, offset, path);
        return true;
      }
    }
    return true;
  }
  if (node.kind === "array") {
    for (let i = 0; i < node.items.length; i++) {
      const item = node.items[i]!;
      if (offset >= item.start && offset <= item.end) {
        path.push(String(i));
        walkAtOffset(item, offset, path);
        return true;
      }
    }
    return true;
  }
  return true;
}

function parseArrayIndex(tok: string): number | null {
  if (tok === "" || tok === "-") return null;
  if (!/^(0|[1-9][0-9]*)$/.test(tok)) return null;
  return Number(tok);
}

function escapeToken(tok: string): string {
  return tok.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapeToken(tok: string): string {
  return tok.replace(/~1/g, "/").replace(/~0/g, "~");
}

// --- JSON parser ------------------------------------------------------------

function parseValue(src: string, p: { i: number }): JsonNode {
  skipWs(src, p);
  const c = src[p.i];
  if (c === undefined) throw new ParseFailed("eof");
  if (c === "{") return parseObject(src, p);
  if (c === "[") return parseArray(src, p);
  if (c === '"') return parseString(src, p);
  if (c === "t" || c === "f") return parseBool(src, p);
  if (c === "n") return parseNull(src, p);
  return parseNumber(src, p);
}

function parseObject(src: string, p: { i: number }): JsonNode {
  const start = p.i;
  p.i++; // {
  const props: JsonProp[] = [];
  skipWs(src, p);
  if (src[p.i] === "}") {
    p.i++;
    return { kind: "object", start, end: p.i, props };
  }
  for (;;) {
    skipWs(src, p);
    if (src[p.i] !== '"') throw new ParseFailed("expected key");
    const keyStart = p.i;
    const keyNode = parseString(src, p);
    skipWs(src, p);
    if (src[p.i] !== ":") throw new ParseFailed("expected :");
    p.i++;
    const value = parseValue(src, p);
    props.push({
      keyStart,
      keyEnd: keyNode.end,
      key: keyNode.kind === "string" ? keyNode.value : "",
      node: value,
    });
    skipWs(src, p);
    if (src[p.i] === ",") {
      p.i++;
      continue;
    }
    if (src[p.i] === "}") {
      p.i++;
      return { kind: "object", start, end: p.i, props };
    }
    throw new ParseFailed("expected , or }");
  }
}

function parseArray(src: string, p: { i: number }): JsonNode {
  const start = p.i;
  p.i++; // [
  const items: JsonNode[] = [];
  skipWs(src, p);
  if (src[p.i] === "]") {
    p.i++;
    return { kind: "array", start, end: p.i, items };
  }
  for (;;) {
    items.push(parseValue(src, p));
    skipWs(src, p);
    if (src[p.i] === ",") {
      p.i++;
      continue;
    }
    if (src[p.i] === "]") {
      p.i++;
      return { kind: "array", start, end: p.i, items };
    }
    throw new ParseFailed("expected , or ]");
  }
}

function parseString(src: string, p: { i: number }): JsonNode {
  const start = p.i;
  if (src[p.i] !== '"') throw new ParseFailed("expected string");
  p.i++;
  let out = "";
  while (p.i < src.length) {
    const c = src[p.i]!;
    if (c === '"') {
      p.i++;
      return { kind: "string", start, end: p.i, value: out };
    }
    if (c === "\\") {
      const esc = src[p.i + 1];
      if (esc === undefined) throw new ParseFailed("bad escape");
      p.i += 2;
      switch (esc) {
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const hex = src.slice(p.i, p.i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ParseFailed("bad \\u");
          out += String.fromCharCode(parseInt(hex, 16));
          p.i += 4;
          break;
        }
        default:
          throw new ParseFailed("bad escape");
      }
      continue;
    }
    out += c;
    p.i++;
  }
  throw new ParseFailed("unterminated string");
}

function parseNumber(src: string, p: { i: number }): JsonNode {
  const start = p.i;
  const re = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/;
  const m = re.exec(src.slice(p.i));
  if (!m) throw new ParseFailed("expected number");
  p.i += m[0].length;
  return { kind: "number", start, end: p.i };
}

function parseBool(src: string, p: { i: number }): JsonNode {
  const start = p.i;
  if (src.startsWith("true", p.i)) {
    p.i += 4;
    return { kind: "boolean", start, end: p.i };
  }
  if (src.startsWith("false", p.i)) {
    p.i += 5;
    return { kind: "boolean", start, end: p.i };
  }
  throw new ParseFailed("expected boolean");
}

function parseNull(src: string, p: { i: number }): JsonNode {
  const start = p.i;
  if (src.startsWith("null", p.i)) {
    p.i += 4;
    return { kind: "null", start, end: p.i };
  }
  throw new ParseFailed("expected null");
}

function skipWs(src: string, p: { i: number }): void {
  while (p.i < src.length) {
    const c = src.charCodeAt(p.i);
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
      p.i++;
      continue;
    }
    break;
  }
}
