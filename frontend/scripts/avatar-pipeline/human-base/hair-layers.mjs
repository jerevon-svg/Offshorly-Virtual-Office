// hair-layers.mjs — STRUCTURALLY LAYERED HAIR for generated identity heads (HumanBase V1.1). ZERO CREDITS. Universal:
// nothing here names an employee.
//
// A generated head is ONE surface: skin, eyes and hair painted on and sculpted into the same sheet. Hair that crosses
// the face (a fringe, a sweep over one eye, a side lock over the cheek) then occupies nearly the same surface as the
// face and the living-eye layer, and the two fight from oblique angles. V1.1 gives every hairstyle an explicit
// structure, decided geometrically (the same rules for every head):
//
//   SCALP   hair lying on the canonical skull (the base cap the style is built on)
//   MAIN    the hairstyle volume (crown, sides, top)
//   FRINGE  FOREGROUND hair: locks that come down over the face (forehead, eye, cheek) and are rooted in the hair mass.
//           The fringe OWNS its pixels: it is moved in front of the face and of the living-eye shell (an obstacle-
//           constrained lift that is zero at its root and grows only where something lies under it), closed along its
//           free edges by a short hair-coloured wall (it reads as a lock, not a paper sheet), and kept rigid near the eye.
//   BACK    hair hanging below the jaw line (length, tied/tail components attach here)
//
// Under a fringe the FACE stays whole: where the lock was fused into the face sheet (no skin behind it), its
// footprint becomes an UNDERLAY — the same triangles flattened onto the face surface (harmonic fill of the surrounding
// face depth) and painted with the surrounding skin (harmonic colour fill, per-vertex _PAINT) — so the face/eye system
// is clean underneath and the lock simply occludes it. Where real face lies behind the lock, nothing is added.
//
// Two calls: splitHair() before the living-eye bake (the bake then sees the clean face), liftFringe() after it (the lift
// needs the eye shells' depth).
import { computeNormals, weldNormals } from "./lib.mjs";

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const HAIR_LAYER = { HEAD: 0, SCALP: 1, MAIN: 2, FRINGE: 3, BACK: 4 };
export const HAIR_LAYER_NAMES = ["identity_head", "identity_hair_scalp", "identity_hair_main", "identity_hair_fringe", "identity_hair_back"];

/** front height field of a triangle set over an (x,y) grid: max z of front-facing coverage, NaN where none */
function frontRaster(P, I, tris, G) {
  const Z = new Float32Array(G.nx * G.ny).fill(NaN);
  for (const t of tris) {
    const q = [0, 1, 2].map((k) => { const v = I[t * 3 + k]; return [(P[v * 3] - G.x0) / G.c, (P[v * 3 + 1] - G.y0) / G.c, P[v * 3 + 2]]; });
    const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-12) continue;
    for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(G.ny - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(G.nx - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
        if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue; const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], k = y * G.nx + x; if (!(z <= Z[k])) Z[k] = z; } }
  return Z;
}
/** Laplace fill of NaN cells inside `inside` (fixed cells keep their value) */
function laplaceFill(Z, G, inside, iters = 400) {
  const free = []; for (let k = 0; k < Z.length; k++) if (inside[k] && Number.isNaN(Z[k])) free.push(k);
  if (!free.length) return Z;
  // seed: row-wise linear interpolation, then relax
  for (const k of free) { const x = k % G.nx, y = (k / G.nx) | 0; let l = x, r = x; while (l > 0 && Number.isNaN(Z[y * G.nx + l])) l--; while (r < G.nx - 1 && Number.isNaN(Z[y * G.nx + r])) r++;
    const zl = Z[y * G.nx + l], zr = Z[y * G.nx + r]; Z[k] = Number.isNaN(zl) ? zr : Number.isNaN(zr) ? zl : zl + (zr - zl) * (x - l) / (r - l); }
  const fx = new Uint8Array(Z.length); for (const k of free) fx[k] = 1;
  for (let it = 0; it < iters; it++) for (const k of free) { const x = k % G.nx; let s = 0, c = 0; for (const k2 of [k - 1, k + 1, k - G.nx, k + G.nx]) { if (k2 < 0 || k2 >= Z.length || Math.abs((k2 % G.nx) - x) > 1 || Number.isNaN(Z[k2])) continue; s += Z[k2]; c++; } if (c) Z[k] += 1.8 * (s / c - Z[k]); }
  return Z;
}
const at = (Z, G, x, y) => { const fx = Math.min(G.nx - 1.001, Math.max(0, (x - G.x0) / G.c)), fy = Math.min(G.ny - 1.001, Math.max(0, (y - G.y0) / G.c)), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const v = [Z[j * G.nx + i], Z[j * G.nx + i + 1], Z[(j + 1) * G.nx + i], Z[(j + 1) * G.nx + i + 1]], w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  let s = 0, c = 0; for (let q = 0; q < 4; q++) if (!Number.isNaN(v[q])) { s += v[q] * w[q]; c += w[q]; } return c > 1e-6 ? s / c : NaN; };

/**
 * Decide the layers, build the underlay. Mutates P (underlay flattening) and label (underlay → skin) in place.
 * @param m { P, N, UV, J, W, I, label, COL (per-vertex sRGB 0..255), LABEL, lm, after, skull(x,y,z)→radial excess over
 *            the canonical skull (≤ 0 inside) }
 */
