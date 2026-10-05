// build-human-garments.mjs — the proof wardrobe for HumanBase_V1, v2 (visual QA pass). ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-human-garments.mjs        (from frontend/; after build-human-base)
//
// DESIGNED PIECES, NOT INFLATED BODY. v1 offset the base surface and inherited everything under it: Alex's tee
// wrinkles, his old sleeve step, Meshy's surface noise, the jagged region cuts. v2 builds each garment from clean
// parts and uses the body only where it helps:
//   · TORSO      the body's torso, heavily Taubin-smoothed and shaped (oversized drape) — a clean soft volume
//   · SLEEVES    clean tubes along the arm chain with a designed radius profile and a ribbed cuff
//   · LEGS       clean tubes along each thigh (the base's own thigh as the minimum radius), a rolled denim hem
//   · BANDS      hem / collar / waistband as clean rings sampled around the garment — no jagged cut ever shows
//   · HOOD       a designed hood lying on the upper back (U-shaped drop) with a rolled rim showing its lining
//   · POCKET     a raised kangaroo pocket panel with stitched edges
//   · PRINT      the supplied CRRN IVRSE artwork (art/crrniverse-logo.png), placed as a chest print
//   · CLOGS      Crocs-style, sculpted from a signed distance field (surface nets): a domed toe box, a large instep
//                opening with the foot seated inside (skin), a thick sole, a pivoting heel strap on rivets; vents drawn
// EVERY PART takes its skin weights from the nearest body skin (inverse-distance over the k nearest base vertices
// of the regions it covers), so it deforms exactly like the body under it in every shared clip.
//
// OUTPUT public/avatars/human-base-v1/garments/: hoodie-crrn, tee-offshorly, shorts-denim, clogs, sneakers (.glb)
import * as THREE from "three";
import sharp from "sharp";
import fs from "node:fs";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { adjacency, BASE_OUT, computeNormals, loadBase, simplifyGeo, smooth, subset, surfaceNets, taubin, weldGeo, weldNormals, writeModule } from "./lib.mjs";

// --only=tee,joggers rebuilds just those pieces (approved garments are never rewritten by an unrelated change)
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",") ?? null, want = (id) => !ONLY || ONLY.includes(id);
const base = await loadBase();
const R = C.BODY_REGIONS;
const G = base.geo;
const nvB = G.P.length / 3;
const BN = weldNormals(G.P, new Float32Array(G.N));
const OUT = `${BASE_OUT}/garments`;
const ART = "scripts/avatar-pipeline/human-base/art";
const report = [];
const rest = base.rest;
const reg = (i) => Math.round(G.REG[i]);

// ---- weight transfer: the k nearest body vertices of the allowed regions, inverse-distance blended -------------
const grid = new Map(); const GC = 0.03;
for (let i = 0; i < nvB; i++) { const k = `${Math.floor(G.P[i * 3] / GC)},${Math.floor(G.P[i * 3 + 1] / GC)},${Math.floor(G.P[i * 3 + 2] / GC)}`; (grid.get(k) ?? grid.set(k, []).get(k)).push(i); }
const ARM_J = new Set(base.names.map((n, i) => (/Arm|Hand|Thumb|Index|Fingers/.test(n) ? i : -1)).filter((i) => i >= 0));
/** `noArms`: torso cloth follows the spine and clavicles only — an arm-bone influence tears the sides when the arms drop */
function transferWeights(P, regions, k = 6, noArms = false) {
  const allow = new Set(regions);
  const J = [], W = [];
  for (let v = 0; v < P.length / 3; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let found = [];
    for (let r = 1; r <= 6 && found.length < k; r++) {
      found = [];
      const cx = Math.floor(x / GC), cy = Math.floor(y / GC), cz = Math.floor(z / GC);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const cellv = grid.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!cellv) continue;
        for (const i of cellv) if (allow.has(reg(i))) found.push([Math.hypot(G.P[i * 3] - x, G.P[i * 3 + 1] - y, G.P[i * 3 + 2] - z), i]);
      }
    }
    found.sort((a, b) => a[0] - b[0]);
    const acc = {};
    for (const [d, i] of found.slice(0, k)) { const wi = 1 / (d + 0.004) ** 2; for (let q = 0; q < 4; q++) { const j = G.J[i * 4 + q], w = G.W[i * 4 + q]; if (w > 0 && !(noArms && ARM_J.has(j))) acc[j] = (acc[j] ?? 0) + w * wi; } }
    if (!Object.keys(acc).length) acc[base.JI.Spine] = 1;
    const top = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 4); const s = top.reduce((a, [, w]) => a + w, 0) || 1;
    for (let q = 0; q < 4; q++) { J.push(top[q] ? +top[q][0] : 0); W.push(top[q] ? top[q][1] / s : (q === 0 ? 1 : 0)); }
  }
  return { J, W };
}

// ---- body shells -------------------------------------------------------------------------------------------
function shellOf(keep) {
  const g = subset({ P: G.P, N: BN, J: G.J, W: G.W }, G.I, (t) => {
    const a = G.I[t * 3], b = G.I[t * 3 + 1], c = G.I[t * 3 + 2];
    const cen = [0, 1, 2].map((k) => (G.P[a * 3 + k] + G.P[b * 3 + k] + G.P[c * 3 + k]) / 3);
    return keep(t, cen, reg(a));
  });
  return weldGeo(g);
}
/** smooth a body shell into a clean volume: Taubin first (wrinkles and steps go), offset by thick(), a second light
 *  pass, and never closer than minClear to the skin it grew from */
function drape(g, thick, iters = 40, minClear = 0.01) {
  const nv = g.P.length / 3, P = new Float32Array(g.P);
  const { rep, nb } = adjacency(P, g.I);
  const free = new Uint8Array(nv).fill(1);
  // |μ| barely above λ: many iterations would otherwise INFLATE the low frequencies (the garment balloons)
  taubin(P, nb, rep, free, iters, 0.5, -0.505);
  const N = weldNormals(P, computeNormals(P, g.I));
  const T = new Float32Array(nv); for (let i = 0; i < nv; i++) T[i] = thick(i, P);
  for (let i = 0; i < nv; i++) { P[i * 3] += N[i * 3] * T[i]; P[i * 3 + 1] += N[i * 3 + 1] * T[i]; P[i * 3 + 2] += N[i * 3 + 2] * T[i]; }
  taubin(P, nb, rep, free, 8, 0.5, -0.505);
  // clamp: never closer than minClear, never further than the designed thickness (+8 mm of drape) from the skin
  for (let i = 0; i < nv; i++) {
    const d = (P[i * 3] - g.P[i * 3]) * g.N[i * 3] + (P[i * 3 + 1] - g.P[i * 3 + 1]) * g.N[i * 3 + 1] + (P[i * 3 + 2] - g.P[i * 3 + 2]) * g.N[i * 3 + 2];
    const lo = minClear, hi = T[i] + 0.008;
    const k = d < lo ? lo - d : d > hi ? hi - d : 0;
    if (k) { P[i * 3] += g.N[i * 3] * k; P[i * 3 + 1] += g.N[i * 3 + 1] * k; P[i * 3 + 2] += g.N[i * 3 + 2] * k; }
  }
  return { P: Array.from(P), I: g.I };
}
/** close SMALL boundary loops (pinholes left where region cuts are ragged) with a fan to their centroid; real openings
 *  (neck, arm holes, hems — long loops) are kept */
function fillSmallHoles(g, maxLen = 40) {
  const P = g.P, I = g.I, n = P.length / 3, key = (i) => `${Math.round(P[i * 3] * 1e5)},${Math.round(P[i * 3 + 1] * 1e5)},${Math.round(P[i * 3 + 2] * 1e5)}`;
  const wid = new Map(), id = new Int32Array(n), first = []; for (let i = 0; i < n; i++) { const k = key(i); if (!wid.has(k)) { wid.set(k, wid.size); first.push(i); } id[i] = wid.get(k); }
  const ec = new Map(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { const u = id[I[t + q]], v = id[I[t + (q + 1) % 3]], k = u < v ? `${u}|${v}` : `${v}|${u}`, e = ec.get(k); if (e) e.c++; else ec.set(k, { c: 1, u, v }); }
  const next = new Map(); for (const e of ec.values()) if (e.c === 1) { (next.get(e.u) ?? next.set(e.u, []).get(e.u)).push(e.v); (next.get(e.v) ?? next.set(e.v, []).get(e.v)).push(e.u); }
  const seen = new Set(); let filled = 0;
  for (const s0 of next.keys()) { if (seen.has(s0)) continue; const loop = [s0]; seen.add(s0); let cur = s0, prev = -1;
    for (;;) { const nx = (next.get(cur) ?? []).find((x) => x !== prev && !seen.has(x)); if (nx === undefined) break; loop.push(nx); seen.add(nx); prev = cur; cur = nx; }
    if (loop.length < 3 || loop.length > maxLen) continue;
    const c = [0, 1, 2].map((k) => loop.reduce((a, w) => a + P[first[w] * 3 + k], 0) / loop.length), ci = P.length / 3; P.push(...c);
    for (let k = 0; k < loop.length; k++) I.push(first[loop[k]], first[loop[(k + 1) % loop.length]], ci); filled++; }
  return filled;
}
/** keep the triangles whose centroid passes, compacted */
function trim(g, keepTri) {
  const s = subset({ P: g.P }, g.I, (t) => keepTri([0, 1, 2].map((k) => (g.P[g.I[t * 3] * 3 + k] + g.P[g.I[t * 3 + 1] * 3 + k] + g.P[g.I[t * 3 + 2] * 3 + k]) / 3)));
  return { P: s.P, I: s.I };
}

// ---- radial maps: a garment's radius around a vertical axis, by angle and height --------------------------------
function radialMap(P, cz = 0.02, cx = 0, binA = 5) {
  const NA = Math.round(360 / binA), map = new Map();
  for (let i = 0; i < P.length / 3; i++) {
    const x = P[i * 3] - cx, y = P[i * 3 + 1], z = P[i * 3 + 2] - cz;
    const a = Math.floor((((Math.atan2(x, z) * 180) / Math.PI) + 360) % 360 / binA), b = Math.round(y / 0.01);
    const key = a * 1000 + b; map.set(key, Math.max(map.get(key) ?? 0, Math.hypot(x, z)));
  }
  return (thetaDeg, y) => {
    const a = Math.floor((((thetaDeg % 360) + 360) % 360) / binA), b = Math.round(y / 0.01);
    let r = 0; for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) r = Math.max(r, map.get(((a + da + NA) % NA) * 1000 + b + db) ?? 0);
    return r;
  };
}

