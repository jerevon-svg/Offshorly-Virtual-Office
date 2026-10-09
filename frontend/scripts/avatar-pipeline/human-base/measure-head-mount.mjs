// measure-head-mount.mjs — GROUP PROPORTION NORMALIZATION evidence (ZERO CREDITS): each production identity's anatomical
// face size against BON (the canonical head), hair-independent. The method the approved first five's HEAD_MOUNT
// (avatar/humanBody.ts) was set with on 2026-10-05: six measures on the optimised production head — cheek width, jaw
// width, eye-line width, chin→eye length, eye spacing, ear-root span — each relative to Bon, combined as a geometric
// mean ("face size vs Bon"). Suggested mount scale = 1 / faceSize, × 0.98 on the feminine body preset (its torso is ~4 %
// narrower); a suggestion, rounded and confirmed in the permanent lineup (human-base-lineup.html), never applied blind.
//   node scripts/avatar-pipeline/human-base/measure-head-mount.mjs [who …] [--feminine=a,b]   (default: every production head)
import fs from "node:fs";
import { io } from "./lib.mjs";
const DIR = "public/avatars/human-base-v1/production";
const POS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const who = POS.length ? POS : fs.readdirSync(DIR).filter((f) => f.endsWith("-v1.glb")).map((f) => f.replace("-v1.glb", ""));
// the feminine body-preset wearers (humanCatalogue *_AVATAR bodyPreset); --feminine=a,b overrides
const FEMININE = new Set((process.argv.find((a) => a.startsWith("--feminine="))?.slice(11) ?? "micah,clang,france,jona,nicole").split(","));
const measure = async (id) => {
  const r = (await io.read(`${DIR}/${id}-v1.glb`)).getRoot(), lm = r.listScenes()[0].getExtras().humanIdentity.landmarks, ey = lm.eyes.l[1];
  const P = r.listMeshes().find((m) => m.getName() === "identity_head").listPrimitives()[0].getAttribute("POSITION").getArray();
  const band = (y0, y1, zmin) => { let a = 9, b = -9; for (let i = 0; i < P.length; i += 3) if (P[i + 1] >= y0 && P[i + 1] <= y1 && P[i + 2] > zmin) { a = Math.min(a, P[i]); b = Math.max(b, P[i]); } return b - a; };
  return { cheekW: band(ey - 0.12, ey - 0.06, 0.15), jawW: band(0.9, 0.95, 0.15), eyeLineW: band(ey - 0.02, ey + 0.02, 0.15), faceLen: ey - 0.805, ipd: lm.eyes.r[0] - lm.eyes.l[0], earW: lm.attach.ears.r.root[0] - lm.attach.ears.l.root[0] };
};
const B = await measure("bon");
for (const id of ["bon", ...who.filter((w) => w !== "bon")]) {
  const o = await measure(id), rel = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +(v / B[k]).toFixed(3)]));
  const face = Math.exp(Object.values(rel).reduce((a, v) => a + Math.log(v), 0) / 6), fem = FEMININE.has(id);
  console.log(`${id.padEnd(7)} faceSize ${face.toFixed(3)} · suggested scale ${(id === "bon" ? 1 : (1 / face) * (fem ? 0.98 : 1)).toFixed(3)}${fem ? " (feminine ×0.98)" : ""} · rel ${JSON.stringify(rel)}`);
}
