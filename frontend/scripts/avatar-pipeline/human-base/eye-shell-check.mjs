// eye-shell-check.mjs — LID-EDGE LEAK check on a FINISHED identity's living-eye atlas (2026-10-21). A closing lid covers exactly the
// shell; where the shell's top edge dips below BOTH neighbours (within `window` columns) by ≥ `minGap` texels and the dip holds DARK
// baked paint, a closed eye shows that paint through the notch (a pinpoint dot). Reads the atlas exactly as bakedEyeMaterial does:
// glTF rows (flipY false), page 1 = the two eye boxes with coded alpha (≥ 2 = shell), the bottom 9 rows = per-column data (B, H).
// Report-only helper (eye-box-fit.test.mjs); the bake's own fix is chibify lidLeakReach.
import { createRequire } from "node:module";
const sharp = createRequire(`${process.cwd()}/package.json`)("sharp");

/** columns of the atlas whose shell top is notched over dark paint — [] when the closed lid is whole */
export function lidLeakColumns({ data, width: W, height: Hh }, { window = 6, minGap = 2, dark = 100 } = {}) {
  const rows = Hh - 9, NX1 = W / 6, a = (x, y) => data[(y * W + x) * 4 + 3], lum = (x, y) => { const i = (y * W + x) * 4; return 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]; };
  const out = [];
  for (let side = 0; side < 2; side++) {
    const x0 = side * NX1, top = [], shell = [];
    for (let x = x0; x < x0 + NX1; x++) { const B = a(x, rows) + a(x, rows + 1) / 255, H = a(x, rows + 2) + a(x, rows + 3) / 255; let s = -1; for (let y = 0; y < rows; y++) if (a(x, y) >= 2) s = y; top.push(H >= 0.5 ? Math.round(B + H) : -1); shell.push(s); }
    for (let i = 0; i < NX1; i++) { if (top[i] < 0 || shell[i] < 0) continue; const reach = (j) => (top[j] >= 0 && shell[j] >= 0 ? shell[j] - top[j] : -1);
      let l = -1, r = -1; for (let d = 1; d <= window; d++) { if (i - d >= 0) l = Math.max(l, reach(i - d)); if (i + d < NX1) r = Math.max(r, reach(i + d)); }
      const want = Math.min(l, r), have = reach(i); if (want < 0 || want < have + minGap) continue;
      for (let y = shell[i] + 1; y <= Math.min(rows - 1, top[i] + want); y++) if (lum(x0 + i, y) < dark) { out.push({ side, x: i, have, want }); break; } }
  }
  return out;
}

/** the face_eyes atlas of an identity GLB, decoded (RGBA) */
export async function eyeAtlas(doc) {
  const t = doc.getRoot().listMaterials().find((m) => m.getName() === "face_eyes")?.getBaseColorTexture(); if (!t) return null;
  const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, width: info.width, height: info.height };
}