// ---- parametric parts ---------------------------------------------------------------------------------------------
/** a RING BAND around a vertical axis (hem, waistband): radius from a profile, thickness, a rolled lower lip */
function ringBand({ y0, y1, radius, cx = 0, cz = 0.02, thick, seg = 96, rows = 6, taper = 0.97, band = 1 }) {
  const P = [], I = [], B = [];
  const rr = Array.from({ length: seg }, (_, s) => radius((s / seg) * 360));
  for (let pass = 0; pass < 3; pass++) { const c = rr.slice(); for (let s = 0; s < seg; s++) rr[s] = (c[(s + seg - 1) % seg] + 2 * c[s] + c[(s + 1) % seg]) / 4; }
  const rings = [];
  const ringAt = (y, k, out) => { const ring = []; for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2, r = rr[s] * k + (out ? thick : 0); P.push(cx + Math.sin(a) * r, y, cz + Math.cos(a) * r); B.push(band); ring.push(P.length / 3 - 1); } return ring; };
  for (let r = 0; r <= rows; r++) rings.push(ringAt(y0 + (y1 - y0) * (r / rows), taper + (1 - taper) * (r / rows), true));
  const innerTop = ringAt(y1, 1, false), innerBot = ringAt(y0, taper, false);
  const strip = (A, Bq) => { for (let s = 0; s < seg; s++) { const s1 = (s + 1) % seg; I.push(A[s], A[s1], Bq[s], A[s1], Bq[s1], Bq[s]); } };
  for (let r = 0; r < rows; r++) strip(rings[r + 1], rings[r]);
  strip(rings[rows], innerTop); strip(innerTop, innerBot); strip(innerBot, rings[0]);
  return { P, I, B };
}
/** a TUBE along a polyline (arm, leg): elliptical section, radius by the fraction along the path; a turned-in lip at
 *  the far end gives the opening thickness (the root end hides inside the torso / pelvis) */
