import { describe, expect, it } from "vitest";
import { dilateAtlasRgba, rasterizeUvCoverage } from "./atlas-dilate.mjs";

// 12x12 synthetic atlas: two opaque "charts" (red square, blue square) with
// transparent black gaps between/around them.
function makeAtlas() {
  const w = 12, h = 12;
  const rgba = new Uint8Array(w * h * 4); // all transparent black
  const paint = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4; rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
    }
  };
  paint(1, 1, 3, 3, [255, 0, 0]);   // red chart, top-left
  paint(8, 8, 10, 10, [0, 0, 255]); // blue chart, bottom-right
  return { rgba, w, h };
}
const px = (rgba, w, x, y) => Array.from(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

describe("dilateAtlasRgba (UV-atlas gap padding)", () => {
  it("fills transparent gap texels within the radius with the nearest chart colour and leaves alpha untouched", () => {
    const { rgba, w, h } = makeAtlas();
    const stats = dilateAtlasRgba(rgba, w, h, { radius: 2 });
    expect(stats.opaque).toBe(18);
    // Directly right of the red chart -> red; directly above the blue chart -> blue.
    expect(px(rgba, w, 4, 2)).toEqual([255, 0, 0, 0]);
    expect(px(rgba, w, 5, 2)).toEqual([255, 0, 0, 0]);
    expect(px(rgba, w, 9, 7)).toEqual([0, 0, 255, 0]);
    expect(px(rgba, w, 9, 6)).toEqual([0, 0, 255, 0]);
    // Beyond the radius stays transparent black (reported, not filled).
    expect(px(rgba, w, 6, 2)).toEqual([0, 0, 0, 0]);
    expect(stats.remainingTransparent).toBeGreaterThan(0);
    expect(stats.filled + stats.opaque + stats.remainingTransparent).toBe(w * h);
  });

  it("never modifies opaque chart texels (interior or edge), byte for byte", () => {
    const { rgba, w, h } = makeAtlas();
    const before = Uint8Array.from(rgba);
    dilateAtlasRgba(rgba, w, h, { radius: 16 });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (before[i + 3] === 255) {
        expect(Array.from(rgba.subarray(i, i + 4))).toEqual(Array.from(before.subarray(i, i + 4)));
      }
    }
  });

  it("with a large radius no gap texel is left black; each gap texel takes the colour of its nearest chart", () => {
    const { rgba, w, h } = makeAtlas();
    const stats = dilateAtlasRgba(rgba, w, h, { radius: 16 });
    expect(stats.remainingTransparent).toBe(0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, , b] = px(rgba, w, x, y);
      expect(r === 255 || b === 255).toBe(true);
    }
    // Corner nearest the red chart is red, corner nearest the blue chart is blue.
    expect(px(rgba, w, 0, 0).slice(0, 3)).toEqual([255, 0, 0]);
    expect(px(rgba, w, 11, 11).slice(0, 3)).toEqual([0, 0, 255]);
  });

  it("fillRemainder keeps flooding past the radius until no gap texel is left, still without touching chart texels", () => {
    const { rgba, w, h } = makeAtlas();
    const before = Uint8Array.from(rgba);
    const stats = dilateAtlasRgba(rgba, w, h, { radius: 1, fillRemainder: true });
    expect(stats.remainingTransparent).toBe(0);
    expect(stats.filled).toBe(w * h - stats.opaque);
    for (let i = 0; i < w * h; i++) if (before[i * 4 + 3] === 255) expect(Array.from(rgba.subarray(i * 4, i * 4 + 4))).toEqual(Array.from(before.subarray(i * 4, i * 4 + 4)));
  });

  it("rejects a buffer whose length does not match the dimensions", () => {
    expect(() => dilateAtlasRgba(new Uint8Array(10), 2, 2)).toThrow(/buffer length/);
  });
});

describe("rasterizeUvCoverage + coverage-keyed dilation (opaque-black-gap atlases)", () => {
  // 16x16 atlas, one UV quad (two triangles) covering texels x 2..7, y 2..7
  // (uv 0.125..0.5). Everything else is an opaque BLACK gap, exactly like
  // Meshy's atlases; a black hair texel inside the chart must survive.
  const w = 16, h = 16;
  const uv = new Float32Array([0.125, 0.125, 0.5, 0.125, 0.5, 0.5, 0.125, 0.5]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  it("marks exactly the texels under the UV triangles plus a 1-texel conservative margin", () => {
    const { mask, covered, triangles } = rasterizeUvCoverage(uv, indices, w, h, { margin: 0 });
    expect(triangles).toBe(2);
    expect(covered).toBe(36); // 6x6 texel centres strictly inside/on the quad
    expect(mask[3 * w + 3]).toBe(1);
    expect(mask[1 * w + 1]).toBe(0);
    const grown = rasterizeUvCoverage(uv, indices, w, h, { margin: 1 });
    expect(grown.covered).toBe(64); // 8x8 after growing by one texel on each side
    expect(grown.mask[1 * w + 1]).toBe(1);
    expect(grown.mask[0]).toBe(0);
  });

  it("fills opaque-black gaps from the covered chart while keeping black paint inside the chart", () => {
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = 255; // fully opaque, black everywhere
    for (let y = 2; y <= 7; y++) for (let x = 2; x <= 7; x++) { const i = (y * w + x) * 4; rgba[i] = 250; rgba[i + 1] = 200; rgba[i + 2] = 190; }
    const hair = (4 * w + 4) * 4; rgba[hair] = 0; rgba[hair + 1] = 0; rgba[hair + 2] = 0; // black texel inside the chart
    const { mask } = rasterizeUvCoverage(uv, indices, w, h, { margin: 0 });
    const stats = dilateAtlasRgba(rgba, w, h, { radius: 16, coverage: mask });
    expect(stats.opaque).toBe(36);
    expect(stats.remainingTransparent).toBe(0);
    // Gap texel just outside the chart now carries skin colour, not black.
    expect(Array.from(rgba.subarray((1 * w + 4) * 4, (1 * w + 4) * 4 + 3))).toEqual([250, 200, 190]);
    expect(Array.from(rgba.subarray((12 * w + 12) * 4, (12 * w + 12) * 4 + 3))).toEqual([250, 200, 190]);
    // The black hair texel inside the chart is untouched.
    expect(Array.from(rgba.subarray(hair, hair + 3))).toEqual([0, 0, 0]);
    // Alpha-keyed mode would have found nothing to fill on this fully-opaque atlas.
    const again = new Uint8Array(w * h * 4).fill(255);
    expect(dilateAtlasRgba(again, w, h, { radius: 4 }).filled).toBe(0);
  });
});
