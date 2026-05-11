import { Formatter } from "fracturedjsonjs";

// Mirrors `scripts/format-json-core.js`. The defaults from FracturedJson v4
// already produce the layout the CLI formatter writes to disk (4-space indent,
// table-aligned arrays/objects), so we don't override anything here — but if
// the CLI script ever sets options, this must match.
function createFormatter(): Formatter {
  return new Formatter();
}

export type FormatResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export function formatJsonText(source: string): FormatResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    const text = createFormatter().Serialize(parsed);
    if (text === undefined) {
      return { ok: false, error: "formatter returned no output" };
    }
    return { ok: true, text: text + "\n" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
