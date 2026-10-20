// art-class.test.mjs — prep-reference tells flat-colour sprites from soft-shaded renders by measurement alone, and a soft full
// figure keeps only its head region. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/art-class.test.mjs
import { describe, expect, it } from "vitest";
import { SOFT_BELOW, artClass, keepLargestRegion } from "./art-class.mjs";

const px = (list) => Uint8Array.from(list.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));

describe("artClass", () => {
  it("reads flat-colour skin as flat and smooth gradients as soft", () => {
    const flat = px(Array.from({ length: 400 }, (_, i) => (i % 5 ? [250, 205, 180] : [200, 160, 140])));
    const soft = px(Array.from({ length: 400 }, (_, i) => [200 + (i % 50), 160 + ((i * 7) % 40), 130 + ((i * 3) % 30)]));
    expect(artClass(flat).soft).toBe(false);
    expect(artClass(flat).flatness).toBeGreaterThan(0.9);
    expect(artClass(soft).soft).toBe(true);
    expect(artClass(soft).flatness).toBeLessThan(SOFT_BELOW);
  });

  it("measures skin only — transparent and non-skin pixels never count; no skin keeps the flat path", () => {
    expect(artClass(px([[0, 0, 0, 0], [20, 20, 200], [250, 250, 250]]))).toEqual({ flatness: null, soft: false, skinPixels: 0 });
  });
});

describe("keepLargestRegion", () => {
  const W = 5, img = (rows) => px(rows.join("").split("").map((c) => (c === "#" ? [200, 150, 120, 255] : [0, 0, 0, 0])));

  it("clears every island above the cut and keeps the largest region", () => {
    const a = img(["##..#", "##...", ".....", "#...#"]);
    expect(keepLargestRegion(a, W, 3)).toBe(1);
    expect(a[4 * 4 + 3]).toBe(0);              // the island at row 0, column 4
    expect(a[3]).toBe(255);                    // the head region stays
    expect(a[3 * W * 4 + 3]).toBe(255);        // rows at or below the cut are never touched
  });

  it("a single region is left alone", () => {
    const a = img(["###..", ".#...", "....."]);
    expect(keepLargestRegion(a, W, 3)).toBe(0);
  });
});
