import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
// @ts-expect-error - draco3dgltf ships no type declarations
import draco3d from "draco3dgltf";
import { canonicalStandingFraction, canonicalTop } from "./characterSize";

// Regression cover for the live "giant cropped rectangle" failure. The
// synthetic rig used by characterFraming.test.ts has no Armature, so it could
// not catch Meshy's real export convention: an `Armature` node scaled 0.01
// whose skinned POSITION data is ALREADY at final world scale. Multiplying
// geometry.boundingBox by mesh.matrixWorld therefore applied that 0.01 twice
// (1.70 -> 0.0170) and collapsed the orthographic zoom ~100x.
//
// These assertions read the REAL shipped GLBs.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });

const ASSETS = {
  bon: "public/avatars/bon-v3-hq/bon-v3",
  alex: "public/avatars/alex-v2-hq/alex-v2",
  micah: "public/avatars/micah-v5-hq/micah-v5",
  angelo: "public/avatars/gelo-v1-hq/gelo-v1",
};
const LAYER_HEIGHT = { bon: 37.2, alex: 34.46, micah: 39.1, angelo: 39.85 };

async function meshBounds(file: string) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute("POSITION")!;
  const min = pos.getMin([] as unknown as number[]) as unknown as number[];
  const max = pos.getMax([] as unknown as number[]) as unknown as number[];
  // the Armature node's scale, as exported by Meshy
  let armatureScale: number | null = null;
  for (const node of root.listNodes()) {
    const s = node.getScale();
    if (Math.abs(s[0] - 1) > 1e-6) armatureScale = s[0];
  }
  return { height: max[1] - min[1], width: max[0] - min[0], armatureScale };
}

describe("real Meshy assets — Armature scale convention", () => {
  it("every shipped rig is exported under an Armature scaled 0.01", async () => {
    for (const base of Object.values(ASSETS)) {
      const b = await meshBounds(`${base}-lod0.glb`);
      expect(b.armatureScale).toBeCloseTo(0.01, 6);
    }
  });

  it("skinned POSITION data is already at final world scale (~1.70 tall)", async () => {
    for (const base of Object.values(ASSETS)) {
      const b = await meshBounds(`${base}-lod0.glb`);
      expect(b.height).toBeGreaterThan(1.5);
      expect(b.height).toBeLessThan(2.0);
    }
  });

  it("applying the Armature scale a second time is the ~100x error that broke framing", async () => {
    const b = await meshBounds(`${ASSETS.bon}-lod0.glb`);
    const doubleScaled = b.height * (b.armatureScale ?? 1);
    expect(doubleScaled).toBeLessThan(0.02);
    // a standing box that small drives the canonical solve to a ~100x zoom-in
    const bogusTop = canonicalTop(1, doubleScaled / (b.height / 1), LAYER_HEIGHT.bon);
    expect(bogusTop).toBeLessThan(0.05);
  });

  it("every character is the same modelled height, so equal visible height is achievable", async () => {
    const bon = await meshBounds(`${ASSETS.bon}-lod0.glb`);
    for (const key of ["alex", "micah", "angelo"] as const) {
      const other = await meshBounds(`${ASSETS[key]}-lod0.glb`);
      expect(Math.abs(bon.height - other.height) / bon.height).toBeLessThan(0.02);
    }
  });

  it("every LOD tier of a character has the same modelled height (LOD never changes size)", async () => {
    for (const base of Object.values(ASSETS)) {
      const hs = [] as number[];
      for (const tier of ["lod0", "lod1", "lod2"]) hs.push((await meshBounds(`${base}-${tier}.glb`)).height);
      const spread = (Math.max(...hs) - Math.min(...hs)) / Math.max(...hs);
      expect(spread).toBeLessThan(0.02);
    }
  });

  it("the canonical rule equalizes bon and alex within 2%, preserving bon's approved height", () => {
    // proxy standing fractions measured off the real GLBs with the app's own
    // framing code (see the offline harness in the task report)
    const BON = { solvedTop: 1.0368, proxyFraction: 0.8922 };
    const ALEX = { solvedTop: 1.3672, proxyFraction: 0.6847 };
    const bonTop = canonicalTop(BON.solvedTop, BON.proxyFraction, LAYER_HEIGHT.bon);
    const alexTop = canonicalTop(ALEX.solvedTop, ALEX.proxyFraction, LAYER_HEIGHT.alex);
    // bon barely moves from his approved framing
    expect(Math.abs(bonTop - BON.solvedTop) / BON.solvedTop).toBeLessThan(0.02);
    // alex zooms IN (his old top was too large, so he rendered short)
    expect(alexTop).toBeLessThan(ALEX.solvedTop);
    // and neither lands anywhere near the collapsed-zoom regression
    expect(bonTop).toBeGreaterThan(0.5);
    expect(alexTop).toBeGreaterThan(0.5);
  });

  it("every registered employee lands on the SAME canonical visible standing height", () => {
    // visible height (frame units) = canonicalStandingFraction(layerHeight) x
    // layerHeight, which equals CANONICAL_STANDING_FRAME_UNITS for every
    // character whose layer is tall enough not to hit the 1.02 ceiling.
    // Angelo's layer used to be 31.323, which DID hit the ceiling and left him
    // 3.4% short; his and micah's layers are now calibrated so all four match.
    const heights = Object.entries(LAYER_HEIGHT).map(([, lh]) => canonicalStandingFraction(lh) * lh);
    const min = Math.min(...heights), max = Math.max(...heights);
    expect((max - min) / max).toBeLessThan(0.02);
  });

  it("the canonical fraction never exceeds the headroom ceiling", () => {
    for (const lh of Object.values(LAYER_HEIGHT)) {
      expect(canonicalStandingFraction(lh)).toBeLessThanOrEqual(1.02);
    }
  });
});
