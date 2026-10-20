// underside-fold.test.mjs — the welded underside never folds: the collar leaves the weld along the skin's own outgoing direction (no
// fold back, no fin), a weld that would fold is refused (never forced), and the report-only shipped-file measure (FC-UNDERSIDE-FOLD)
// fires on the real folded weld it was built against. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/underside-fold.test.mjs
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { weldUnderside, tubeWall, weldFoldBacks } from "./underside-weld.mjs";
import { identityParts } from "./visibility.mjs";
import { REPORT_ONLY, REGISTRY, closureInMotion } from "./failure-registry.mjs";

const require = createRequire(import.meta.url), { NodeIO } = require("@gltf-transform/core"), { ALL_EXTENSIONS } = require("@gltf-transform/extensions"), draco3d = require("draco3dgltf");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
const NA = 72, eyeY = 1.15, iod = 0.36, tube = Array.from({ length: 36 }, (_, s) => { const t = ((s + 0.5) / 36) * 2 * Math.PI - Math.PI; return [0.1 * Math.cos(t), 0.1 * Math.sin(t)]; });
const neck = { cx: 0, cz: 0, wall: tubeWall(tube, 0, 0), y0: 0.8, y1: 1.05 }, at = (t, r, y) => [r * Math.cos(t), y, r * Math.sin(t)];
// a skin skirt: rings (r, y) top to bottom; the last is the open rim, zigzagging ± rJag in radius and ± yJag in height (a rim cut through
// generated geometry)
const skirt = (rings, yJag, rJag = 0) => { const P = []; rings.forEach(([r, y], k) => { const last = k === rings.length - 1; for (let i = 0; i < NA; i++) { const z = i % 2 ? 1 : -1; P.push(...at((2 * Math.PI * i) / NA, r + (last ? rJag * z : 0), y + (last ? yJag * z : 0))); } });
  const I = []; for (let k = 0; k + 1 < rings.length; k++) for (let i = 0; i < NA; i++) { const a = k * NA, b = (k + 1) * NA, j = (i + 1) % NA; I.push(a + i, a + j, b + i, a + j, b + j, b + i); } return { P: Float32Array.from(P), I }; };
const weld = (s, sheet) => weldUnderside({ parts: [{ name: "identity_head", P: s.P, I: s.I }], neck, sheet, eyeY, iod, headJoint: 3, colourOf: () => [0.8, 0.6, 0.5], hairColour: [0.1, 0.1, 0.1] });

describe("the welded underside never folds (underside-weld.mjs collar)", () => {
  // (the v15 construction, ear-clipping the rim itself, folded this one: 2 fold-backs, 34 fins, median crease 60°)
  it("a zigzag rim on a steep wall, hanging BELOW the canonical sheet: tangent-continuous, no fold back, no fin", () => {
    const r = weld(skirt([[0.32, 1.2], [0.31, 1.1], [0.3, 1.0]], 0.006, 0.008), (x, z) => (Math.hypot(x, z) > 0.5 ? NaN : 1.03 + 0.05 * (Math.hypot(x, z) - 0.1)));
    expect(r.info.reason).toBeUndefined(); expect(r.info.foldBacks).toBe(0); expect(r.info.fins).toBe(0); expect(r.info.crease.max).toBeLessThan(90); expect(r.info.crease.median).toBeLessThan(20);
  });
  it("a skin that flares out and up at its rim cannot be continued inward without folding: refused, never forced", () => {
    const r = weld(skirt([[0.32, 1.2], [0.31, 1.1], [0.36, 1.12]], 0), (x, z) => (Math.hypot(x, z) > 0.5 ? NaN : 0.98 + 0.05 * (Math.hypot(x, z) - 0.1)));
    expect(r.part).toBeNull(); expect(r.info.reason).toMatch(/fold|cross|face into/);
  });
});

describe("FC-UNDERSIDE-FOLD (weldFoldBacks, report-only)", () => {
  const measure = async (f) => weldFoldBacks(identityParts(await io.read(f)));
  it("fires on its fixture: the real v15 France weld folded back over the skin", async () => { const m = await measure("scripts/avatar-pipeline/human-base/fixtures/report-only/france-v15-underside-fold.glb");
    expect(m.weldEdges).toBeGreaterThan(100); expect(m.foldBacks).toBeGreaterThan(0); }, 120000);
  it("reads 0 where no welded underside exists (an approved head)", async () => { expect(await measure("public/avatars/human-base-v1/production/bon-v1.glb")).toEqual({ weldEdges: 0, foldBacks: 0, crease: null, fins: 0 }); }, 120000);
  it("is report-only: never a blocking class", () => { expect(REPORT_ONLY.some((d) => d.id === "FC-UNDERSIDE-FOLD")).toBe(true); expect(REGISTRY.some((d) => d.id === "FC-UNDERSIDE-FOLD")).toBe(false); });
  it("hair through the underside stays report-only; the nape closure in motion is BLOCKING (2026-10-12); every report-only class names its evidence source", () => {
    const d = REPORT_ONLY.find((x) => x.id === "FC-HAIR-THROUGH-UNDERSIDE"); expect(d?.source).toBe("mounted"); expect(REGISTRY.some((x) => x.id === "FC-HAIR-THROUGH-UNDERSIDE")).toBe(false);
    for (const x of REPORT_ONLY) expect(["artifact", "mounted", "record"], x.id).toContain(x.source);
    const c = REGISTRY.find((x) => x.id === "FC-CLOSURE-EXPOSED-IN-MOTION"); expect(c?.source).toBe("mounted"); expect(REPORT_ONLY.some((x) => x.id === c.id)).toBe(false); expect(c.grandfather).toBe(true);
    const ev = (motion) => ({ mounted: { motion } }), m = closureInMotion(ev({ walk0: { pct: 7.1, worstPct: 16.8, worstView: "lowRear" }, bind: { pct: 0.5, worstPct: 2, worstView: "under" } }));
    expect(m).toEqual({ pct: 7.1, worstPct: 16.8, at: "walk0/lowRear" }); expect(c.validate(ev({ walk0: { pct: 7.1, worstPct: 16.8, worstView: "lowRear" } })).pass).toBe(false);
    expect(c.validate(ev({ walk0: { pct: 0.5, worstPct: 2.4, worstView: "under" } })).pass).toBe(true); expect(() => c.validate({ mounted: {} })).toThrow(/no motion evidence/);
  });
});
