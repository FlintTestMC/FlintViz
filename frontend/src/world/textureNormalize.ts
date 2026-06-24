// Vanilla fluid textures (water_still, water_flow, lava_*) are animated PNG
// strips — often 4-bit colormap — that `createImageBitmap(blob)` rejects in
// Chromium. `decodeToDrawable` falls back to `HTMLImageElement`.

const FLUID_TEXTURE_RE = /(?:water|lava)_(?:still|flow)$/;

/** Source square size to sample from an animated strip before downscaling to 16. */
export function atlasFrameSourceSize(id: string, width: number): number {
  if (/(?:water|lava)_flow$/.test(id) && width >= 32) return 32;
  return 16;
}

export function needsTextureNormalization(id: string): boolean {
  return FLUID_TEXTURE_RE.test(id);
}

export async function decodeToDrawable(
  blob: Blob,
): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(blob);
  } catch {
    // Fall through — colormap / animated PNGs often fail here.
  }
  return loadHtmlImage(blob);
}

function loadHtmlImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode texture image"));
    };
    img.src = url;
  });
}
