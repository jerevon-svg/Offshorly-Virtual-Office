// lid-leak.test.mjs — the LID-EDGE LEAK (2026-10-21): a closed lid must not show the head's own dark paint through a notch in the eye
// shell's top edge. The bake fix (chibify lidLeakReach) fills a dropout column's REACH from its neighbours only over dark paint; the
// atlas check (eye-shell-check lidLeakColumns) finds the defect on a finished head. From frontend/:
//   npx vitest run scripts/avatar-pipeline/human-base/lid-leak.test.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { LID_LEAK, lidLeakReach } from "./chibify.mjs";
import { lidLeakColumns, eyeAtlas } from "./eye-shell-check.mjs";
import { readIdentity } from "./failure-detectors.mjs";

const sharp = createRequire(`${process.cwd()}/package.json`)("sharp");
/** one eye's per-column measures: opening top at row 10, lash band 3 texels everywhere except `drop` columns */
function eye({ n = 40, drop = [], paint = () => 200 } = {}) {
  const LT = new Float32Array(n).fill(3), B0 = new Int16Array(n).fill(4), H0 = new Int16Array(n).fill(6);
  for (const x of drop) LT[x] = 0;
  return { LT, B0, H0, xa: 0, xz: n - 1, NY: 24, lum: paint };
}

describe("lidLeakReach — the bake's gated fill", () => {
  it("fills a dropout column's reach from its neighbours when the strip it leaves holds dark paint (the pinpoint dot)", () => {
    const e = eye({ drop: [20], paint: (x, y) => (x === 20 && y >= 11 && y <= 13 ? 30 : 200) }), { reach, filled } = lidLeakReach(e);
    expect(filled).toBe(1); expect(reach[20]).toBe(3);
    expect([...reach].filter((v, x) => x !== 20).every((v) => v === 3)).toBe(true);   // nothing else changes
  });
  it("leaves a dropout over skin-coloured paint alone (an invisible notch — no change, byte-identical heads)", () => {
    const { reach, filled } = lidLeakReach(eye({ drop: [20] })); expect(filled).toBe(0); expect(reach[20]).toBe(0);
  });
  it("never fills a one-sided taper (the eye's corners end on purpose) or a column only slightly thinner", () => {
    const e = eye({ paint: () => 30 }); e.LT.fill(3); for (let x = 34; x < 40; x++) e.LT[x] = 0;   // the outer corner tapers to nothing
    expect(lidLeakReach(e).filled).toBe(0);
    const f = eye({ paint: () => 30 }); f.LT[20] = 3 - (LID_LEAK.minGap - 1); expect(lidLeakReach(f).filled).toBe(0);
  });
  it("does nothing on an eye with no dropout", () => { expect(lidLeakReach(eye({ paint: () => 30 })).filled).toBe(0); });
});

describe("lidLeakColumns — the defect on finished heads", () => {
  // the D2 atlas fixture is an eye crop — local-only like the rest of fixtures/eye-box (skipped in a checkout without it)
  it.skipIf(!fs.existsSync("scripts/avatar-pipeline/human-base/fixtures/eye-box/esson-d2-prefix-eyes-atlas.webp"))("finds the leak on D2 as built before the fix (fixtures/eye-box/esson-d2-prefix-eyes-atlas.webp)", async () => {
    const { data, info } = await sharp("scripts/avatar-pipeline/human-base/fixtures/eye-box/esson-d2-prefix-eyes-atlas.webp").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cols = lidLeakColumns({ data, width: info.width, height: info.height }); expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) expect(c.want - c.have).toBeGreaterThanOrEqual(LID_LEAK.minGap);
  });
  for (const who of ["bon", "micah", "angelo", "clang", "france", "lui"]) it(`approved ${who}: no lid-edge leak`, async () => {
    const f = `public/avatars/human-base-v1/production/${who}-v1.glb`; expect(fs.existsSync(f)).toBe(true);
    expect(lidLeakColumns(await eyeAtlas(await readIdentity(f)))).toEqual([]);
  });
});
