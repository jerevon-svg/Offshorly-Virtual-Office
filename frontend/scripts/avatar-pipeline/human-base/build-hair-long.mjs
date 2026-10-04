// build-hair-long.mjs — BON, LONGER: his own hair on top + a sculpted under-layer that falls further. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-hair-long.mjs        (from frontend/; after build-bon-identity)
//
// Bon's recognisable hair (the fringe, the crown clumps) is kept exactly. Underneath it a second layer of chunky
// chibi clumps is grown around the back and sides of the head: it hugs the head (the identity head + its scalp,
// ears included) from inside the original hair, then FALLS — below the skull's widest line it hangs instead of
// following the head inward — to a longer hem: the nape at y 0.79 (Bon's own hair stops at 0.90), behind the ears
// 0.86, over the ears 0.93 (the top of the ear covered), the sideburns 1.02. The hem is cut into tapered tips.
//
// THE LIMIT, measured: the chibi head sits ON the shoulders (the head's underside is at the shoulder line), so
// anything longer than the nape meets the shoulders / a hood the moment the head turns. This layer is therefore
// RIGID on Head and stops at the nape: the longest length that stays clean in every shared clip. Shoulder-length
// hair needs skinned (neck/spine-weighted) hair with collision against the top garment — a later hair class.
import * as THREE from "three";
import fs from "node:fs";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { BASE_OUT, computeNormals, io, loadBase, smooth, weldNormals, writeModule } from "./lib.mjs";

const base = await loadBase();
const work = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/output/human-base/bon-hair-work.json", "utf8"));
const headDoc = await io.read(`${BASE_OUT}/identity/bon/head.glb`);
const headPrim = headDoc.getRoot().listMeshes().find((m) => m.getName() === "identity_head").listPrimitives()[0];
const HP = headPrim.getAttribute("POSITION").getArray();
const AXZ = -0.01;
const theta = (x, z) => Math.atan2(x, z - AXZ), rad = (x, z) => Math.hypot(x, z - AXZ);

// ---- the head's radius map (identity head + scalp + ears) and the original hair's ------------------------
const NT = 180, TH_STEP = (2 * Math.PI) / NT, Y0 = 0.74, NY = 120, Y_STEP = 0.006;
const bin = (x, y, z) => { const t = Math.floor(((theta(x, z) + Math.PI) / TH_STEP)) % NT, j = Math.floor((y - Y0) / Y_STEP); return j < 0 || j >= NY ? -1 : j * NT + t; };
const Rhead = new Float32Array(NT * NY).fill(0), Rhair = new Float32Array(NT * NY).fill(0);
for (let i = 0; i < HP.length / 3; i++) { const k = bin(HP[i * 3], HP[i * 3 + 1], HP[i * 3 + 2]); if (k >= 0) Rhead[k] = Math.max(Rhead[k], rad(HP[i * 3], HP[i * 3 + 2])); }
const OH = work.hair.P;
for (let i = 0; i < OH.length / 3; i++) { const k = bin(OH[i * 3], OH[i * 3 + 1], OH[i * 3 + 2]); if (k >= 0) Rhair[k] = Math.max(Rhair[k], rad(OH[i * 3], OH[i * 3 + 2])); }
// fill empty head bins from their neighbours in θ (a bin can miss a sample at this density)
for (let pass = 0; pass < 6; pass++) for (let j = 0; j < NY; j++) for (let t = 0; t < NT; t++) {
  const k = j * NT + t; if (Rhead[k] > 0) continue;
  const a = Rhead[j * NT + (t + 1) % NT], b = Rhead[j * NT + (t + NT - 1) % NT]; if (a > 0 || b > 0) Rhead[k] = Math.max(a, b);
}
const headR = (th, y) => { const t = Math.floor((th + Math.PI) / TH_STEP) % NT, j = Math.max(0, Math.min(NY - 1, Math.floor((y - Y0) / Y_STEP))); let r = 0; for (let d = -1; d <= 1; d++) r = Math.max(r, Rhead[j * NT + (t + d + NT) % NT]); return r; };

const hairR = (th, y) => { const t = Math.floor((th + Math.PI) / TH_STEP) % NT, j = Math.max(0, Math.min(NY - 1, Math.floor((y - Y0) / Y_STEP))); let r = 9; let any = false; for (let d = -1; d <= 1; d++) { const v = Rhair[j * NT + (t + d + NT) % NT]; if (v > 0) { any = true; r = Math.min(r, v); } } return any ? r : 0; };

