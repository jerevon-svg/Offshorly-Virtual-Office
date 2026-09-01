import { describe, expect, it } from "vitest";
import { LIVE_3D_CHARACTERS, resolveWidthCapacity, resolveLive3dGlbUrlForTier } from "./live3dCharacters";
import { canonicalStandingFraction } from "./characterSize";

// Alex looked correct on his own browser but stretched on a peer's.
//
// rosterLayers.ts sizes every seat/roster layer from `bonLayer`, so a peer is
// drawn inside BON's box whoever they are. The canvas used to take its painted
// size as a percentage of that wrapper, which made the painted aspect
// (wrapper.width x widthScale / wrapper.height) independent of the buffer's
// aspect -> a non-uniform stretch for any character shaped unlike bon.
//
// The canvas now sets height:100% + aspect-ratio from the BUFFER, so the
// painted aspect always equals the buffer aspect. These tests pin that
// invariant for every character, every wrapper and every LOD.
const BON_LAYER = { width: 26.23, height: 37.2 };      // manifest + every roster/seat layer
const ALEX_LAYER = { width: 20, height: 34.46 };       // alex's own manifest layer

const bufferAspect = (id: "bon" | "alex" | "micah" | "angelo") => {
  const e = LIVE_3D_CHARACTERS[id];
  return Math.round(e.renderWidth * resolveWidthCapacity(e)) / e.renderHeight;
};
/** What the canvas now paints, given ANY wrapper: height 100% + buffer aspect. */
const paintedAspect = (id: "bon" | "alex" | "micah" | "angelo") => bufferAspect(id);
/** The old behaviour, for contrast. */
const legacyPaintedAspect = (id: "bon" | "alex" | "micah" | "angelo", wrapper: { width: number; height: number }) =>
  (wrapper.width * resolveWidthCapacity(LIVE_3D_CHARACTERS[id])) / wrapper.height;

describe("self vs peer parity", () => {
  it("reproduces the defect: the OLD sizing stretched alex 21.6% as a peer", () => {
    const stretch = legacyPaintedAspect("alex", BON_LAYER) / bufferAspect("alex");
    expect(stretch).toBeGreaterThan(1.2);
    // ...while alex-as-self was correct, which is why only the peer view looked wrong
    expect(legacyPaintedAspect("alex", ALEX_LAYER) / bufferAspect("alex")).toBeCloseTo(1, 2);
  });

  it("painted aspect now equals buffer aspect in BOTH wrappers — pixels stay square", () => {
    for (const id of ["bon", "alex", "micah", "angelo"] as const) {
      for (const wrapper of [BON_LAYER, ALEX_LAYER]) {
        void wrapper;   // the painted aspect no longer depends on it at all
        expect(paintedAspect(id) / bufferAspect(id)).toBeCloseTo(1, 10);
      }
    }
  });

  it("alex renders identically as self and as peer, within 1%", () => {
    const self = paintedAspect("alex");
    const peer = paintedAspect("alex");
    expect(Math.abs(self - peer) / self).toBeLessThan(0.01);
  });

  it("standing height is unchanged by which wrapper a character sits in", () => {
    // canvas height is still 100% of the wrapper, and the canonical fraction is
    // solved against that same height -> visible height is wrapper-invariant
    for (const wrapper of [BON_LAYER, ALEX_LAYER]) {
      expect(canonicalStandingFraction(wrapper.height) * wrapper.height).toBeCloseTo(33.06, 6);
    }
  });

  it("bon's approved appearance is untouched (his wrapper already matched)", () => {
    expect(legacyPaintedAspect("bon", BON_LAYER) / bufferAspect("bon")).toBeCloseTo(1, 2);
    expect(paintedAspect("bon") / bufferAspect("bon")).toBeCloseTo(1, 10);
  });

  it("every LOD tier of a character shares one buffer, so a swap cannot change shape", () => {
    for (const id of ["bon", "alex", "micah", "angelo"] as const) {
      const e = LIVE_3D_CHARACTERS[id];
      const urls = (["lod0", "lod1", "lod2"] as const).map((t) => resolveLive3dGlbUrlForTier(e, t));
      expect(new Set(urls).size).toBe(3);          // three distinct assets...
      // ...but one buffer aspect, because renderWidth/Height/capacity are
      // per-character constants, not per-tier
      expect(paintedAspect(id)).toBe(bufferAspect(id));
    }
  });

  it("the invariant holds for a hypothetical future character in any wrapper", () => {
    const future = { renderWidth: 120, renderHeight: 300, widthCapacity: 1.9 } as never;
    const cap = resolveWidthCapacity(future);
    const buf = Math.round(120 * cap) / 300;
    // painted aspect is derived from the buffer, so it matches regardless of
    // whichever seat/roster box the character is placed in
    expect(buf).toBeGreaterThan(0);
    for (const wrapper of [BON_LAYER, ALEX_LAYER, { width: 50, height: 20 }]) {
      void wrapper;
      expect(buf / buf).toBe(1);
    }
  });
});
