// vo3d POLISH PHASE 1 — the global visual foundation.
//
// These tests pin the four things the phase actually changed, and they run the REAL texture generator:
// jsdom has no 2D context, so the suite installs a minimal recording one first. Without it every map
// silently comes back null and the assertions below would pass against nothing.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import * as THREE from "three";
// Vite `?raw` — the same trick qa.test.ts and executive.test.ts use to assert on builder source text.
import qaSrc from "./build/qa.ts?raw";
import aiSrc from "./build/ai.ts?raw";
import devSrc from "./build/dev.ts?raw";
import cmsSrc from "./build/cms.ts?raw";
import gamingSrc from "./build/gaming.ts?raw";

type Rec = { w: number; h: number; data: Uint8ClampedArray };
const drawn: Rec[] = [];
let realCreate: typeof document.createElement;

beforeAll(() => {
  realCreate = document.createElement.bind(document);
  document.createElement = ((tag: string) => {
    const el = realCreate(tag) as HTMLCanvasElement;
    if (tag !== "canvas") return el;
    let rec: Rec | null = null;
    (el as unknown as { getContext: unknown }).getContext = () => ({
      canvas: el,
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img: { width: number; height: number; data: Uint8ClampedArray }) => {
        rec = { w: img.width, h: img.height, data: img.data };
        drawn.push(rec);
      },
      // the colour canvases in render/Materials draw with the 2D API rather than ImageData
      fillRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, arc: () => {},
      bezierCurveTo: () => {}, stroke: () => {}, fill: () => {},
      createRadialGradient: () => ({ addColorStop: () => {} }),
      set fillStyle(_v: string) {}, set strokeStyle(_v: string) {}, set lineWidth(_v: number) {},
    });
    Object.defineProperty(el, "__rec", { get: () => rec });
    return el;
  }) as typeof document.createElement;
});
afterAll(() => { document.createElement = realCreate; });

// imported AFTER the context shim is installed — the maps are built lazily on first use, not at import
const detail = await import("./render/detail");
const M = await import("./render/Materials");
const { buildFootprint } = await import("./build/floorplan");
const { groundFloor } = await import("./rooms/ground-floor");

function sample(t: THREE.Texture | null): Rec {
  expect(t).not.toBeNull();
  const rec = (t!.image as HTMLCanvasElement & { __rec: Rec }).__rec;
  expect(rec).toBeTruthy();
  return rec;
}
const lum = (r: Rec, x: number, y: number) => r.data[(y * r.w + x) * 4 + 1]; // three reads .g for data maps
const alpha = lum; // the contact maps are greyscale; alphaMap also reads .g

