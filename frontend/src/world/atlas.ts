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
}

const ASSETS_URL = "/mc-assets.zip";
const BLOCKSTATE_PREFIX = "assets/minecraft/blockstates/";
const MODEL_PREFIX = "assets/minecraft/models/";
const TEXTURE_PREFIX = "assets/minecraft/textures/";

let cached: Promise<BlockProviders> | null = null;
let zipPromise: Promise<JSZip> | null = null;

// Shared parsed-zip singleton. Both `world/atlas.ts` and `panels/itemIcons.ts`
// (#0030) consume it so the asset zip is parsed exactly once per app load even
// though the browser would otherwise cache the HTTP response.
export function loadAssetZip(): Promise<JSZip> {
  if (zipPromise) return zipPromise;
  zipPromise = (async () => {
    const res = await fetch(ASSETS_URL);
    if (!res.ok) {
      throw new Error(
        `Failed to load ${ASSETS_URL} (${res.status}). Run \`npm run assets\` to generate it.`,
      );
    }
    const zipBytes = new Uint8Array(await res.arrayBuffer());
    return JSZip.loadAsync(zipBytes);
  })();
  return zipPromise;
}

export function loadBlockProviders(): Promise<BlockProviders> {
  if (cached) return cached;
  cached = doLoad();
  return cached;
}

// Reset cache — used by the gallery's reload button and by tests.
export function resetBlockProviders(): void {
  cached = null;
  zipPromise = null;
}

async function doLoad(): Promise<BlockProviders> {
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
