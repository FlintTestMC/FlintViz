import {
  BlockDefinition,
  BlockModel,
  Identifier,
  TextureAtlas,
  type BlockDefinitionProvider,
  type BlockModelProvider,
  type TextureAtlasProvider,
} from "deepslate";
import JSZip from "jszip";

import { type BlockDefaults, loadBlockDefaults } from "./blockDefaults";
import {
  CanvasTexture,
  NearestFilter,
  SRGBColorSpace,
  type Texture,
} from "three";

export interface BlockProviders {
  blockModels: BlockModelProvider;
  blockDefinitions: BlockDefinitionProvider;
  atlas: TextureAtlasProvider;
  atlasTexture: Texture;
  atlasSize: number;
  // Default block-state properties (#0048), keyed `minecraft:<id>`. Merged
  // underneath user props in `instancing.ts` so tests can omit properties.
  defaults: BlockDefaults;
}

const ASSETS_URL = `${import.meta.env.BASE_URL}mc-assets.zip`;
const BLOCKSTATE_PREFIX = "assets/minecraft/blockstates/";
const MODEL_PREFIX = "assets/minecraft/models/";
const TEXTURE_PREFIX = "assets/minecraft/textures/";

const MC_VERSION = "26.1.2";
const VERSION_MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const KEEP_PATH_RE = /^assets\/minecraft\/(blockstates|models|textures\/block|textures\/item)\//;

export type AssetLoadStatus =
  | { kind: "idle" }
  | { kind: "eula_prompt"; onAccept: () => void }
  | { kind: "loading"; message: string }
  | { kind: "loaded" }
  | { kind: "error"; error: Error };

type StatusListener = (status: AssetLoadStatus) => void;
const statusListeners = new Set<StatusListener>();
let currentStatus: AssetLoadStatus = { kind: "idle" };

export function subscribeAssetStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

function setAssetStatus(status: AssetLoadStatus) {
  currentStatus = status;
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch (e) {
      // ignore
    }
  }
}