export async function splitHair(m, rules) {
  const { P, I, label, COL, LABEL, lm, after } = m, nv = P.length / 3, nt = I.length / 3;
  const R = rules.layers;
  const isHairV = (v) => label[v] === LABEL.HAIR;
  const hairTri = new Uint8Array(nt); for (let t = 0; t < nt; t++) { let h = 0; for (let q = 0; q < 3; q++) if (isHairV(I[t * 3 + q])) h++; hairTri[t] = h >= 2 ? 1 : 0; }
  const cen = (t, k) => (P[I[t * 3] * 3 + k] + P[I[t * 3 + 1] * 3 + k] + P[I[t * 3 + 2] * 3 + k]) / 3;
  const sep = after.eyes.sep, eyeY = (lm.eyes.l[1] + lm.eyes.r[1]) / 2, chin = after.chin, mid = 0;
  // ---- the FACE footprint and surface: front-facing non-hair surface ahead of the ear plane (the face sheet), closed by
  //      its mirror about the centre line (a lock over one side is recovered from the other side), holes filled ----
  const G = { x0: -0.6, y0: chin - 0.06, c: 0.004 }; G.nx = Math.ceil(1.2 / G.c); G.ny = Math.ceil((eyeY + 0.6 - G.y0) / G.c);
  const zFront = after.ears.z + sep * 0.25;
  const skinTris = []; for (let t = 0; t < nt; t++) if (!hairTri[t] && cen(t, 2) > zFront) skinTris.push(t);
  const Zs = frontRaster(P, I, skinTris, G);
  const inside = new Uint8Array(G.nx * G.ny);
  for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { const k = j * G.nx + i, im = Math.round((2 * mid - (G.x0 + i * G.c) - G.x0) / G.c);
    if (!Number.isNaN(Zs[k]) || (im >= 0 && im < G.nx && !Number.isNaN(Zs[j * G.nx + im]))) inside[k] = 1; }
  // close small holes (eyes' raster gaps, nostrils): a cell enclosed left+right and up+down by footprint is inside
  { const ins2 = inside.slice(); for (let j = 1; j < G.ny - 1; j++) for (let i = 1; i < G.nx - 1; i++) { const k = j * G.nx + i; if (inside[k]) continue;
      let l = 0, r = 0, u = 0, d = 0; for (let s = 1; s < 40; s++) { if (!l && i - s >= 0 && inside[k - s]) l = 1; if (!r && i + s < G.nx && inside[k + s]) r = 1; if (!d && j - s >= 0 && inside[k - s * G.nx]) d = 1; if (!u && j + s < G.ny && inside[k + s * G.nx]) u = 1; }
      if (l && r && u && d) ins2[k] = 1; } inside.set(ins2); }
  const realSkin = Zs.map((z) => (Number.isNaN(z) ? 0 : 1));
  // the face surface where it is covered (mirror depth first, then Laplace)
  const Zf = Zs.slice(); for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { const k = j * G.nx + i; if (!inside[k] || !Number.isNaN(Zf[k])) continue; const im = Math.round((2 * mid - (G.x0 + i * G.c) - G.x0) / G.c); if (im >= 0 && im < G.nx) Zf[k] = Zs[j * G.nx + im]; }
  laplaceFill(Zf, G, inside);
  const faceZ = (x, y) => at(Zf, G, x, y), onFace = (x, y) => { const i = Math.round((x - G.x0) / G.c), j = Math.round((y - G.y0) / G.c); return i >= 0 && j >= 0 && i < G.nx && j < G.ny && inside[j * G.nx + i] === 1; };
  const skinBehind = (x, y) => { const i = Math.round((x - G.x0) / G.c), j = Math.round((y - G.y0) / G.c); if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) return false; let n = 0, c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const k = (j + dj) * G.nx + i + di; if (k >= 0 && k < realSkin.length) { n += realSkin[k]; c++; } } return n >= 0.5 * c; };
  // ---- FRINGE candidates: hair over the face footprint, in front of (or on) the face surface, below the zone top ----
  const zoneTop = eyeY + R.fringeZoneTop * sep, zoneBot = chin + R.fringeZoneBottom * (eyeY - chin);
  // PAINTED FEATURES are never hair geometry: inside each eye opening (+ its lash margin) and the brow band, hair-coloured
  // triangles that lie on the face (relief below featureRelief) are iris, liner, lashes, brows — paint, not a lock
  const ex = Math.abs(lm.eyes.r[0]), ehw = lm.eyes.halfW, ehh = lm.eyes.halfH;
  const feature = (x, y) => { const dx = Math.abs(Math.abs(x) - ex) / (ehw * 1.35), dy = (y - eyeY) / (ehh * 1.6); if (dx * dx + dy * dy < 1) return true;
    return Math.abs(Math.abs(x) - ex) < ehw * 1.5 && y > eyeY + ehh * 0.8 && y < eyeY + ehh * 1.2 + 0.11; };
  // the dilated eye zone: sculpted lashes / lid flicks live wholly inside it; a hair strand crossing the eye leaves it
  const eyeZone = (x, y) => { const dx = Math.abs(Math.abs(x) - ex) / (ehw * 1.7), dy = (y - eyeY) / (ehh * 2.4); return dx * dx + dy * dy < 1; };
  const relief = (t) => { const fz = faceZ(cen(t, 0), cen(t, 1)); return Number.isNaN(fz) ? NaN : cen(t, 2) - fz; };
  const paint = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) if (hairTri[t] && feature(cen(t, 0), cen(t, 1)) && !(relief(t) >= R.featureRelief)) paint[t] = 1;
  // ---- BILATERAL SYMMETRY (V1.2, universal): painted features come in mirror pairs — an iris, liner, lash line or brow on
  //      one side has its twin on the other. A lock fused across ONE eye passes every positional test above (inside the
  //      eye zone, flat on the face) but has no twin. Front map of hair-coloured face-sheet surface; a hair triangle is
  //      SUPPORTED when hair paint lies within `symTol` of its mirror point. A side whose eye/brow zone carries more
  //      unsupported hair than `symContam` × the eye's area is CONTAMINATED: there nothing hair-coloured is trusted as paint
  //      — the lock becomes fringe and the face under it (geometry, skin, eye, brow) is rebuilt from its twin. Both sides
  //      covered (symmetric curtain bangs) = no twin to trust: the positional/relief rules alone decide, as before.
  const sideOf = (x) => (x >= ((after.eyes.l.c[0] + after.eyes.r.c[0]) / 2) ? 1 : 0), zoneOf = (x, y) => feature(x, y) || eyeZone(x, y);
  const DMc = 0.003, DM = { x0: -0.6, y0: G.y0, c: DMc }; DM.nx = Math.ceil(1.2 / DMc); DM.ny = Math.ceil((eyeY + 0.6 - DM.y0) / DMc);
  const sheet = []; for (let t = 0; t < nt; t++) if (cen(t, 2) > zFront) sheet.push(t);
  const dmZ = new Float32Array(DM.nx * DM.ny).fill(-9), dmH = new Uint8Array(DM.nx * DM.ny);
  for (const t of sheet) { const q = [0, 1, 2].map((k) => { const v = I[t * 3 + k]; return [(P[v * 3] - DM.x0) / DMc, (P[v * 3 + 1] - DM.y0) / DMc, P[v * 3 + 2]]; });
    const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-12) continue;
    for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(DM.ny - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(DM.nx - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
        if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue; const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], k = y * DM.nx + x; if (z <= dmZ[k]) continue; dmZ[k] = z; dmH[k] = hairTri[t]; } }
  // the mirror axis is the face's OWN eye midline (measured), not x = 0: generated faces are often a little off-centre
  const axis = (after.eyes.l.c[0] + after.eyes.r.c[0]) / 2, eyeDY = after.eyes.r.c[1] - after.eyes.l.c[1];
  const rS = Math.max(1, Math.round((R.symTol ?? 0.012) / DMc)), supported = (x, y) => { const i = Math.round((2 * axis - x - DM.x0) / DMc); y += (x > axis ? -eyeDY : eyeDY); const j = Math.round((y - DM.y0) / DMc);
    for (let dj = -rS; dj <= rS; dj++) for (let di = -rS; di <= rS; di++) { if (di * di + dj * dj > rS * rS) continue; const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < DM.nx && jj < DM.ny && dmH[jj * DM.nx + ii]) return true; } return false; };
  const triArea = (t) => { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2], e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]); return Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2; };
  const unsup = new Uint8Array(nt), unsupArea = [0, 0];
  for (let t = 0; t < nt; t++) { if (!hairTri[t]) continue; const x = cen(t, 0), y = cen(t, 1); if (!zoneOf(x, y) || cen(t, 2) <= zFront || !(relief(t) < R.standOffRelief)) continue;
    { const k = Math.round((y - DM.y0) / DMc) * DM.nx + Math.round((x - DM.x0) / DMc); if (!(Math.abs(cen(t, 2) - dmZ[k]) < 0.005)) continue; }   // visible face-sheet surface only (not interior / back faces)
    if (supported(x, y)) continue; unsup[t] = 1; unsupArea[sideOf(x)] += triArea(t); }
  // the contamination measure is what the front camera SEES: zone cells whose front-most face-sheet surface is hair while
  // the mirror neighbourhood shows none (a layered or standing-off lock counts as much as a fused one — it covers the eye)
  const cellUn = [0, 0]; for (let j = 0; j < DM.ny; j++) for (let i = 0; i < DM.nx; i++) { const k = j * DM.nx + i; if (!dmH[k]) continue; const x = DM.x0 + i * DMc, y = DM.y0 + j * DMc; if (!zoneOf(x, y) || supported(x, y)) continue; cellUn[sideOf(x)] += DMc * DMc; }
  unsupArea[0] = cellUn[0]; unsupArea[1] = cellUn[1];
  const eyeArea = Math.PI * ehw * Math.max(ehh, 0.5 * ehw), contam = unsupArea.map((a, s) => a > (R.symContam ?? 0.12) * eyeArea && a > 2.5 * unsupArea[1 - s]);
  if (contam[0] || contam[1]) for (let t = 0; t < nt; t++) if (paint[t] && contam[sideOf(cen(t, 0))]) paint[t] = 0;   // nothing hair-coloured on a contaminated side is trusted as paint
  const symmetry = { unsupportedArea: unsupArea.map((a) => +(a / eyeArea).toFixed(3)), contaminated: contam.map((c, s) => (c ? (s ? "+x" : "-x") : null)).filter(Boolean) };
  const cand = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) { if (!hairTri[t] || paint[t]) continue; const x = cen(t, 0), y = cen(t, 1); if (y > zoneTop || y < zoneBot || !onFace(x, y)) continue; const r = relief(t); if (Number.isNaN(r) || r < -R.behindTol) continue; cand[t] = 1; }
  // grow each lock up toward its root: connected hair triangles still over the face footprint and in front of it
  const vt = Array.from({ length: nv }, () => []); for (let t = 0; t < nt; t++) for (let q = 0; q < 3; q++) vt[I[t * 3 + q]].push(t);
  { const st = []; for (let t = 0; t < nt; t++) if (cand[t]) st.push(t);
    while (st.length) { const t = st.pop(); for (let q = 0; q < 3; q++) for (const t2 of vt[I[t * 3 + q]]) { if (cand[t2] || !hairTri[t2]) continue; const x = cen(t2, 0), y = cen(t2, 1), z = cen(t2, 2);
      if (paint[t2] || y > zoneTop + R.rootReach * sep || !onFace(x, y)) continue; const fz = faceZ(x, y); if (Number.isNaN(fz) || z < fz - R.behindTol) continue; cand[t2] = 2; st.push(t2); } } }
  // components: a LOCK is rooted (shares vertices with hair outside the fringe) and is not a speck; painted features
  // (brows, liner) are hair-coloured islands INSIDE the face — not rooted — and stay face paint
  const comp = new Int32Array(nt).fill(-1), comps = [];
  for (let t0 = 0; t0 < nt; t0++) { if (!cand[t0] || comp[t0] >= 0) continue; const id = comps.length, list = [t0]; comp[t0] = id;
    for (let h = 0; h < list.length; h++) { const t = list[h]; for (let q = 0; q < 3; q++) for (const t2 of vt[I[t * 3 + q]]) if (cand[t2] && comp[t2] < 0) { comp[t2] = id; list.push(t2); } }
    let rooted = 0, area = 0; for (const t of list) { for (let q = 0; q < 3; q++) for (const t2 of vt[I[t * 3 + q]]) if (hairTri[t2] && !cand[t2] && !paint[t2]) { rooted++; break; } }
    const rel = list.map(relief).filter((r) => !Number.isNaN(r)).sort((a, b) => a - b), medRelief = rel.length ? rel[rel.length >> 1] : 0;
    for (const t of list) { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2], e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]); area += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2; }
    let outside = 0, onContam = 0, twinless = 0; for (const t of list) { const x = cen(t, 0), y = cen(t, 1); if (!eyeZone(x, y)) outside++; if (contam[sideOf(x)]) { onContam++; if (!supported(x, y)) twinless++; } }
    // on a CONTAMINATED side there is no eye-sculpt exemption (that eye is rebuilt from its twin) and any hair piece with
    // twinless surface is the lock — strands painted flat across the eye included (the hairstyle keeps every strand);
    // only pieces wholly matched by the twin's paint (that side's own iris / brow) are left to the twin rebuild
    const fused = onContam > 0.5 * list.length && twinless >= Math.max(1, 0.1 * onContam);
    comps.push({ list, rooted, area, medRelief, eyeOnly: outside < 0.05 * list.length && !(onContam > 0.5 * list.length), fused }); }
  if (process.env.HB_DEBUG_LAYERS) { const fs = await import("node:fs"); const rows = []; for (let t = 0; t < nt; t++) if (cand[t]) { const x = cen(t, 0), y = cen(t, 1), z = cen(t, 2); rows.push([+x.toFixed(4), +y.toFixed(4), +(z - faceZ(x, y)).toFixed(4), comp[t], skinBehind(x, y) ? 1 : 0]); }
    fs.writeFileSync(process.env.HB_DEBUG_LAYERS, JSON.stringify({ eyeY, sep, halfH: lm.eyes.halfH, halfW: lm.eyes.halfW, ex: lm.eyes.r[0], comps: comps.map((c) => ({ n: c.list.length, rooted: c.rooted, area: +c.area.toFixed(5), rel: +c.medRelief.toFixed(4) })), rows })); }
  const fringe = new Uint8Array(nt), eyeGeo = new Uint8Array(nt); let locks = 0;
  // a LOCK: rooted in the hair mass, big enough, and standing off the face (sculpted hair) — a flat hair-coloured patch lying
  // on the face is paint and stays face (the eye bake's strand repaint handles painted strands over an eye)
  // Generated hair is sometimes ONE sheet (locks are rooted in it topologically) and sometimes separate strand SHELLS (no
  // topological root at all): a piece clearly standing off the face (≥ standOffRelief) is hair geometry either way
  for (const c of comps) if ((c.rooted >= R.minRootTris && c.area >= R.minLockArea * sep * sep && c.medRelief >= R.minLockRelief) || c.medRelief >= R.standOffRelief || c.fused) { if (c.eyeOnly) { for (const t of c.list) eyeGeo[t] = 1; continue; } locks++; for (const t of c.list) fringe[t] = 1; }
  // ---- UNDERLAY: fringe triangles fused into the face sheet (no real face behind them) ----
  // (never below the jawline: a fused lock hanging beside the jaw must not become "skin" — that reads as a thick jaw/neck)
  const P0d = Float32Array.from(P);   // pre-underlay positions (diagnostic map)
  // V1.2: real face must lie BEHIND every vertex of the lock triangle, at that exact spot (a strand one or two cells wide
  // always has skin BESIDE it — the old neighbourhood test then left a slit in the face along every thin fused strand)
  const skinBehindTri = (t) => { for (let q = 0; q < 3; q++) { const v = I[t * 3 + q], i = Math.round((P[v * 3] - G.x0) / G.c), j = Math.round((P[v * 3 + 1] - G.y0) / G.c);
      if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) return false; const z = Zs[j * G.nx + i]; if (Number.isNaN(z) || z > P[v * 3 + 2] - 0.002) return false; } return true; };
  // (V1.3: and only where the face surface is DEFINED behind every vertex — beyond the face silhouette an underlay cannot be
  //  flattened and stood out of the cheek as a hair-textured fin; there the lock stays foreground fringe)
  const flattenable = (t) => { for (let q = 0; q < 3; q++) { const v = I[t * 3 + q]; if (!onFace(P[v * 3], P[v * 3 + 1]) || Number.isNaN(faceZ(P[v * 3], P[v * 3 + 1]))) return false; } return true; };
  const under = new Uint8Array(nt); for (let t = 0; t < nt; t++) if (fringe[t] && !skinBehindTri(t) && cen(t, 1) > Math.max(m.minUnderlayY, chin + 0.02) && flattenable(t)) under[t] = 1;   // never below the head's OWN jaw
  // vertex roles: inU = used by an underlay triangle; pin = also used by a hair triangle that stays in another layer
  const inU = new Uint8Array(nv), pinU = new Uint8Array(nv), skinNb = new Uint8Array(nv);
  for (let t = 0; t < nt; t++) if (under[t]) for (let q = 0; q < 3; q++) inU[I[t * 3 + q]] = 1;
  for (let t = 0; t < nt; t++) { if (under[t]) continue; for (let q = 0; q < 3; q++) { const v = I[t * 3 + q]; if (!inU[v]) continue; if (hairTri[t] && !fringe[t]) pinU[v] = 1; else if (!hairTri[t]) skinNb[v] = 1; } }
  const uV = []; for (let v = 0; v < nv; v++) if (inU[v]) uV.push(v);
  // underlay weight (0 at the hair root → 1 on the open face): harmonic over the underlay's vertex graph
  const nbr = new Map(); for (let t = 0; t < nt; t++) if (under[t]) for (let q = 0; q < 3; q++) { const a = I[t * 3 + q], b = I[t * 3 + (q + 1) % 3]; (nbr.get(a) ?? nbr.set(a, new Set()).get(a)).add(b); (nbr.get(b) ?? nbr.set(b, new Set()).get(b)).add(a); }
  const wU = new Float32Array(nv); for (const v of uV) wU[v] = pinU[v] ? 0 : 1;
  for (let it = 0; it < 120; it++) for (const v of uV) { if (pinU[v] || skinNb[v]) continue; let s = 0, c = 0; for (const u of nbr.get(v) ?? []) { s += wU[u]; c++; } if (c) wU[v] = Math.max(0, Math.min(1, s / c + 0.02)); }
  // paint: the surrounding skin continued across the underlay (harmonic colour fill from skin-adjacent vertices)
  const PAINT = new Uint8Array(nv * 4), col = new Float32Array(nv * 3);
  { const fixed = new Uint8Array(nv); let mean = [0, 0, 0], mc = 0;
    for (const v of uV) if (skinNb[v]) { for (let k = 0; k < 3; k++) col[v * 3 + k] = COL[v * 3 + k]; fixed[v] = 1; }
    for (let t = 0; t < nt; t++) if (!hairTri[t]) for (let q = 0; q < 3; q++) { const v = I[t * 3 + q]; if (label[v] === LABEL.SKIN && P[v * 3 + 2] > zFront) { mean[0] += COL[v * 3]; mean[1] += COL[v * 3 + 1]; mean[2] += COL[v * 3 + 2]; mc++; } }
    mean = mean.map((x) => x / Math.max(1, mc));
    for (const v of uV) if (!fixed[v]) for (let k = 0; k < 3; k++) col[v * 3 + k] = mean[k];
    for (let it = 0; it < 300; it++) for (const v of uV) { if (fixed[v]) continue; const s = [0, 0, 0]; let c = 0; for (const u of nbr.get(v) ?? []) { for (let k = 0; k < 3; k++) s[k] += col[u * 3 + k]; c++; } if (c) for (let k = 0; k < 3; k++) col[v * 3 + k] = s[k] / c; }
    for (const v of uV) { for (let k = 0; k < 3; k++) PAINT[v * 4 + k] = Math.round(col[v * 3 + k]); PAINT[v * 4 + 3] = Math.round(255 * sm(0, 0.35, wU[v])); } }
  // flatten: onto the face surface (never forward of the fused sheet), weighted by the root ramp
  const P0 = Float32Array.from(P);
  let moved = 0; for (const v of uV) { const fz = faceZ(P[v * 3], P[v * 3 + 1]); if (Number.isNaN(fz)) continue; const w = sm(0, 0.35, wU[v]), z2 = Math.min(P[v * 3 + 2], fz - R.underlayInset); if (w > 0 && Math.abs(z2 - P[v * 3 + 2]) > 1e-6) { P[v * 3 + 2] += w * (z2 - P[v * 3 + 2]); moved++; } }
  for (const v of uV) if (PAINT[v * 4 + 3] > 128) label[v] = LABEL.SKIN;
  // ---- the other layers (pure partition, no displacement) ----
  const layer = new Uint8Array(nt);
  // painted features and pressed eye sculpt are FACE (texel-exact paint on the face surface, never hair-layer shading); on a
  // contaminated side every hair-coloured face triangle that is not the lock is face to be rebuilt from the twin
  const rebuildZone = (x, y, k = 1) => { const dx = Math.abs(Math.abs(x) - ex) / (ehw * 2.0 * k), dy = (y - eyeY) / (ehh * 2.8 * k); return dx * dx + dy * dy < 1 || (Math.abs(Math.abs(x) - ex) < ehw * 1.8 * k && y > eyeY && y < eyeY + (ehh * 1.2 + 0.13) * k); };
  const faceLeft = (t) => contam[sideOf(cen(t, 0))] && rebuildZone(cen(t, 0), cen(t, 1)) && cen(t, 2) > zFront && relief(t) < R.standOffRelief;
  // (painted features keep the V1.1 hair-scalp shading — the approved brow look depends on it; contaminated-side leftovers
  //  stay in their layer too and are rebuilt from the twin's paint like the face around them)
  // HAIR-COLOURED SKIN-LABELLED GEOMETRY (V1.3): a non-hair triangle dark at all three vertices that stands off the face
  // (relief > 1 cm-eq) or lies beyond the face footprint is a strand shell the colour classifier missed — hair, not face
  const darkV = (v) => 0.3 * COL[v * 3] + 0.59 * COL[v * 3 + 1] + 0.11 * COL[v * 3 + 2] < (R.paintLumLo ?? 55);
  // (below the chin: dark at ≥ 2 vertices is enough — no face skin hangs below the jaw; the side lock / sideburn was skin-labelled there)
  const strayHair = (t) => { const nd = darkV(I[t * 3]) + darkV(I[t * 3 + 1]) + darkV(I[t * 3 + 2]), x = cen(t, 0), y = cen(t, 1); if (y < chin) return nd >= 2; if (nd < 3) return false; return !onFace(x, y) && cen(t, 2) > zFront; };   // never on the face footprint: painted brows / liner with relief are FACE (they opened windows in the brow)
  let strays = 0;
  // MIXED BORDER TRIANGLES below the jaw (any hair vertex, chin-level or lower): they belong to the hanging hair, never the
  // face — moved with the hair by a tie gather they became skin-coloured fins standing out of the jaw
  const mixedLow = (t) => cen(t, 1) < chin + 0.01 && [0, 1, 2].some((q) => isHairV(I[t * 3 + q]));
  for (let t = 0; t < nt; t++) { if (!hairTri[t] && mixedLow(t) && !under[t]) { layer[t] = HAIR_LAYER.BACK; strays++; continue; }
    if (!hairTri[t]) { if (!under[t] && strayHair(t)) { layer[t] = cen(t, 1) < chin + R.backBelowChin * sep ? HAIR_LAYER.BACK : HAIR_LAYER.MAIN; strays++; } else layer[t] = HAIR_LAYER.HEAD; continue; } if (fringe[t]) { layer[t] = HAIR_LAYER.FRINGE; continue; }
    const x = cen(t, 0), y = cen(t, 1), z = cen(t, 2);
    if (y < chin + R.backBelowChin * sep) layer[t] = HAIR_LAYER.BACK;
    else if (m.skull(x, y, z) < R.scalpThickness) layer[t] = HAIR_LAYER.SCALP;
    else layer[t] = HAIR_LAYER.MAIN; }
  // DIAGNOSTIC (HB_LAYER_MAP=<png>): front orthographic map of the front-most triangle's role over the face —
  // skin (beige) · hair left in the head layers (red) · painted feature (blue) · eye sculpt (cyan) · lifted fringe (yellow)
  // · fused fringe = underlay below it (green). Hair left red over the face footprint is a fringe the rules missed.
  if (process.env.HB_LAYER_MAP) { const sharp = (await import("sharp")).default, D = { x0: -0.55, y0: chin - 0.02, c: 0.0025 }; D.nx = Math.ceil(1.1 / D.c); D.ny = Math.ceil((eyeY + 0.5 - D.y0) / D.c);
    const zb = new Float32Array(D.nx * D.ny).fill(-9), img = Buffer.alloc(D.nx * D.ny * 3, 40);
    const colOf = (t) => unsup[t] && !fringe[t] ? [230, 40, 230] : fringe[t] ? (under[t] ? [60, 200, 90] : [240, 210, 40]) : eyeGeo[t] ? [60, 220, 230] : paint[t] ? [60, 90, 230] : hairTri[t] ? (onFace(cen(t, 0), cen(t, 1)) ? [230, 40, 40] : [120, 30, 30]) : [235, 205, 180];
    for (let t = 0; t < nt; t++) { const q = [0, 1, 2].map((k) => { const v = I[t * 3 + k]; return [(P0d[v * 3] - D.x0) / D.c, (P0d[v * 3 + 1] - D.y0) / D.c, P0d[v * 3 + 2]]; });
      const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-12) continue; const c = colOf(t);
      for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(D.ny - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
        for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(D.nx - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
          const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
          if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue; const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], k = (D.ny - 1 - y) * D.nx + x; if (z <= zb[k]) continue; zb[k] = z; img[k * 3] = c[0]; img[k * 3 + 1] = c[1]; img[k * 3 + 2] = c[2]; } }
    await sharp(img, { raw: { width: D.nx, height: D.ny, channels: 3 } }).resize(D.nx * 2, D.ny * 2, { kernel: "nearest" }).png().toFile(process.env.HB_LAYER_MAP); }
  if (process.env.HB_TRACE) { const [tx, ty, tz] = process.env.HB_TRACE.split(",").map(Number); for (let t = 0; t < nt; t++) { if ((tz > 5 ? Math.hypot(cen(t, 0) - tx, cen(t, 1) - ty) : Math.hypot(cen(t, 0) - tx, cen(t, 1) - ty, cen(t, 2) - tz)) > 0.006 || (process.env.HB_TRACE_HEAD && layer[t] !== HAIR_LAYER.HEAD)) continue;
    console.log(`TRACE t${t} c(${[0, 1, 2].map((k) => cen(t, k).toFixed(3))}) hairTri ${hairTri[t]} fringe ${fringe[t]} under ${under[t]} paint ${paint[t]} eyeGeo ${eyeGeo[t]} layer ${layer[t]} onFace ${onFace(cen(t, 0), cen(t, 1))} chin ${chin.toFixed(3)} labels ${[0, 1, 2].map((q) => label[I[t * 3 + q]])} lum ${[0, 1, 2].map((q) => { const v = I[t * 3 + q]; return Math.round(0.3 * COL[v * 3] + 0.59 * COL[v * 3 + 1] + 0.11 * COL[v * 3 + 2]); })}`); } }
  // TEXEL REBUILD TARGETS (rebuildFaceTexels): every underlay triangle, and on a contaminated side the whole eye/brow zone
  // of the face layer — the twin's eye, lids, lashes and brow are transplanted there, so the face reads whole without hair
  // …and, on a contaminated side, any face lying under the fringe's footprint (strand paint between sculpted locks)
  const FPc = 0.004, FPm = { x0: -0.6, y0: G.y0 }, fnx = Math.ceil(1.2 / FPc), fny = Math.ceil((eyeY + 0.6 - G.y0) / FPc), foot = new Uint8Array(fnx * fny);
  if (contam[0] || contam[1]) { for (let t = 0; t < nt; t++) if (fringe[t] && !under[t]) { const i = Math.round((cen(t, 0) - FPm.x0) / FPc), j = Math.round((cen(t, 1) - FPm.y0) / FPc);
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < fnx && jj < fny) foot[jj * fnx + ii] = 1; } } }
  const underFoot = (x, y) => { const i = Math.round((x - FPm.x0) / FPc), j = Math.round((y - FPm.y0) / FPc); return i >= 0 && j >= 0 && i < fnx && j < fny && foot[j * fnx + i] === 1; };
  // (V1.3: only ON THE FACE FOOTPRINT, above the chin — the jaw edge / neck under a long lock is not face; the twin there is
  //  hair or nothing, and copying it produced a plank of hair-textured skin standing out of the jaw)
  const onFaceT = (t) => onFace(cen(t, 0), cen(t, 1)) && cen(t, 1) > chin + 0.02;
  const rebuild = new Uint8Array(nt); for (let t = 0; t < nt; t++) if (under[t] || ((layer[t] === HAIR_LAYER.HEAD || faceLeft(t)) && contam[sideOf(cen(t, 0))] && (rebuildZone(cen(t, 0), cen(t, 1)) || underFoot(cen(t, 0), cen(t, 1))) && cen(t, 2) > zFront && onFaceT(t))) rebuild[t] = 1;
  // FEATURE (painted brows / iris / liner, eye sculpt) and DROP (hair-coloured leftovers of a fused lock inside a contaminated
  // eye/brow zone: the mirrored twin patch replaces them)
  const featureT = new Uint8Array(nt), drop = new Uint8Array(nt); for (let t = 0; t < nt; t++) { if (!fringe[t] && (paint[t] || eyeGeo[t])) featureT[t] = 1; if (!fringe[t] && faceLeft(t) && rebuildZone(cen(t, 0), cen(t, 1))) drop[t] = 1; }
  return { layer, fringe, under, eyeGeo, rebuild, contam, rebuildZone, feature: featureT, drop, axis: (after.eyes.l.c[0] + after.eyes.r.c[0]) / 2, eyeDY: after.eyes.r.c[1] - after.eyes.l.c[1], PAINT, P0, faceZ, onFace, G, Zf, info: { symmetry, strayHairTris: strays, rebuildTris: rebuild.reduce((a, b) => a + b, 0), locks, fringeTris: fringe.reduce((a, b) => a + b, 0), underlayTris: under.reduce((a, b) => a + b, 0), underlayVertsMoved: moved,
    layers: Object.fromEntries(HAIR_LAYER_NAMES.map((n, k) => [n, layer.reduce((a, l) => a + (l === k ? 1 : 0), 0)])) } };
}