describe("vo3d polish 1 — shared procedural detail maps", () => {
  it("hands out ONE instance per map: a second caller gets the same texture, not a copy", () => {
    expect(detail.stoneDetail()).toBe(detail.stoneDetail());
    expect(detail.weaveDetail()).toBe(detail.weaveDetail());
    expect(detail.woodDetail("box")).toBe(detail.woodDetail("box"));
    expect(detail.metalDetail()).toBe(detail.metalDetail());
  });

  it("gives the two wood UV conventions their own transform off ONE canvas", () => {
    const box = detail.woodDetail("box")!, ext = detail.woodDetail("extrude")!;
    expect(ext).not.toBe(box);
    expect(ext.image).toBe(box.image); // same pixels: the clone exists only to carry a different repeat
    expect(ext.repeat.x).toBeLessThan(box.repeat.x); // world-unit UVs need a far smaller repeat
  });

  it("builds them as DATA maps, not colour: linear space, wrapping, mipmapped", () => {
    for (const t of [detail.stoneDetail()!, detail.weaveDetail()!, detail.woodDetail()!, detail.metalDetail()!]) {
      expect(t.colorSpace).toBe(THREE.NoColorSpace);
      expect(t.wrapS).toBe(THREE.RepeatWrapping);
      expect(t.wrapT).toBe(THREE.RepeatWrapping);
      expect(t.generateMipmaps).toBe(true);
    }
  });

  it("keeps every detail map SUBTLE — it modulates the approved roughness, it does not replace it", () => {
    for (const t of [detail.stoneDetail()!, detail.weaveDetail()!, detail.woodDetail()!]) {
      const r = sample(t);
      let lo = 255, hi = 0;
      for (let i = 1; i < r.data.length; i += 4) { lo = Math.min(lo, r.data[i]); hi = Math.max(hi, r.data[i]); }
      expect(lo).toBeGreaterThan(150); // never drives roughness below ~0.6 of the material's own value
      expect(hi - lo).toBeLessThan(90); // and never swings so far that the surface reads as two materials
    }
  });

  it("tiles seamlessly: the noise is periodic, so the wrap is just another interior step", () => {
    // The comparison has to be against the WHOLE image, not one interior column: the weave is a structured
    // pattern whose thread alternates every eight texels, so any single mid-cell column understates how
    // steep a normal step in it is. A seam that is no worse than the steepest interior step is a seam that
    // is not there.
    for (const t of [detail.stoneDetail()!, detail.weaveDetail()!, detail.woodDetail()!, detail.metalDetail()!]) {
      const r = sample(t);
      const steps: number[] = [];
      let seamU = 0, seamV = 0;
      for (let i = 0; i < r.h; i++) {
        seamU += Math.abs(lum(r, r.w - 1, i) - lum(r, 0, i));
        seamV += Math.abs(lum(r, i, r.h - 1) - lum(r, i, 0));
        for (let x = 0; x < r.w - 1; x++) steps.push(Math.abs(lum(r, x, i) - lum(r, x + 1, i)));
      }
      const worstInterior = Math.max(...steps);
      expect(seamU / r.h).toBeLessThanOrEqual(worstInterior);
      expect(seamV / r.h).toBeLessThanOrEqual(worstInterior);
    }
  });
});

describe("vo3d polish 1 — soft contact shadows", () => {
  it("falls off to nothing at the plate edge and stays solid under the piece", () => {
    for (const t of [detail.contactRoundAlpha()!, detail.contactRectAlpha()!]) {
      const r = sample(t);
      expect(alpha(r, r.w >> 1, r.h >> 1)).toBe(255);          // solid core: it still reads as contact
      expect(alpha(r, 0, r.h >> 1)).toBe(0);                    // gone at the edge: no decal border
      expect(alpha(r, r.w - 1, r.h >> 1)).toBeLessThan(4);      // the far texel centre sits just inside r=1
      const mid = alpha(r, Math.round(r.w * 0.9), r.h >> 1);   // and a real shoulder in between
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(255);
    }
    // clamped, not wrapped — a wrapped falloff would put a hard ring back on the plate edge
    expect(detail.contactRoundAlpha()!.wrapS).toBe(THREE.ClampToEdgeWrapping);
  });

  it("carries the falloff on the shared material and caches per opacity AND shape", () => {
    const rect = M.contactShadowMat(0.15), round = M.contactShadowMat(0.15, "round");
    expect(rect.alphaMap).toBe(detail.contactRectAlpha());
    expect(round.alphaMap).toBe(detail.contactRoundAlpha());
    expect(rect).not.toBe(round);
    expect(M.contactShadowMat(0.15)).toBe(rect); // same request, same material: no per-object explosion
    expect(rect.depthWrite).toBe(false);
    expect(rect.userData.floorLayer).toBe(M.FLOOR_LAYER.contact);
  });
});

