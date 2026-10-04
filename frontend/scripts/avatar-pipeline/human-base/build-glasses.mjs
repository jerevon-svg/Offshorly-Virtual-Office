// build-glasses.mjs — a MODULAR glasses accessory fitted to an identity head's landmarks + surface. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-glasses.mjs <identity.glb> <style.json> <accessory-id>
//
// The STYLE is measured from the employee's approved illustration, in units of the illustration's eye separation
// (centre-to-centre), so it transfers to any head: lens half-size, lens offset from the eye, rim width, roundness,
// bridge height, frame colour. The FIT comes from the identity head: published eye landmarks set the scale and
// position; the head's own surface sets the lens plane (in front of the brows/nose/lashes) and the temple path along
// the side of the head. The frame is rigid on Head (no identity geometry is touched).
import fs from "node:fs";
import * as THREE from "three";
import sharp from "sharp";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { BASE_OUT, computeNormals, io, loadBase, weldNormals, writeModule } from "./lib.mjs";

const [idFile, styleFile, outId] = process.argv.slice(2);
const style = JSON.parse(fs.readFileSync(styleFile, "utf8"));
const doc = await io.read(idFile);
const lm = doc.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks;
const head = doc.getRoot().listMeshes().find((m) => m.getName() === "identity_head").listPrimitives()[0];
const HP = head.getAttribute("POSITION").getArray(), hn = HP.length / 3;
const sep = lm.eyes.r[0] - lm.eyes.l[0], ey = lm.eyes.r[1];
// EARS (where the temple arms end): the outermost SKIN-coloured points of the head near the eye line
const ears = await (async () => { const UVa = head.getAttribute("TEXCOORD_0")?.getArray(), tex = head.getMaterial()?.getBaseColorTexture(); if (!UVa || !tex) return null;
  const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = {}; for (const sx of [1, -1]) { let best = null;
    for (let i = 0; i < hn; i++) { const x = HP[i * 3] * sx, y = HP[i * 3 + 1]; if (x <= 0 || Math.abs(y - ey) > sep * 0.45) continue;
      const u = Math.min(info.width - 1, Math.round((UVa[i * 2] % 1) * (info.width - 1))), v = Math.min(info.height - 1, Math.round((UVa[i * 2 + 1] % 1) * (info.height - 1))), o = (v * info.width + u) * 3;
      const r = data[o], g = data[o + 1], b = data[o + 2]; if (!(r > b + 30 && 0.3 * r + 0.59 * g + 0.11 * b > 90)) continue;
      if (!best || x > best[0]) best = [x, y, HP[i * 3 + 2]]; }
    out[sx] = best; }
  // heads are fitted symmetric: one ear position, mirrored (a stray skin texel on one side cannot skew the frame)
  if (out[1] && out[-1]) { const m = [(out[1][0] + out[-1][0]) / 2, Math.min(out[1][1], out[-1][1]), (out[1][2] + out[-1][2]) / 2]; out[1] = m; out[-1] = m; }
  return out; })();
const U = (v) => v * sep;
// surface front z near (x, y): the head's most forward point within a small disc
const grid = new Map(), cell = 0.02, key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
for (let i = 0; i < hn; i++) { const k = key(HP[i * 3], HP[i * 3 + 1]); grid.set(k, Math.max(grid.get(k) ?? -9, HP[i * 3 + 2])); }
const frontZ = (x, y, r = 1) => { let m = -9; const cx = Math.floor(x / cell), cy = Math.floor(y / cell); for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) m = Math.max(m, grid.get(`${cx + dx},${cy + dy}`) ?? -9); return m; };
// side of the head at height y, depth z: the widest |x|
const side = (y, z) => { let m = 0; for (let i = 0; i < hn; i++) if (Math.abs(HP[i * 3 + 1] - y) < 0.015 && Math.abs(HP[i * 3 + 2] - z) < 0.015) m = Math.max(m, Math.abs(HP[i * 3])); return m; };