/**
 * Build the FRINGE layer as its own geometry (copied vertices), lifted to own its pixels: in front of the face (and the
 * underlay) by `clear`, and in front of every VISIBLE living-eye shell texel by `clearEye`. The lift is the smallest
 * smooth field meeting those minimums with zero lift at the lock's root (vertices shared with the main hair). Free
 * edges get a hair-coloured wall back to the face. Rigid on Head over the face (blending to the source weights at the
 * root), so motion never swings it into the eye.
 */
export function liftFringe(m, split, eyeShells, rules, headJoint) {
  const { P, N, UV, J, W, I } = m, nt = I.length / 3, R = rules.layers;
  const tris = []; for (let t = 0; t < nt; t++) if (split.layer[t] === HAIR_LAYER.FRINGE) tris.push(t);
  if (!tris.length) return null;
  const map = new Map(), src = []; const FI = [];
  for (const t of tris) for (let q = 0; q < 3; q++) { const v = I[t * 3 + q]; if (!map.has(v)) { map.set(v, src.length); src.push(v); } FI.push(map.get(v)); }
  const n = src.length, FP = new Float32Array(n * 3); for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) FP[i * 3 + k] = split.P0[src[i] * 3 + k];
  // root pins: vertices also used by a non-fringe HAIR triangle (the lock grows out of the hair mass there)
  const pin = new Uint8Array(n); for (let t = 0; t < nt; t++) { const l = split.layer[t]; if (l === HAIR_LAYER.FRINGE || l === HAIR_LAYER.HEAD) continue; for (let q = 0; q < 3; q++) { const i = map.get(I[t * 3 + q]); if (i !== undefined) pin[i] = 1; } }
  // minimum lift per vertex
  const shellZ = (x, y) => { let z = -9; for (const s of eyeShells) { const px = Math.floor((x - s.x0) / s.w * s.NX), py = Math.floor((y - s.y0) / s.hh * s.NY); if (px < -2 || py < -2 || px >= s.NX + 2 || py >= s.NY + 2) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = px + dx, yy = py + dy; if (xx < 0 || yy < 0 || xx >= s.NX || yy >= s.NY) continue; const k = yy * s.NX + xx, a = s.A[k]; if (a === 2 || a === 8 || a === 9 || a === 10) z = Math.max(z, s.ZD[k]); } } return z; };
  // the REAL head surface in front (skin + underlay, after every rebuild step) — the footprint-limited face fill misses the
  // face silhouette, where side locks wrap the cheek and forehead strands lie on the skin
  const HG = { x0: -0.65, y0: m.after.chin - 0.1, c: 0.004 }; HG.nx = Math.ceil(1.3 / HG.c); HG.ny = Math.ceil(1.3 / HG.c);
  const headTris = []; for (let t = 0; t < nt; t++) if (split.layer[t] === HAIR_LAYER.HEAD || split.under[t]) headTris.push(t);
  const HZ = frontRaster(P, I, headTris, HG), headZ = (x, y) => at(HZ, HG, x, y);
  const need = new Float32Array(n); let eyeNeed = 0;
  const rootNeed = new Float32Array(n);   // a ROOT inside the skin lifts too (with its main-hair vertex: no crack)
  const uVert = new Uint8Array(P.length / 3); for (let t = 0; t < nt; t++) if (split.under[t]) for (let q = 0; q < 3; q++) uVert[I[t * 3 + q]] = 1;
  for (let i = 0; i < n; i++) { const x = FP[i * 3], y = FP[i * 3 + 1], z = FP[i * 3 + 2]; let req = -9;
    const fz = split.faceZ(x, y); if (!Number.isNaN(fz) && split.onFace(x, y)) req = Math.max(req, fz + R.clear);
    // a visible eye-shell texel under the lock: the lock owns the pixel (only where the shell lies on the face — a shell
    // texel far off the face surface is beyond the face silhouette and is not an eye to clear)
    const ez = shellZ(x, y); if (ez > -8 && !(ez - fz > R.maxEyeStandoff)) { req = Math.max(req, ez + R.clearEye); }
    // the underlay this vertex was copied from (fused sheet) now lies on the face: clear it too
    if (uVert[src[i]]) req = Math.max(req, P[src[i] * 3 + 2] + R.clear);
    { const hz = headZ(x, y); if (!Number.isNaN(hz) && z > hz - R.maxLift && z < hz + R.clear) { req = Math.max(req, hz + R.clear); rootNeed[i] = Math.min(R.maxLift, hz + R.clear - z); } }   // near/inside the skin: out; deeper = behind the face by design
    need[i] = Math.min(R.maxLift, Math.max(0, req - z)); if (ez > -8 && need[i] > 0) eyeNeed++; }
  // obstacle-constrained smooth lift: L = max(need, mean of neighbours), roots pinned to 0
  const nb = Array.from({ length: n }, () => new Set()); for (let t = 0; t < FI.length; t += 3) for (let q = 0; q < 3; q++) { nb[FI[t + q]].add(FI[t + (q + 1) % 3]); nb[FI[t + (q + 1) % 3]].add(FI[t + q]); }
  const L = Float32Array.from(need); for (let i = 0; i < n; i++) if (pin[i]) L[i] = rootNeed[i];
  for (let it = 0; it < R.liftIters; it++) for (let i = 0; i < n; i++) { if (pin[i]) continue; let s = 0, c = 0; for (const j of nb[i]) { s += L[j]; c++; } L[i] = Math.max(need[i], c ? 0.5 * L[i] + 0.5 * s / c : L[i]); }
  let maxL = 0, rootsLifted = 0; for (let i = 0; i < n; i++) { FP[i * 3 + 2] += L[i]; maxL = Math.max(maxL, L[i]); if (pin[i] && L[i] > 0) { P[src[i] * 3 + 2] = FP[i * 3 + 2]; rootsLifted++; } }
  // weights: rigid on Head away from the root (graph distance), the source's own at the root
  const dist = new Float32Array(n).fill(1e9), q = []; for (let i = 0; i < n; i++) if (pin[i]) { dist[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) { const i = q[h]; for (const j of nb[i]) { const d = dist[i] + Math.hypot(FP[i * 3] - FP[j * 3], FP[i * 3 + 1] - FP[j * 3 + 1], FP[i * 3 + 2] - FP[j * 3 + 2]); if (d < dist[j]) { dist[j] = d; q.push(j); } } }
  const FJ = new Uint8Array(n * 4), FW = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const r = sm(0, R.rigidAfter, dist[i]), acc = new Map(); for (let k = 0; k < 4; k++) { const w = W[src[i] * 4 + k] * (1 - r); if (w > 0) acc.set(J[src[i] * 4 + k], (acc.get(J[src[i] * 4 + k]) ?? 0) + w); } acc.set(headJoint, (acc.get(headJoint) ?? 0) + r);
    const top = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4), s = top.reduce((a, b) => a + b[1], 0); for (let k = 0; k < 4; k++) { FJ[i * 4 + k] = top[k] ? top[k][0] : 0; FW[i * 4 + k] = top[k] ? top[k][1] / s : 0; } }
  // free edges (boundary of the fringe that is not a root) → a wall from the lifted lock back to the face sheet
  const ec = new Map(), ek = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let t = 0; t < FI.length; t += 3) for (let k = 0; k < 3; k++) { const a = FI[t + k], b = FI[t + (k + 1) % 3], key = ek(a, b), e = ec.get(key); if (e) e.c++; else ec.set(key, { a, b, c: 1, t }); }
  const WP = [], WUV = [], WJ = [], WW = [], WI = []; let walls = 0;
  for (const e of ec.values()) { if (e.c !== 1 || (pin[e.a] && pin[e.b]) || (L[e.a] < 1e-5 && L[e.b] < 1e-5)) continue;
    const o = WP.length / 3;
    for (const [i, lifted] of [[e.a, 1], [e.b, 1], [e.b, 0], [e.a, 0]]) { const v = src[i], hz = headZ(FP[i * 3], FP[i * 3 + 1]);
      // the wall ends ON the skin (never inside it: the lock's original position could lie within the cheek edge)
      const zb = Number.isNaN(hz) ? P[v * 3 + 2] : Math.min(FP[i * 3 + 2], Math.max(P[v * 3 + 2], hz - 0.002));
      WP.push(FP[i * 3], FP[i * 3 + 1], lifted ? FP[i * 3 + 2] : zb); WUV.push(UV[v * 2], UV[v * 2 + 1]);
      for (let k = 0; k < 4; k++) { WJ.push(lifted ? FJ[i * 4 + k] : J[v * 4 + k]); WW.push(lifted ? FW[i * 4 + k] : W[v * 4 + k]); } }
    WI.push(o, o + 1, o + 2, o, o + 2, o + 3); walls++; }
  // assemble: lock + walls; normals: the lock keeps the head's own (no seam at the root), walls their own
  const FN = new Float32Array(n * 3); for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) FN[i * 3 + k] = N[src[i] * 3 + k];
  // a generated strand over the face often carries the FACE's paint (sclera, lid, skin projected across it): the lock owns
  // its pixels, so such texels are repainted with the hair's own colour (per-vertex _PAINT; hair texels are left as painted)
  const FPA = new Uint8Array((n + 0) * 4); let repainted = 0;
  if (m.COL && m.hairRGB) for (let i = 0; i < n; i++) { const v = src[i], l = 0.3 * m.COL[v * 3] + 0.59 * m.COL[v * 3 + 1] + 0.11 * m.COL[v * 3 + 2], a = sm(R.paintLumLo, R.paintLumHi, l);
    if (a > 0) { FPA.set([...m.hairRGB, Math.round(255 * a)], i * 4); repainted++; } }
  const FUV = new Float32Array(n * 2); for (let i = 0; i < n; i++) { FUV[i * 2] = UV[src[i] * 2]; FUV[i * 2 + 1] = UV[src[i] * 2 + 1]; }
  const WPf = Float32Array.from(WP), WN = WPf.length ? weldNormals(WPf, computeNormals(WPf, WI)) : new Float32Array(0);
  const cat = (a, b, T) => { const o = new T(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  return { P: cat(FP, WPf, Float32Array), N: cat(FN, WN, Float32Array), UV: cat(FUV, Float32Array.from(WUV), Float32Array), J: cat(FJ, Uint8Array.from(WJ), Uint8Array), W: cat(FW, Float32Array.from(WW), Float32Array),
    PAINT: cat(FPA, (() => { const w = new Uint8Array(WP.length / 3 * 4); for (let q = 0; q < w.length / 4; q++) w.set([...(m.hairRGB ?? [0, 0, 0]), m.hairRGB ? 255 : 0], q * 4); return w; })(), Uint8Array),
    I: [...FI, ...WI.map((i) => i + n)], src, info: { repainted, rootsLifted, verts: n, tris: FI.length / 3, wallQuads: walls, maxLift: +maxL.toFixed(4), eyeOwnedVerts: eyeNeed, roots: pin.reduce((a, b) => a + b, 0) } };
}

/** TIED STYLES (identity side; the tied piece itself is build-hair-tail.mjs): hair behind the ear plane and below the tie
 *  is gathered UP and IN toward the tie — the nape no longer hangs loose under a ponytail — and kept outside the
 *  canonical skull (+ scalp thickness). Above the tie the back hair converges slightly toward the centre line, so the
 *  flow reads into the tie. Mutates P. Returns the number of vertices moved. */
export function gatherToTie(m, tie, rules) {
  const { P, label, LABEL, after, skull, skullCentre } = m, R = rules.layers, nv = P.length / 3; void skullCentre;
  const tieY = (m.lm.eyes.l[1]) + ({ low: -0.13, mid: 0.03, high: 0.22 }[tie] ?? -0.13), earZ = after.ears.z;
  let moved = 0;
  for (let v = 0; v < nv; v++) { if (label[v] !== LABEL.HAIR) continue; let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const wB = sm(earZ - 0.02, earZ - 0.22, z); if (wB <= 0) continue;
    const below = sm(tieY + 0.02, tieY - 0.12, y), above = sm(tieY + 0.3, tieY, y) * (1 - below);
    if (below <= 0 && above <= 0) continue;
    const y2 = y < tieY ? tieY - (tieY - y) * R.tieKeep : y, x2 = x * (1 - 0.5 * below - 0.4 * above);
    x += (x2 - x) * wB; y += (y2 - y) * wB * below;
    // above the tie the back hair is drawn IN toward the skull (combed back into the tie, not a loose bob flaring over it)
    { const c = skullCentre, d = [x - c[0], y - c[1], z - c[2]], r = Math.hypot(...d), ex0 = skull(x, y, z), keep = R.scalpThickness * 1.2;
      if (ex0 > keep) { const f = (r - (ex0 - keep) * 0.65 * above * wB) / r; x = c[0] + d[0] * f; y = c[1] + d[1] * f; z = c[2] + d[2] * f; } }
    // stay outside the canonical skull (+ scalp hair thickness)
    const ex = skull(x, y, z); if (ex < R.scalpThickness * 0.6) { const c = skullCentre, d = [x - c[0], y - c[1], z - c[2]], r = Math.hypot(...d), f = (r + R.scalpThickness * 0.6 - ex) / r; x = c[0] + d[0] * f; y = c[1] + d[1] * f; z = c[2] + d[2] * f; }
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z; moved++; }
  return { tieY: +tieY.toFixed(3), moved };
}

/** HAIR SIDE-VOLUME CEILING (universal): above the ear line, hair standing off the canonical skull SIDEWAYS by more than
 *  `sideMax` is compressed back (soft knee: only the excess, by sideKeep) — generated short hair can puff out at the
 *  temples and read as a wide head. Measured on the skull, not the face, so the identity face is never narrowed; hair
 *  inside the ceiling (every approved V1 style but the outliers) is untouched. Mutates P; returns stats. */
export function hairSideCeiling(m, rules) {
  const { P, label, LABEL, skull, skullCentre: c, lm } = m, R = rules.layers, eyeY = lm.eyes.l[1]; let moved = 0, worst = 0;
  for (let v = 0; v < P.length / 3; v++) { if (label[v] !== LABEL.HAIR) continue; const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const d = [x - c[0], y - c[1], z - c[2]], r = Math.hypot(...d), lat = Math.abs(d[0]) / r, w = sm(0.55, 0.8, lat) * sm(eyeY - 0.1, eyeY - 0.02, y) * sm(eyeY + 0.45, eyeY + 0.3, y);
    if (w <= 0) continue; const ex = skull(x, y, z); worst = Math.max(worst, ex); if (ex <= R.sideMax) continue;
    const ex2 = R.sideMax + (ex - R.sideMax) * R.sideKeep, f = (r - (ex - ex2) * w) / r; P[v * 3] = c[0] + d[0] * f; P[v * 3 + 1] = c[1] + d[1] * f; P[v * 3 + 2] = c[2] + d[2] * f; moved++; }
  return { moved, worstSideExcess: +worst.toFixed(3) };
}

/** EYE-SCULPT FLATTEN (universal, before the eye bake): generated heads sculpt lashes as dark FINS that stand off the lid
 *  and, from the side, stick out beyond the face silhouette. The living-eye shell already draws the lash line, so dark
 *  (hair-labelled) head geometry wholly inside the dilated eye zone is pressed onto the face surface; where there is no
 *  face behind it (a fin beyond the silhouette) it collapses onto the nearest lid skin. Strands that cross the eye are
 *  fringe (another layer) and are never touched. Mutates P; returns stats. */
export function flattenEyeSculpt(m, split, rules) {
  const { P, I, label, LABEL, lm } = m, nv = P.length / 3, nt = I.length / 3, R = rules.layers;
  const ex = Math.abs(lm.eyes.r[0]), ey = lm.eyes.l[1], hw = lm.eyes.halfW, hh = lm.eyes.halfH;
  const zone = (x, y) => { const dx = (Math.abs(x) - ex) / (hw * 1.75), dy = (y - ey) / (hh * 2.2); return dx * dx + dy * dy < 1 && Math.abs(x) > ex * 0.35; };
  // eligible: vertices of head triangles and of EYE-ONLY sculpt pieces (lash fins the split kept out of the fringe)
  const headOnly = new Uint8Array(nv).fill(1); for (let t = 0; t < nt; t++) if (split.layer[t] !== HAIR_LAYER.HEAD && !split.eyeGeo[t]) for (let q = 0; q < 3; q++) headOnly[I[t * 3 + q]] = 0;
  // skin anchors for collapse (lid skin in the zone)
  const anchors = []; for (let v = 0; v < nv; v++) if (label[v] === LABEL.SKIN && zone(P[v * 3], P[v * 3 + 1])) anchors.push(v);
  let pressed = 0, collapsed = 0;
  for (let v = 0; v < nv; v++) { if (label[v] !== LABEL.HAIR || !headOnly[v]) continue; const x = P[v * 3], y = P[v * 3 + 1]; if (!zone(x, y)) continue;
    const fz = split.onFace(x, y) ? split.faceZ(x, y) : NaN;
    if (!Number.isNaN(fz)) { if (P[v * 3 + 2] > fz + R.lashRelief) { P[v * 3 + 2] = fz + R.lashRelief * 0.5; pressed++; } continue; }
    let best = -1, bd = 1e9; for (const a of anchors) { const d = (P[a * 3] - x) ** 2 + (P[a * 3 + 1] - y) ** 2 + (P[a * 3 + 2] - P[v * 3 + 2]) ** 2; if (d < bd) { bd = d; best = a; } }
    if (best >= 0) { P[v * 3] = P[best * 3]; P[v * 3 + 1] = P[best * 3 + 1]; P[v * 3 + 2] = P[best * 3 + 2]; collapsed++; } }
  return { pressed, collapsed };
}

/** HAIR RELIEF (universal, before the split): generated hair is often a smooth cap with the strand flow only PAINTED.
 *  The paint's own mid-scale luminance (lighter clump crests, darker partings — band-passed in 3D between a clump scale
 *  and a lock scale, normalised per head) becomes a small displacement along the normal: a few readable sculpted clumps
 *  that follow the painted flow, never noisy strands. Bounded to `reliefAmp`; skin and the face are never touched. */
export function hairRelief(m, rules) {
  const { P, N, label, LABEL, COL } = m, R = rules.layers, n = P.length / 3; if (!R.reliefAmp) return { moved: 0 };
  const lum = (v) => 0.3 * COL[v * 3] + 0.59 * COL[v * 3 + 1] + 0.11 * COL[v * 3 + 2];
  const blur = (cell) => { const acc = new Map(), key = (x, y, z) => `${x},${y},${z}`;
    for (let v = 0; v < n; v++) { if (label[v] !== LABEL.HAIR) continue; const k = key(Math.floor(P[v * 3] / cell), Math.floor(P[v * 3 + 1] / cell), Math.floor(P[v * 3 + 2] / cell)), a = acc.get(k) ?? [0, 0]; a[0] += lum(v); a[1]++; acc.set(k, a); }
    return (v) => { const x = Math.floor(P[v * 3] / cell), y = Math.floor(P[v * 3 + 1] / cell), z = Math.floor(P[v * 3 + 2] / cell); let s = 0, c = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const a = acc.get(key(x + dx, y + dy, z + dz)); if (a) { s += a[0]; c += a[1]; } } return c ? s / c : NaN; }; };
  const fine = blur(R.reliefFine), coarse = blur(R.reliefCoarse), band = new Float32Array(n).fill(NaN); let s2 = 0, c = 0;
  for (let v = 0; v < n; v++) { if (label[v] !== LABEL.HAIR) continue; const b = fine(v) - coarse(v); if (Number.isNaN(b)) continue; band[v] = b; s2 += b * b; c++; }
  const sd = Math.sqrt(s2 / Math.max(1, c)) || 1, paintW = Math.min(1, sd / R.reliefMinSd); let moved = 0;
  // SCULPT GATE: hair whose geometry already carries its structure (strands, locks — high local curvature relative to its
  // edge length) gets NO added relief: generated detail is never corrugated. Only smooth caps receive clumps.
  // lock-scale detail: median |normal offset| of hair vertices from their 3D neighbourhood mean (cell reliefCell)
  let detail = 0; { const C = R.reliefCell, acc = new Map(), key = (x, y, z) => `${x},${y},${z}`;
    for (let v = 0; v < n; v++) { if (label[v] !== LABEL.HAIR) continue; const k = key(Math.floor(P[v * 3] / C), Math.floor(P[v * 3 + 1] / C), Math.floor(P[v * 3 + 2] / C)), a = acc.get(k) ?? [0, 0, 0, 0]; a[0] += P[v * 3]; a[1] += P[v * 3 + 1]; a[2] += P[v * 3 + 2]; a[3]++; acc.set(k, a); }
    const dev = []; for (let v = 0; v < n; v += 5) { if (label[v] !== LABEL.HAIR) continue; const x = Math.floor(P[v * 3] / C), y = Math.floor(P[v * 3 + 1] / C), z = Math.floor(P[v * 3 + 2] / C), mu = [0, 0, 0]; let c2 = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) { const a = acc.get(key(x + dx, y + dy, z + dz)); if (a) { mu[0] += a[0]; mu[1] += a[1]; mu[2] += a[2]; c2 += a[3]; } }
      dev.push(Math.abs((P[v * 3] - mu[0] / c2) * N[v * 3] + (P[v * 3 + 1] - mu[1] / c2) * N[v * 3 + 1] + (P[v * 3 + 2] - mu[2] / c2) * N[v * 3 + 2])); }
    dev.sort((a, b) => a - b); detail = dev.length ? dev[dev.length >> 1] : 1; }
  const gate = 1 - sm(R.reliefDetailLo, R.reliefDetailHi, detail);   // sculpted hair (≥ hi) is never touched if (gate <= 0.01) return { moved: 0, detail: +detail.toFixed(4), gate: 0 };
  // where the paint carries little flow (generated hair is often near-flat black), a conservative PROCEDURAL clump flow
  // takes over: locks radiating from the crown (meridian bands around it, gently wavy along their length), fading out at
  // the crown itself — the hair falls from the crown in readable locks instead of a smooth cap
  let cx = 0, cz = 0, cy = -9, cn = 0; for (let v = 0; v < n; v++) if (label[v] === LABEL.HAIR) cy = Math.max(cy, P[v * 3 + 1]);
  for (let v = 0; v < n; v++) if (label[v] === LABEL.HAIR && P[v * 3 + 1] > cy - 0.04) { cx += P[v * 3]; cz += P[v * 3 + 2]; cn++; } cx /= Math.max(1, cn); cz /= Math.max(1, cn);
  for (let v = 0; v < n; v++) { if (label[v] !== LABEL.HAIR) continue; const x = P[v * 3] - cx, y = P[v * 3 + 1], z = P[v * 3 + 2] - cz, r = Math.hypot(x, z), fall = cy - y + r;
    const th = Math.atan2(x, z), wav = Math.sin(fall * 9) * 0.35, band2 = Math.cos(R.clumps * th + wav * Math.PI), proc = (band2 * band2 * 2 - 1) * sm(0.02, 0.12, fall);
    const tex = Number.isNaN(band[v]) ? 0 : Math.max(-1.6, Math.min(1.6, band[v] / sd)) / 1.6;
    const d = (tex * paintW + proc * (1 - paintW)) * R.reliefAmp * gate; if (Math.abs(d) < 1e-5) continue;
    for (let k = 0; k < 3; k++) P[v * 3 + k] += N[v * 3 + k] * d; moved++; }
  return { moved, bandSd: +sd.toFixed(2), paintDriven: +paintW.toFixed(2), detail: +detail.toFixed(4), gate: +gate.toFixed(2) };
}

