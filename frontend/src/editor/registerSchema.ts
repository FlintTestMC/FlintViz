import flintSchema from "./flint.schema.json";

const SCHEMA_URI = "flint://schemas/flint-test.json";
// Alias for the `$schema` URL embedded in `newTestTemplate.ts`. Monaco's JSON
// worker has no HTTP schema-request service, so without this entry every new
// test file marks "No schema request service available" against that URL.
const REMOTE_SCHEMA_URL =
  "https://raw.githubusercontent.com/FlintTestMC/flint-core/refs/heads/main/flint-content/test_spec_schema.json";

let registered = false;

// Wires the Flint test JSON schema into Monaco's JSON language service.
// Idempotent: safe to call from every editor mount (StrictMode double-mount,
// multiple editor panes, etc).
export function registerFlintSchema(monaco: typeof import("monaco-editor")) {
  if (registered) return;
  registered = true;

  const existing = monaco.languages.json.jsonDefaults.diagnosticsOptions;
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    ...existing,
    validate: true,
    allowComments: false,
    schemaValidation: "error",
    schemas: [
      ...(existing.schemas ?? []).filter(
        (s) => s.uri !== SCHEMA_URI && s.uri !== REMOTE_SCHEMA_URL,
      ),
      {
        uri: SCHEMA_URI,
        // Match every JSON file in the workspace — Monaco's JSON service treats
        // the inline editor model as a virtual file, so we glob broadly.
        fileMatch: ["*"],
        schema: flintSchema,
      },
      {
        uri: REMOTE_SCHEMA_URL,
        schema: flintSchema,
      },
    ],
  });
}
