import type { Identifier, TextureAtlasProvider } from "deepslate";

type UV = [number, number, number, number];

/** UV lookup for deepslate — pixel data lives on the Three.js canvas instead. */
export function createAtlasProvider(
  pixelWidth: number,
  idMap: Record<string, UV>,
): TextureAtlasProvider {
  const part = 16 / pixelWidth;
  const missing: UV = [0, 0, part, part];
  return {
    getTextureAtlas() {
      return new ImageData(1, 1);
    },
    getTextureUV(id: Identifier) {
      return idMap[id.toString()] ?? missing;
    },
    getPixelSize() {
      return part / 16;
    },
  };
}