/** TIED STYLES, sides: hair at the SIDES behind the face plane and below the tie is combed back toward the tie (x in,
 *  z back), kept outside the canonical skull — side and back hair visibly flow into the gathering point. Hair in front of
 *  the face plane (fringe, a front sweep, a long front lock) is never moved. */
/** ROOT ANCHORING for hair edits (tie gather, side comb): hair grown out of the head shell keeps its ROOTS where they
 *  leave the skin — the move ramps in from 0 over `ramp` of geodesic distance from the nearest skin vertex. Moving only
 *  the hair-labelled vertices stretched the mixed hair/skin triangles at every hairline into spikes. Detached strand
 *  shells (no skin neighbour) move whole. Returns a per-vertex weight 0..1. */
export function hairRootWeights(P, I, isHair, ramp) {
  const n = P.length / 3, rep = new Int32Array(n), seen = new Map(), q = (x) => Math.round(x * 2e4) + 65536;
  for (let v = 0; v < n; v++) { const k = (q(P[v * 3]) * 131072 + q(P[v * 3 + 1])) * 131072 + q(P[v * 3 + 2]), r = seen.get(k); if (r === undefined) { seen.set(k, v); rep[v] = v; } else rep[v] = r; }
  seen.clear();
  const hairRep = new Uint8Array(n), skinRep = new Uint8Array(n); for (let v = 0; v < n; v++) (isHair(v) ? hairRep : skinRep)[rep[v]] = 1;
  // CSR adjacency over reps
  const deg = new Int32Array(n + 1); for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) deg[rep[I[t + k]]] += 2;
  const off = new Int32Array(n + 1); for (let v = 0; v < n; v++) off[v + 1] = off[v] + deg[v]; const fill = off.slice(0, n), adj = new Int32Array(off[n]);
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = rep[I[t + k]], b = rep[I[t + (k + 1) % 3]], c = rep[I[t + (k + 2) % 3]]; adj[fill[a]++] = b; adj[fill[a]++] = c; }
  // typed binary heap (lazy deletion)
  const d = new Float64Array(n).fill(Infinity); let cap = 1 << 20, HK = new Float64Array(cap), HV = new Int32Array(cap), hn = 0;
  const push = (v, dv) => { if (hn === cap) { cap *= 2; const K2 = new Float64Array(cap), V2 = new Int32Array(cap); K2.set(HK); V2.set(HV); HK = K2; HV = V2; }
      let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (HK[p] <= dv) break; HK[i] = HK[p]; HV[i] = HV[p]; i = p; } HK[i] = dv; HV[i] = v; },
    pop = () => { const v = HV[0], kv = HK[0], lk = HK[--hn], lv = HV[hn]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = -1, mk = lk; if (l < hn && HK[l] < mk) { m = l; mk = HK[l]; } if (r < hn && HK[r] < mk) { m = r; mk = HK[r]; } if (m < 0) break; HK[i] = HK[m]; HV[i] = HV[m]; i = m; } HK[i] = lk; HV[i] = lv; popK = kv; return v; };
  let popK = 0;
  const len = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  // the root is where hair meets skin: a hair rep that is ALSO skin (shared seam vertex) or touches a skin rep
  for (let v = 0; v < n; v++) { if (rep[v] !== v || !hairRep[v]) continue; if (skinRep[v]) { d[v] = 0; push(v, 0); continue; }
    for (let j = off[v]; j < off[v + 1]; j++) { const u = adj[j]; if (skinRep[u] && !hairRep[u]) { const dv = 0.5 * len(v, u); if (dv < d[v]) { d[v] = dv; push(v, dv); } } } }
  while (hn) { const v = pop(), dv = popK; if (dv > d[v] || dv > ramp) continue;
    for (let j = off[v]; j < off[v + 1]; j++) { const u = adj[j]; if (!hairRep[u]) continue; const du = dv + len(v, u); if (du < d[u]) { d[u] = du; push(u, du); } } }
  const w = new Float32Array(n); for (let v = 0; v < n; v++) { const t = Math.min(1, d[rep[v]] / ramp); w[v] = t * t * (3 - 2 * t); }
  return w;
}
export function combSidesToTie(m, tie, rules) {
  const { P, label, LABEL, after, skull, skullCentre: c, lm } = m, R = rules.layers, tieY = lm.eyes.l[1] + ({ low: -0.13, mid: 0.03, high: 0.22 }[tie] ?? -0.13);
  // (V1.3: only hair BEHIND the ear plane — a face-framing side lock / sideburn in front of the ear keeps its shape)
  const earZ = after.ears.z, faceZ = earZ - 0.02; let moved = 0;
  for (let v = 0; v < P.length / 3; v++) { if (label[v] !== LABEL.HAIR) continue; let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (z > faceZ || y > tieY + 0.12 || Math.abs(x) < 0.12) continue;
    const w = sm(faceZ, earZ - 0.1, z) * sm(tieY + 0.12, tieY - 0.05, y) * sm(0.12, 0.28, Math.abs(x)); if (w <= 0) continue;
    x *= 1 - R.combIn * w; z -= R.combBack * w * sm(0.2, 0.45, Math.abs(P[v * 3]));
    const ex = skull(x, y, z); if (ex < R.scalpThickness * 0.6) { const d = [x - c[0], y - c[1], z - c[2]], r = Math.hypot(...d), f = (r + R.scalpThickness * 0.6 - ex) / r; x = c[0] + d[0] * f; y = c[1] + d[1] * f; z = c[2] + d[2] * f; }
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z; moved++; }
  return { moved };
}

/** HAIR BASE CAP (universal): generated hair is often strand shells with gaps — behind the ears and at the nape the scalp
 *  (skin) shows between them, and when side hair is combed toward a tie it opens further. A clean hair-coloured base is
 *  laid UNDER the hair over the skull behind the face plane: per direction from the cranium centre, just inside the
 *  innermost hair (never in front of it → no z-fighting), a little off the canonical skull, stepping behind a protruding
 *  ear; it ends at a SMOOTHED hairline (the hair's own lower edge per azimuth, blurred) and dives into the head there, so
 *  the nape reads as a deliberate hairline. Returns a part { P, I, N, J, W } (rigid on Head) or null. */
