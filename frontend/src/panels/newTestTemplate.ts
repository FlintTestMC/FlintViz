const SCHEMA_URL =
  "https://raw.githubusercontent.com/FlintTestMC/flint-core/refs/heads/main/flint-content/test_spec_schema.json";

export function newTestTemplate(stem: string): string {
  const body = {
    $schema: SCHEMA_URL,
    flintVersion: "1.0",
    name: stem,
    description: "TODO: describe what this test verifies",
    tags: [] as string[],
    minecraftIds: ["minecraft:stone"],
    setup: {
      cleanup: {
        region: [
          [0, 0, 0],
          [0, 0, 0],
        ],
      },
    },
    timeline: [
      { at: 0, do: "place", pos: [0, 0, 0], block: { id: "minecraft:stone" } },
      {
        at: 1,
        do: "assert",
        checks: [{ pos: [0, 0, 0], is: { id: "minecraft:stone" } }],
      },
    ],
  };
  return JSON.stringify(body, null, 2) + "\n";
}