function limbTube(path, radius, { seg = 40, rings = 64, up = new THREE.Vector3(0, 1, 0), bandOf = () => 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)), false, "centripetal");
  const P = [], I = [], B = [];
  for (let r = 0; r <= rings; r++) {
    const f = r / rings, c = curve.getPointAt(f), t = curve.getTangentAt(f).normalize();
    const n = up.clone().addScaledVector(t, -up.dot(t)).normalize(), b = new THREE.Vector3().crossVectors(t, n).normalize();
    const [ra, rb] = radius(f);
    for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2; const p = c.clone().addScaledVector(n, Math.cos(a) * ra).addScaledVector(b, Math.sin(a) * rb); P.push(p.x, p.y, p.z); B.push(bandOf(f)); }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) { const a = r * seg + s, b = r * seg + (s + 1) % seg; I.push(a, b, a + seg, b, b + seg, a + seg); }
  const last = rings * seg, lip = P.length / 3, cEnd = curve.getPointAt(1), tEnd = curve.getTangentAt(1);
  for (let s = 0; s < seg; s++) { const p = new THREE.Vector3(P[(last + s) * 3], P[(last + s) * 3 + 1], P[(last + s) * 3 + 2]); const d = p.clone().sub(cEnd).multiplyScalar(0.82); const q = cEnd.clone().add(d).addScaledVector(tEnd, -0.012); P.push(q.x, q.y, q.z); B.push(bandOf(1)); }
  for (let s = 0; s < seg; s++) { const a = last + s, b = last + (s + 1) % seg, a2 = lip + s, b2 = lip + (s + 1) % seg; I.push(a, b, a2, b, b2, a2); }
  return { P, I, B };
}
function tube(path, radius, seg) {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)));
  const n = Math.max(12, path.length * 8), frames = curve.computeFrenetFrames(n, false), P = [], I = [];
  for (let i = 0; i <= n; i++) { const u = i / n, c = curve.getPointAt(u), [a, b] = radius(u);
    for (let s = 0; s < seg; s++) { const t = (s / seg) * Math.PI * 2; const d = frames.normals[i].clone().multiplyScalar(Math.cos(t) * a).add(frames.binormals[i].clone().multiplyScalar(Math.sin(t) * b)); P.push(c.x + d.x, c.y + d.y, c.z + d.z); } }
  for (let i = 0; i < n; i++) for (let s = 0; s < seg; s++) { const a = i * seg + s, b = i * seg + (s + 1) % seg; I.push(a, a + seg, b, b, a + seg, b + seg); }
  for (const [ring, flip] of [[0, true], [n, false]]) { const c = P.length / 3, cp = curve.getPointAt(ring / n); P.push(cp.x, cp.y, cp.z); for (let s = 0; s < seg; s++) { const a = ring * seg + s, b = ring * seg + (s + 1) % seg; if (flip) I.push(c, b, a); else I.push(c, a, b); } }
  return { P, I };
}
/** the conical rib collar around the neck */
function collarBand({ yBottom, yTop, rBottom, rTop, cz = 0.025, thick, seg = 80, rows = 8 }) {
  const P = [], I = [], B = [];
  const ring = (y, r) => { const out = []; for (let s = 0; s < seg; s++) { const a = (s / seg) * Math.PI * 2; P.push(Math.sin(a) * r, y, cz + Math.cos(a) * r * 0.94); B.push(1); out.push(P.length / 3 - 1); } return out; };
  const outer = [], inner = [];
  for (let k = 0; k <= rows; k++) { const u = k / rows, y = yBottom + (yTop - yBottom) * u, r = rBottom + (rTop - rBottom) * Math.pow(u, 0.7); outer.push(ring(y, r + thick)); inner.push(ring(y, r)); }
  const strip = (a, b, flip) => { for (let s = 0; s < seg; s++) { const s1 = (s + 1) % seg; if (flip) I.push(a[s], b[s], a[s1], a[s1], b[s], b[s1]); else I.push(a[s], a[s1], b[s], a[s1], b[s1], b[s]); } };
  for (let k = 0; k < rows; k++) { strip(outer[k], outer[k + 1], false); strip(inner[k], inner[k + 1], true); }
  strip(outer[rows], inner[rows], false);
  return { P, I, B };
}
/** merge parts into one geometry; each part's weights are transferred from the body regions it covers */
function assemble(parts) {
  const out = { P: [], I: [], B: [], J: [], W: [] };
  for (const p of parts) {
    const off = out.P.length / 3, n = p.P.length / 3;
    const push = (dst, src) => { for (const v of src) dst.push(v); };   // (no spread: large parts overflow the call stack)
    push(out.P, p.P); push(out.I, p.I.map((i) => i + off));
    push(out.B, p.B ?? new Array(n).fill(p.band ?? 0));
    const w = transferWeights(p.P, p.regions, 6, p.noArms === true);
    // ARMPIT BLEND (optional per part): vertices toward the arm take the arm's weights progressively (the cloth follows a
    // dropping arm instead of tearing open or being pierced by the elbow)
    if (p.armBlend) { const wa = transferWeights(p.P, [...p.regions, R.UPPERARM_L, R.UPPERARM_R], 6, false);
      for (let v = 0; v < n; v++) { const f = p.armBlend(p.P[v * 3], p.P[v * 3 + 1], p.P[v * 3 + 2]); if (f <= 0) continue; const acc = {};
        for (let q = 0; q < 4; q++) { acc[w.J[v * 4 + q]] = (acc[w.J[v * 4 + q]] ?? 0) + w.W[v * 4 + q] * (1 - f); acc[wa.J[v * 4 + q]] = (acc[wa.J[v * 4 + q]] ?? 0) + wa.W[v * 4 + q] * f; }
        const top = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, [, x]) => a + x, 0) || 1;
        for (let q = 0; q < 4; q++) { w.J[v * 4 + q] = top[q] ? +top[q][0] : 0; w.W[v * 4 + q] = top[q] ? top[q][1] / sum : 0; } } }
    // WEIGHT SMOOTHING (optional per part): each vertex takes the distance-weighted average of the part's weights within
    // `weightSmooth` — a thin designed band (a rib collar) copying its nearest body vertex across a region boundary got
    // neighbours on different bones, and the pose tore it into a sawtooth
    if (p.weightSmooth) { const R2 = p.weightSmooth ** 2, J2 = [], W2 = [];
      for (let v = 0; v < n; v++) { const acc = {}; for (let u = 0; u < n; u++) { const d2 = (p.P[v * 3] - p.P[u * 3]) ** 2 + (p.P[v * 3 + 1] - p.P[u * 3 + 1]) ** 2 + (p.P[v * 3 + 2] - p.P[u * 3 + 2]) ** 2; if (d2 > R2) continue; const k = 1 - d2 / R2;
          for (let q = 0; q < 4; q++) if (w.W[u * 4 + q] > 0) acc[w.J[u * 4 + q]] = (acc[w.J[u * 4 + q]] ?? 0) + w.W[u * 4 + q] * k; }
        const top = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((a, [, x]) => a + x, 0) || 1;
        for (let q = 0; q < 4; q++) { J2.push(top[q] ? +top[q][0] : 0); W2.push(top[q] ? top[q][1] / sum : 0); } }
      w.J = J2; w.W = W2; }
    push(out.J, w.J); push(out.W, w.W);
  }
  return out;
}
/** the body's axis near a point: the arm chain, a leg, else the spine — garments face away from it */
function axisPoint(m) {
  const ax = Math.abs(m[0]), s = m[0] >= 0 ? "Left" : "Right";
  if (ax > 0.17 && m[1] > 0.62) { const sh = rest[`${s}Arm`], w = rest[`${s}Hand`]; const u = Math.min(1, Math.max(0, (ax - Math.abs(sh.x)) / (Math.abs(w.x) - Math.abs(sh.x)))); return [sh.x + (w.x - sh.x) * u, sh.y + (w.y - sh.y) * u, sh.z + (w.z - sh.z) * u]; }
  if (m[1] < 0.37 && ax > 0.03) { const up = rest[`${s}UpLeg`], kn = rest[`${s}Leg`]; const u = Math.min(1, Math.max(0, (up.y - m[1]) / (up.y - kn.y))); return [up.x + (kn.x - up.x) * u, m[1], up.z + (kn.z - up.z) * u]; }
  return [0, Math.min(Math.max(m[1], 0.4), 0.72), 0.02];
}
function orientOutward(g) {
  for (let t = 0; t < g.I.length; t += 3) {
    const [a, b, c] = [g.I[t], g.I[t + 1], g.I[t + 2]];
    const e1 = [0, 1, 2].map((k) => g.P[b * 3 + k] - g.P[a * 3 + k]), e2 = [0, 1, 2].map((k) => g.P[c * 3 + k] - g.P[a * 3 + k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [0, 1, 2].map((k) => (g.P[a * 3 + k] + g.P[b * 3 + k] + g.P[c * 3 + k]) / 3), o = axisPoint(m);
    if (n[0] * (m[0] - o[0]) + n[1] * (m[1] - o[1]) + n[2] * (m[2] - o[2]) < 0) { g.I[t + 1] = c; g.I[t + 2] = b; }
  }
  g.N = Array.from(weldNormals(g.P, computeNormals(g.P, g.I)));
}
const normW = (g) => { for (let i = 0; i < g.W.length; i += 4) { const s = g.W[i] + g.W[i + 1] + g.W[i + 2] + g.W[i + 3] || 1; for (let k = 0; k < 4; k++) g.W[i + k] /= s; } };
/** planar front print uv on band-0 fabric facing forward; outside the print box uv stays outside [0,1] */
function chestUV(g, box) {
  const uv = [];
  for (let i = 0; i < g.P.length / 3; i++) {
    const x = g.P[i * 3], y = g.P[i * 3 + 1], z = g.P[i * 3 + 2], nz = g.N[i * 3 + 2];
    if (z < 0.05 || nz < 0.2 || g.B[i] !== 0) { uv.push(-1, -1); continue; }
    uv.push((x - box.x0) / (box.x1 - box.x0), 1 - (y - box.y0) / (box.y1 - box.y0));
  }
  return uv;
}
/** the arm chain as a sleeve path: from inside the torso (a dropped shoulder) out to `endX` */
function armPath(side, endX) {
  const s = side > 0 ? "Left" : "Right", sh = rest[`${s}Arm`], el = rest[`${s}ForeArm`], wr = rest[`${s}Hand`];
  const at = (ax) => { if (ax <= Math.abs(el.x)) { const u = (ax - Math.abs(sh.x)) / (Math.abs(el.x) - Math.abs(sh.x)); return [side * ax, sh.y + (el.y - sh.y) * u, sh.z + (el.z - sh.z) * u]; }
    const u = (ax - Math.abs(el.x)) / (Math.abs(wr.x) - Math.abs(el.x)); return [side * ax, el.y + (wr.y - el.y) * u, el.z + (wr.z - el.z) * u]; };
  return [0.13, 0.2, 0.28, Math.abs(el.x), 0.47, endX].map((ax) => { const p = at(Math.max(ax, Math.abs(sh.x))); if (ax < Math.abs(sh.x)) p[0] = side * ax; return p; });
}
const TORSO = [R.CHEST, R.BELLY, R.PELVIS];
// the hips' own profile (base pelvis + thigh tops): an oversized top hangs STRAIGHT over it, never tucked into the hips
const HIP = (() => { const pts = []; for (let i = 0; i < nvB; i++) { const y = G.P[i * 3 + 1]; if ((reg(i) === R.PELVIS || reg(i) === R.THIGH_L || reg(i) === R.THIGH_R) && y > 0.33 && y < 0.47) pts.push(G.P[i * 3], y, G.P[i * 3 + 2]); }
  const m = radialMap(pts, 0.02, 0, 6); return (th) => { let r = 0; for (let y = 0.35; y <= 0.45; y += 0.01) r = Math.max(r, m(th, y)); return r; }; })();

// =========================================== HOODIE (CRRN IVRSE) ===========================================
if (want("hoodie")) {
  const HEM_TOP = 0.448;
  // the under-arm side of the ribcage is labelled UPPERARM in the bind (arms are horizontal): the torso keeps it, or the
  // shell has a ragged hole under each arm (the dark shards along the torso sides)
  const underArm = (c, r) => (r === R.UPPERARM_L || r === R.UPPERARM_R) && c[1] < 0.69 && Math.abs(c[0]) < 0.32;
  const torso0 = shellOf((t, c, r) => (r === R.CHEST || r === R.BELLY || underArm(c, r) || (r === R.PELVIS && c[1] > 0.4)) && !(c[1] > 0.705 && Math.hypot(c[0], c[2] - 0.025) < 0.17));
  // oversized sweatshirt drape: a fuller belly and back, a soft dropped shoulder
  // the arms hang close at the sides in every idle: the bulk goes front and back, the sides stay slim
  let torso = drape(torso0, (i, P) => { const y = P[i * 3 + 1], ax = Math.abs(P[i * 3]), side = smooth(0.12, 0.19, ax); // full sides again: body clearance now keeps the arms off the torso, and a slim side let the sleeve roots poke out
    return 0.026 + 0.012 * (1 - side) * smooth(0.44, 0.52, y) * (1 - smooth(0.62, 0.72, y)); }, 45, 0.014);
  torso = trim(torso, (c) => c[1] > HEM_TOP - 0.018);
  // the kangaroo pocket: a raised panel on the belly front, stitched at its edge
  const TB = new Array(torso.P.length / 3).fill(0);
  { const N = weldNormals(torso.P, computeNormals(torso.P, torso.I));
    for (let i = 0; i < torso.P.length / 3; i++) { const x = torso.P[i * 3], y = torso.P[i * 3 + 1], z = torso.P[i * 3 + 2]; if (z < 0.05 || N[i * 3 + 2] < 0.3) continue;
      const edge = Math.min(y - 0.452, 0.546 - y, 0.152 - (y - 0.452) * 0.35 - Math.abs(x));
      if (edge > -0.004) { const k = 0.008 * smooth(-0.004, 0.012, edge); torso.P[i * 3] += N[i * 3] * k; torso.P[i * 3 + 1] += N[i * 3 + 1] * k; torso.P[i * 3 + 2] += N[i * 3 + 2] * k; }
      void TB; } }
  const tmap = radialMap(torso.P);
  // sleeves: full, dropped at the shoulder, tapering to a ribbed cuff past the wrist
  const sleeves = [1, -1].map((side) => limbTube(armPath(side, 0.594), (f) => { const r = f < 0.86 ? 0.076 - 0.022 * smooth(0, 0.86, f) : 0.054 - 0.006 * smooth(0.86, 0.95, f); return [r, r * 1.05]; }, { bandOf: (f) => (f > 0.88 ? 1 : 0) }));
  const hem = ringBand({ y0: 0.385, y1: HEM_TOP, radius: (th) => Math.max(tmap(th, HEM_TOP - 0.006) + 0.004, HIP(th) + 0.034), thick: 0.014, taper: 0.985 });
  const collar = collarBand({ yBottom: 0.686, yTop: 0.79, rBottom: 0.168, rTop: 0.118, thick: 0.02 });
  // the HOOD, down: a panel lying on the upper back (U-shaped drop) under a rolled rim round the collar
  const hoodPanel = (() => {
    const P = [], I = [], A = 48, Y = 16;
    for (let a = 0; a <= A; a++) for (let yb = 0; yb <= Y; yb++) {
      const th = 112 + (136 * a) / A, w = Math.abs(th - 180) / 68;
      const yBot = 0.6 + 0.12 * w * w, y = yBot + (0.782 - yBot) * (yb / Y);
      const r = tmap(th, Math.max(0.6, Math.min(0.7, y))) + 0.014 + 0.012 * (1 - w * w) * Math.sin((yb / Y) * Math.PI);
      const rad = (th * Math.PI) / 180; P.push(Math.sin(rad) * r, y, 0.02 + Math.cos(rad) * r);
    }
    for (let a = 0; a < A; a++) for (let yb = 0; yb < Y; yb++) { const i0 = a * (Y + 1) + yb, i1 = (a + 1) * (Y + 1) + yb; I.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1); }
    return { P, I };
  })();
  const rimPath = []; for (let k = 0; k <= 24; k++) { const th = 58 + (244 * k) / 24, rad = (th * Math.PI) / 180, back = Math.max(0, -Math.cos(rad)); const r = 0.152 + 0.07 * back;
    rimPath.push([Math.sin(rad) * r, 0.752 + 0.028 * back, 0.025 + Math.cos(rad) * r * 0.95]); }
  const rim = tube(rimPath, (u) => { const b = Math.sin(u * Math.PI); return [0.022 + 0.02 * b, 0.026 + 0.03 * b]; }, 20);
  // the rim's inner half shows the lining (band 0.5)
  const rimB = rim.P.filter((_, i) => i % 3 === 0).map((_, i) => { const x = rim.P[i * 3], z = rim.P[i * 3 + 2] - 0.025; return Math.hypot(x, z) < 0.15 + 0.07 * Math.max(0, -z / (Math.hypot(x, z) || 1)) ? 0.5 : 0; });
  const cords = [];
  for (const sx of [1, -1]) {
    cords.push({ ...tube([[sx * 0.05, 0.735, 0.17], [sx * 0.054, 0.69, 0.198], [sx * 0.056, 0.64, 0.207], [sx * 0.058, 0.6, 0.209]], () => [0.0055, 0.0055], 8), band: 2, regions: [R.CHEST] });
    cords.push({ ...tube([[sx * 0.058, 0.604, 0.209], [sx * 0.0585, 0.582, 0.21]], () => [0.0078, 0.0078], 10), band: 3, regions: [R.CHEST] });
  }
  const g = assemble([
    { ...torso, B: TB, regions: TORSO, noArms: true },
    { ...sleeves[0], regions: [R.UPPERARM_L, R.FOREARM_L, R.CHEST] }, { ...sleeves[1], regions: [R.UPPERARM_R, R.FOREARM_R, R.CHEST] },
    { ...hem, regions: TORSO, noArms: true }, { ...collar, regions: [R.CHEST, R.NECK], noArms: true },
    { ...hoodPanel, regions: [R.CHEST], noArms: true }, { ...rim, B: rimB, regions: [R.CHEST, R.NECK] }, ...cords,
  ]);
  orientOutward(g); normW(g);
  // the supplied artwork: white on transparent, tinted by the colourway's accent in the shader
  const logo = await sharp(`${ART}/crrniverse-logo.png`).resize(1000, 380, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).extend({ top: 16, bottom: 16, left: 12, right: 12, background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 96, alphaQuality: 100 }).toBuffer();
  const W0 = 0.25, H0 = W0 * (412 / 1024), CY = 0.636;
  const uv = chestUV(g, { x0: -W0 / 2, x1: W0 / 2, y0: CY - H0 / 2, y1: CY + H0 / 2 });
  const bytes = await writeModule(`${OUT}/hoodie-crrn.glb`, base, [{
    name: "garment_hoodie_crrn", P: g.P, N: g.N, UV: uv, I: g.I, J: g.J, W: g.W,
    extraAttrs: { _BAND: { type: "SCALAR", array: new Float32Array(g.B) } },
    material: { name: "garment", texture: new Uint8Array(logo), roughness: 0.95, doubleSided: true },
  }], { humanGarment: { id: "hoodie-crrn", slot: "top", hides: ["CHEST", "BELLY", "UPPERARM_L", "UPPERARM_R", "FOREARM_L", "FOREARM_R"],
    look: { main: "#17171a", trim: "#101012", accent: "#f2efe8" }, fabric: "fleece", decalTint: true, art: "crrniverse-logo.png",
    colorways: { black: { main: "#17171a", trim: "#101012", accent: "#f2efe8" }, heather: { main: "#5b5d63", trim: "#4a4c51", accent: "#f2efe8" }, bone: { main: "#e6e0d3", trim: "#d7d0c1", accent: "#1c1c20" } } } });
  report.push(["hoodie-crrn", g.I.length / 3, bytes]);
}

// =========================================== TEE (OFFSHORLY) v3 ============================================
// V1.1 fitting contract: the cloth HANGS from the chest (gravity: it never sucks into the waist below its widest point
// above), the hem is the torso's own edge rolled (no separate hoop standing off the hips), and the crew COLLAR follows the
// body's measured neck/trapezius profile along a real neckline (lower at the front, higher at the sides and back) — no
// fixed circle inside the neck base. Body presets move body and cloth with one field, so the fit carries over.
if (want("tee")) {
  const HEM_TOP = 0.455;
  const thOf = (x, z) => ((Math.atan2(x, z - 0.02) * 180) / Math.PI + 360) % 360;
  const neckY = (th) => { const a = (th * Math.PI) / 180; return 0.712 + 0.046 * (1 - Math.cos(a)) / 2 + 0.042 * Math.sin(a) ** 2; };   // front 0.712 · sides ~0.775 · back 0.758
  const bodyNeck = (() => { const pts = []; for (let i = 0; i < nvB; i++) { const y = G.P[i * 3 + 1], r = reg(i); if ((r === R.NECK || r === R.CHEST) && y > 0.66 && y < 0.82) pts.push(G.P[i * 3], y, G.P[i * 3 + 2]); } return radialMap(pts, 0.02, 0, 5); })();
  // the torso borrows only the under-arm band CLOSE to the ribs: bind-pose arm skin further out stays behind when the arm
  // drops and the elbow passes through it (the sleeve root closes the armhole from inside)
  const underArm = (c, r) => (r === R.UPPERARM_L || r === R.UPPERARM_R) && c[1] < 0.69 && Math.abs(c[0]) < 0.3;   // the full under-arm band (armpit-blended below)
  const torso0 = shellOf((t, c, r) => (r === R.CHEST || r === R.BELLY || underArm(c, r) || (r === R.PELVIS && c[1] > 0.42) || r === R.NECK) && c[1] < neckY(thOf(c[0], c[2])) - 0.004);
  let torso = drape(torso0, (i, P) => 0.013 + 0.004 * smooth(0.12, 0.2, Math.abs(P[i * 3])), 40, 0.009);
  torso = trim(torso, (c) => c[1] > HEM_TOP - 0.016);
  // HANG: below the chest, the radius at an angle never falls below the widest point above it (minus a soft drape-in)
  { const m = radialMap(torso.P, 0.02, 0, 5), CH = 0.6;
    for (let i = 0; i < torso.P.length / 3; i++) { const x = torso.P[i * 3], y = torso.P[i * 3 + 1], z = torso.P[i * 3 + 2]; if (y > CH || Math.abs(x) > 0.24) continue;
      const th = thOf(x, z), r = Math.hypot(x, z - 0.02); let up = 0; for (let yy = y + 0.01; yy <= CH; yy += 0.01) up = Math.max(up, m(th, yy));
      const fb = Math.cos((th * Math.PI) / 180) ** 2;   // front/back only: the SIDES stay close (the arms hang there)
      const want = r + (0.88 * up + 0.12 * r - r) * fb; if (want > r && r > 1e-4) { const f = want / r; torso.P[i * 3] = x * f; torso.P[i * 3 + 2] = 0.02 + (z - 0.02) * f; } } }
  const holes = fillSmallHoles(torso); console.log(`tee torso: ${holes} pinholes closed`);
  const tmap = radialMap(torso.P);
  // sleeves end at mid upper arm (a bending elbow never drives the forearm through the sleeve edge)
  const sleeves = [1, -1].map((side) => limbTube(armPath(side, 0.33), (f) => { const r = 0.09 - 0.008 * smooth(0, 1, f); return [r, r * 1.05]; }, { bandOf: (f) => (f > 0.88 ? 1 : 0) }));
  // the hem: the torso's own edge, rolled (radius continuous with the cloth above it), still over any bottom's waistband
  const hem = ringBand({ y0: 0.41, y1: HEM_TOP, radius: (th) => Math.max(tmap(th, HEM_TOP - 0.004) + 0.002, HIP(th) + 0.016), thick: 0.008, taper: 0.995 });
  // the collar: a rib band on the neckline, radius from the body's own neck profile (+ clearance), covering the torso edge
  // the collar: a rib band on the neckline, radius from the body's own neck profile (+ clearance), covering the torso edge.
  // The profile is SMOOTHED round the ring (the radial maps are binned — sampled raw they cut a sawtooth), and the rib starts
  // 1 cm below the torso's cut edge so it overlaps it in every pose.
  const collar = (() => { const seg = 96, rows = 6, P = [], I = [], B = [];
    const circ = (arr, passes) => { let a = arr.slice(); for (let it = 0; it < passes; it++) { const c = a.slice(); for (let s = 0; s < seg; s++) a[s] = (c[(s + seg - 1) % seg] + 2 * c[s] + c[(s + 1) % seg]) / 4; } return a; };
    const yOf = (s, k) => neckY((s / seg) * 360) - 0.016 + 0.032 * (k / rows);
    const RB = Array.from({ length: rows + 1 }, (_, k) => circ(Array.from({ length: seg }, (_, s) => { const th = (s / seg) * 360, y = yOf(s, k); return Math.max(bodyNeck(th, y), bodyNeck(th, y - 0.01), bodyNeck(th, y + 0.01)) + 0.011; }), 12));
    const RE = circ(Array.from({ length: seg }, (_, s) => { const th = (s / seg) * 360; return Math.max(tmap(th, neckY(th) - 0.008), tmap(th, neckY(th) - 0.018)) + 0.001; }), 12);
    const ring = (k, out) => { const rr = []; for (let s = 0; s < seg; s++) { const th = (s / seg) * Math.PI * 2, y = yOf(s, k);
        const f = Math.max(0, 1 - k / 3), r = Math.max(RB[k][s], RB[k][s] + (RE[s] - RB[k][s]) * f) + (out ? 0.008 : 0);
        P.push(Math.sin(th) * r, y, 0.02 + Math.cos(th) * r); B.push(1); rr.push(P.length / 3 - 1); } return rr; };
    const outer = [], inner = []; for (let k = 0; k <= rows; k++) { outer.push(ring(k, true)); inner.push(ring(k, false)); }
    const strip = (A, Bq, flip) => { for (let s = 0; s < seg; s++) { const s1 = (s + 1) % seg; if (flip) I.push(A[s], Bq[s], A[s1], A[s1], Bq[s], Bq[s1]); else I.push(A[s], A[s1], Bq[s], A[s1], Bq[s1], Bq[s]); } };
    for (let k = 0; k < rows; k++) { strip(outer[k], outer[k + 1], false); strip(inner[k], inner[k + 1], true); } strip(outer[rows], inner[rows], false); strip(inner[0], outer[0], false);
    return { P, I, B }; })();
  const g = assemble([{ ...torso, regions: TORSO, noArms: true, armBlend: (x, y) => smooth(0.17, 0.27, Math.abs(x)) * smooth(0.72, 0.66, y) },
    { ...sleeves[0], regions: [R.UPPERARM_L, R.CHEST] }, { ...sleeves[1], regions: [R.UPPERARM_R, R.CHEST] },
    { ...hem, regions: TORSO, noArms: true }, { ...collar, regions: [R.CHEST, R.NECK], noArms: true, weightSmooth: 0.03 }]);
  orientOutward(g); normW(g);
  const logoSvg = fs.readFileSync("src/assets/brand/offshorly-logo.svg", "utf8").replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const decal = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="420" viewBox="0 0 1024 420"><g transform="translate(112 110) scale(1.27)">${logoSvg}</g></svg>`)).resize(1024, 420).webp({ quality: 96, alphaQuality: 100 }).toBuffer();
  const uv = chestUV(g, { x0: -0.15, x1: 0.15, y0: 0.6, y1: 0.723 });
  const bytes = await writeModule(`${OUT}/tee-offshorly.glb`, base, [{
    name: "garment_tee_offshorly", P: g.P, N: g.N, UV: uv, I: g.I, J: g.J, W: g.W,
    extraAttrs: { _BAND: { type: "SCALAR", array: new Float32Array(g.B) } },
    material: { name: "garment", texture: new Uint8Array(decal), roughness: 0.92, doubleSided: true },
  }], { humanGarment: { id: "tee-offshorly", slot: "top", hides: ["CHEST", "BELLY", "UPPERARM_L", "UPPERARM_R"], construction: "hang-collar-v3",
    look: { main: "#f3f0e9", trim: "#e7e3da", accent: "#5dd9b3" }, fabric: "jersey",
    colorways: { white: { main: "#f3f0e9", trim: "#e7e3da" }, mint: { main: "#5dd9b3", trim: "#4cc4a0" }, ink: { main: "#1c1c22", trim: "#141418" } } } });
  report.push(["tee-offshorly", g.I.length / 3, bytes]);
}

// =========================================== OFFSHORLY JOGGERS (default uniform) =================================
// A relaxed fleece jogger for the chibi proportions, built like the shorts as ONE CLOSED SOLID: the pelvis column (the
// base pelvis profile) smooth-unioned with two baggy leg tubes along each measured leg axis (hip → knee → ankle; radius
// = the body's own leg radius there + a designed ease), so the crotch/seat is filled by construction; an inverted-V
// crease keeps two legs; the ease blouses just above a gathered ankle CUFF; a rib WAISTBAND under the top's hem; a small
// logo on the left thigh. Weights from the legs it covers: it bends with the knees in walk, sit and the scooter pose.
if (want("joggers")) {
  const T = 0.03, WAIST = 0.43, CUFF_Y = 0.074;
  const pel = []; for (let i = 0; i < nvB; i++) if (reg(i) === R.PELVIS || ((reg(i) === R.THIGH_L || reg(i) === R.THIGH_R) && G.P[i * 3 + 1] > 0.33)) pel.push(G.P[i * 3], G.P[i * 3 + 1], G.P[i * 3 + 2]);
  const pmap0 = radialMap(pel, 0.02, 0, 6);
  const pmap = (th, y) => { let a = 0, n = 0; for (let d = -12; d <= 12; d += 6) for (let dy = -0.02; dy <= 0.021; dy += 0.01) { a += pmap0(th + d, y + dy); n++; } return a / n; };
  // each leg: its bone axis and the body's own radius along it (95th percentile of THIGH/SHIN distance per axis bin)
  const legs = ["Left", "Right"].map((s) => { const A = [rest[`${s}UpLeg`], rest[`${s}Leg`], rest[`${s}Foot`]].map((v) => [v.x, v.y, v.z]);
    const L1 = Math.hypot(A[1][0] - A[0][0], A[1][1] - A[0][1], A[1][2] - A[0][2]), L2 = Math.hypot(A[2][0] - A[1][0], A[2][1] - A[1][1], A[2][2] - A[1][2]);
    const proj = (p) => { let best = null; for (let k = 0; k < 2; k++) { const a = A[k], b = A[k + 1], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dd = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / dd)), c = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t], dist = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
        const s2 = k === 0 ? (t * L1) / (L1 + L2) : (L1 + t * L2) / (L1 + L2); if (!best || dist < best.dist) best = { dist, s: s2, c }; } return best; };
    const NB = 24, bins = Array.from({ length: NB }, () => []), side = s === "Left" ? 1 : -1, regs = s === "Left" ? [R.THIGH_L, R.SHIN_L] : [R.THIGH_R, R.SHIN_R];
    // (v2) the same radius PER DIRECTION about the axis (NA sectors; θ 0 = front, 90° = the leg's outer side): the seat
    // is far behind the thigh axis, the outer thigh is not — a round tube sized by the seat bloats the outer thigh
    const NA = 12, angOf = (p, c) => ((Math.atan2((p[0] - c[0]) * side, p[2] - c[2]) * 180) / Math.PI + 360) % 360;
    const abins = Array.from({ length: NB * NA }, () => []);
    for (let i = 0; i < nvB; i++) { if (!regs.includes(reg(i)) || G.P[i * 3] * side < 0) continue; const p = [G.P[i * 3], G.P[i * 3 + 1], G.P[i * 3 + 2]], q = proj(p), kb = Math.min(NB - 1, Math.floor(q.s * NB));
      bins[kb].push(q.dist); abins[kb * NA + (Math.floor(angOf(p, q.c) / (360 / NA)) % NA)].push(q.dist); }
    const rb = bins.map((b) => { b.sort((x, y) => x - y); return b.length ? b[Math.floor(b.length * 0.95)] : 0; }); for (let k = 0; k < NB; k++) if (!rb[k]) rb[k] = rb[k - 1] ?? 0.08;
    for (let pass = 0; pass < 5; pass++) { const c = rb.slice(); for (let k = 0; k < NB; k++) rb[k] = (c[Math.max(0, k - 1)] + 2 * c[k] + c[Math.min(NB - 1, k + 1)]) / 4; }
    // per-direction profile: empty sectors take the round profile; smoothed in s and around θ, then BILINEAR (no ridges)
    const ra = abins.map((b, j) => { b.sort((x, y) => x - y); return b.length >= 3 ? b[Math.floor(b.length * 0.95)] : rb[Math.floor(j / NA)]; });
    for (let pass = 0; pass < 5; pass++) { const c = ra.slice(); for (let k = 0; k < NB; k++) for (let a = 0; a < NA; a++) { const at = (kk, aa) => c[Math.max(0, Math.min(NB - 1, kk)) * NA + ((aa + NA) % NA)];
      ra[k * NA + a] = (4 * at(k, a) + at(k - 1, a) + at(k + 1, a) + at(k, a - 1) + at(k, a + 1)) / 8; } }
    const rBodyA = (s2, th) => { const f = Math.min(NB - 1.001, Math.max(0, s2 * NB - 0.5)), k = Math.floor(f), t = f - k, g = ((th / (360 / NA)) - 0.5 + NA) % NA, a = Math.floor(g), u = g - a;
      const at = (kk, aa) => ra[Math.min(NB - 1, kk) * NA + (aa % NA)];
      return (at(k, a) * (1 - u) + at(k, a + 1) * u) * (1 - t) + (at(k + 1, a) * (1 - u) + at(k + 1, a + 1) * u) * t; };
    // LINEAR in s (a piecewise-constant profile leaves a ring step at every bin boundary)
    return { A, proj, angOf, rBodyA, rBody: (s2) => { const f = Math.min(NB - 1.001, Math.max(0, s2 * NB - 0.5)), k = Math.floor(f), t = f - k; return rb[k] * (1 - t) + rb[Math.min(NB - 1, k + 1)] * t; } }; });
  // THE LEG'S DESIGNED SILHOUETTE (v2): one continuous relaxed leg, hip → gentle taper → blousing → gathered cuff. The chibi
  // thigh is a "ham" (body radius 0.165 at the hip, 0.074 above the knee), so following it at a fixed ease (v1) drew a
  // round upper-thigh band over a narrow lower leg — it read as shorts with pant legs attached. The fabric now hangs on
  // its own taper (RLEG_TOP → RLEG_LOW at the blousing line), never closer to the skin than the clearance ease.
  const RLEG_TOP = 0.172, RLEG_LOW = 0.12, BLOUSE = 0.86;
  const clear = (s2) => (s2 < BLOUSE ? 0.014 + 0.014 * smooth(0.18, 0.55, s2) : 0.028 - 0.016 * smooth(0.9, 0.97, s2));   // minimum ease: slim at the hips (arms hang there), knee room
  const rLeg = (L, s2, th) => { const hang = RLEG_TOP + (RLEG_LOW - RLEG_TOP) * smooth(0, BLOUSE, s2), body = L.rBodyA(s2, th) + clear(s2);
    return Math.max(body, s2 < BLOUSE ? hang : hang + (body - hang) * smooth(0.9, 0.97, s2)); };   // below the blousing line: gathers into the cuff
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
  const Ty = (y) => T - 0.018 * smooth(0.37, 0.42, y);   // the waist sits inside the top's hem
  const solid = (x, y, z) => {
    const th = ((Math.atan2(x, z - 0.02) * 180) / Math.PI + 360) % 360, yy = Math.min(0.47, Math.max(0.34, y));
    let d = smax(Math.hypot(x, z - 0.02) - (pmap(th, yy) + Ty(y)), 0.31 - y, 0.04);
    for (const L of legs) { const q = L.proj([x, y, z]); d = smin(d, q.dist - rLeg(L, q.s, L.angOf([x, y, z], q.c)), 0.02 + 0.03 * smooth(0.25, 0.35, y)); }   // continuous fillet (a step in k leaves a ridge)
    const gap = 0.003 + 0.02 * smooth(0.31, 0.2, y); if (y < 0.315) d = Math.max(d, gap - Math.abs(x) - 0.004 * (1 - smooth(0.3, 0.29, y)));
    // UNDER THE TOP: from the upper thigh up, never wider than the hips' own profile + a cloth gap (the top's hem covers the
    // waist; a bottom bulging out below it reads as a separate "muffin" layer)
    const cap = Math.hypot(x, z - 0.02) - (HIP(th) + 0.012); d = smax(d, d + (cap - d) * smooth(0.33, 0.38, y) * (cap > d ? 1 : 0), 0.01);
    return d;
  };
  const sdf = (x, y, z) => Math.max(Math.abs(solid(x, y, z) + 0.006) - 0.006, y - WAIST, CUFF_Y - y);
  const mesh = surfaceNets(sdf, [-0.36, CUFF_Y - 0.01, -0.3], [0.36, WAIST + 0.01, 0.34], 0.0042);
  const P = Float32Array.from(mesh.P);
  { const { rep, nb } = adjacency(P, mesh.I); taubin(P, nb, rep, new Uint8Array(P.length / 3).fill(1), 22, 0.5, -0.51); }
  const sh = simplifyGeo({ P: Array.from(P), I: mesh.I }, 30000, 0.0012);
  // after simplification: smooth again (dark fleece shows every facet), welded so no seam opens
  { const SP = Float32Array.from(sh.P), { rep, nb } = adjacency(SP, sh.I); taubin(SP, nb, rep, new Uint8Array(SP.length / 3).fill(1), 14, 0.5, -0.51); sh.P = Array.from(SP); }
  // RIB CUFFS (gathered, hugging the ankle) and the RIB WAISTBAND — designed edges over the shell's raw cuts
  const cuffs = legs.map((L, li) => { const ank = L.A[2], r = L.rBody(0.97) + 0.016, path = []; for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; path.push([ank[0] + Math.sin(a) * r, CUFF_Y + 0.012, ank[2] + Math.cos(a) * r]); }
    return { ...tube(path, () => [0.012, 0.014], 14), band: 1, regions: [li ? R.SHIN_R : R.SHIN_L] }; });
  const waist = ringBand({ y0: WAIST - 0.03, y1: WAIST + 0.004, radius: (th) => pmap(th, WAIST - 0.01) + Ty(WAIST) + 0.004, thick: 0.008, taper: 0.995 });
  const g = assemble([{ P: sh.P, I: sh.I, band: 0, regions: [R.PELVIS, R.THIGH_L, R.THIGH_R, R.SHIN_L, R.SHIN_R] }, ...cuffs, { ...waist, regions: [R.PELVIS] }]);
  g.N = Array.from(weldNormals(g.P, computeNormals(g.P, g.I))); normW(g);
  // a small logo on the left thigh front (single-colour artwork, tinted by the colourway's accent)
  const logoSvg = fs.readFileSync("src/assets/brand/offshorly-logo.svg", "utf8").replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const decal = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="420" viewBox="0 0 1024 420"><g transform="translate(112 110) scale(1.27)">${logoSvg}</g></svg>`)).resize(1024, 420).webp({ quality: 96, alphaQuality: 100 }).toBuffer();
  const uv = []; for (let i = 0; i < g.P.length / 3; i++) { const x = g.P[i * 3], y = g.P[i * 3 + 1], z = g.P[i * 3 + 2], nz = g.N[i * 3 + 2];
    // front-facing fabric keeps its PLANAR uv even outside the logo box (it lands outside [0,1] by itself): a triangle that
    // straddles the box edge then never interpolates toward a sentinel and smears the artwork
    if (g.B[i] !== 0 || nz < 0.2 || z < 0.0 || x < 0) { uv.push(-1, -1); continue; } uv.push((x - 0.08) / 0.14, 1 - (y - 0.285) / 0.058); }
  const bytes = await writeModule(`${OUT}/joggers-offshorly.glb`, base, [{
    name: "garment_joggers_offshorly", P: g.P, N: g.N, UV: uv, I: g.I, J: g.J, W: g.W,
    extraAttrs: { _BAND: { type: "SCALAR", array: new Float32Array(g.B) } },
    material: { name: "garment", texture: new Uint8Array(decal), roughness: 0.95, doubleSided: true },
  }], { humanGarment: { id: "joggers-offshorly", slot: "bottom", hides: ["PELVIS", "THIGH_L", "THIGH_R", "SHIN_L", "SHIN_R"], construction: "closed-solid-joggers-v2",
    look: { main: "#1f1f24", trim: "#16161a", accent: "#5dd9b3" }, fabric: "fleece",
    colorways: { black: { main: "#1f1f24", trim: "#16161a", accent: "#5dd9b3" }, charcoal: { main: "#3a3b41", trim: "#2c2d32", accent: "#5dd9b3" }, navy: { main: "#232c42", trim: "#1a2234", accent: "#5dd9b3" } } } });
  report.push(["joggers-offshorly", g.I.length / 3, bytes]);
}

