import { describe, expect, it } from "vitest";

import { atlasFrameSourceSize, needsTextureNormalization } from "../textureNormalize";

describe("atlasFrameSourceSize", () => {
  it("uses 16px frames for still fluids", () => {
    expect(atlasFrameSourceSize("minecraft:block/water_still", 16)).toBe(16);
    expect(atlasFrameSourceSize("minecraft:block/lava_still", 16)).toBe(16);
  });

  it("uses 32px frames for wide flow strips", () => {
    expect(atlasFrameSourceSize("minecraft:block/water_flow", 32)).toBe(32);
    expect(atlasFrameSourceSize("minecraft:block/lava_flow", 32)).toBe(32);
  });

  it("falls back to 16px for narrow flow textures", () => {
    expect(atlasFrameSourceSize("minecraft:block/water_flow", 16)).toBe(16);
  });
});

describe("needsTextureNormalization", () => {
  it("flags fluid textures", () => {
    expect(needsTextureNormalization("minecraft:block/water_still")).toBe(true);
    expect(needsTextureNormalization("minecraft:block/water_flow")).toBe(true);
    expect(needsTextureNormalization("minecraft:block/lava_still")).toBe(true);
    expect(needsTextureNormalization("minecraft:block/lava_flow")).toBe(true);
  });

  it("skips ordinary block textures", () => {
    expect(needsTextureNormalization("minecraft:block/stone")).toBe(false);
    expect(needsTextureNormalization("minecraft:block/oak_planks")).toBe(false);
  });
});