describe("vo3d polish 1 — material hierarchy", () => {
  it("puts ONLY the declared metals above metalness 0", () => {
    expect(M.mat("execBrass", 0.4).metalness).toBeGreaterThan(0.3);
    expect(M.mat("bronze", 0.5).metalness).toBeGreaterThan(0.3);
    expect(M.mat("aiFrame", 0.4).metalness).toBeGreaterThan(0.3);
    for (const k of ["wall", "plaster", "floor", "green", "execWalnut", "cmsSofa"] as const) {
      expect(M.mat(k, 0.9).metalness).toBe(0);
    }
  });
  it("lets a builder that already stated a metalness keep it", () => {
    expect(M.mat("metal", 0.35, { metalness: 0.7 }).metalness).toBe(0.7);
    expect(M.mat("execBrass", 0.4, { metalness: 0 }).metalness).toBe(0);
  });
  it("gives metal a brushed roughness map", () => {
    expect(M.mat("execBrass", 0.4).roughnessMap).toBe(detail.metalDetail());
  });
  // THE SURFACE FAMILIES (V2 high-detail pass). `mat()` used to leave every dielectric's roughness bare,
  // which meant eleven room builders each asked for the same flat plaster. Two families now carry shared
  // maps — and, following the finding render/detail's stoneTint documents, an ALBEDO tint is half of each
  // pair, because on a big matt wall a roughness map alone measures as no change at all.
  it("gives every plaster wall the shared trowel tint AND its roughness map", () => {
    for (const k of ["wall", "wallFace", "plaster", "aiPlaster", "devPlaster", "cmsPlaster", "qaPlaster", "gamingPlaster"] as const) {
      const m = M.mat(k, 0.95);
      expect(m.map).toBe(detail.plasterTint());
      expect(m.roughnessMap).toBe(detail.plasterDetail());
      expect(m.roughness).toBe(0.95); // the approved scalar is the CEILING; the map only modulates it
    }
  });
  it("gives upright cast-stone masses the shared stone pair", () => {
    const m = M.mat("hubStone", 0.9);
    expect(m.map).toBe(detail.stoneTint());
    expect(m.roughnessMap).toBe(detail.stoneDetail());
  });
  it("leaves a dielectric OUTSIDE both families untouched, and lets a caller's own maps win", () => {
    const paint = M.mat("green", 0.9);
    expect(paint.map).toBeNull();
    expect(paint.roughnessMap).toBeNull();
    const own = M.mat("wall", 0.96, { roughnessMap: detail.metalDetail() ?? undefined });
    expect(own.roughnessMap).toBe(detail.metalDetail());
  });
  it("gives fabric a weave on BOTH roughness and bump — at roughness 0.98 the bump is what shows", () => {
    const f = M.fabric("green");
    expect(f.roughnessMap).toBe(detail.weaveDetail());
    expect(f.bumpMap).toBe(detail.weaveDetail());
    expect(f.bumpScale).toBeGreaterThan(0);
    expect(f.roughness).toBe(0.98); // the approved scalar is untouched; the map only modulates it
    expect(M.fabric("green")).toBe(f);
  });
  it("gives wood its pore map on top of the existing grain colour map", () => {
    expect(M.wood("box").roughnessMap).toBe(detail.woodDetail("box"));
    expect(M.wood("extrude").roughnessMap).toBe(detail.woodDetail("extrude"));
  });
  it("breaks up every floor surface with the ONE shared stone map", () => {
    expect(M.floorMat("exterior", 1).roughnessMap).toBe(detail.stoneDetail());
    expect(M.floorMat("exterior", 1).map).toBe(detail.stoneTint());
    expect(M.tileMat().roughnessMap).toBe(detail.stoneDetail());
    expect(M.tileMat().map).not.toBe(detail.stoneTint()); // the tile brings its own grout/mottle canvas
    expect(M.floorMat("exterior", 1)).toBe(M.floorMat("exterior", 1)); // shared, one material per key
    expect(M.floorMat("exterior", 1).color.getHex()).toBe(M.PALETTE.exterior); // colour identity untouched
  });

  it("keeps the floor TINT near white, so it modulates luminance and never the palette hue", () => {
    const t = detail.stoneTint()!;
    expect(t).toBe(detail.stoneTint());
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace); // it multiplies an albedo, so it IS colour
    const r = sample(t);
    let lo = 255, hi = 0, sum = 0, n = 0;
    for (let i = 0; i < r.data.length; i += 4) {
      const g = r.data[i + 1];
      lo = Math.min(lo, g); hi = Math.max(hi, g); sum += g; n++;
      expect(r.data[i]).toBe(g); // grey: R = G = B, so the map cannot shift a hue even in principle
      expect(r.data[i + 2]).toBe(g);
    }
    expect(sum / n).toBeGreaterThan(240);  // centred just under white: the floor keeps its measured tone
    expect(hi - lo).toBeLessThan(26);      // ±5% of full range at the very most — a mottle, not a pattern
  });
});

