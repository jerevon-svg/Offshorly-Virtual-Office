import { describe, expect, it } from "vitest";
import { ATLAS_PAD_RADIUS, LOD_TIERS, REQUIRED_CLIP_NAMES, TEXTURE_ENCODING } from "./lod-policy.mjs";

describe("LOD policy (quality pass 2026-08-29)", () => {
  it("ships 2048 / 1024 / 512 textures for lod0 / lod1 / lod2", () => {
    expect(LOD_TIERS.map((t) => [t.name, t.textureSize])).toEqual([["lod0", 2048], ["lod1", 1024], ["lod2", 512]]);
  });

  it("encodes every tier as near-lossless WebP (edge-preserving), never JPEG", () => {
    expect(TEXTURE_ENCODING.targetFormat).toBe("webp");
    expect(TEXTURE_ENCODING.nearLossless).toBe(true);
    // near-lossless is a lossless-mode preprocessor in libwebp — without this
    // flag the encoder silently falls back to plain lossy output.
    expect(TEXTURE_ENCODING.lossless).toBe(true);
    expect(TEXTURE_ENCODING.quality).toBeGreaterThanOrEqual(60);
  });

  it("keeps Draco on every tier with TEXCOORD quantization of at least 10 bits (lod2 raised from 8)", () => {
    for (const t of LOD_TIERS) {
      expect(t.dracoQuant.quantizeTexcoord).toBeGreaterThanOrEqual(10);
      expect(t.dracoQuant.quantizePosition).toBeGreaterThanOrEqual(10);
    }
    expect(LOD_TIERS.find((t) => t.name === "lod2").dracoQuant.quantizeTexcoord).toBe(10);
  });

  it("leaves geometry budgets unchanged and pads atlases by 8-16 texels", () => {
    expect(LOD_TIERS.map((t) => t.triangleTarget)).toEqual([25_000, 12_500, 4_000]);
    expect(ATLAS_PAD_RADIUS).toBeGreaterThanOrEqual(8);
    expect(ATLAS_PAD_RADIUS).toBeLessThanOrEqual(16);
  });

  it("requires exactly the six CharacterCanvas clip names", () => {
    expect(REQUIRED_CLIP_NAMES).toEqual(["idle-9", "walking", "agree-gesture", "listening-gesture", "sit-on-chair-arms", "sitting-answering"]);
  });
});