const S = style, hw = U(S.lens.halfW), hh = U(S.lens.halfH), rimW = U(S.rim.width), rimD = U(S.rim.depth ?? S.rim.width * 0.8);
const lensC = (sx) => [sx * (sep / 2 + U(S.lens.dx)), ey + U(S.lens.dy)];
// one lens plane for both lenses: in front of everything inside the lens areas (+ standoff), with a gentle wrap
let zPlane = -9; for (const sx of [1, -1]) { const [cx, cy] = lensC(sx); for (let a = 0; a < 1; a += 0.02) for (const r of [0, 0.5, 0.95]) zPlane = Math.max(zPlane, frontZ(cx + Math.cos(a * 2 * Math.PI) * hw * r, cy + Math.sin(a * 2 * Math.PI) * hh * r, 0)); }
zPlane += U(S.standoff);
const wrap = (x) => zPlane - S.wrap * Math.max(0, Math.abs(x) - sep * 0.3) ** 2 / sep;
const se = (t, e) => Math.sign(t) * Math.abs(t) ** (2 / e);
const P = [], I = [];
const addV = (x, y, z) => { P.push(x, y, z); return P.length / 3 - 1; };
const N = 160;
for (const sx of [1, -1]) {
  const [cx, cy] = lensC(sx);
  // superellipse rim: outer / inner outline × front / back face → a closed rectangular-section ring
  const ring = (inset, dz) => Array.from({ length: N }, (_, k) => { const a = (k / N) * 2 * Math.PI, x = cx + se(Math.cos(a), S.lens.roundness) * (hw - inset), y = cy + se(Math.sin(a), S.lens.roundness) * (hh - inset); return [x, y, wrap(x) + dz]; });
  const L = [ring(0, 0), ring(rimW, 0), ring(rimW, -rimD), ring(0, -rimD)].map((r) => r.map((p) => addV(...p)));
  for (let q = 0; q < 4; q++) { const A = L[q], B = L[(q + 1) % 4]; for (let k = 0; k < N; k++) { const k1 = (k + 1) % N; I.push(A[k], B[k], A[k1], A[k1], B[k], B[k1]); } }
}
// bridge: an arched bar between the two inner rim points
{ const yB = ey + U(S.bridge.dy), xa = sep / 2 + U(S.lens.dx) - hw + rimW * 0.5, M = 24, t = U(S.bridge.thick), bz = (x) => wrap(x) - rimD * 0.5 + U(S.bridge.arch) * 0;
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-xa, yB, bz(xa)), new THREE.Vector3(0, yB + U(S.bridge.arch), zPlane + U(0.01)), new THREE.Vector3(xa, yB, bz(xa))]);
  const b0 = P.length / 3, seg = 8; for (let k = 0; k <= M; k++) { const c = curve.getPointAt(k / M); for (let q = 0; q < seg; q++) { const a = (q / seg) * 2 * Math.PI; addV(c.x, c.y + Math.cos(a) * t, c.z + Math.sin(a) * t * 0.8); } }
  for (let k = 0; k < M; k++) for (let q = 0; q < seg; q++) { const a = b0 + k * seg + q, b = b0 + k * seg + (q + 1) % seg; I.push(a, a + seg, b, b, a + seg, b + seg); } }
// temples: from the outer rim edge back along the side of the head, just outside it
for (const sx of [1, -1]) {
  const [cx, cy] = lensC(sx), yT = cy + hh * S.temple.yFrac, x0 = cx + sx * (hw - rimW * 0.3), z0 = wrap(x0) - rimD * 0.5;
  const path = [new THREE.Vector3(x0, yT, z0)], ear = ears?.[sx];
  if (ear) {
    // toward the top of the ear: hug the side of the face (just outside it), then tuck in over the ear root
    const ez = ear[2] + 0.01, ey2 = Math.min(yT, ear[1] + sep * 0.12), xs = (z) => Math.max(ear[0] - 0.01, side(yT, z) + 0.008);
    for (let k = 1; k <= 4; k++) { const t = k / 5, z = z0 + (ez - z0) * t; path.push(new THREE.Vector3(sx * Math.min(Math.abs(x0), xs(z)) * (1 - 0.0 * t) + sx * 0, yT + (ey2 - yT) * t, z)); }
    path.push(new THREE.Vector3(sx * (ear[0] - 0.012), ey2, ez), new THREE.Vector3(sx * (ear[0] - 0.03), ey2 - sep * 0.05, ez - sep * 0.12));
  } else for (let z = z0 - 0.04; z > z0 - U(S.temple.length); z -= 0.03) path.push(new THREE.Vector3(sx * Math.max(Math.abs(x0) * 0.98, side(yT, z) + 0.012), yT - 0.004 * path.length, z));
  const curve = new THREE.CatmullRomCurve3(path), M = 40, seg = 8, b0 = P.length / 3, t = U(S.temple.thick);
  for (let k = 0; k <= M; k++) { const c = curve.getPointAt(k / M); for (let q = 0; q < seg; q++) { const a = (q / seg) * 2 * Math.PI; addV(c.x + Math.cos(a) * t * 0.6, c.y + Math.sin(a) * t, c.z); } }
  for (let k = 0; k < M; k++) for (let q = 0; q < seg; q++) { const a = b0 + k * seg + q, b = b0 + k * seg + (q + 1) % seg; I.push(a, a + seg, b, b, a + seg, b + seg); }
}
const base = await loadBase(), nv = P.length / 3, Pf = Float32Array.from(P);
const col = [1, 3, 5].map((k) => parseInt(S.colour.slice(k, k + 2), 16) / 255);
const bytes = await writeModule(`${BASE_OUT}/accessories/${outId}.glb`, base, [{ name: "glasses_frame", P: Pf, N: weldNormals(Pf, computeNormals(Pf, I)), I, COLOR: Array.from({ length: nv }, () => col).flat(),
  J: new Uint8Array(nv * 4).map((_, k) => (k % 4 === 0 ? base.JI.Head : 0)), W: new Float32Array(nv * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), material: { name: "glasses_frame", roughness: 0.35, doubleSided: true } }],
  { humanAccessory: { id: outId, slot: "glasses", base: C.HUMAN_BASE_VERSION, light: 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2] > 0.75, ears: ears ? [ears[1], ears[-1]] : null, fittedTo: idFile.split("/").pop(), style: styleFile.split("/").pop() } }, { compress: false });
console.log(`ears ${JSON.stringify(ears)}`);
console.log(`${outId}: ${I.length / 3} tris · ${(bytes / 1024).toFixed(0)} KB · eye sep ${sep.toFixed(3)} · lens ${(hw * 2).toFixed(3)}×${(hh * 2).toFixed(3)} · plane z ${zPlane.toFixed(3)}`);
