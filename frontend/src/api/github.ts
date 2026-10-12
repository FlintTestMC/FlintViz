import type { TestDetail, TestSpec, TestSummary } from "./types";

export interface GithubSource {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  /** `<ref>/<path>` from a /tree/ URL; split into ref + path on first listing. */
  rest?: string;
}

/**
 * Parses `?github=<url|owner/repo>[&ref=..][&path=..]`.
 * In `/tree/<ref>/<path>` URLs the first segment is the default ref guess;
 * `githubListTests` retries longer prefixes for branches containing `/`.
 * ponytail: costs one API request per wrong guess, `&ref=` skips the probing.
 */
export function parseGithubSource(search: string): GithubSource | null {
  const q = new URLSearchParams(search);
  const raw = q.get("github")?.trim();
  if (!raw) return null;
  const m = raw.match(
    /^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?$/,
  );
  if (!m) return null;
  const [, owner = "", repo = "", urlRef, urlPath] = m;
  const explicit = q.get("ref");
  return {
    owner,
    repo,
    ref: explicit || urlRef || "HEAD",
    path: (q.get("path") ?? urlPath ?? "").replace(/^\/+|\/+$/g, ""),
    rest: !explicit && urlRef ? [urlRef, urlPath].filter(Boolean).join("/") : undefined,
  };
}

let source: GithubSource | null =
  typeof window === "undefined" ? null : parseGithubSource(window.location.search);

export function isGithub(): boolean {
  return source !== null;
}

export function githubLabel(): string {
  return source ? `${source.owner}/${source.repo}@${source.ref}` : "";
}

const sources = new Map<string, string>();

export async function githubListTests(): Promise<
  { ok: true; body: TestSummary[] } | { ok: false; err: string }
> {
  if (!source) return { ok: false, err: "not in github mode" };
  const { owner, repo } = source;
  const tree = (ref: string) =>
    fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
  let res = await tree(source.ref);
  if (res.status === 404 && source.rest) {
    const segs = source.rest.split("/");
    for (let i = 2; i <= segs.length && res.status === 404; i++) {
      const ref = segs.slice(0, i).join("/");
      const r = await tree(ref);
      if (r.ok) {
        source = { ...source, ref, path: segs.slice(i).join("/") };
        res = r;
      }
    }
  }
  if (!res.ok) return { ok: false, err: `GitHub API HTTP ${res.status}` };
  const { path } = source;
  const json = (await res.json()) as {
    tree: { path: string; type: string }[];
  };
  const prefix = path ? path + "/" : "";
  const body = json.tree
    .filter((e) => e.type === "blob" && e.path.endsWith(".json") && e.path.startsWith(prefix))
    .map((e) => {
      const id = e.path.slice(prefix.length);
      return {
        id,
        path: `github://${owner}/${repo}/${e.path}`,
        name: id.replace(/\.json$/i, ""),
        tags: [],
      };
    });
  return { ok: true, body };
}

export async function githubGetTest(
  id: string,
): Promise<{ ok: true; body: TestDetail } | { ok: false; status: number; err: string }> {
  if (!source) return { ok: false, status: 0, err: "not in github mode" };
  let text = sources.get(id);
  if (text === undefined) {
    const { owner, repo, ref, path } = source;
    const file = [path, id].filter(Boolean).join("/").split("/").map(encodeURIComponent).join("/");
    const res = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${ref.split("/").map(encodeURIComponent).join("/")}/${file}`,
    );
    if (!res.ok) return { ok: false, status: res.status, err: `HTTP ${res.status}` };
    text = await res.text();
    sources.set(id, text);
  }
  let spec: TestSpec | null = null;
  let parse_error: string | null = null;
  try {
    spec = JSON.parse(text) as TestSpec;
  } catch (err) {
    parse_error = err instanceof Error ? err.message : String(err);
  }
  return { ok: true, body: { id, source: text, spec, parse_error } };
}

/** In-memory scratch edit only; never written back to GitHub. */
export function githubSaveTest(id: string, text: string): void {
  sources.set(id, text);
}
