import { describe, expect, it } from "vitest";
import JSZip from "jszip";

import { hasAssetZipLayout, looksLikeZip } from "../assetZip";

describe("looksLikeZip", () => {
  it("accepts PK signatures", () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
  });

  it("rejects HTML SPA fallbacks", () => {
    const html = new TextEncoder().encode("<!doctype html><html>");
    expect(looksLikeZip(html)).toBe(false);
  });
});

describe("hasAssetZipLayout", () => {
  it("requires blockstates and block textures", async () => {
    const zip = new JSZip();
    zip.file(
      "assets/minecraft/blockstates/stone.json",
      JSON.stringify({ variants: {} }),
    );
    zip.file("assets/minecraft/textures/block/stone.png", new Uint8Array(8));

    expect(hasAssetZipLayout(zip)).toBe(true);
  });

  it("rejects empty archives", () => {
    expect(hasAssetZipLayout(new JSZip())).toBe(false);
  });
});