export function hairBaseCap(m, rules) {
  const { P, label, LABEL, skullMap, after, headJoint, lm, tie } = m, R = rules.layers, n = P.length / 3, CC = skullMap.CC, eyeY = lm.eyes.l[1];
  const NT = 128, NP = 256, hairMin = new Float32Array(NT * NP).fill(9), skinMin = new Float32Array(NT * NP).fill(9), skinMax = new Float32Array(NT * NP).fill(-1);
  const dirOf = (x, y, z) => { const dx = x - CC[0], dy = y - CC[1], dz = z - CC[2], r = Math.hypot(dx, dy, dz) || 1e-9; return [Math.min(NT - 1, Math.floor(Math.acos(Math.max(-1, Math.min(1, dy / r))) / Math.PI * NT)), Math.min(NP - 1, Math.floor((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * NP)), r]; };
  for (let v = 0; v < n; v++) { const [t, p, r] = dirOf(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]), k = t * NP + p; if (label[v] === LABEL.HAIR) { if (r < hairMin[k]) hairMin[k] = r; } else { if (r < skinMin[k]) skinMin[k] = r; if (r > skinMax[k]) skinMax[k] = r; } }
  const dirVec = (t, p) => { const th = ((t + 0.5) / NT) * Math.PI, ph = ((p + 0.5) / NP) * 2 * Math.PI - Math.PI; return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; };
  const skullR = (d) => 1 - skullMap.excess(CC[0] + d[0], CC[1] + d[1], CC[2] + d[2]);   // excess at unit radius → skull radius
  // the hairline per azimuth: the lowest polar row reached by hair continuously from the crown, blurred round the head
  const line = new Float32Array(NP);
  for (let p = 0; p < NP; p++) { let last = -1, miss = 0; for (let t = 0; t < NT; t++) { if (hairMin[t * NP + p] < 8) { last = t; miss = 0; } else if (++miss > 6 && last >= 0) break; } line[p] = last; }
  // TIED styles: the hair is swept up — the base reaches a deliberate hairline: above the ears at the sides (eye height),
  // down to the neck junction at the back centre (a deliberate nape hairline), whatever the gathered strands left uncovered
  // (the row is found on the ACTUAL skull surface in that azimuth — a nominal-radius conversion put the back line ~7 cm-eq
  // too high and left the lower back of a tied head bare)
  const rowAtY = (p, yT) => { for (let t = 0; t < NT; t++) { const d = dirVec(t, p); if (CC[1] + d[1] * skullR(d) < yT) return t - 0.5; } return NT - 1; };
  // V1.3: the back line reaches the MEASURED nape (lowest head skin at the back centre + 2 cm-eq) — long hair gathered up
  // covers the whole occiput; at the ear azimuths the line runs at the lobe and the cap tucks behind the real ear
  let napeY = 9; for (let v = 0; v < n; v++) if (label[v] !== LABEL.HAIR && Math.abs(P[v * 3]) < 0.1 && P[v * 3 + 2] < after.ears.z - 0.12) napeY = Math.min(napeY, P[v * 3 + 1]);
  const backLo = napeY < 8 ? Math.min(eyeY - 0.22, napeY + 0.02) : eyeY - 0.22;
  if (tie) for (let p = 0; p < NP; p++) { if (line[p] < 0) continue; const ph = ((p + 0.5) / NP) * 2 * Math.PI - Math.PI, back = Math.max(0, -Math.sin(ph)) ** 0.7;
    line[p] = Math.max(line[p], rowAtY(p, eyeY - 0.12 + (backLo - eyeY + 0.12) * back)); }
  for (let pass = 0; pass < 4; pass++) { const c = line.slice(); for (let p = 0; p < NP; p++) { let s = 0, w = 0; for (let d = -6; d <= 6; d++) { const v = c[(p + d + NP) % NP]; if (v < 0) continue; s += v; w++; } line[p] = w ? s / w : -1; } }
  // the radius field: just inside the innermost hair, a little off the skull, over exposed scalp skin, behind protruding
  // ears — then min-filtered and blurred (no per-bin steps; conservatively never in front of the hair)
  const Rr = new Float32Array(NT * NP).fill(NaN);
  // EAR OUTLINE (capEarOutline, opt-in, 2026-10-13): the cap never covers an ear. Removing the cap made the ears clean, and every
  // per-direction skin test (the v21 heuristic) still left a notch — a shallow concha / cymba stands off the skull less than the cap's
  // own offset and cannot be told from scalp one direction at a time. The ear is found from its PROTRUDING geometry instead (skin
  // standing off the skull by more than capEar: helix / antihelix), seeded in the ear box (standing-off skin elsewhere is scalp residue)
  // and followed through protruding skin in the ear's neighbourhood; its outline on the cap grid is the CONVEX HULL of those cells per
  // side, grown by EAR_MARGIN cells — the concha always lies inside its rim's hull, whatever its own depth. No cap is built (or
  // pocket-filled) inside the outline; at that new edge the cap dives into the head exactly like its hairline (0.03, squared ramp, two cells).
  const EAR_MARGIN = 1, earOut = new Uint8Array(NT * NP), earDist = new Float32Array(NT * NP).fill(9);
  if (rules.capEarOutline) { const prot = (t, p) => { const k = t * NP + p; return skinMax[k] > 0 && skinMax[k] > skullR(dirVec(t, p)) + R.capEar; };
    const near = (d) => Math.abs(CC[1] + d[1] * 0.42 - eyeY + 0.01) < 0.3 && Math.abs(d[0]) > 0.45 && Math.abs(CC[2] + d[2] * 0.42 - after.ears.z) < 0.2;
    const inBox = (d) => Math.abs(CC[1] + d[1] * 0.42 - eyeY + 0.01) < 0.11 && Math.abs(d[0]) > 0.62 && Math.abs(CC[2] + d[2] * 0.42 - after.ears.z) < 0.09;
    const ear = new Uint8Array(NT * NP), q = []; for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) if (inBox(dirVec(t, p)) && prot(t, p)) { ear[t * NP + p] = 1; q.push(t * NP + p); }
    while (q.length) { const k = q.pop(), t = Math.floor(k / NP), p = k % NP; for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; const pp = (p + dp + NP) % NP, kk = tt * NP + pp; if (!ear[kk] && near(dirVec(tt, pp)) && prot(tt, pp)) { ear[kk] = 1; q.push(kk); } } }
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const hull = (pts) => { const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), lo = [], up = []; for (const x of P) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], x) <= 0) lo.pop(); lo.push(x); }
      for (let i = P.length - 1; i >= 0; i--) { const x = P[i]; while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], x) <= 0) up.pop(); up.push(x); } return lo.slice(0, -1).concat(up.slice(0, -1)); };   // CCW in (t, u)
    for (const side of [1, -1]) { const U = (p) => (side > 0 ? p : (p + NP / 2) % NP), pts = [];   // u: azimuth unwrapped so this side's ear never straddles the seam
      for (let k = 0; k < NT * NP; k++) if (ear[k]) { const t = Math.floor(k / NP), p = k % NP; if (Math.sign(dirVec(t, p)[0]) === side) pts.push([t, U(p)]); }
      if (pts.length < 6) continue; const H = hull(pts); if (H.length < 3) continue;
      const E = H.map((a, i) => { const b = H[(i + 1) % H.length], e = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(...e); return [a, [e[1] / l, -e[0] / l]]; });   // each edge's outward normal
      const T0 = Math.max(0, Math.min(...H.map((h) => h[0])) - 4), T1 = Math.min(NT - 1, Math.max(...H.map((h) => h[0])) + 4), u0 = Math.min(...H.map((h) => h[1])) - 4, u1 = Math.max(...H.map((h) => h[1])) + 4;
      for (let t = T0; t <= T1; t++) for (let u = u0; u <= u1; u++) { const sd = Math.max(...E.map(([a, n]) => (t - a[0]) * n[0] + (u - a[1]) * n[1])) - EAR_MARGIN, uu = ((u % NP) + NP) % NP, p = side > 0 ? uu : (uu + NP / 2) % NP, k = t * NP + p;
        if (sd <= 0) earOut[k] = 1; else earDist[k] = Math.min(earDist[k], sd); } } }
  for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const lim = line[p]; if (lim < 0 || t > lim + 2) continue; const d = dirVec(t, p);
    if (CC[2] + d[2] * 0.42 > after.ears.z + R.capFront) continue;   // never over the face / temples
    if (earOut[t * NP + p]) continue;   // capEarOutline: never over an ear
    const rs = skullR(d), hm = hairMin[t * NP + p], sk = skinMin[t * NP + p], y = CC[1] + d[1] * 0.42, earZone = Math.abs(y - eyeY + 0.01) < 0.11 && Math.abs(d[0]) > 0.62 && Math.abs(CC[2] + d[2] * 0.42 - after.ears.z) < 0.09;   // the real ear box (skin standing off elsewhere is scalp residue: covered)
    let r = rs + R.capOffset; if (hm < 8) r = Math.min(r, hm - R.capGap);
    if (sk < 8 && earZone && sk > rs + R.capEar) r = Math.min(r, sk - R.capGap); else if (sk < 8 && sk > rs - 0.03) r = Math.max(r, sk + R.capGap);
    Rr[t * NP + p] = Math.max(r, rs + 0.002); }
  // POCKET CLOSURE (V1.4, universal): skin left uncovered BETWEEN hair (a wedge between temple hair and the cap above the ear,
  // a gap between swept side hair and the nape) is never a hairstyle feature — per polar row and per azimuth column, an
  // uncovered run bounded by hair / cap on both ends (≤ 45° wide, ≤ 14 rows tall) on the SIDE / BACK of the head is covered by
  // the cap. Never the face (front of the ear plane + capPocket), never the ear box.
  let pockets = 0;
  { const isCov = (t, p) => !Number.isNaN(Rr[t * NP + p]) || hairMin[t * NP + p] < 8;
    const cellOK = (t, p) => { const d = dirVec(t, p), x = d[0] * 0.42, y = CC[1] + d[1] * 0.42, z = CC[2] + d[2] * 0.42; if (y < eyeY - 0.04 || z > after.ears.z + (R.capPocket ?? 0.18) || Math.abs(x) < 0.2) return false;
      return !(Math.abs(y - eyeY + 0.01) < 0.11 && Math.abs(d[0]) > 0.62 && Math.abs(z - after.ears.z) < 0.09) && !earOut[t * NP + p]; };
    const fillCell = (t, p) => { const k = t * NP + p; if (!Number.isNaN(Rr[k])) return; const d = dirVec(t, p), rs = skullR(d), sk = skinMin[k]; let r = rs + R.capOffset; if (sk < 8 && sk > rs - 0.03) r = Math.max(r, sk + R.capGap); Rr[k] = Math.max(r, rs + 0.002); pockets++; };
    const MAXP = Math.round(NP / 8), MAXT = 14, todo = [];
    for (let t = 0; t < NT; t++) { let p0 = -1; for (let q = 0; q < 2 * NP; q++) { const p = q % NP; if (isCov(t, p)) { if (p0 >= 0 && q - p0 - 1 > 0 && q - p0 - 1 <= MAXP) { const run = []; for (let qq = p0 + 1; qq < q; qq++) run.push([t, qq % NP]); if (run.every(([a, b]) => cellOK(a, b))) todo.push(...run); } p0 = q; } } }
    for (let p = 0; p < NP; p++) { let t0 = -1; for (let t = 0; t < NT; t++) { if (isCov(t, p)) { if (t0 >= 0 && t - t0 - 1 > 0 && t - t0 - 1 <= MAXT) { const run = []; for (let tt = t0 + 1; tt < t; tt++) run.push([tt, p]); if (run.every(([a, b]) => cellOK(a, b))) todo.push(...run); } t0 = t; } } }
    // CONDITIONAL: only a real pocket (enough enclosed cells) is closed — stray cells on a good head are left alone
    if (todo.length >= (rules.pocketMinCells ?? 0)) for (const [t, p] of todo) fillCell(t, p); }
  const filt = (A, op) => { const B = A.slice(); for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p; if (Number.isNaN(A[k])) continue; let acc = op === "min" ? 9 : 0, c = 0;
      for (let dt = -1; dt <= 1; dt++) for (let dp = -1; dp <= 1; dp++) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; const v = A[tt * NP + ((p + dp) % NP + NP) % NP]; if (Number.isNaN(v)) continue; if (op === "min") acc = Math.min(acc, v); else { acc += v; c++; } }
      B[k] = op === "min" ? acc : acc / c; } return B; };
  let Rf = filt(filt(Rr, "min"), "min"); for (let i = 0; i < 4; i++) Rf = filt(Rf, "avg");
  const P2 = [], idx = new Int32Array(NT * NP).fill(-1); let cnt = 0;
  for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p; if (Number.isNaN(Rf[k])) continue; const d = dirVec(t, p), lim = line[p];
    const edge = Math.max(0, Math.min(1, (t - lim) / 2)), fe = earDist[k] < 2 ? 1 - earDist[k] / 2 : 0, r = Rf[k] - Math.max(edge * edge, fe * fe) * 0.03;   // at the hairline (and, with capEarOutline, the ear outline) the cap dives into the head
    idx[k] = cnt++; P2.push(CC[0] + d[0] * r, CC[1] + d[1] * r, CC[2] + d[2] * r); }
  if (cnt < 50) return null;
  if (process.env.HB_CAPDIAG) { const cells = []; for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p, d = dirVec(t, p); if (Math.abs(d[0]) < 0.4) continue;   // DIAGNOSTIC ONLY (env): per-cell cap inputs at the sides of the head
      cells.push([t, p, +skullR(d).toFixed(4), skinMin[k] < 8 ? +skinMin[k].toFixed(4) : null, skinMax[k] > 0 ? +skinMax[k].toFixed(4) : null, hairMin[k] < 8 ? +hairMin[k].toFixed(4) : null, Number.isNaN(Rf[k]) ? null : +Rf[k].toFixed(4), +(CC[1] + d[1] * 0.42).toFixed(4), +(CC[2] + d[2] * 0.42).toFixed(4), +d[0].toFixed(3)]); }
    process.getBuiltinModule("node:fs").writeFileSync(process.env.HB_CAPDIAG, JSON.stringify({ NT, NP, eyeY, earsZ: after.ears.z, capFront: R.capFront, cols: ["t", "p", "rs", "skMin", "skMax", "hairMin", "Rf", "y42", "z42", "dx"], line: Array.from(line), cells })); }
  const I2 = []; for (let t = 0; t < NT - 1; t++) for (let p = 0; p < NP; p++) { const a = idx[t * NP + p], b = idx[t * NP + (p + 1) % NP], c = idx[(t + 1) * NP + p], dd = idx[(t + 1) * NP + (p + 1) % NP]; if (a < 0 || b < 0 || c < 0 || dd < 0) continue; I2.push(a, b, c, b, dd, c); }
  const Pf = Float32Array.from(P2), N = new Float32Array(Pf.length);
  for (let i = 0; i < Pf.length / 3; i++) { const dx = Pf[i * 3] - CC[0], dy = Pf[i * 3 + 1] - CC[1], dz = Pf[i * 3 + 2] - CC[2], l = Math.hypot(dx, dy, dz) || 1; N[i * 3] = dx / l; N[i * 3 + 1] = dy / l; N[i * 3 + 2] = dz / l; }
  for (let t = 0; t < I2.length; t += 3) { const a = I2[t], b = I2[t + 1], c = I2[t + 2], e1 = [0, 1, 2].map((k) => Pf[b * 3 + k] - Pf[a * 3 + k]), e2 = [0, 1, 2].map((k) => Pf[c * 3 + k] - Pf[a * 3 + k]);
    const nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; if (nn[0] * N[a * 3] + nn[1] * N[a * 3 + 1] + nn[2] * N[a * 3 + 2] < 0) { I2[t + 1] = c; I2[t + 2] = b; } }
  const nv = Pf.length / 3;
  return { P: Pf, N, I: I2, J: new Uint8Array(nv * 4).map((_, k) => (k % 4 === 0 ? headJoint : 0)), W: new Float32Array(nv * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), info: { verts: nv, tris: I2.length / 3, pocketsClosed: pockets }, line, grid: { NT, NP } };
}

/** HAIR FLOW FIELD (universal; feeds the runtime flow highlights): the hairstyle's root→tip direction and its LOCK LANES,
 *  from the style's own structure — hair falls from the CROWN (the hair's top centre), so lanes are azimuth bands around
 *  the crown axis gently curving along the fall; a TIED style's back/side hair flows toward its TIE point (lanes = angle
 *  around the tie), and the tail continues it. One field for every layer (scalp, main, back, fringe, base cap) so the
 *  highlights continue across technically separate pieces. Returns (p, n) → { t: tangent, c: lane mask 0..1 }. */