async function downloadAndExtractAssetsClientSide(): Promise<JSZip> {
  setAssetStatus({ kind: "loading", message: "Fetching Minecraft version manifest..." });
  const manifestRes = await fetch(VERSION_MANIFEST_URL);
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch version manifest: HTTP ${manifestRes.status}`);
  }
  const manifest = await manifestRes.json();
  const entry = manifest.versions.find((v: any) => v.id === MC_VERSION);
  if (!entry) {
    throw new Error(`Version ${MC_VERSION} not found in Minecraft manifest.`);
  }

  setAssetStatus({ kind: "loading", message: `Fetching version info for ${MC_VERSION}...` });
  const versionRes = await fetch(entry.url);
  if (!versionRes.ok) {
    throw new Error(`Failed to fetch version info: HTTP ${versionRes.status}`);
  }
  const versionDoc = await versionRes.json();
  const { url, size } = versionDoc.downloads.client;

  setAssetStatus({
    kind: "loading",
    message: `Downloading Minecraft client.jar (${(size / 1024 / 1024).toFixed(1)} MB)...`,
  });

  const jarRes = await fetch(url);
  if (!jarRes.ok) {
    throw new Error(`Failed to download client.jar: HTTP ${jarRes.status}`);
  }

  const reader = jarRes.body?.getReader();
  const contentLength = size;

  if (!reader) {
    throw new Error("Failed to read client.jar download stream.");
  }

  let receivedLength = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedLength += value.length;
    const pct = ((receivedLength / contentLength) * 100).toFixed(0);
    setAssetStatus({
      kind: "loading",
      message: `Downloading client.jar: ${pct}% (${(receivedLength / 1024 / 1024).toFixed(1)} / ${(contentLength / 1024 / 1024).toFixed(1)} MB)`,
    });
  }

  setAssetStatus({ kind: "loading", message: "Reading downloaded client.jar..." });
  const jarBytes = new Uint8Array(receivedLength);
  let position = 0;
  for (const chunk of chunks) {
    jarBytes.set(chunk, position);
    position += chunk.length;
  }

  setAssetStatus({ kind: "loading", message: "Extracting asset files (this may take a few seconds)..." });
  const inZip = await JSZip.loadAsync(jarBytes);
  const outZip = new JSZip();

  let kept = 0;
  const entries = Object.keys(inZip.files);
  const totalEntries = entries.length;
  let processed = 0;

  for (const path of entries) {
    processed++;
    if (processed % 1000 === 0) {
      setAssetStatus({
        kind: "loading",
        message: `Extracting assets: ${((processed / totalEntries) * 100).toFixed(0)}%`,
      });
    }

    const file = inZip.files[path];
    if (!file || file.dir) continue;
    if (!KEEP_PATH_RE.test(path)) continue;

    const data = await file.async("uint8array");
    outZip.file(path, data);
    kept++;
  }

  setAssetStatus({ kind: "loading", message: `Generating optimized asset bundle (${kept} files)...` });
  const outBytes = await outZip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  setAssetStatus({ kind: "loading", message: "Caching asset bundle in browser storage..." });
  try {
    const cache = await caches.open("flint-viz-assets");
    await cache.put(
      ASSETS_URL,
      new Response(outBytes as any, {
        headers: { "Content-Type": "application/zip" },
      }),
    );
  } catch (e) {
    console.warn("Failed to write bundle to browser CacheStorage", e);
  }

  return outZip;
}

let cached: Promise<BlockProviders> | null = null;
let zipPromise: Promise<JSZip> | null = null;

/** Clears cached zip/providers so a failed load can be retried without reload. */
export function resetAssetLoad(): void {
  cached = null;
  zipPromise = null;
  setAssetStatus({ kind: "idle" });
}

export function loadAssetZip(): Promise<JSZip> {
  if (zipPromise) return zipPromise;
  zipPromise = (async () => {
    // 1. Try server-side first
    setAssetStatus({ kind: "loading", message: "Checking server for pre-built asset bundle..." });
    try {
      const res = await fetch(ASSETS_URL);
      if (res.ok) {
        setAssetStatus({ kind: "loading", message: "Loading asset bundle from server..." });
        const zipBytes = new Uint8Array(await res.arrayBuffer());
        const zip = await JSZip.loadAsync(zipBytes);
        setAssetStatus({ kind: "loaded" });
        return zip;
      }
    } catch (e) {
      console.log("Failed to fetch assets from server, falling back to cache/download", e);
    }

    // 2. Try browser cache
    setAssetStatus({ kind: "loading", message: "Checking browser cache for assets..." });
    try {
      const cache = await caches.open("flint-viz-assets");
      const cachedResponse = await cache.match(ASSETS_URL);
      if (cachedResponse) {
        setAssetStatus({ kind: "loading", message: "Loading assets from browser cache..." });
        const zipBytes = new Uint8Array(await cachedResponse.arrayBuffer());
        const zip = await JSZip.loadAsync(zipBytes);
        setAssetStatus({ kind: "loaded" });
        return zip;
      }
    } catch (e) {
      console.warn("Browser cache access failed", e);
    }

    // 3. Ask for EULA acceptance
    let acceptEulaResolver: (() => void) | null = null;
    setAssetStatus({
      kind: "eula_prompt",
      onAccept: () => {
        if (acceptEulaResolver) {
          acceptEulaResolver();
          acceptEulaResolver = null;
        }
      },
    });

    await new Promise<void>((resolve) => {
      acceptEulaResolver = resolve;
    });

    // 4. Download and extract client-side
    try {
      const zip = await downloadAndExtractAssetsClientSide();
      setAssetStatus({ kind: "loaded" });
      return zip;
    } catch (err: any) {
      setAssetStatus({ kind: "error", error: err });
      throw err;
    }
  })();
  return zipPromise;
}

export function loadBlockProviders(): Promise<BlockProviders> {
  if (cached) return cached;
  cached = doLoad();
  return cached;
}

async function doLoad(): Promise<BlockProviders> {
  // Kick off the defaults fetch in parallel with the (much larger) asset zip
  // so "renderer ready" stays a single async boundary — no second loading
  // state in components.
  const defaultsPromise = loadBlockDefaults();
  const zip = await loadAssetZip();

  const textureBlobs: { [id: string]: Blob } = {};
  const modelEntries: Array<[Identifier, unknown]> = [];
  const stateEntries: Array<[Identifier, unknown]> = [];

  const tasks: Promise<void>[] = [];

  for (const path of Object.keys(zip.files)) {
    const file = zip.files[path];
    if (!file || file.dir) continue;

    if (path.startsWith(TEXTURE_PREFIX) && path.endsWith(".png")) {
      // Only block textures land in the world atlas — item icons get their own
      // pipeline in #0030. Keep them out to keep the atlas small.
      if (!path.startsWith(`${TEXTURE_PREFIX}block/`)) continue;
      const rel = path.slice(TEXTURE_PREFIX.length, -".png".length);
      const id = `minecraft:${rel}`;
      tasks.push(
        file.async("blob").then((blob) => {
          textureBlobs[id] = blob;
        }),
      );
    } else if (path.startsWith(MODEL_PREFIX) && path.endsWith(".json")) {
      const rel = path.slice(MODEL_PREFIX.length, -".json".length);
      const id = Identifier.create(rel);
      tasks.push(
        file.async("string").then((text) => {
          try {
            modelEntries.push([id, normaliseModelJson(JSON.parse(text))]);
          } catch {
            // Malformed JSON shouldn't kill the whole atlas — skip and warn.
            console.warn(`atlas: skipping malformed model ${path}`);
          }
        }),
      );
    } else if (path.startsWith(BLOCKSTATE_PREFIX) && path.endsWith(".json")) {
      const rel = path.slice(BLOCKSTATE_PREFIX.length, -".json".length);
      const id = Identifier.create(rel);
      tasks.push(
        file.async("string").then((text) => {
          try {
            stateEntries.push([id, JSON.parse(text)]);
          } catch {
            console.warn(`atlas: skipping malformed blockstate ${path}`);
          }
        }),
      );
    }
  }

  await Promise.all(tasks);

  // Preflight `createImageBitmap` on every block texture so a single
  // undecodable PNG doesn't sink the whole atlas. deepslate's
  // `TextureAtlas.fromBlobs` runs all decodes inside one `Promise.all`, so
  // when one blob fails the rejection bubbles out as the browser's generic
  // "The source image could not be decoded" with no clue which file. Doing
  // the decode ourselves lets us log the offending id and continue with the
  // rest — the bad texture just renders as the magenta-checker fallback.
  const decodableBlobs: { [id: string]: Blob } = {};
  await Promise.all(
    Object.entries(textureBlobs).map(async ([id, blob]) => {
      try {
        const bmp = await createImageBitmap(blob);
        bmp.close();
        decodableBlobs[id] = blob;
      } catch (err) {
        console.warn(`atlas: skipping undecodable texture ${id}`, err);
      }
    }),
  );

  const models = new Map<string, BlockModel>();
  for (const [id, json] of modelEntries) {
    models.set(id.toString(), BlockModel.fromJson(json));
  }

  const blockModels: BlockModelProvider = {
    getBlockModel(id) {
      return models.get(id.toString()) ?? null;
    },
  };

  for (const model of models.values()) {
    model.flatten(blockModels);
  }

  const definitions = new Map<string, BlockDefinition>();
  for (const [id, json] of stateEntries) {
    definitions.set(id.toString(), BlockDefinition.fromJson(json));
  }

  const blockDefinitions: BlockDefinitionProvider = {
    getBlockDefinition(id) {
      return definitions.get(id.toString()) ?? null;
    },
  };

  const atlas = await TextureAtlas.fromBlobs(decodableBlobs);
  const atlasImage = atlas.getTextureAtlas();
  const atlasTexture = imageDataToTexture(atlasImage);

  return {
    blockModels,
    blockDefinitions,
    atlas,
    atlasTexture,
    atlasSize: atlasImage.width,
    defaults: await defaultsPromise,
  };
}

// Patches model JSON in place to work around two vanilla quirks deepslate
// doesn't handle on its own:
//
// 1. Since 1.21.4 some texture refs are objects like
//    `{ "force_translucent": true, "sprite": "minecraft:block/glass" }`
//    instead of plain strings. deepslate's `getTexture` calls `.startsWith`
//    on the value and throws on objects (glass_pane, etc. silently fail to
//    render). Collapse those to the bare sprite string.
//
// 2. Entity-rendered blocks (every shulker box, chests, beds, signs) ship
//    block models with only a `particle` texture and no `parent`/`elements`
//    — vanilla draws them via entity code. deepslate produces zero quads for
//    these. Synthesise a `cube_all` parent with the particle texture so they
//    at least show up as a solid coloured cube in the world view.
//    Skip this for `air` (particle = `missingno`) and inventory-only blocks
//    like `barrier` / `structure_void` (particle = `item/...`) so they stay
//    invisible instead of becoming missing-texture cubes.
function normaliseModelJson(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const model = json as {
    parent?: string;
    elements?: unknown[];
    textures?: Record<string, unknown>;
  };

  if (model.textures) {
    for (const k of Object.keys(model.textures)) {
      const v = model.textures[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const sprite = (v as { sprite?: unknown }).sprite;
        model.textures[k] = typeof sprite === "string" ? sprite : "";
      }
    }
  }

  const hasElements =
    Array.isArray(model.elements) && model.elements.length > 0;
  const particle =
    model.textures && typeof model.textures.particle === "string"
      ? (model.textures.particle as string)
      : null;
  if (
    !model.parent &&
    !hasElements &&
    particle &&
    particle.startsWith("minecraft:block/")
  ) {
    model.parent = "minecraft:block/cube_all";
    model.textures = { ...model.textures, all: particle };
  }

  return model;
}

function imageDataToTexture(img: ImageData): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("atlas: 2d context unavailable");
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
