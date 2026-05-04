import { describe, expect, it } from "vitest";

import type { TestSummary } from "../../api/types";
import { buildTree, type TreeFolder } from "../buildTree";

function summary(id: string, extras: Partial<TestSummary> = {}): TestSummary {
  return {
    id,
    path: `/abs/${id}`,
    name: id.split("/").pop() ?? id,
    tags: [],
    ...extras,
  };
}

describe("buildTree", () => {
  it("returns flat list when no slashes in ids", () => {
    const tree = buildTree([summary("a.json"), summary("b.json")]);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.kind === "file")).toBe(true);
  });

  it("nests folders by id segments", () => {
    const tree = buildTree([
      summary("redstone/a.json"),
      summary("redstone/b.json"),
      summary("nether/c.json"),
    ]);
    expect(tree).toHaveLength(2);
    const redstone = tree[0] as TreeFolder;
    expect(redstone.kind).toBe("folder");
    expect(redstone.name).toBe("redstone");
    expect(redstone.children).toHaveLength(2);
  });

  it("preserves input order (server sorts by id ascending)", () => {
    const tree = buildTree([
      summary("a/b.json"),
      summary("a/a.json"),
      summary("a/c.json"),
    ]);
    const a = tree[0] as TreeFolder;
    expect(a.children.map((n) => n.name)).toEqual(["b.json", "a.json", "c.json"]);
  });

  it("merges shared folder prefixes across summaries", () => {
    const tree = buildTree([
      summary("a/b/c.json"),
      summary("a/b/d.json"),
      summary("a/e.json"),
    ]);
    const a = tree[0] as TreeFolder;
    expect(a.children).toHaveLength(2);
    const b = a.children[0] as TreeFolder;
    expect(b.kind).toBe("folder");
    expect(b.children).toHaveLength(2);
    expect(a.children[1]?.kind).toBe("file");
  });

  it("attaches the original summary on file nodes", () => {
    const s = summary("x.json", { parse_error: "boom" });
    const tree = buildTree([s]);
    expect(tree[0]?.kind).toBe("file");
    if (tree[0]?.kind === "file") {
      expect(tree[0].summary.parse_error).toBe("boom");
    }
  });

  it("computes folder paths from accumulated prefix", () => {
    const tree = buildTree([summary("a/b/c.json")]);
    const a = tree[0] as TreeFolder;
    const b = a.children[0] as TreeFolder;
    expect(a.path).toBe("a");
    expect(b.path).toBe("a/b");
  });
});