export function flowField(m, rules) {
  const { P, label, LABEL, lm, after, tie } = m, R = rules.layers, n = P.length / 3;
  let cy = -9; for (let v = 0; v < n; v++) if (label[v] === LABEL.HAIR) cy = Math.max(cy, P[v * 3 + 1]);
  let cx = 0, cz = 0, cn = 0; for (let v = 0; v < n; v++) if (label[v] === LABEL.HAIR && P[v * 3 + 1] > cy - 0.05) { cx += P[v * 3]; cz += P[v * 3 + 2]; cn++; } cx /= Math.max(1, cn); cz /= Math.max(1, cn);
  const tieY = tie ? lm.eyes.l[1] + ({ low: -0.13, mid: 0.03, high: 0.22 }[tie] ?? -0.13) : null, tieP = tie ? [0, tieY, after.ears.z - 0.42] : null;
  const proj = (v, nn) => { const d = v[0] * nn[0] + v[1] * nn[1] + v[2] * nn[2]; const t = [v[0] - nn[0] * d, v[1] - nn[1] * d, v[2] - nn[2] * d], l = Math.hypot(...t) || 1; return t.map((x) => x / l); };
  const lanes = (a, fall) => { const s = 0.5 + 0.5 * Math.cos(R.flowLanes * a + 1.1 * Math.sin(fall * 6)); return s ** 6; };   // a few broad lock lanes
  return (p, nn) => {
    const [x, y, z] = p, fall = cy - y + Math.hypot(x - cx, z - cz);
    // crown flow: down and away from the crown along the surface
    let t = proj([x - cx, (y - cy) - 0.25, z - cz], nn), c = lanes(Math.atan2(x - cx, z - cz), fall);
    if (tieP) { const w = Math.min(1, Math.max(0, (after.ears.z + 0.05 - z) / 0.2)) * Math.min(1, Math.max(0, (cy - 0.04 - y) / 0.1));
      if (w > 0) { const tt = proj([tieP[0] - x, tieP[1] - y, tieP[2] - z], nn), ct = lanes(Math.atan2(x - tieP[0], y - tieP[1]) * 1.4, Math.hypot(x - tieP[0], y - tieP[1]));
        t = t.map((v, k) => v * (1 - w) + tt[k] * w); const l = Math.hypot(...t) || 1; t = t.map((v) => v / l); c = c * (1 - w) + ct * w; } }
    return { t, c };
  };
}

/**
 * MIRROR-TWIN FACE REBUILD (V1.2, universal). The face under a lock is rebuilt from its twin, at texel precision: every
 * rebuild-target triangle (split.rebuild — the underlay of every fused lock, and on a CONTAMINATED side the whole eye /
 * lid / brow zone) is rasterised in texture space; each texel's surface point is mirrored about the face's own eye
 * midline and the twin side's texel there is copied (exact barycentric lookup on the front-most face triangle). A
 * gradient-domain correction (harmonic fill of the skin-colour difference measured along the rebuild border) makes the
 * transplant continue the surrounding skin with no seam. Where the twin is itself covered (both sides under hair), the
 * surrounding skin is continued harmonically. Mutates img.rgb. The fringe keeps its own texels (fringe texture page), so
 * nothing here can repaint the hair.
 */
export function rebuildFaceTexels({ P, I, UV, img, split, after, layerHead, weight }) {   // weight: the twin-geometry transplant's per-vertex weight — paint follows geometry exactly
  const nt = I.length / 3, TW = img.width, TH = img.height, src = Uint8Array.from(img.rgb);
  const axis = (after.eyes.l.c[0] + after.eyes.r.c[0]) / 2, eyeDY = after.eyes.r.c[1] - after.eyes.l.c[1], front = after.ears.z + after.eyes.sep * 0.25;
  const G = { x0: -0.6, y0: after.chin - 0.08, c: 0.0015 }; G.nx = Math.ceil(1.2 / G.c); G.ny = Math.ceil((after.eyes.y + 0.62 - G.y0) / G.c);
  const own = new Int32Array(G.nx * G.ny).fill(-1), zb = new Float32Array(G.nx * G.ny).fill(-9);
  const px = (v) => [(P[v * 3] - G.x0) / G.c, (P[v * 3 + 1] - G.y0) / G.c, P[v * 3 + 2]];
  for (let t = 0; t < nt; t++) { if (!((split.layer[t] === layerHead && !split.under[t]) || split.feature[t]) || split.drop[t]) continue; const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2]; if ((P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3 < front) continue;
    const q = [px(a), px(b), px(c)], ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-12) continue;
    for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(G.ny - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(G.nx - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
        if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue; const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], k = y * G.nx + x; if (z <= zb[k]) continue; zb[k] = z; own[k] = t; } }
  const tex = (u, v) => { const fx = Math.min(TW - 1.001, Math.max(0, u * TW - 0.5)), fy = Math.min(TH - 1.001, Math.max(0, v * TH - 0.5)), x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, o = [];
    for (let k = 0; k < 3; k++) { const g = (x, y) => src[(y * TW + x) * 3 + k]; o.push((g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty); } return o; };
  // the surface colour at (x, y) on a NON-target face triangle (the twin), or null
  const surf = (x, y) => { const i = Math.round((x - G.x0) / G.c), j = Math.round((y - G.y0) / G.c); if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) return null; const t = own[j * G.nx + i]; if (t < 0 || split.rebuild[t]) return null;
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2], ar = (P[b * 3] - P[a * 3]) * (P[c * 3 + 1] - P[a * 3 + 1]) - (P[c * 3] - P[a * 3]) * (P[b * 3 + 1] - P[a * 3 + 1]); if (Math.abs(ar) < 1e-14) return null;
    let w0 = ((P[b * 3] - x) * (P[c * 3 + 1] - y) - (P[c * 3] - x) * (P[b * 3 + 1] - y)) / ar, w1 = ((P[c * 3] - x) * (P[a * 3 + 1] - y) - (P[a * 3] - x) * (P[c * 3 + 1] - y)) / ar, w2 = 1 - w0 - w1;
    w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2); const s = w0 + w1 + w2; w0 /= s; w1 /= s; w2 /= s;
    return tex(w0 * UV[a * 2] + w1 * UV[b * 2] + w2 * UV[c * 2], w0 * UV[a * 2 + 1] + w1 * UV[b * 2 + 1] + w2 * UV[c * 2 + 1]); };
  const mirror = (x, y) => surf(2 * axis - x, y + (x > axis ? -eyeDY : eyeDY));
  // ---- seam correction field D (twin → local skin) and the fallback fill F, both harmonic over the target cells ----
  const T = new Uint8Array(G.nx * G.ny); for (let k = 0; k < T.length; k++) if (own[k] >= 0 && split.rebuild[own[k]]) T[k] = 1;
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const D = new Float32Array(G.nx * G.ny * 3), F = new Float32Array(G.nx * G.ny * 3), fixD = new Uint8Array(G.nx * G.ny), fixF = new Uint8Array(G.nx * G.ny);
  const skinL = (() => { const ls = []; for (let k = 0; k < T.length; k += 7) if (own[k] >= 0 && !T[k]) { const x = G.x0 + (k % G.nx) * G.c, y = G.y0 + ((k / G.nx) | 0) * G.c, s = surf(x, y); if (s) ls.push(lum(s)); } ls.sort((a, b) => a - b); return ls[ls.length >> 1] ?? 180; })();
  let border = 0;
  for (let k = 0; k < T.length; k++) { if (T[k] || own[k] < 0) continue; const i = k % G.nx; if (!((i > 0 && T[k - 1]) || (i < G.nx - 1 && T[k + 1]) || T[k - G.nx] || T[k + G.nx])) continue;
    const x = G.x0 + i * G.c, y = G.y0 + ((k / G.nx) | 0) * G.c, s = surf(x, y); if (!s || lum(s) < 0.6 * skinL) continue;   // skin borders only (a brow edge is not a skin reference)
    for (let c = 0; c < 3; c++) F[k * 3 + c] = s[c]; fixF[k] = 1;
    const m = mirror(x, y); if (m && lum(m) > 0.6 * skinL) { for (let c = 0; c < 3; c++) D[k * 3 + c] = Math.max(-30, Math.min(30, s[c] - m[c])); fixD[k] = 1; border++; } }
  const relax = (A, fix) => { const cells = []; for (let k = 0; k < T.length; k++) if (T[k]) cells.push(k);
    for (let it = 0; it < 400; it++) for (const k of cells) { let s0 = 0, s1 = 0, s2 = 0, n = 0; for (const k2 of [k - 1, k + 1, k - G.nx, k + G.nx]) { if (k2 < 0 || k2 >= T.length || !(T[k2] || fix[k2])) continue; s0 += A[k2 * 3]; s1 += A[k2 * 3 + 1]; s2 += A[k2 * 3 + 2]; n++; } if (n) { A[k * 3] = s0 / n; A[k * 3 + 1] = s1 / n; A[k * 3 + 2] = s2 / n; } } };
  relax(D, fixD); relax(F, fixF);
  const field = (A, x, y) => { const i = Math.min(G.nx - 1, Math.max(0, Math.round((x - G.x0) / G.c))), j = Math.min(G.ny - 1, Math.max(0, Math.round((y - G.y0) / G.c))), k = j * G.nx + i; return [A[k * 3], A[k * 3 + 1], A[k * 3 + 2]]; };
  // TEXEL OWNERSHIP (V1.3): generated textures map mirrored halves onto SHARED texels — a texel any surface outside the
  // rebuild uses is never written (writing it repainted the clean twin too; where texels are shared the rebuild target
  // already shows the twin's paint)
  const keepT = new Uint8Array(TW * TH);
  for (let t = 0; t < nt; t++) { if (split.rebuild[t] || split.drop[t] || (split.layer[t] === HAIR_LAYER.FRINGE && !split.under[t])) continue; const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const q = [a, b, c].map((v) => [UV[v * 2] * TW - 0.5, UV[v * 2 + 1] * TH - 0.5]), ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
    for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 1); y <= Math.min(TH - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 1); y++)
      for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 1); x <= Math.min(TW - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 1); x++) {
        if (Math.abs(ar) < 1e-9) { if (q.some((p2) => Math.abs(p2[0] - x) <= 1 && Math.abs(p2[1] - y) <= 1)) keepT[y * TW + x] = 1; continue; }
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, e = 1 / Math.sqrt(Math.abs(ar)); if (w0 > -e && w1 > -e && 1 - w0 - w1 > -e) keepT[y * TW + x] = 1; } }
  // ---- the texels ----
  let mirrored = 0, filled = 0, shared = 0;
  for (let t = 0; t < nt; t++) { if (!split.rebuild[t]) continue; const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const q = [a, b, c].map((v) => [UV[v * 2] * TW - 0.5, UV[v * 2 + 1] * TH - 0.5]), ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-9) continue;
    const tol = Math.min(0.6, 2 / Math.sqrt(Math.abs(ar)));   // ≈ 1.5 texels past every edge: bilinear filtering never reads an unwritten texel
    for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 2); y <= Math.min(TH - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 2); y++)
      for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 2); x <= Math.min(TW - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 2); x++) {
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
        if (w0 < -tol || w1 < -tol || w2 < -tol) continue;
        const X = w0 * P[a * 3] + w1 * P[b * 3] + w2 * P[c * 3], Y = w0 * P[a * 3 + 1] + w1 * P[b * 3 + 1] + w2 * P[c * 3 + 1], m = mirror(X, Y), o = (y * TW + x) * 3;
        // fused-lock underlay: always rebuilt (its own texels are hair); elsewhere the paint follows the geometry's weight
        const ww = split.under[t] || !weight ? 1 : Math.max(0, Math.min(1, w0 * weight[a] + w1 * weight[b] + w2 * weight[c])); if (ww <= 0.001) continue;
        if (keepT[y * TW + x]) { shared++; continue; }
        const put = (c3) => { for (let k = 0; k < 3; k++) img.rgb[o + k] = Math.max(0, Math.min(255, Math.round(src[o + k] + (c3[k] - src[o + k]) * ww))); };
        if (m) { const d = field(D, X, Y); put([m[0] + d[0], m[1] + d[1], m[2] + d[2]]); mirrored++; }
        else { const f = field(F, X, Y); if (f[0] + f[1] + f[2] > 0) { put(f); filled++; } } } }
  return { mirrored, filled, sharedTexelsKept: shared, borderSamples: border, skinLum: Math.round(skinL) };
}

/**
 * FRINGE TEXTURE PAGE (V1.2): the foreground fringe owns its texels. Its islands are copied texel-exact out of the
 * ORIGINAL head texture (captured before any face rebuild) into a compact atlas of its own, and every face-painted texel
 * inside a lock (skin, eye white, lid paint projected across a strand) is replaced by hair colour — the lock is hair from
 * every angle, and the face beneath can be rebuilt freely.
 */
export async function fringeTexturePage({ img, UV, I, isFacePaint, hairRGB, pad }, repackAtlas) {
  const r = await repackAtlas(img, UV, I, { pad });
  let repainted = 0; const S = r.size;
  for (let k = 0; k < S * S; k++) { const o = k * 3; if (isFacePaint(r.rgb[o], r.rgb[o + 1], r.rgb[o + 2])) { r.rgb[o] = hairRGB[0]; r.rgb[o + 1] = hairRGB[1]; r.rgb[o + 2] = hairRGB[2]; repainted++; } }
  return { rgb: r.rgb, size: S, UV: r.UV, repainted, islands: r.islands };
}

/**
 * TWIN GEOMETRY TRANSPLANT (V1.2): on a CONTAMINATED side the face surface in the rebuild region still carries the fused
 * lock's sculpt and the damaged eye (ridges, folded slivers). Its depth is replaced by the twin side's real face surface
 * (mirrored about the eye midline; full weight inside, a short ramp at the region border, welded across UV seams) and
 * its NORMALS by the twin surface's — folded slivers then lie on one smooth surface with one shading, and the texel
 * rebuild (which maps every texel through its final 3D point) paints them consistently. x/y are never moved: unfolding
 * slivers would stretch their few texels into smears. Returns the moved vertices' normals for chibify to re-apply after
 * its normal recompute.
 */
export function transplantTwinGeometry({ P, I, after }, split) {
  if (!split.contam[0] && !split.contam[1]) return { moved: 0, normals: null, weight: null };
  const nt = I.length / 3, nv = P.length / 3, axis = (after.eyes.l.c[0] + after.eyes.r.c[0]) / 2, eyeDY = after.eyes.r.c[1] - after.eyes.l.c[1], front = after.ears.z + after.eyes.sep * 0.25;
  const cx = (t) => (P[I[t * 3] * 3] + P[I[t * 3 + 1] * 3] + P[I[t * 3 + 2] * 3]) / 3, cz = (t) => (P[I[t * 3] * 3 + 2] + P[I[t * 3 + 1] * 3 + 2] + P[I[t * 3 + 2] * 3 + 2]) / 3;
  const region = (t) => split.rebuild[t] && !split.drop[t] && split.contam[cx(t) >= axis ? 1 : 0] && cz(t) > front;
  const G = { x0: -0.6, y0: after.chin - 0.08, c: 0.002 }; G.nx = Math.ceil(1.2 / G.c); G.ny = Math.ceil((after.eyes.y + 0.62 - G.y0) / G.c);
  // the twin SURFACE is the twin's face skin (and painted features) only — never hair
  const tris = []; for (let t = 0; t < nt; t++) if (((split.layer[t] === HAIR_LAYER.HEAD && !split.under[t]) || split.feature[t]) && !split.rebuild[t] && cz(t) > front) tris.push(t);
  const Z = frontRaster(P, I, tris, G);
  const key = (v) => `${Math.round(P[v * 3] * 2e4)},${Math.round(P[v * 3 + 1] * 2e4)},${Math.round(P[v * 3 + 2] * 2e4)}`, rep = new Int32Array(nv), first = new Map();
  for (let v = 0; v < nv; v++) { const k = key(v); if (!first.has(k)) first.set(k, v); rep[v] = first.get(k); }
  const inR = new Uint8Array(nv), outR = new Uint8Array(nv), nbr = new Map();
  for (let t = 0; t < nt; t++) { const r = region(t); if (!r && split.layer[t] === HAIR_LAYER.FRINGE && !split.under[t]) continue;   // the lifted fringe owns copied vertices: it pins nothing
    for (let q = 0; q < 3; q++) (r ? inR : outR)[rep[I[t * 3 + q]]] = 1; }
  for (let t = 0; t < nt; t++) if (region(t)) for (let q = 0; q < 3; q++) { const a = rep[I[t * 3 + q]], b = rep[I[t * 3 + (q + 1) % 3]]; if (a === b) continue; (nbr.get(a) ?? nbr.set(a, new Set()).get(a)).add(b); (nbr.get(b) ?? nbr.set(b, new Set()).get(b)).add(a); }
  // weight: 0 on the border (shared with untouched surface), 1 a few rings in (graph distance ramp)
  // (V1.3: a GEODESIC ramp of RAMP native units — 4 graph rings on a dense mesh were ~2 mm: a crease line round the region)
  const w = new Float32Array(nv).fill(1e9), q0 = []; for (const v of nbr.keys()) if (outR[v]) { w[v] = 0; q0.push(v); }
  for (let h = 0; h < q0.length; h++) { const v = q0[h]; for (const u of nbr.get(v)) { const d = w[v] + Math.hypot(P[u * 3] - P[v * 3], P[u * 3 + 1] - P[v * 3 + 1], P[u * 3 + 2] - P[v * 3 + 2]); if (d < w[u] - 1e-9) { w[u] = d; q0.push(u); } } }
  const RAMP = 0.018, zm = (x, y) => at(Z, G, 2 * axis - x, y + (x > axis ? -eyeDY : eyeDY));
  const moved = new Map();
  for (const v of nbr.keys()) { const d = w[v] > 1e8 ? RAMP : w[v]; if (d <= 0) continue; const x = P[v * 3], y = P[v * 3 + 1], m = zm(x, y); if (Number.isNaN(m) || Math.abs(m - P[v * 3 + 2]) > 0.08) continue;   // a face surface never needs more (larger = the twin is something else)
    const t = Math.min(1, d / RAMP), ww = t * t * (3 - 2 * t);
    // twin normal: the mirrored surface's gradient, x flipped back
    const e = 0.004, gx = (zm(x + e, y) - zm(x - e, y)) / (2 * e), gy = (zm(x, y + e) - zm(x, y - e)) / (2 * e), n = [-gx, -gy, 1], l = Math.hypot(...n);
    moved.set(v, { z: P[v * 3 + 2] + ww * (m - P[v * 3 + 2]), w: ww, n: Number.isFinite(l) ? n.map((c) => c / l) : null }); }
  const normals = new Map(), weight = new Float32Array(nv);
  for (let v = 0; v < nv; v++) { const q = moved.get(rep[v]); if (!q) continue; P[v * 3 + 2] = q.z; weight[v] = q.w; if (q.n && q.w > 0.99) normals.set(v, q.n); }
  return { moved: moved.size, normals, weight };
}

