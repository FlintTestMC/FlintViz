// Downloads the vanilla Minecraft client jar for a given version, extracts
// only the asset paths the visualizer needs (blockstates, models, block/item
// textures), and re-zips them into `frontend/public/mc-assets.zip`. Run once
// per dev machine — the resulting zip is gitignored.
//
// Usage: `npm run assets` (defaults to MC_VERSION below).

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

const MC_VERSION = process.env.MC_VERSION ?? "26.1.2";
const VERSION_MANIFEST_URL =
  "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const KEEP_PATH_RE =
  /^assets\/minecraft\/(blockstates|models|textures\/block|textures\/item)\//;

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "public", "mc-assets.zip");

interface ManifestVersion {
  id: string;
  url: string;
}
interface VersionDoc {
  downloads: { client: { url: string; sha1: string; size: number } };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return (await res.json()) as T;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

async function main() {
  console.log(`Fetching manifest…`);
  const manifest = await fetchJson<{ versions: ManifestVersion[] }>(
    VERSION_MANIFEST_URL,
  );
  const entry = manifest.versions.find((v) => v.id === MC_VERSION);
  if (!entry) {
    throw new Error(
      `Version ${MC_VERSION} not in manifest. Set MC_VERSION env to a valid id.`,
    );
  }

  console.log(`Fetching version doc for ${MC_VERSION}…`);
  const doc = await fetchJson<VersionDoc>(entry.url);
  const { url, sha1: expected, size } = doc.downloads.client;
  console.log(
    `Downloading client.jar (${(size / 1024 / 1024).toFixed(1)} MB)…`,
  );
  const jarBytes = await fetchBytes(url);
  const actual = sha1(jarBytes);
  if (actual !== expected) {
    throw new Error(`client.jar sha1 mismatch: ${actual} vs ${expected}`);
  }

  console.log("Unzipping client.jar…");
  const inZip = await JSZip.loadAsync(jarBytes);
  const outZip = new JSZip();

  let kept = 0;
  let skipped = 0;
  const entries = Object.keys(inZip.files);
  for (const path of entries) {
    const file = inZip.files[path];
    if (!file || file.dir) continue;
    if (!KEEP_PATH_RE.test(path)) {
      skipped++;
      continue;
    }
    const data = await file.async("uint8array");
    outZip.file(path, data);
    kept++;
  }

  console.log(`Kept ${kept} files, skipped ${skipped}.`);

  await mkdir(dirname(outPath), { recursive: true });
  const outBytes = await outZip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await writeFile(outPath, outBytes);
  console.log(
    `Wrote ${outPath} (${(outBytes.byteLength / 1024 / 1024).toFixed(1)} MB).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
