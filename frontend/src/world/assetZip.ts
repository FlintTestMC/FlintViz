import JSZip from "jszip";

const ASSETS_URL = `${import.meta.env.BASE_URL}mc-assets.zip`;
const BLOCKSTATE_PREFIX = "assets/minecraft/blockstates/";
const BLOCK_TEXTURE_PREFIX = "assets/minecraft/textures/block/";

/** ZIP local-file or empty-archive signature (`PK`). */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function hasAssetZipLayout(zip: JSZip): boolean {
  const paths = Object.keys(zip.files);
  return (
    paths.some((p) => p.startsWith(BLOCKSTATE_PREFIX)) &&
    paths.some(
      (p) => p.startsWith(BLOCK_TEXTURE_PREFIX) && p.endsWith(".png"),
    )
  );
}

export async function parseAssetZipBytes(
  bytes: Uint8Array,
  source: string,
): Promise<JSZip | null> {
  if (!looksLikeZip(bytes)) {
    console.warn(`asset zip from ${source} is not a zip file`);
    return null;
  }
  try {
    const zip = await JSZip.loadAsync(bytes);
    if (!hasAssetZipLayout(zip)) {
      console.warn(`asset zip from ${source} is missing expected Minecraft assets`);
      return null;
    }
    return zip;
  } catch (err) {
    console.warn(`asset zip from ${source} failed to parse`, err);
    return null;
  }
}

export async function clearCachedAssetZip(): Promise<void> {
  try {
    const cache = await caches.open("flint-viz-assets");
    await cache.delete(ASSETS_URL);
  } catch {
    // CacheStorage unavailable or blocked — ignore.
  }
}

export { ASSETS_URL };