// ---- the layer ---------------------------------------------------------------------------------------------
const deg = Math.PI / 180;
const TH_A = 104 * deg;           // front edge of the layer on each side (just behind the ear: the ears stay visible)
/** design hem by |θ| (degrees) — linear between the knots */
const HEM = [[104, 0.9], [118, 0.86], [138, 0.82], [160, 0.795], [180, 0.79]];
const hemAt = (th) => { const a = Math.abs(th) / deg; for (let k = 0; k < HEM.length - 1; k++) { const [a0, y0] = HEM[k], [a1, y1] = HEM[k + 1]; if (a <= a1) return y0 + (y1 - y0) * smooth(a0, a1, a); } return 0.8; };
const CLUMP_W = 17 * deg, TIP = 0.05, THICK = 0.02, LIFT = 0.008;
const clumpPhase = (th) => ((th - TH_A) / CLUMP_W) % 1;
/** 0 between clumps, 1 at a clump's centre — the tips taper to points */
const clump = (th) => { const f = clumpPhase(th < TH_A ? th + 2 * Math.PI : th); const tri = 1 - Math.abs(f * 2 - 1); return Math.pow(tri, 1.6); };
const COLS = 150, ROWS = 34;
const outer = [], inner = [];
for (let c = 0; c <= COLS; c++) {
  // around the back: θ from +62° through 180° to −62°
  const th = TH_A + (c / COLS) * (2 * Math.PI - 2 * TH_A);
  const thW = th > Math.PI ? th - 2 * Math.PI : th;
  const cl = clump(th);
  const hem = hemAt(thW) - TIP * cl;
  const yTop = Math.min(1.25, hemAt(thW) + 0.2);
  // the edge clumps at the front taper the layer's thickness to nothing so its side edge tucks under
  const edge = smooth(0, 0.06, Math.min(c, COLS - c) / COLS);
  let rPrev = 0;
  const colO = [], colI = [];
  for (let r = 0; r <= ROWS; r++) {
    const u = r / ROWS, y = yTop + (hem - yTop) * u;
    // hug: just outside the head here; fall: never closer to the axis than the row above minus a gentle taper
    let rr = headR(thW, y) + LIFT;
    // the back of the skull curves into the nape: follow it, but never faster than hair would bend
    if (r > 0) rr = Math.max(rr, rPrev - 0.6 * (yTop - hem) / ROWS);
    rPrev = rr;
    // clump relief across the layer, strongest toward the hem; tips pinch in
    const relief = 0.006 * Math.cos(((clumpPhase(th) * 2 - 1) * Math.PI)) * smooth(0.2, 0.9, u);
    const tipPinch = 1 - 0.55 * smooth(0.8, 1.0, u) * (1 - cl);
    let ro = rr + relief + THICK * edge * tipPinch * (0.55 + 0.45 * u);
    // wherever Bon's own hair exists the layer stays UNDER it (no ledge), it only shows below his hem
    const own = hairR(thW, y); if (own > 0) { ro = Math.min(ro, Math.max(rr + 0.004, own - 0.012)); }
    colO.push([Math.sin(thW) * ro, y, AXZ + Math.cos(thW) * ro]);
    colI.push([Math.sin(thW) * rr, y, AXZ + Math.cos(thW) * rr]);
  }
  outer.push(colO); inner.push(colI);
}
const P = [], I = [];
const grid = (cols, flip) => {
  const base0 = P.length / 3;
  for (const col of cols) for (const p of col) P.push(...p);
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    const a = base0 + c * (ROWS + 1) + r, b = a + ROWS + 1, a1 = a + 1, b1 = b + 1;
    if (flip) I.push(a, a1, b, b, a1, b1); else I.push(a, b, a1, b, b1, a1);
  }
  return base0;
};
const oBase = grid(outer, false), iBase = grid(inner, true);
// close the hem and the two front edges so the layer has visible thickness
for (let c = 0; c < COLS; c++) { const r = ROWS; const a = oBase + c * (ROWS + 1) + r, b = oBase + (c + 1) * (ROWS + 1) + r, ai = iBase + c * (ROWS + 1) + r, bi = iBase + (c + 1) * (ROWS + 1) + r; I.push(a, ai, b, b, ai, bi); }
for (const c of [0, COLS]) for (let r = 0; r < ROWS; r++) { const a = oBase + c * (ROWS + 1) + r, ai = iBase + c * (ROWS + 1) + r; if (c === 0) I.push(a, a + 1, ai, ai, a + 1, ai + 1); else I.push(a, ai, a + 1, ai, ai + 1, a + 1); }

// ---- orient: every outer-layer normal must point away from the head axis ----------------------------------
{ let wrong = 0; const N = computeNormals(P, I); for (let i = oBase; i < iBase; i++) { const x = P[i * 3], z = P[i * 3 + 2] - AXZ; if (N[i * 3] * x + N[i * 3 + 2] * z < 0) wrong++; }
  if (wrong > (iBase - oBase) / 2) for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]]; }

// ---- merge with Bon's own hair: one mesh, one draw -------------------------------------------------------
const nExt = P.length / 3;
const HC = work.hairColor;
const allP = [...work.hair.P, ...P];
const allI = [...work.hair.I, ...I.map((i) => i + work.hair.P.length / 3)];
const allC = [...work.hair.C, ...Array.from({ length: nExt }, () => HC).flat()];
const N = weldNormals(allP, computeNormals(allP, allI));
const n = allP.length / 3, J = new Uint8Array(n * 4), W = new Float32Array(n * 4);
for (let i = 0; i < n; i++) { J[i * 4] = base.JI.Head; W[i * 4] = 1; }
const bytes = await writeModule(`${BASE_OUT}/hair/bon-long.glb`, base, [
  { name: "hair_bon_long", P: allP, N, COLOR: allC, I: allI, J, W, material: { name: "hair", roughness: 0.62, doubleSided: true } },
], { humanHair: { id: "bon-long", base: C.HUMAN_BASE_VERSION, rigid: true, hemY: { nape: 0.8, behindEar: 0.86, overEar: 0.93, sideburn: 1.02 } } });
console.log(`bon-long: ${allI.length / 3} tris (own ${work.hair.I.length / 3} + layer ${I.length / 3}) · ${(bytes / 1e3).toFixed(0)} KB`);
void THREE;
