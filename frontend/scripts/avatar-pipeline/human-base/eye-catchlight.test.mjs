// eye-catchlight.test.mjs — the missing-catchlight polish fires only on an iris without a highlight, never on the approved five
// (France's small sparkle included), and only paints visible-iris pixels. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/eye-catchlight.test.mjs
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { CATCHLIGHT, catchlightPolish, irisHighlight } from "./eye-catchlight.mjs";
const sharp = createRequire(`${process.cwd()}/package.json`)("sharp");

/** a synthetic eye panel: sclera (8) with a dark iris disc (9) of radius R, optional bright spot of radius s at (dx, dy) */
const eye = (NX, NY, R, spot = null) => { const img = Buffer.alloc(NX * NY * 4), cx = NX / 2, cy = NY / 2;
  for (let k = 0; k < NX * NY; k++) { const x = k % NX, y = (k / NX) | 0, inI = Math.hypot(x - cx, y - cy) <= R; img.set(inI ? [20, 14, 10, 9] : [235, 232, 228, 8], k * 4);
    if (inI && spot && Math.hypot(x - cx - spot.dx, y - cy - spot.dy) <= spot.s) img.set([250, 250, 250], k * 4); }
  return img; };

describe("missing catchlight polish (eye-catchlight.mjs)", () => {
  it("paints ONE soft highlight on an iris that has none — iris pixels only, alpha codes untouched", () => {
    const img = eye(160, 120, 34), a0 = Buffer.from(img.filter((_, i) => i % 4 === 3)), r = catchlightPolish(img, 160, 120);
    expect(r.before).toBe(0); expect(r.added).toBe(true); expect(r.after).toBeGreaterThan(CATCHLIGHT.missingBelow); expect(r.after).toBeLessThan(0.06);   // subtle: France-level, not a glare
    expect(Buffer.from(img.filter((_, i) => i % 4 === 3)).equals(a0)).toBe(true);
    for (let k = 0; k < 160 * 120; k++) if (img[k * 4 + 3] === 8) expect(img[k * 4]).toBe(235); });
  it("leaves an iris with a highlight byte-identical — even France's small sparkle (≈ 3 %)", () => {
    for (const spot of [{ dx: 10, dy: 7, s: 6 }, { dx: 8, dy: 16, s: 5 }]) { const img = eye(160, 120, 34, spot), b = Buffer.from(img), r = catchlightPolish(img, 160, 120);
      expect(r.added).toBe(false); expect(img.equals(b)).toBe(true); expect(r.before).toBeGreaterThan(CATCHLIGHT.missingBelow); } });
  it("an eye with no visible iris is never painted", () => { const img = Buffer.alloc(64 * 64 * 4).fill(8), r = catchlightPolish(img, 64, 64); expect(r.before).toBe(null); expect(r.added).toBe(false); });

  // the shipped eye atlases: the approved five must read as HAVING a highlight; Kael / Jona (before the rule) must read missing
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const eyesOf = async (f) => { io.registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() }); const t = (await io.read(f)).getRoot().listTextures().find((x) => x.getName() === "face_eyes_tex");
    const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), NX = info.width / 6, NY = info.height - 9;
    return [0, 1].map((side) => { const img = Buffer.alloc(NX * NY * 4); for (let y = 0; y < NY; y++) data.copy(img, y * NX * 4, (y * info.width + side * NX) * 4, (y * info.width + side * NX + NX) * 4); return { img, NX, NY }; }); };
  const P = "public/avatars/human-base-v1/production";
  for (const who of ["bon", "micah", "angelo", "clang", "france"]) it(`${who} (approved): both eyes already have a highlight — never touched`, async () => {
    for (const e of await eyesOf(`${P}/${who}-v1.glb`)) { const b = Buffer.from(e.img), r = catchlightPolish(e.img, e.NX, e.NY); expect(r.before).toBeGreaterThan(0.02); expect(r.added).toBe(false); expect(e.img.equals(b)).toBe(true); } }, 60000);
  const C = "scripts/avatar-pipeline/output/human-base/candidates";
  for (const [who, f] of [["kael", `${C}/kael/base-v3-pass3/kael-v1.glb`], ["jona", `${C}/jona/base-v3-pass2/jona-v1.glb`]]) it.skipIf(!fs.existsSync(f))(`${who} (built before the rule): read as missing → gets a subtle highlight`, async () => {
    for (const e of await eyesOf(f)) { const r = catchlightPolish(e.img, e.NX, e.NY); expect(r.before).toBeLessThan(CATCHLIGHT.missingBelow); expect(r.added).toBe(true); expect(irisHighlight(e.img, e.NX, e.NY).frac).toBeGreaterThan(CATCHLIGHT.missingBelow); } }, 60000);
});
