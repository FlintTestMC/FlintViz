import { useEffect, useState } from "react";

import { loadAssetZip } from "../world/atlas";

// Pragmatic item-icon pipeline. The plan called for deepslate's `ItemRenderer`
// baked into a sprite sheet (see #0030 file notes), but ~95 % of vanilla items
// resolve cleanly to a single PNG by walking the model `parent` chain — sword,
// pickaxe, bucket, food, every block-form item — so we use the texture
// directly. Items that don't (rare special-cased models) fall back to a text
// label rendered inline by the panel.
//
// The pipeline returns a CSS background string (`url(...)`) per item id; the
// panel paints it onto a slot div. The data URL pool is cached in memory as a
// single Promise so concurrent calls from the inventory + future tooltips
// share one parse pass.

const TEXTURE_ITEM_PREFIX = "assets/minecraft/textures/item/";
const TEXTURE_BLOCK_PREFIX = "assets/minecraft/textures/block/";
const MODEL_ITEM_PREFIX = "assets/minecraft/models/item/";
const MODEL_BLOCK_PREFIX = "assets/minecraft/models/block/";

interface IconIndex {
  // Map of fully-qualified id (`minecraft:stone`) → data URL background.
  byId: Map<string, string>;
}

let cached: Promise<IconIndex> | null = null;
let iconIndexState: IconIndex | null = null;
const subscribers = new Set<() => void>();
let loadStarted = false;

export function resetItemIcons(): void {
  cached = null;
  loadStarted = false;
  iconIndexState = null;
  ensureIconsLoaded();
}

function ensureIconsLoaded(): void {
  if (loadStarted) return;
  loadStarted = true;
  loadItemIcons()
    .then((idx) => {
      iconIndexState = idx;
      for (const fn of subscribers) fn();
    })
    .catch((err) => {
      console.warn("itemIcons: failed to load", err);
      loadStarted = false;
    });
}

export function useItemIcon(id: string): string | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    ensureIconsLoaded();
    const fn = () => setTick((n) => n + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  if (!iconIndexState) return null;
  if (id.includes(":")) return iconIndexState.byId.get(id) ?? null;
  return iconIndexState.byId.get(`minecraft:${id}`) ?? null;
}

export function loadItemIcons(): Promise<IconIndex> {
  if (cached) return cached;
  cached = doLoad();
  return cached;
}

async function doLoad(): Promise<IconIndex> {
  const zip = await loadAssetZip();

  // Pull texture PNGs and model JSONs into in-memory maps keyed by their bare
  // ids (no minecraft: prefix). We don't need every block model, just enough
  // to follow `parent` references for items whose icons live in `block/`.
  const textureBlobs = new Map<string, Blob>();
  const itemModels = new Map<string, ItemModel>();
  const blockModels = new Map<string, ItemModel>();

  const tasks: Promise<void>[] = [];
  for (const path of Object.keys(zip.files)) {
    const file = zip.files[path];
    if (!file || file.dir) continue;

    if (path.startsWith(TEXTURE_ITEM_PREFIX) && path.endsWith(".png")) {
      const id = path.slice(TEXTURE_ITEM_PREFIX.length, -".png".length);
      tasks.push(
        file.async("blob").then((blob) => {
          textureBlobs.set(`item/${id}`, blob);
        }),
      );
    } else if (
      path.startsWith(TEXTURE_BLOCK_PREFIX) &&
      path.endsWith(".png")
    ) {
      const id = path.slice(TEXTURE_BLOCK_PREFIX.length, -".png".length);
      tasks.push(
        file.async("blob").then((blob) => {
          textureBlobs.set(`block/${id}`, blob);
        }),
      );
    } else if (path.startsWith(MODEL_ITEM_PREFIX) && path.endsWith(".json")) {
      const id = path.slice(MODEL_ITEM_PREFIX.length, -".json".length);
      tasks.push(
        file.async("string").then((text) => {
          try {
            itemModels.set(id, JSON.parse(text) as ItemModel);
          } catch {
            // Skip malformed; just no icon for this id.
          }
        }),
      );
    } else if (path.startsWith(MODEL_BLOCK_PREFIX) && path.endsWith(".json")) {
      const id = path.slice(MODEL_BLOCK_PREFIX.length, -".json".length);
      tasks.push(
        file.async("string").then((text) => {
          try {
            blockModels.set(id, JSON.parse(text) as ItemModel);
          } catch {
            // ignore
          }
        }),
      );
    }
  }
  await Promise.all(tasks);

  // For every item model, resolve its preferred texture by walking parents
  // and inspecting `textures` for layer0 / particle / all / side / front.
  // Then convert that PNG blob to a data URL once.
  const dataUrlCache = new Map<string, string>();
  const blobToDataUrl = async (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  };

  const byId = new Map<string, string>();
  for (const itemId of itemModels.keys()) {
    const texRef = resolveItemTexture(itemId, itemModels, blockModels);
    if (!texRef) continue;
    const blob = textureBlobs.get(texRef);
    if (!blob) continue;
    let dataUrl = dataUrlCache.get(texRef);
    if (!dataUrl) {
      dataUrl = await blobToDataUrl(blob);
      dataUrlCache.set(texRef, dataUrl);
    }
    byId.set(`minecraft:${itemId}`, dataUrl);
  }

  return { byId };
}

interface ItemModel {
  parent?: string;
  textures?: Record<string, string>;
}

// Returns a texture reference like "item/stick" or "block/stone", or null.
function resolveItemTexture(
  itemId: string,
  itemModels: Map<string, ItemModel>,
  blockModels: Map<string, ItemModel>,
): string | null {
  const seen = new Set<string>();
  let model = itemModels.get(itemId);
  let inItemNamespace = true;
  while (model) {
    const tex = pickTexture(model.textures);
    if (tex) return normaliseTextureRef(tex);
    if (!model.parent) return null;
    const parent = stripPrefix(model.parent);
    if (seen.has(parent)) return null; // cycle guard
    seen.add(parent);
    if (parent.startsWith("item/")) {
      inItemNamespace = true;
      model = itemModels.get(parent.slice("item/".length));
    } else if (parent.startsWith("block/")) {
      inItemNamespace = false;
      model = blockModels.get(parent.slice("block/".length));
    } else if (parent === "builtin/generated" || parent === "builtin/entity") {
      return null;
    } else {
      // Unscoped reference — try item/ first when we're walking item models,
      // else block/.
      model = inItemNamespace ? itemModels.get(parent) : blockModels.get(parent);
    }
  }
  return null;
}

function pickTexture(textures?: Record<string, string>): string | null {
  if (!textures) return null;
  for (const key of [
    "layer0",
    "particle",
    "all",
    "front",
    "side",
    "end",
    "top",
    "down",
    "up",
    "north",
  ]) {
    const v = textures[key];
    if (v && !v.startsWith("#")) return v;
  }
  // Fall back to the first non-reference value.
  for (const v of Object.values(textures)) {
    if (v && !v.startsWith("#")) return v;
  }
  return null;
}

function stripPrefix(ref: string): string {
  return ref.startsWith("minecraft:") ? ref.slice("minecraft:".length) : ref;
}

function normaliseTextureRef(ref: string): string {
  // Texture refs in models are like "minecraft:item/stick" or "block/stone".
  return stripPrefix(ref);
}