// =========================================== DENIM SHORTS ==================================================
// ONE CLOSED SOLID, then cloth: the pelvis column (the base pelvis's own radial profile) smooth-unioned with two oval
// thigh tubes (each thigh's measured centre and radii), so the crotch is FILLED by construction — no gap between the
// legs can exist. Hollowed into a cloth shell, cut at the waist and at the hems; a rolled cuff at each leg.
if (want("shorts")) {
  const T = 0.03;                                                         // stand-off from the skin (the catalogue's thickness)
  const pel = []; for (let i = 0; i < nvB; i++) if (reg(i) === R.PELVIS || ((reg(i) === R.THIGH_L || reg(i) === R.THIGH_R) && G.P[i * 3 + 1] > 0.33)) pel.push(G.P[i * 3], G.P[i * 3 + 1], G.P[i * 3 + 2]);
  const pmap0 = radialMap(pel, 0.02, 0, 6);
  // a smooth profile: averaged over neighbouring angles and heights (binning steps must not show as ridges)
  const pmap = (th, y) => { let a = 0, n = 0; for (let d = -12; d <= 12; d += 6) for (let dy = -0.02; dy <= 0.021; dy += 0.01) { a += pmap0(th + d, y + dy); n++; } return a / n; };
  const slice = (rg, y) => { let cx = 0, cz = 0, n = 0; const pts = []; for (let i = 0; i < nvB; i++) { if (reg(i) !== rg || Math.abs(G.P[i * 3 + 1] - y) > 0.012) continue; cx += G.P[i * 3]; cz += G.P[i * 3 + 2]; n++; pts.push(i); }
    cx /= n; cz /= n; const pc = (a) => a.sort((p, q) => p - q)[Math.floor(a.length * 0.9)]; return { cx, cz, rx: pc(pts.map((i) => Math.abs(G.P[i * 3] - cx))), rz: pc(pts.map((i) => Math.abs(G.P[i * 3 + 2] - cz))) }; };
  const legs = [R.THIGH_L, R.THIGH_R].map((rg) => ({ top: slice(rg, 0.33), low: slice(rg, 0.255) }));
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  // the waist tucks INSIDE the top's hem (tops are the outer layer): the stand-off tapers to 12 mm up there
  const HEM = 0.205, WAIST = 0.415;
  const Ty = (y) => T - 0.02 * smooth(0.36, 0.41, y);
  const solid = (x, y, z) => {
    // pelvis column: radius from the pelvis profile at this height (clamped into its band), soft-capped below the crotch
    const th = ((Math.atan2(x, z - 0.02) * 180) / Math.PI + 360) % 360, yy = Math.min(0.48, Math.max(0.34, y));
    const rp = pmap(th, yy) + Ty(y);
    let d = Math.hypot(x, z - 0.02) - rp;
    const sm = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
    d = sm(d, 0.3 - y, 0.04);                                             // the pelvis ends at the crotch, softly
    for (const L of legs) {
      const u = Math.min(1, Math.max(0, (0.33 - y) / (0.33 - 0.255)));
      const cx = L.top.cx + (L.low.cx - L.top.cx) * u, cz = L.top.cz + (L.low.cz - L.top.cz) * u;
      const rx = (L.top.rx + (L.low.rx - L.top.rx) * u) + Ty(y) + 0.006 * smooth(0.25, HEM, y), rz = (L.top.rz + (L.low.rz - L.top.rz) * u) + Ty(y) + 0.006 * smooth(0.25, HEM, y);
      const e = Math.hypot((x - cx) / rx, (z - cz) / rz);
      const leg = Math.max((e - 1) * Math.min(rx, rz), y - 0.36);       // the legs end inside the pelvis column
      d = smin(d, leg, y > 0.3 ? 0.05 : 0.02);                            // the crotch fillet: one coherent garment
    }
    // TWO LEGS: an inverted-V crease between them from the crotch down to the hems (never a skirt)
    const gap = 0.003 + 0.022 * smooth(0.31, HEM, y);
    if (y < 0.315) d = Math.max(d, gap - Math.abs(x) - 0.004 * (1 - smooth(0.3, 0.29, y)));
    return d;
  };
  const sdf = (x, y, z) => {
    let d = Math.abs(solid(x, y, z) + 0.006) - 0.006;                     // a 12 mm cloth shell
    d = Math.max(d, y - WAIST, HEM - y);
    return d;
  };
  const mesh = surfaceNets(sdf, [-0.36, HEM - 0.01, -0.3], [0.36, WAIST + 0.01, 0.34], 0.0042);
  const P = Float32Array.from(mesh.P);
  { const { rep, nb } = adjacency(P, mesh.I); taubin(P, nb, rep, new Uint8Array(P.length / 3).fill(1), 22, 0.5, -0.51); }
  const sh = simplifyGeo({ P: Array.from(P), I: mesh.I }, 20000, 0.0008);
  // ROLLED CUFFS: a soft ring round each hem (the shell's raw edge sits inside it) — a clean, designed edge
  const cuffs = legs.map((L) => {
    const cx = L.low.cx, cz = L.low.cz, rx = L.low.rx + T + 0.012, rz = L.low.rz + T + 0.012, path = [];
    for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; path.push([cx + Math.sin(a) * rx, HEM + 0.012, cz + Math.cos(a) * rz]); }
    return { ...tube(path, () => [0.012, 0.016], 14), band: 1, regions: [L === legs[0] ? R.THIGH_L : R.THIGH_R] };
  });
  const g = assemble([{ P: sh.P, I: sh.I, band: 0, regions: [R.PELVIS, R.THIGH_L, R.THIGH_R] }, ...cuffs]);
  g.N = Array.from(weldNormals(g.P, computeNormals(g.P, g.I))); normW(g);
  const bytes = await writeModule(`${OUT}/shorts-denim.glb`, base, [{
    name: "garment_shorts_denim", P: g.P, N: g.N, I: g.I, J: g.J, W: g.W,
    extraAttrs: { _BAND: { type: "SCALAR", array: new Float32Array(g.B) } },
    material: { name: "garment", roughness: 0.96, doubleSided: true },
  }], { humanGarment: { id: "shorts-denim", slot: "bottom", hides: ["PELVIS", "THIGH_L", "THIGH_R"],
    look: { main: "#3d5a86", trim: "#c88a3c", accent: "#9fb4d1" }, fabric: "denim", construction: "closed-solid-v2",
    colorways: { mid: { main: "#3d5a86", trim: "#c88a3c", accent: "#9fb4d1" }, light: { main: "#7b97bf", trim: "#c88a3c", accent: "#b9c9df" }, black: { main: "#2a2c33", trim: "#8a8a8a", accent: "#4a4d56" } } } });
  report.push(["shorts-denim", g.I.length / 3, bytes]);
}