describe("vo3d polish 1 — the room floor tints actually multiply", () => {
  // three r185 REFUSES MultiplyBlending unless the material declares premultipliedAlpha: WebGLState logs
  // "MultiplyBlending requires material.premultipliedAlpha = true" and then falls out of the switch having
  // set NO blend function at all — so the plane drew with whatever blend state the previous draw happened
  // to leave bound. That is why the five room floor tints (QA mint, AI cool, Dev pale, CMS cool, Gaming
  // mood) painted a flat opaque wash over their tile instead of darkening it, and why the result depended
  // on draw order and therefore on the camera. Source-level, because the materials are builder-private.
  const sources: [string, string][] = [["qa", qaSrc], ["ai", aiSrc], ["dev", devSrc], ["cms", cmsSrc], ["gaming", gamingSrc]];
  it.each(sources)("%s's floor tint declares premultipliedAlpha next to MultiplyBlending", (_id, src) => {
    const uses = src.split("MultiplyBlending").length - 1;
    expect(uses).toBeGreaterThan(0);
    for (const chunk of src.split("blending: THREE.MultiplyBlending").slice(1)) {
      expect(chunk.slice(0, 120)).toContain("premultipliedAlpha: true");
    }
  });
});

describe("vo3d polish 1 — glass depth sorting", () => {
  it("stops glass writing depth, which is what made overlapping panes flip with the camera", () => {
    for (const g of [M.glassMat(), M.facadeGlassMat()]) {
      expect(g.transparent).toBe(true);
      expect(g.depthWrite).toBe(false);
      expect(g.depthTest).toBe(true); // it must still be hidden by opaque geometry in front of it
      expect(g.envMapIntensity).toBeGreaterThan(1.4);
    }
  });
});

describe("vo3d polish 1 — wall-to-floor intersection", () => {
  // Every room on the ground floor is reconstructed today, so buildFootprint only runs for a PLACEHOLDER.
  // The test therefore forces one: the change is to the placeholder path, and this is the only way to
  // exercise it until the next unreconstructed room arrives.
  const plan = groundFloor();
  const placeholder = { ...plan.rooms[0], reconstructed: false };
  const plateOf = (room: typeof placeholder) => {
    let box: THREE.Box3 | null = null;
    buildFootprint(room, plan).traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.position.y >= 0) return; // the plate is the only piece sitting below y 0
      m.geometry.computeBoundingBox();
      box = m.geometry.boundingBox!.clone().translate(m.position);
    });
    return box as THREE.Box3 | null;
  };

  it("runs the footprint plate UNDER its walls instead of butting it against their inner faces", () => {
    const r = placeholder.rect;
    const box = plateOf(placeholder);
    expect(box).not.toBeNull();
    // the old plate stopped a full wall thickness inside the rect on every side; it now reaches the rect,
    // so the plate's side face and the wall's inner face are no longer the same plane
    expect(box!.min.x).toBeCloseTo(r.x, 3);
    expect(box!.max.x).toBeCloseTo(r.x + r.w, 3);
    expect(box!.min.z).toBeCloseTo(r.z, 3);
    expect(box!.max.x - box!.min.x).toBeGreaterThan(r.w - 0.001);
  });

  it("still never lets a plate surface past the shared façade plane", () => {
    for (const room of plan.rooms) {
      const box = plateOf({ ...room, reconstructed: false });
      if (box) expect(box.max.z).toBeLessThanOrEqual(plan.facadeZ + 0.02);
    }
  });
});