/**
 * MIRRORED TWIN PATCH (V1.3, universal) — the covered eye is not repainted, it is REBUILT. On a CONTAMINATED side the eye /
 * lid / lash / brow zone is replaced by a mirrored copy of the twin side's final geometry: the twin's own triangles (face
 * skin + painted features), mirrored about the face's eye midline (shifted by the eyes' height difference), winding
 * reversed, normals mirrored, SAME texture coordinates — texel-identical to the clean eye, no resampling, no smear. The
 * own surface under it is pushed just behind the patch (never in front), so the patch owns every pixel of the zone. Built
 * from FINAL positions (after the eye-depth contract, skin stage and edit blending); the living-eye bake sees it.
 * Returns null when no side is contaminated.
 */
export function buildTwinPatch({ P, N, I, after }, split) {
  if (!split.contam[0] && !split.contam[1]) return null;
  const nt = I.length / 3, nv = P.length / 3, axis = split.axis, eyeDY = split.eyeDY, front = after.ears.z + after.eyes.sep * 0.25;
  const cen = (t, k) => (P[I[t * 3] * 3 + k] + P[I[t * 3 + 1] * 3 + k] + P[I[t * 3 + 2] * 3 + k]) / 3;
  const mapX = (x) => 2 * axis - x, shiftFor = (x) => (x > axis ? -eyeDY : eyeDY);
  const srcV = new Map(), srcList = [], skinI = [], featI = [];
  for (let t = 0; t < nt; t++) { const x = cen(t, 0), y = cen(t, 1); if (cen(t, 2) <= front) continue; const side = x >= axis ? 1 : 0; if (split.contam[side] || !split.contam[1 - side]) continue;
    const skin = split.layer[t] === HAIR_LAYER.HEAD && !split.under[t] && !split.rebuild[t];
    // features: painted ones, and any non-fringe hair lying ON the twin's face (brow pieces with a little relief, lash fins)
    const onFace = split.layer[t] !== HAIR_LAYER.FRINGE && !split.under[t] && (() => { const fz = split.faceZ(x, y); return !Number.isNaN(fz) && cen(t, 2) - fz < 0.025; })();
    if (!skin && !split.feature[t] && !onFace) continue;
    // (the patch footprint is the rebuild zone GROWN by 30%: it covers every fused-lock leftover round the zone, so its rim lies
    //  in clean twin-rebuilt skin — a thin leftover ring outside it read as vein lines)
    const mx = mapX(x), my = y + shiftFor(x); if (!split.rebuildZone(mx, my, 1.3) || Math.abs(x - axis) < 0.006) continue;   // the nose bridge / midline stays the face's own (no mirrored seam on it)
    const loc = [0, 1, 2].map((q) => { const v = I[t * 3 + q]; if (!srcV.has(v)) { srcV.set(v, srcList.length); srcList.push(v); } return srcV.get(v); });
    (skin ? skinI : featI).push(loc[0], loc[2], loc[1]); }   // reversed winding (a mirror flips orientation)
  if (!skinI.length) return null;
  const n = srcList.length, PP = new Float32Array(n * 3), NN = new Float32Array(n * 3), rimInfo = {};
  for (let i = 0; i < n; i++) { const v = srcList[i], x = P[v * 3]; PP[i * 3] = mapX(x); PP[i * 3 + 1] = P[v * 3 + 1] + shiftFor(x); PP[i * 3 + 2] = P[v * 3 + 2]; NN[i * 3] = -N[v * 3]; NN[i * 3 + 1] = N[v * 3 + 1]; NN[i * 3 + 2] = N[v * 3 + 2]; }
  // RIM BLEND (V1.3): the patch's open boundary lies ON the face's own surface and its depth/normals ramp to the twin's over
  // a few rings — no edge, no step where the rebuilt zone meets the face (a floating rim read as a fine dark vein line)
  const G = { x0: -0.6, y0: after.chin - 0.08, c: 0.0015 }; G.nx = Math.ceil(1.2 / G.c); G.ny = Math.ceil((after.eyes.y + 0.62 - G.y0) / G.c);
  { const ownT = []; for (let t = 0; t < nt; t++) if (split.layer[t] === HAIR_LAYER.HEAD && !split.drop[t] && cen(t, 2) > front && split.contam[cen(t, 0) >= axis ? 1 : 0]) ownT.push(t);
    const Zo = frontRaster(P, I, ownT, G), zo = (x, y) => at(Zo, G, x, y);
    const all = [...skinI, ...featI], ec = new Map(), ek = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`); for (let t = 0; t < all.length; t += 3) for (let q = 0; q < 3; q++) { const k = ek(all[t + q], all[t + (q + 1) % 3]); ec.set(k, (ec.get(k) ?? 0) + 1); }
    // (patch vertices welded by position for the ring distance — the source mesh splits them at UV seams)
    const pk = (i) => `${Math.round(PP[i * 3] * 2e4)},${Math.round(PP[i * 3 + 1] * 2e4)},${Math.round(PP[i * 3 + 2] * 2e4)}`, rep = new Map(), rid = new Int32Array(n); for (let i = 0; i < n; i++) { const k = pk(i); if (!rep.has(k)) rep.set(k, i); rid[i] = rep.get(k); }
    const nb = new Map(); for (let t = 0; t < all.length; t += 3) for (let q = 0; q < 3; q++) { const a = rid[all[t + q]], b = rid[all[t + (q + 1) % 3]]; if (a === b) continue; (nb.get(a) ?? nb.set(a, new Set()).get(a)).add(b); (nb.get(b) ?? nb.set(b, new Set()).get(b)).add(a); }
    const d = new Float32Array(n).fill(1e9), q0 = []; for (const [k, c] of ec) if (c === 1) for (const v of k.split("_").map(Number)) if (d[rid[v]] > 0) { d[rid[v]] = 0; q0.push(rid[v]); }
    for (let h = 0; h < q0.length; h++) { const v = q0[h]; for (const u of nb.get(v) ?? []) if (d[u] > d[v] + 1) { d[u] = d[v] + 1; q0.push(u); } }
    const RING = 5; let blended = 0, nanZ = 0, far = 0, bnd = 0; for (let i = 0; i < n; i++) if (d[rid[i]] === 0) bnd++;
    for (let i = 0; i < n; i++) { const r = d[rid[i]]; if (r >= RING) continue; const z0 = zo(PP[i * 3], PP[i * 3 + 1]); if (Number.isNaN(z0)) { nanZ++; continue; } if (Math.abs(z0 - PP[i * 3 + 2]) > 0.03) { far++; continue; }
      const w = r / RING, ww = w * w * (3 - 2 * w); PP[i * 3 + 2] = z0 + 0.0004 + (PP[i * 3 + 2] - z0 - 0.0004) * ww; blended++; }
    // normals: on the blended rim ring they ramp from the face's own surface normal to the twin's (no lighting edge)
    for (let i = 0; i < n; i++) { const r = d[rid[i]]; if (r >= RING) continue; const x = PP[i * 3], y = PP[i * 3 + 1], e = 0.004, gx = (zo(x + e, y) - zo(x - e, y)) / (2 * e), gy = (zo(x, y + e) - zo(x, y - e)) / (2 * e); if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
      const no = [-gx, -gy, 1], l = Math.hypot(...no), w = r / RING, ww = w * w * (3 - 2 * w), m = [0, 1, 2].map((k) => no[k] / l * (1 - ww) + NN[i * 3 + k] * ww), lm2 = Math.hypot(...m) || 1; for (let k = 0; k < 3; k++) NN[i * 3 + k] = m[k] / lm2; }
    rimInfo.blended = blended; rimInfo.boundary = bnd; rimInfo.nanZ = nanZ; rimInfo.far = far; rimInfo.ownT = ownT.length; }
  // own surface just behind the patch: raster the patch's front depth, push own HEAD vertices (not shared with hair) back
  const Z = frontRaster(PP, [...skinI, ...featI], Array.from({ length: (skinI.length + featI.length) / 3 }, (_, t) => t), G);
  const hairUse = new Uint8Array(nv); for (let t = 0; t < nt; t++) if (split.layer[t] !== HAIR_LAYER.HEAD && !split.drop[t]) for (let q = 0; q < 3; q++) hairUse[I[t * 3 + q]] = 1;
  const own = new Set(); for (let t = 0; t < nt; t++) if (split.layer[t] === HAIR_LAYER.HEAD && split.contam[cen(t, 0) >= axis ? 1 : 0]) for (let q = 0; q < 3; q++) own.add(I[t * 3 + q]);
  // OWNERSHIP: own face triangles wholly inside the patch (coverage eroded by 2 cells) are dropped — the patch owns the zone;
  // only the rim is kept (pushed just behind the patch below)
  const cov = new Uint8Array(G.nx * G.ny); for (let k = 0; k < cov.length; k++) if (!Number.isNaN(Z[k])) cov[k] = 1;
  for (let e = 0; e < 6; e++) { const c2 = cov.slice(); for (let j = 1; j < G.ny - 1; j++) for (let i = 1; i < G.nx - 1; i++) { const k = j * G.nx + i; if (c2[k] && (!c2[k - 1] || !c2[k + 1] || !c2[k - G.nx] || !c2[k + G.nx])) cov[k] = 0; } }
  const inCovXY = (x, y) => { const i = Math.round((x - G.x0) / G.c), j = Math.round((y - G.y0) / G.c); return i >= 0 && j >= 0 && i < G.nx && j < G.ny && cov[j * G.nx + i] === 1; };
  const triInside = (t) => { const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2], pts = [[a], [b], [c], [a, b], [b, c], [c, a], [a, b, c]];
    return pts.every((vs) => inCovXY(vs.reduce((s2, v) => s2 + P[v * 3], 0) / vs.length, vs.reduce((s2, v) => s2 + P[v * 3 + 1], 0) / vs.length)); };
  // a fused-lock leftover (drop candidate) is dropped only where the patch really covers it (coverage eroded once); outside
  // the patch it becomes face skin (its texels were rebuilt from the twin) — never a hole
  { const cov1 = new Uint8Array(G.nx * G.ny); for (let k = 0; k < cov1.length; k++) if (!Number.isNaN(Z[k])) cov1[k] = 1;
    const c1 = cov1.slice(); for (let j = 1; j < G.ny - 1; j++) for (let i = 1; i < G.nx - 1; i++) { const k = j * G.nx + i; if (c1[k] && (!c1[k - 1] || !c1[k + 1] || !c1[k - G.nx] || !c1[k + G.nx])) cov1[k] = 0; }
    const in1 = (x, y) => { const i = Math.round((x - G.x0) / G.c), j = Math.round((y - G.y0) / G.c); return i >= 0 && j >= 0 && i < G.nx && j < G.ny && cov1[j * G.nx + i] === 1; };
    for (let t = 0; t < nt; t++) { if (!split.drop[t]) continue; const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
      if (![a, b, c].every((v) => in1(P[v * 3], P[v * 3 + 1])) || !in1(cen(t, 0), cen(t, 1))) { split.drop[t] = 0;
        // ON THE FACE (footprint, above the jaw) it becomes face skin; anywhere else it keeps its hair layer (a back-hair strand
        // beside the jaw turned into a skin-coloured fin when it was made face)
        if (split.onFace(cen(t, 0), cen(t, 1)) && cen(t, 1) > after.chin + 0.02) { split.layer[t] = HAIR_LAYER.HEAD; (split.skinPaint ??= new Set()).add(t); } } } }
  let culled = 0; for (let t = 0; t < nt; t++) { if (split.layer[t] === HAIR_LAYER.FRINGE && !split.under[t]) continue; if (!split.contam[cen(t, 0) >= axis ? 1 : 0] || cen(t, 2) <= front) continue;
    if (!split.drop[t] && triInside(t)) { split.drop[t] = 1; culled++; } }
  // (welded: every copy of a surface point moves together, and a point any hair triangle uses is never moved)
  const pk = (v) => `${Math.round(P[v * 3] * 2e4)},${Math.round(P[v * 3 + 1] * 2e4)},${Math.round(P[v * 3 + 2] * 2e4)}`, grp = new Map();
  const keyOf = new Array(nv); for (let v = 0; v < nv; v++) { const k = (keyOf[v] = pk(v)), g = grp.get(k); if (g) g.push(v); else grp.set(k, [v]); }   // keys fixed before anything moves
  let pushed = 0; const done = new Set();
  for (const v of own) { const k = keyOf[v]; if (done.has(k)) continue; done.add(k); const g = grp.get(k); if (g.some((u) => hairUse[u])) continue;
    const i = Math.round((P[v * 3] - G.x0) / G.c), j = Math.round((P[v * 3 + 1] - G.y0) / G.c); if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue;
    const z = Z[j * G.nx + i]; if (Number.isNaN(z) || P[v * 3 + 2] < z - 0.0012 || P[v * 3 + 2] > z + 0.04) continue; for (const u of g) P[u * 3 + 2] = z - 0.0012; pushed++; }
  return { srcV: Int32Array.from(srcList), P: PP, N: NN, skinI, featI, info: { verts: n, skinTris: skinI.length / 3, featureTris: featI.length / 3, ownCulled: culled, ownPushedBehind: pushed, rim: rimInfo } };
}

/**
 * SEAM WELD INVARIANT (V1.3, universal): a generated head stores one surface point as several vertices (UV seams, label
 * borders). Any per-vertex edit that moves one copy and not the others opens a slit through which the interior shows
 * (dotted dark seams, "windows" in brows). Every group of vertices that shared a position in `ref` and now spreads by less
 * than `maxSpread` (larger = an intentional separation) is moved to its most-displaced member. `skip(v)` excludes vertices
 * (copied fringe locks live in their own arrays anyway). Returns the number of groups re-joined.
 */
export function weldSeams(P, ref, { maxSpread = 0.02, skip = () => false } = {}) {
  const n = P.length / 3, key = (v) => `${Math.round(ref[v * 3] * 2e4)},${Math.round(ref[v * 3 + 1] * 2e4)},${Math.round(ref[v * 3 + 2] * 2e4)}`, grp = new Map();
  for (let v = 0; v < n; v++) { if (skip(v)) continue; const k = key(v), g = grp.get(k); if (g) g.push(v); else grp.set(k, [v]); }
  let joined = 0;
  // the copies left behind follow the copy an edit actually moved (largest displacement from `ref`): the edit's intent wins
  for (const g of grp.values()) { if (g.length < 2) continue; let b = g[0], bd = -1; for (const v of g) { const d = Math.hypot(P[v * 3] - ref[v * 3], P[v * 3 + 1] - ref[v * 3 + 1], P[v * 3 + 2] - ref[v * 3 + 2]); if (d > bd) { bd = d; b = v; } }
    const m = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]];
    let spread = 0; for (const v of g) spread = Math.max(spread, Math.hypot(P[v * 3] - m[0], P[v * 3 + 1] - m[1], P[v * 3 + 2] - m[2]));
    if (spread < 1e-7 || spread > maxSpread) continue; for (const v of g) for (let k = 0; k < 3; k++) P[v * 3 + k] = m[k]; joined++; }
  return joined;
}

/**
 * NAPE SKIN (V1.4, universal) — the REAR CLOSURE is a real exterior surface. The canonical-anatomy cut removes the generated
 * nape / rear underside, and that region used to be "closed" only by the interior shell (1 cm inside every jagged surface →
 * lumpy, blotchy) and the skull-base filler: seen from a low rear camera it read as broken skin, and hiding them showed the face
 * from inside. Here, in a radial map about the skull centre, every direction BEHIND the ear plane and below the eye line gets
 * a smooth skin surface: radius = max(canonical skull, outermost identity skin + 2.5 mm) (the person's own head shape where it is
 * fuller, never inside it), kept under any hanging hair, its top rows ramped INSIDE the identity skin (no lip where it starts),
 * and its bottom row ending on the HumanBase neck column (inside the neck extension) — skull → rear underside → nape → neck is one
 * continuous surface. Ears excluded. Returns { P, N, I, J, W } (rigid on Head) or null.
 */
export function napeSkin(m, rules) {
  const { P, label, LABEL, skullMap, after, headJoint, lm, neck } = m, n = P.length / 3, CC = skullMap.CC, eyeY = lm.eyes.l[1];
  const NT = 128, NP = 256, hairMin = new Float32Array(NT * NP).fill(9), skinMax = new Float32Array(NT * NP).fill(-9);
  const dirOf = (x, y, z) => { const dx = x - CC[0], dy = y - CC[1], dz = z - CC[2], r = Math.hypot(dx, dy, dz) || 1e-9; return [Math.min(NT - 1, Math.floor(Math.acos(Math.max(-1, Math.min(1, dy / r))) / Math.PI * NT)), Math.min(NP - 1, Math.floor((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * NP)), r]; };
  for (let v = 0; v < n; v++) { const [t, p, r] = dirOf(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]), k = t * NP + p; if (label[v] === LABEL.HAIR) { if (r < hairMin[k]) hairMin[k] = r; } else if (r > skinMax[k]) skinMax[k] = r; }
  const dirVec = (t, p) => { const th = ((t + 0.5) / NT) * Math.PI, ph = ((p + 0.5) / NP) * 2 * Math.PI - Math.PI; return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; };
  const skullR = (d) => 1 - skullMap.excess(CC[0] + d[0], CC[1] + d[1], CC[2] + d[2]);
  const S2 = neck.ring.length, RG = neck.ring.map((_, i) => { let s2 = 0; for (let d = -2; d <= 2; d++) s2 += neck.ring[(i + d + S2) % S2].r; return s2 / 5; });   // smoothed neck ring
  const neckR = (x, z) => { const th = Math.atan2(z - neck.cz, x - neck.cx), f = ((th + Math.PI) / (2 * Math.PI)) * S2 - 0.5, i0 = ((Math.floor(f) % S2) + S2) % S2, i1 = (i0 + 1) % S2, u = f - Math.floor(f); return RG[i0] * (1 - u) + RG[i1] * u; };
  // smooth the per-bin skin maximum (generated skin is ragged; the shell must follow the head SHAPE, not its fragments)
  const fill = (A, bad) => { const B = A.slice(); for (let it = 0; it < 6; it++) for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p; if (!bad(B[k])) continue; let s = 0, c = 0; for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; const v = B[tt * NP + ((p + dp) % NP + NP) % NP]; if (!bad(v)) { s += v; c++; } } if (c) B[k] = s / c; } return B; };
  // the skin's smooth UPPER ENVELOPE (dilate, then blur): the shell covers generated lumps instead of following them
  const SK = (() => { let A = fill(skinMax, (v) => v < -8); const get = (B, t, p) => B[Math.min(NT - 1, Math.max(0, t)) * NP + ((p % NP) + NP) % NP];
    for (let it = 0; it < 2; it++) { const B = A.slice(); for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { let mx = -9; for (let dt = -2; dt <= 2; dt++) for (let dp = -2; dp <= 2; dp++) mx = Math.max(mx, get(A, t + dt, p + dp)); B[t * NP + p] = mx; } A = B; }
    for (let it = 0; it < 6; it++) { const B = A.slice(); for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { if (A[t * NP + p] < -8) continue; let s2 = 0, c = 0; for (let dt = -1; dt <= 1; dt++) for (let dp = -1; dp <= 1; dp++) { const v = get(A, t + dt, p + dp); if (v > -8) { s2 += v; c++; } } B[t * NP + p] = s2 / c; } A = B; } return A; })();
  // the lowest row with real skin per column (the face / jaw rim in front of the ears)
  const skinLow = new Int32Array(NP).fill(-1); for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) if (skinMax[t * NP + p] > -8) skinLow[p] = t;
  const R = new Float32Array(NT * NP).fill(NaN), lastRow = new Int32Array(NP).fill(-1), firstRow = new Int32Array(NP).fill(-1), front = new Uint8Array(NP);
  // a front column whose lowest skin already reaches the neck column (the jaw rim tucked into the neck) needs nothing
  const tucked = new Uint8Array(NP); for (let p = 0; p < NP; p++) { const t = skinLow[p]; if (t < 0) continue; const d = dirVec(t, p), r = skinMax[t * NP + p], x = CC[0] + d[0] * r, z = CC[2] + d[2] * r; if (Math.hypot(x - neck.cx, z - neck.cz) < neckR(x, z) * 1.15) tucked[p] = 1; }
  for (let p = 0; p < NP; p++) for (let t = 0; t < NT; t++) { const d = dirVec(t, p), k = t * NP + p, rs = skullR(d);
    const y0 = CC[1] + d[1] * rs, z0 = CC[2] + d[2] * rs, x0 = CC[0] + d[0] * rs;
    if (y0 > eyeY + 0.02) continue;                                                                               // below the eye line
    // IN FRONT of the ear plane (jaw / chin sides): only BELOW that column's own lowest skin (the jaw rim) — never over the face;
    // the surface there follows the canonical skull underside (the approved jaw-to-neck shape) into the neck
    const isFront = z0 > after.ears.z + 0.05; if (isFront) { front[p] = 1; if (skinLow[p] < 0 || t < skinLow[p] - 2 || tucked[p]) continue; }
    if (Math.abs(y0 - eyeY + 0.01) < 0.12 && Math.abs(d[0]) > 0.6 && Math.abs(z0 - after.ears.z) < 0.1 && skinMax[k] > -8) continue;   // the ear itself (under the lobe, where no skin is, the shell closes)
    // exposed skin → the smooth exterior radius; wherever ANY hair lies in this direction the hair (and its base cap) owns it:
    // the shell drops inside the identity skin there (never in front of hair, never showing through strand gaps)
    // ABOVE the hair line (the base cap's own, same grid) the hair + its cap own the head: no shell there. Below it the shell is
    // the outer skin (stray hair fragments lying ON the skin are covered; hair standing off the skin stays outside it)
    const hl = m.hairLine ? m.hairLine[p] : -1; if (!isFront && hl >= 0 && t < hl - 4) continue;   // (starts 4 rows above the cap edge, tucked inside the skin: no slit between cap and nape)
    // (front: inside any real skin in this direction — the jaw stays the jaw; only where no skin exists does the shell show)
    let r = isFront ? (skinMax[k] > -8 || (t > 0 && skinMax[k - NP] > -8) ? Math.min(rs, (skinMax[k] > -8 ? skinMax[k] : skinMax[k - NP]) - 0.004) : rs) : Math.max(rs, SK[k] > -8 ? SK[k] + 0.0025 : rs); if (hairMin[k] < 8 && SK[k] > -8 && hairMin[k] > SK[k] + 0.002 && hairMin[k] - 0.004 < r) r = Math.max(SK[k] - 0.003, hairMin[k] - 0.004);
    const x = CC[0] + d[0] * r, y = CC[1] + d[1] * r, z = CC[2] + d[2] * r;
    if (y < neck.y1 - 0.015 && Math.hypot(x - neck.cx, z - neck.cz) < neckR(x, z) * 1.3) { if (firstRow[p] >= 0 && lastRow[p] < 0) lastRow[p] = t; break; }   // reached the neck column
    R[k] = r; if (firstRow[p] < 0) firstRow[p] = t; }
  // the join row is SMOOTH round the neck (median then mean over ±8 columns): per-column ends fanned into a puckered ring
  { const L0 = Array.from(lastRow), Lm = L0.map((_, p) => { const w = []; for (let d = -8; d <= 8; d++) { const v = L0[(p + d + NP) % NP]; if (v >= 0) w.push(v); } w.sort((a, b) => a - b); return w.length ? w[w.length >> 1] : -1; });
    for (let p = 0; p < NP; p++) { if (L0[p] < 0) continue; let s2 = 0, c = 0; for (let d = -8; d <= 8; d++) { const v = Lm[(p + d + NP) % NP]; if (v >= 0) { s2 += v; c++; } } const e = Math.round(s2 / c);
      for (let t = e; t < NT; t++) R[t * NP + p] = NaN;
      for (let t = firstRow[p]; t < e; t++) if (Number.isNaN(R[t * NP + p])) { const d = dirVec(t, p); R[t * NP + p] = Math.max(skullR(d), SK[t * NP + p] > -8 ? SK[t * NP + p] + 0.0025 : skullR(d)); }   // rows a shorter neighbour skipped
      // the join vertex: ON the neck column (inside the extension) at the shell's own height there
      const d = dirVec(e, p), rr = R[(e - 1) * NP + p] || skullR(d), x = CC[0] + d[0] * rr, y = Math.min(CC[1] + d[1] * rr, neck.y1 - 0.015), z = CC[2] + d[2] * rr, nr = neckR(x, z) * neck.inset * 0.97, hx = x - neck.cx, hz = z - neck.cz, hl = Math.hypot(hx, hz) || 1;
      R[e * NP + p] = Math.hypot(neck.cx + hx / hl * nr - CC[0], y - CC[1], neck.cz + hz / hl * nr - CC[2]); lastRow[p] = e; } }
  // smooth the radius field (columns stay in place), then ramp the top rows inside the identity skin
  for (let it = 0; it < 12; it++) { const B = R.slice(); for (let t = 1; t < NT - 1; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p; if (Number.isNaN(R[k]) || lastRow[p] === t) continue; let s = R[k] * 2, c = 2; for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = R[(t + dt) * NP + ((p + dp) % NP + NP) % NP]; if (!Number.isNaN(v)) { s += v; c++; } } B[k] = s / c; } R.set(B); }
  // the approach to the neck is eased over 8 rows (a single last-row step pinched the skin into a wrinkle ring)
  for (let p = 0; p < NP; p++) { const e = lastRow[p]; if (e < 0) continue; const s0 = Math.max(firstRow[p], e - 8); if (e - s0 < 2) continue; const r0 = R[s0 * NP + p], r1 = R[e * NP + p]; if (Number.isNaN(r0) || Number.isNaN(r1)) continue;
    for (let t = s0 + 1; t < e; t++) { const w = (t - s0) / (e - s0), ww = w * w * (3 - 2 * w); R[t * NP + p] = r0 + (r1 - r0) * ww; } }
  // smooth again AFTER the eased approach (join row fixed): adjacent columns never fold against each other
  for (let it = 0; it < 12; it++) { const B = R.slice(); for (let t = 1; t < NT - 1; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p; if (Number.isNaN(R[k]) || lastRow[p] === t) continue; let s2 = R[k] * 2, c = 2; for (const [dt, dp] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = R[(t + dt) * NP + ((p + dp) % NP + NP) % NP]; if (!Number.isNaN(v)) { s2 += v; c++; } } B[k] = s2 / c; } R.set(B); }
  // near the join (14 rows) the surface is smoothed ROUND the neck (azimuth only, join row included) — radial fold streaks
  // are variation along the azimuth
  for (let it = 0; it < 40; it++) { const B = R.slice(); for (let p = 0; p < NP; p++) { const e = lastRow[p]; if (e < 0) continue; for (let t = Math.max(firstRow[p], e - 14); t <= e; t++) { const k = t * NP + p; if (Number.isNaN(R[k])) continue; let s2 = R[k], c = 1; for (const dp of [-2, -1, 1, 2]) { const v = R[t * NP + ((p + dp) % NP + NP) % NP]; if (!Number.isNaN(v)) { s2 += v; c++; } } B[k] = s2 / c; } } R.set(B); }
  for (let p = 0; p < NP; p++) { if (!front[p]) continue; for (let t = 0; t < NT; t++) { const k = t * NP + p; if (Number.isNaN(R[k]) || lastRow[p] === t) continue; let sk2 = -9; for (let dt = -1; dt <= 1; dt++) for (let dp = -1; dp <= 1; dp++) { const tt = t + dt; if (tt >= 0 && tt < NT) sk2 = Math.max(sk2, skinMax[tt * NP + ((p + dp) % NP + NP) % NP]); } if (sk2 > -8 && R[k] > sk2 - 0.004) R[k] = sk2 - 0.004; } }
  for (let p = 0; p < NP; p++) { if (firstRow[p] < 0) continue; for (let q = 0; q < 6; q++) { const t = firstRow[p] + q, k = t * NP + p; if (t >= NT || Number.isNaN(R[k])) break; const w = q / 6, inner = SK[k] > -8 ? SK[k] - 0.003 : R[k] - 0.003; R[k] = inner + (R[k] - inner) * w * w * (3 - 2 * w); } }
  // REGULAR GRID: every column resampled to JR rows from its first row to its join (no row-count steps between neighbouring
  // columns — those stair-steps read as radial streaks round the neck)
  const JR = 36, colPts = new Array(NP).fill(null);
  for (let p = 0; p < NP; p++) { const a = firstRow[p], e = lastRow[p]; if (a < 0 || e <= a) continue; const pts = [];
    for (let t = a; t <= e; t++) { let r = R[t * NP + p]; if (Number.isNaN(r)) { let lo = t - 1, hi = t + 1; while (lo > a && Number.isNaN(R[lo * NP + p])) lo--; while (hi < e && Number.isNaN(R[hi * NP + p])) hi++; const r0 = R[lo * NP + p], r1 = R[hi * NP + p]; r = Number.isNaN(r0) ? r1 : Number.isNaN(r1) ? r0 : r0 + (r1 - r0) * (t - lo) / (hi - lo); }
      const d = dirVec(t, p); pts.push([CC[0] + d[0] * r, CC[1] + d[1] * r, CC[2] + d[2] * r]); }
    const out = []; for (let j = 0; j <= JR; j++) { const f = (j / JR) * (pts.length - 1), i0 = Math.floor(f), i1 = Math.min(pts.length - 1, i0 + 1), u = f - i0; out.push([0, 1, 2].map((k) => pts[i0][k] + (pts[i1][k] - pts[i0][k]) * u)); }
    colPts[p] = out; }
  const P2 = [], base0 = new Int32Array(NP).fill(-1);
  for (let p = 0; p < NP; p++) { if (!colPts[p]) continue; base0[p] = P2.length / 3; for (const q of colPts[p]) P2.push(...q); }
  if (P2.length / 3 < 50) return null;
  const I2 = []; for (let p = 0; p < NP; p++) { const p2 = (p + 1) % NP; if (base0[p] < 0 || base0[p2] < 0) continue; for (let j = 0; j < JR; j++) { const a = base0[p] + j, b = base0[p2] + j, c = base0[p] + j + 1, dd = base0[p2] + j + 1; I2.push(a, b, c, b, dd, c); } }
  // a radius lookup of the finished shell (for pressing generated skin flaps inside it)
  const shellR = (x, y, z) => { const [t, p] = dirOf(x, y, z); const a = firstRow[p], e = lastRow[p]; if (a < 0 || e < 0 || t < a || t > e) return NaN; const r = R[t * NP + p]; return Number.isNaN(r) ? NaN : r; };
  const Pf = Float32Array.from(P2), nv = Pf.length / 3;
  // outward winding (away from the skull centre)
  for (let t = 0; t < I2.length; t += 3) { const a = I2[t], b = I2[t + 1], c = I2[t + 2], e1 = [0, 1, 2].map((k) => Pf[b * 3 + k] - Pf[a * 3 + k]), e2 = [0, 1, 2].map((k) => Pf[c * 3 + k] - Pf[a * 3 + k]), nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (nn[0] * (Pf[a * 3] - CC[0]) + nn[1] * (Pf[a * 3 + 1] - CC[1]) + nn[2] * (Pf[a * 3 + 2] - CC[2]) < 0) { I2[t + 1] = c; I2[t + 2] = b; } }
  const N = weldNormals(Pf, computeNormals(Pf, I2));
  return { P: Pf, N, I: I2, shellR, centre: CC, J: new Uint8Array(nv * 4).map((_, k) => (k % 4 === 0 ? headJoint : 0)), W: new Float32Array(nv * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), info: { verts: nv, tris: I2.length / 3, columns: firstRow.filter((v) => v >= 0).length, endOnNeck: lastRow.filter((v) => v >= 0).length } };
}
