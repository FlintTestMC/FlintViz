import type { TestSummary } from "../api/types";

export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

export interface TreeFile {
  kind: "file";
  name: string;
  path: string;
  summary: TestSummary;
}

export type TreeNode = TreeFolder | TreeFile;

// Builds a tree from `summary.id` slash structure. Preserves input order,
// which the server already sorts ascending — so folders appear in id-sorted
// order without extra work.
export function buildTree(summaries: TestSummary[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const summary of summaries) {
    const parts = summary.id.split("/");
    if (parts.length === 0 || parts[0] === "") continue;

    let cursor = root;
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      prefix = prefix ? `${prefix}/${part}` : part;
      const existing = cursor.find(
        (n): n is TreeFolder => n.kind === "folder" && n.name === part,
      );
      if (existing) {
        cursor = existing.children;
      } else {
        const folder: TreeFolder = {
          kind: "folder",
          name: part,
          path: prefix,
          children: [],
        };
        cursor.push(folder);
        cursor = folder.children;
      }
    }

    const fileName = parts[parts.length - 1]!;
    cursor.push({
      kind: "file",
      name: fileName,
      path: summary.id,
      summary,
    });
  }

  return root;
}
