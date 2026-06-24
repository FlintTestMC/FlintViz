import type { TextureAtlasProvider } from "deepslate";

import { createAtlasProvider } from "./createAtlasProvider";
import {
  atlasFrameSourceSize,
  decodeToDrawable,
  needsTextureNormalization,
} from "./textureNormalize";

export interface BlockTextureAtlas {
  atlas: TextureAtlasProvider;
  canvas: HTMLCanvasElement;
}

function upperPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function drawInvalidTexture(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = "magenta";
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(8, 8, 8, 8);
}

async function decodeTexture(
  id: string,
  blob: Blob,
): Promise<(CanvasImageSource & { width: number; height: number }) | null> {
  try {
    return needsTextureNormalization(id)
      ? await decodeToDrawable(blob)
      : await createImageBitmap(blob);
  } catch (err) {
    console.warn(`atlas: skipping texture ${id}`, err);
    return null;
  }
}

const DECODE_BATCH = 64;

/** Packs block textures into a canvas + UV map for deepslate and Three.js. */
export async function buildBlockTextureAtlas(
  textures: Record<string, Blob>,
  onProgress?: (done: number, total: number) => void,
): Promise<BlockTextureAtlas> {
  const ids = Object.keys(textures).sort();
  const total = ids.length;

  const grid = upperPowerOfTwo(Math.ceil(Math.sqrt(total + 1)));
  const pixelWidth = grid * 16;
  const part = 1 / grid;

  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelWidth;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("buildBlockTextureAtlas: 2d context unavailable");

  drawInvalidTexture(ctx);

  const idMap: Record<string, [number, number, number, number]> = {};
  let index = 1;
  let packed = 0;

  for (let i = 0; i < ids.length; i += DECODE_BATCH) {
    const batch = ids.slice(i, i + DECODE_BATCH);
    const drawables = await Promise.all(
      batch.map(async (id) => ({
        id,
        drawable: await decodeTexture(id, textures[id]!),
      })),
    );

    for (const { id, drawable } of drawables) {
      if (!drawable) continue;

      const u = index % grid;
      const v = Math.floor(index / grid);
      idMap[id] = [part * u, part * v, part * u + part, part * v + part];

      const frame = atlasFrameSourceSize(id, drawable.width);
      ctx.drawImage(drawable, 0, 0, frame, frame, 16 * u, 16 * v, 16, 16);
      if ("close" in drawable && typeof drawable.close === "function") {
        drawable.close();
      }

      index++;
      packed++;
    }

    onProgress?.(Math.min(i + batch.length, total), total);
    if (i > 0 && i % (DECODE_BATCH * 4) === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  if (packed === 0) {
    throw new Error(
      "No block textures could be packed. Try clearing site data and downloading assets again.",
    );
  }

  return { atlas: createAtlasProvider(pixelWidth, idMap), canvas };
}