// =========================================== SNEAKERS (sculpted, V1.1) =========================================
// The default employee shoe: one reusable clean white low-top, sculpted on the MEASURED HumanBase foot (footprint,
// ankle) as one closed solid (SDF → surface nets): a rounded midsole with toe spring, a domed upper, toe cap and heel
// counter overlays, a padded collar opening sized from the ankle, laces. The collar stays ≤ the jogger cuff's lower
// edge (the cuff rests ON the shoe — no see-through gap where the hidden shin would be). Rigid on the foot.
if (want("sneakers")) {
  let x0 = 9, x1 = -9, z0 = 9, z1 = -9;
  for (let i = 0; i < nvB; i++) if (reg(i) === R.FOOT_L && G.P[i * 3 + 1] < 0.09) { x0 = Math.min(x0, G.P[i * 3]); x1 = Math.max(x1, G.P[i * 3]); z0 = Math.min(z0, G.P[i * 3 + 2]); z1 = Math.max(z1, G.P[i * 3 + 2]); }
  const cxF = (x0 + x1) / 2, czF = (z0 + z1) / 2, HW = (x1 - x0) / 2 + 0.011, HL = (z1 - z0) / 2 + 0.014;
  // the ankle's own cross-section where it enters the shoe (left leg skin at collar height)
  // (the lowest SHIN ring — the foot region at collar height is the whole instep, not the ankle)
  let yS = 9; for (let i = 0; i < nvB; i++) if (reg(i) === R.SHIN_L) yS = Math.min(yS, G.P[i * 3 + 1]);
  let ax = 0, az = 0, an = 0; const ring = []; for (let i = 0; i < nvB; i++) { if (reg(i) !== R.SHIN_L || G.P[i * 3 + 1] > yS + 0.015) continue; ring.push([G.P[i * 3], G.P[i * 3 + 2]]); ax += G.P[i * 3]; az += G.P[i * 3 + 2]; an++; }
  ax /= an; az /= an; let rx = 0, rz = 0; for (const [x, z] of ring) { rx = Math.max(rx, Math.abs(x - ax)); rz = Math.max(rz, Math.abs(z - az)); }
  console.log(`ankle ring: lowest shin y ${yS.toFixed(3)}, ankle joint ${rest.LeftFoot.x.toFixed(3)}, ${rest.LeftFoot.y.toFixed(3)}, ${rest.LeftFoot.z.toFixed(3)}`);
  rx += 0.006; rz += 0.006;
  const COLLAR = 0.07, SOLE = 0.03, vOf = (z) => (z - czF) / HL, uOf = (x) => (x - cxF) / HW, vA = vOf(az);
  console.log(`sneaker footprint ${(2 * HW).toFixed(3)} × ${(2 * HL).toFixed(3)} · ankle opening ${(2 * rx).toFixed(3)} × ${(2 * rz).toFixed(3)} @ ${ax.toFixed(3)}, ${az.toFixed(3)} (v ${vA.toFixed(2)})`);
  const footprint = (x, z, grow) => { const v = (z - czF) / (HL + grow), hw = (HW + grow) * (0.88 + 0.13 * Math.max(-1, Math.min(1, v))); const u = (x - cxF) / hw;
    return (Math.pow(Math.pow(Math.abs(u), 2.4) + Math.pow(Math.abs(v), 2.4), 1 / 2.4) - 1) * Math.min(hw, HL + grow); };
  const smin = (a2, b2, k) => { const h = Math.max(k - Math.abs(a2 - b2), 0) / k; return Math.min(a2, b2) - h * h * k * 0.25; };
  const yb = (z) => 0.009 * smooth(0.5, 1.02, vOf(z)) ** 2;                         // toe spring
  const H = (x, z) => { const v = vOf(z), t = smooth(vA + 0.12, 1.0, v), dome = 0.3 * smooth(vA, vA + 0.45, v);
    return yb(z) + (COLLAR - 0.018 * t) * Math.sqrt(Math.max(0.05, 1 - dome * uOf(x) ** 2)); };
  const opening = (x, z) => (Math.hypot((x - ax) / rx, (z - az) / rz) - 1) * Math.min(rx, rz);
  const rounded = (d2, dy, r) => Math.hypot(Math.max(d2 + r, 0), Math.max(dy + r, 0)) + Math.min(Math.max(d2 + r, dy + r), 0) - r;
  const sdf = (x, y, z) => {
    const sole = rounded(footprint(x, z, 0.008), Math.max(yb(z) - y, y - (SOLE + yb(z) * 0.5)), 0.005);
    const upper = rounded(footprint(x, z, 0.0015), Math.max(0.016 - y, y - H(x, z)), 0.009);
    const d = smin(sole, upper, 0.006);
    return Math.max(d, -Math.max(opening(x, z), 0.046 - y));                          // the collar opening (lined recess)
  };
  const mesh = surfaceNets(sdf, [cxF - HW - 0.03, -0.006, czF - HL - 0.03], [cxF + HW + 0.03, 0.1, czF + HL + 0.03], 0.0024);
  const cp = Float32Array.from(mesh.P);
  { const { rep, nb } = adjacency(cp, mesh.I); taubin(cp, nb, rep, new Uint8Array(cp.length / 3).fill(1), 10); }
  const shoe = simplifyGeo({ P: Array.from(cp), I: mesh.I }, 9000, 0.0008);
  // laces across the instep, lying on the upper in front of the opening
  const laces = [];
  for (let k = 0; k < 3; k++) { const z = az + rz + 0.01 + k * 0.02, path = []; const hw = 0.5 * HW * (1 - 0.08 * k);
    for (let j = 0; j <= 10; j++) { const x = cxF + (j / 10 - 0.5) * 2 * hw; path.push([x, H(x, z) - 0.0004, z]); }
    laces.push(tube(path, () => [0.0028, 0.0028], 8)); }
  const left = { P: [], I: [], B: [] };
  const add = (part, bandOf) => { const off = left.P.length / 3; left.P.push(...part.P); left.I.push(...part.I.map((i) => i + off)); for (let i = 0; i < part.P.length / 3; i++) left.B.push(bandOf(part.P[i * 3], part.P[i * 3 + 1], part.P[i * 3 + 2])); };
  add(shoe, (x, y, z) => { const v = vOf(z); if (opening(x, z) < 0.0025 && y > 0.04) return 4; if (y < SOLE + yb(z) * 0.5 + 0.0012) return 1;
    if ((v > 0.7 && y > 0.026) || (v < -0.62 && y < 0.062)) return 2; return 0; });
  for (const l of laces) add(l, () => 3);
  const n = left.P.length / 3, all = { P: [...left.P], I: [...left.I], B: [...left.B, ...left.B] };
  for (let i = 0; i < n; i++) all.P.push(-left.P[i * 3], left.P[i * 3 + 1], left.P[i * 3 + 2]);
  for (let t = 0; t < left.I.length; t += 3) all.I.push(left.I[t] + n, left.I[t + 2] + n, left.I[t + 1] + n);
  const J = [], W = []; for (let i = 0; i < all.P.length / 3; i++) { J.push(all.P[i * 3] > 0 ? base.JI.LeftFoot : base.JI.RightFoot, 0, 0, 0); W.push(1, 0, 0, 0); }
  const N = weldNormals(all.P, computeNormals(all.P, all.I));
  const uv = []; for (let i = 0; i < all.P.length / 3; i++) uv.push((Math.abs(all.P[i * 3]) - cxF) / (2 * HW) + 0.5, (all.P[i * 3 + 2] - czF) / (2 * HL) + 0.5);
  const bytes = await writeModule(`${OUT}/sneakers.glb`, base, [{ name: "shoes_sneaker", P: all.P, N, UV: uv, I: all.I, J, W,
    extraAttrs: { _BAND: { type: "SCALAR", array: new Float32Array(all.B) } }, material: { name: "garment", roughness: 0.5 } }],
    { humanGarment: { id: "sneakers", slot: "shoes", hides: ["FOOT_L", "FOOT_R"], construction: "closed-solid-sneaker-v1", look: { main: "#f4f3ef", trim: "#ebe8e1", accent: "#f7f6f2" }, fabric: "sneaker",
      colorways: { white: { main: "#f4f3ef", trim: "#ebe8e1", accent: "#f7f6f2" }, black: { main: "#26262b", trim: "#efede7", accent: "#26262b" }, grey: { main: "#b9bbc0", trim: "#efede7", accent: "#f7f6f2" } } } });
  report.push(["sneakers", all.I.length / 3, bytes]);
}

