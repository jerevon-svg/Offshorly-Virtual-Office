// eye-box-fit.test.mjs — the living-eye bake's EYE-BOX FIT detector (chibify irisOverflow, 2026-10-20): it fires ONLY when the iris is
// cut by the box border (a tall dark run between the lids that reaches eye white inward), never for an iris inside the box, a thin
// eyeliner wing at a corner, or dark hair beside the eye. Synthetic rasters only. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/eye-box-fit.test.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { EYE_BOX_FIT, irisOverflow } from "./chibify.mjs";

const SKIN = [232, 192, 162], WHITE = [246, 243, 240], IRIS = [24, 18, 16], LINER = [20, 16, 14];
/** a NX×NY bake raster: skin everywhere on the face (Z = 0), then the painter's strokes */
function raster(NX = 96, NY = 32) {
  const RGB = new Uint8Array(NX * NY * 3), Z = new Float32Array(NX * NY), HO = new Uint8Array(NX * NY);
  for (let k = 0; k < NX * NY; k++) RGB.set(SKIN, k * 3);
  const paint = (x0, x1, y0, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && x < NX && y >= 0 && y < NY) RGB.set(c, (y * NX + x) * 3); };
  return { NX, NY, RGB, Z, HO, paint };
}
const OPEN = [12, 20];   // the eye opening rows (9 rows tall)

describe("irisOverflow — the eye-box fit detector", () => {
  it("does not fire for an iris inside the box (white on both sides) — the approved heads' case", () => {
    const r = raster(); r.paint(14, 80, ...OPEN, WHITE); r.paint(38, 56, ...OPEN, IRIS);
    const o = irisOverflow(r); expect(o.left).toBe(false); expect(o.right).toBe(false); expect(o.opening).toBe(9);
  });

  it("fires on the side where the box ENDS INSIDE THE IRIS (natural narrow eye, iris in the inner corner)", () => {
    const r = raster(); r.paint(10, 95, ...OPEN, WHITE); r.paint(72, 95, ...OPEN, IRIS);   // the iris runs off the +x border
    const o = irisOverflow(r); expect(o.right).toBe(true); expect(o.left).toBe(false); expect(o.runs[1]).toBe(9);
  });

  it("keeps a legitimate eyeliner WING: a thin dark stroke reaching the border is not an iris", () => {
    const r = raster(); r.paint(14, 80, ...OPEN, WHITE); r.paint(40, 54, ...OPEN, IRIS);
    for (let x = 80; x < 96; x++) { const y = OPEN[1] + 1 + Math.floor((x - 80) / 4); r.paint(x, x, y, y + 1, LINER); }   // a 2-px flick rising out of the corner
    r.paint(78, 95, OPEN[1] + 1, OPEN[1] + 2, LINER);   // and the lash line it continues
    const o = irisOverflow(r); expect(o.right).toBe(false); expect(o.left).toBe(false);
  });

  it("ignores dark hair at the border that does not reach the eye white (skin between)", () => {
    const r = raster(); r.paint(20, 76, ...OPEN, WHITE); r.paint(40, 54, ...OPEN, IRIS); r.paint(0, 6, 0, 31, IRIS);   // a dark lock beside the eye
    expect(irisOverflow(r).left).toBe(false);
  });

  it("ignores pixels that are not face (hair standing off the face, beyond the silhouette)", () => {
    const r = raster(); r.paint(10, 95, ...OPEN, WHITE); r.paint(72, 95, ...OPEN, IRIS);
    for (let y = 0; y < r.NY; y++) for (let x = 90; x < 96; x++) r.HO[y * r.NX + x] = 1;   // the border columns are not face
    expect(irisOverflow(r).right).toBe(false);
  });

  it("is symmetric and fires on both borders when the iris overflows both (an eye too small for its box on both sides)", () => {
    const r = raster(); r.paint(0, 95, ...OPEN, IRIS); r.paint(30, 60, ...OPEN, WHITE); r.paint(0, 12, ...OPEN, IRIS); r.paint(84, 95, ...OPEN, IRIS);
    const o = irisOverflow(r); expect(o.left).toBe(true); expect(o.right).toBe(true);
  });

  it("widens in bounded steps only (the fit never exceeds ×2)", () => {
    expect(Math.max(...EYE_BOX_FIT.steps)).toBeLessThanOrEqual(2);
    expect(EYE_BOX_FIT.steps).toEqual([...EYE_BOX_FIT.steps].sort((a, b) => a - b));
  });
});

// REAL-DATA REGRESSION (fixtures/eye-box/: the unfitted bake raster of each eye, written by chibify with HB_EYEBOX_FIXTURES on the
// people's own raw heads — RGB = bake colour, alpha 255 face · 128 hair off the face · 0 no surface): the approved six and Kael's
// eyeliner wings never fire (their builds are byte-identical with and without the fit — eyebox-reg, 2026-10-20); Esson's natural
// eyes kept as made (--meshy-first) fire on the INNER corner of each eye
const sharp = createRequire(`${process.cwd()}/package.json`)("sharp"), FX = "scripts/avatar-pipeline/human-base/fixtures/eye-box/";   // run from frontend/
async function fixture(name) {
  const { data, info } = await sharp(`${FX}${name}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), NX = info.width, NY = info.height, N = NX * NY;
  const RGB = new Uint8Array(N * 3), Z = new Float32Array(N), HO = new Uint8Array(N);
  for (let k = 0; k < N; k++) { RGB[k * 3] = data[k * 4]; RGB[k * 3 + 1] = data[k * 4 + 1]; RGB[k * 3 + 2] = data[k * 4 + 2]; const a = data[k * 4 + 3]; Z[k] = a === 0 ? -9 : 0; HO[k] = a === 128 ? 1 : 0; }
  return { RGB, Z, HO, NX, NY };
}
// The fixtures are eye crops of employees' heads: kept LOCAL-ONLY (not in the public repository), so this block runs where they exist
// (the pipeline workstation, restorable from the company Drive backup) and is skipped in a checkout without them.
describe.skipIf(!fs.existsSync(FX))("irisOverflow on real heads (fixtures/eye-box)", () => {
  for (const who of ["bon", "micah", "angelo", "clang", "france", "lui", "kael", "esson-a"]) it(`${who}: never fires (box unchanged)`, async () => {
    for (const s of ["l", "r"]) { const o = irisOverflow(await fixture(`${who}-${s}`)); expect(o.left || o.right, `${who}-${s} ${JSON.stringify(o)}`).toBe(false); } });
  it("esson, natural eyes kept as made (--meshy-first): fires on the inner corner of each eye only", async () => {
    const l = irisOverflow(await fixture("esson-d-l")), r = irisOverflow(await fixture("esson-d-r"));   // l = the eye at −x: inner corner = its +x border
    expect([l.left, l.right, r.left, r.right]).toEqual([false, true, true, false]); });
  it("every fixture is present (the regression set is complete)", () => {
    for (const who of ["bon", "micah", "angelo", "clang", "france", "lui", "kael", "esson-a", "esson-d"]) for (const s of ["l", "r"]) expect(fs.existsSync(`${FX}${who}-${s}.png`), `${who}-${s}`).toBe(true); });
});
