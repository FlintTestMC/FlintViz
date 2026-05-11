/**
 * Shared FracturedJson formatter for FlintBenchmark test JSON.
 *
 * Both the CLI (`scripts/format-json.js`) and the in-browser editor
 * (`frontend/src/editor/formatJson.ts`) format JSON through this module so the
 * output stays identical regardless of where formatting is triggered.
 *
 * The frontend has its own thin TypeScript wrapper that mirrors the same
 * defaults — keep them in sync if you tweak options here.
 */

const { Formatter } = require('fracturedjsonjs');

function createFormatter() {
  const formatter = new Formatter();
  // FracturedJson v4 reads options off `formatter.Options`. Defaults already
  // produce the layout the repo's tests use (4-space indent, table-aligned
  // arrays/objects), so we don't override anything here — but this is the
  // place to do it if we ever want to.
  return formatter;
}

/**
 * Format a JSON string. Returns the formatted text (always ending with a
 * trailing newline). Throws SyntaxError if the input isn't valid JSON.
 */
function formatJsonText(source) {
  const parsed = JSON.parse(source);
  return createFormatter().Serialize(parsed) + '\n';
}

module.exports = { createFormatter, formatJsonText };