// =========================================== CLOGS (sculpted) ===============================================
if (want("clogs")) {
  // the base foot's footprint (left), and the ankle where the shin enters
  let x0 = 9, x1 = -9, z0 = 9, z1 = -9;
  for (let i = 0; i < nvB; i++) if (reg(i) === R.FOOT_L && G.P[i * 3 + 1] < 0.09) { x0 = Math.min(x0, G.P[i * 3]); x1 = Math.max(x1, G.P[i * 3]); z0 = Math.min(z0, G.P[i * 3 + 2]); z1 = Math.max(z1, G.P[i * 3 + 2]); }
  const cxF = (x0 + x1) / 2, czF = (z0 + z1) / 2, HW = (x1 - x0) / 2 + 0.012, HL = (z1 - z0) / 2 + 0.016;
  const ank = rest.LeftFoot, shin = { x: ank.x, z: ank.z + 0.005 };
  console.log(`clog footprint ${(2 * HW).toFixed(3)} × ${(2 * HL).toFixed(3)} · ankle ${shin.x.toFixed(3)}, ${shin.z.toFixed(3)} · foot centre ${cxF.toFixed(3)}, ${czF.toFixed(3)}`);
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const footprint = (x, z, grow) => { const v = (z - czF) / (HL + grow), hw = (HW + grow) * (0.9 + 0.12 * Math.max(-1, Math.min(1, v))); const u = (x - cxF) / hw;
    return (Math.pow(Math.pow(Math.abs(u), 2.6) + Math.pow(Math.abs(v), 2.6), 1 / 2.6) - 1) * Math.min(hw, HL + grow); };
  // THE CROCS-STYLE CLOG (from the supplied reference, stylised): a domed toe box covering the front ~55%, a large
  // INSTEP OPENING behind it with low walls round the heel, a thick sole, a pivoting heel strap on round rivets.
  // The foot is SEATED inside: its instep shows through the opening as skin (band 5 — the wearer's skin tone).
  const V0 = 0.36;                                                         // where the toe box ends (−1 heel … +1 toe)
  const vOf = (z) => (z - czF) / HL, uOf = (x) => (x - cxF) / HW;
  const toeH = (x, z) => (0.072 + 0.04 * Math.exp(-(((vOf(z) - 0.42) / 0.58) ** 2))) * Math.sqrt(Math.max(0.05, 1 - 0.45 * uOf(x) ** 2));
  const heelH = 0.072;
  const H = (x, z) => { const k = smooth(V0 - 0.08, V0 + 0.08, vOf(z)); return heelH + (toeH(x, z) - heelH) * k; };
  const sdf = (x, y, z) => {
    const sole = Math.max(footprint(x, z, 0.007), -y, y - 0.03);
    const upper = Math.max(footprint(x, z, 0), 0.014 - y, y - H(x, z));
    let d = smin(sole, upper, 0.01);
    // the cavity: the foot's space, open to the sky behind the toe box (the instep opening), roofed by the dome in front
    const roof = vOf(z) > V0 ? H(x, z) - 0.013 : 1;
    const cav = Math.max(footprint(x, z, -0.011), 0.032 - y, y - roof);
    return Math.max(d, -cav);
  };
  // the seated foot: an instep rising from the toe box to the ankle, filling the opening (skin)
  const footSdf = (x, y, z) => {
    // a rounded instep (domed across the foot) rising from the toe box to the ankle; clear of the walls
    // the instep rises from under the toe box to the ankle (where the shin enters), then drops behind it into the heel cup
    const v = vOf(z), u = uOf(x) / 0.78, vA = vOf(shin.z);
    const top = (v > vA ? 0.064 + 0.036 * smooth(V0 + 0.05, vA, v) : 0.1 - 0.055 * smooth(vA, vA - 0.3, v)) - 0.028 * u * u;
    return Math.max(footprint(x, z, -0.02), 0.03 - y, y - top);
  };
  if (false) { for (const [n, x, y, z] of [["wall", cxF + HW - 0.005, 0.05, czF - 0.3 * HL], ["heelback", cxF, 0.05, czF - HL + 0.005], ["inside", cxF, 0.05, czF - 0.3 * HL]]) console.log("DBG", n, "sdf", sdf(x, y, z).toFixed(4), "foot", footSdf(x, y, z).toFixed(4), "fp0", footprint(x, z, 0).toFixed(4)); }
  const mesh = surfaceNets((x, y, z) => Math.min(sdf(x, y, z), footSdf(x, y, z)), [cxF - HW - 0.03, -0.006, czF - HL - 0.03], [cxF + HW + 0.03, 0.15, czF + HL + 0.03], 0.0028);
  const cp = Float32Array.from(mesh.P);
  { const { rep, nb } = adjacency(cp, mesh.I); taubin(cp, nb, rep, new Uint8Array(cp.length / 3).fill(1), 8); }
  const clog = simplifyGeo({ P: Array.from(cp), I: mesh.I }, 9000, 0.0012);
  // the heel strap pivots on rivets at the back corners of the toe box, round the heel just above the low walls
  const zR = czF + V0 * HL - 0.01, hwAt = (z) => (HW + 0.007) * (0.9 + 0.12 * Math.max(-1, Math.min(1, vOf(z))));
  const strapPath = [];
  for (let k = 0; k <= 18; k++) {
    const a = (Math.PI * k) / 18;                                          // rivet → round the heel → rivet
    // on the heel wall itself: from the rivet's z, out along the angle until the footprint ends, 3 mm outside it
    const zc = zR, dx = Math.cos(a), dz = -Math.sin(a);
    let lo = 0, hi = 0.4; for (let it = 0; it < 32; it++) { const m = (lo + hi) / 2; if (footprint(cxF + dx * m, zc + dz * m, 0.007) < 0) lo = m; else hi = m; }
    strapPath.push([cxF + dx * (lo + 0.004), 0.074 - 0.01 * Math.sin(a), zc + dz * (lo + 0.004)]);
  }
  const strap = tube(strapPath, () => [0.0042, 0.013], 12);
  const rivets = [strapPath[0], strapPath[strapPath.length - 1]].map((p) => { const out = Math.sign(p[0] - cxF); return tube([[p[0] - out * 0.004, p[1], p[2]], [p[0] + out * 0.006, p[1], p[2]]], () => [0.012, 0.012], 18); });
  const left = { P: [], I: [], B: [] };
  const add = (part, bandOf) => { const off = left.P.length / 3; left.P.push(...part.P); left.I.push(...part.I.map((i) => i + off)); for (let i = 0; i < part.P.length / 3; i++) left.B.push(bandOf(part.P[i * 3], part.P[i * 3 + 1], part.P[i * 3 + 2])); };
  add(clog, (x, y, z) => (footSdf(x, y, z) < 0.0015 && sdf(x, y, z) > -0.0005 ? 5 : y < 0.031 ? 1 : 0));
  add(strap, () => 2); for (const r of rivets) add(r, () => 3);
  // mirror to the right foot (the base is symmetric)
  const n = left.P.length / 3, all = { P: [...left.P], I: [...left.I], B: [...left.B, ...left.B] };
  for (let i = 0; i < n; i++) all.P.push(-left.P[i * 3], left.P[i * 3 + 1], left.P[i * 3 + 2]);
  for (let t = 0; t < left.I.length; t += 3) all.I.push(left.I[t] + n, left.I[t + 2] + n, left.I[t + 1] + n);
  // rigid on the foot: a clog does not bend at the toes (the hidden foot may; nothing shows)
  const J = [], W = []; for (let i = 0; i < all.P.length / 3; i++) { J.push(all.P[i * 3] > 0 ? base.JI.LeftFoot : base.JI.RightFoot, 0, 0, 0); W.push(1, 0, 0, 0); }
  const N = weldNormals(all.P, computeNormals(all.P, all.I));
  const uv = []; for (let i = 0; i < all.P.length / 3; i++) uv.push((Math.abs(all.P[i * 3]) - cxF) / (2 * HW) + 0.5, (all.P[i * 3 + 2] - czF) / (2 * HL) + 0.5);
  const bytes = await writeModule(`${OUT}/clogs.glb`, base, [{ name: "shoes_clogs", P: all.P, N, UV: uv, I: all.I, J, W,
    extraAttrs: { _BAND: { type: "SCALAR", array: new Float32Array(all.B) } }, material: { name: "garment", roughness: 0.55 } }],
    { humanGarment: { id: "clogs", slot: "shoes", hides: ["FOOT_L", "FOOT_R"], look: { main: "#ece7dc", trim: "#d9d3c5", accent: "#bdb6a6" }, fabric: "clog",
      colorways: { chalk: { main: "#ece7dc", trim: "#d9d3c5", accent: "#bdb6a6" }, black: { main: "#232327", trim: "#18181b", accent: "#3a3a40" }, sage: { main: "#9fb39a", trim: "#879b82", accent: "#e9e5da" } } } });
  report.push(["clogs", all.I.length / 3, bytes]);
}
for (const [id, tris, bytes] of report) console.log(`${id.padEnd(15)} ${String(Math.round(tris)).padStart(6)} tris  ${(bytes / 1e3).toFixed(0)} KB`);
