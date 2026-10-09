// failure-detectors.mjs — ARTIFACT-LEVEL DETECTORS for the HumanBase failure registry (failure-registry.mjs). ZERO CREDITS.
// Each detector measures ONE optimised identity file (+ its build record) and returns plain numbers; the registry owns the
// thresholds and the verdict. Nothing here knows an employee's name.
import fs from "node:fs";
import sharp from "sharp";
import { canonicalSkull } from "./head-closure.mjs";
import { BASE_OUT, io } from "./lib.mjs";

const canon = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/human-base/canonical-profile.json", "utf8"));
let skullP = null;
const skull = async () => (skullP ??= (async () => canonicalSkull((await io.read(`${BASE_OUT}/identity/alex-neutral-head-v1.glb`)).getRoot().listMeshes()[0].listPrimitives()[0].getAttribute("POSITION").getArray(), [0, 1.25, canon.ears.z]))());

const parts = (doc) => Object.fromEntries(doc.getRoot().listMeshes().map((m) => { const p = m.listPrimitives()[0]; return [m.getName(), { prim: p, P: p.getAttribute("POSITION").getArray(), UV: p.getAttribute("TEXCOORD_0")?.getArray(), I: p.getIndices().getArray() }]; }));
const HAIR = /^identity_hair_/;

/** radial coverage: per direction (about the cranium centre) the OUTERMOST hair radius — a skin point is VISIBLE when no
 *  hair lies above it (hair-hidden residue is not a production defect: the approved five carry plenty under their hair) */
const CC = [0, 1.25, canon.ears.z], NT = 128, NP = 256;
const dirOf = (x, y, z) => { const dx = x - CC[0], dy = y - CC[1], dz = z - CC[2], r = Math.hypot(dx, dy, dz) || 1e-9;
  return [Math.min(NT - 1, Math.floor(Math.acos(Math.max(-1, Math.min(1, dy / r))) / Math.PI * NT)), Math.min(NP - 1, Math.floor((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * NP)), r]; };
function hairCover(ps) { const M = new Float32Array(NT * NP).fill(-1);
  for (const [n, g] of Object.entries(ps)) { if (!HAIR.test(n)) continue; const P = g.P, I = g.I;
    const splat = (x, y, z) => { const [t, p, r] = dirOf(x, y, z); const k = t * NP + p; if (r > M[k]) M[k] = r; };
    for (let i = 0; i < P.length; i += 3) splat(P[i], P[i + 1], P[i + 2]);
    for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; splat((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3); } }
  // dilate 1 cell (a strand gap is not an exposure)
  const O = M.slice(); for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { let m = M[t * NP + p]; for (let dt = -1; dt <= 1; dt++) for (let dp = -1; dp <= 1; dp++) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; m = Math.max(m, M[tt * NP + ((p + dp) % NP + NP) % NP]); } O[t * NP + p] = m; }
  return (x, y, z) => { const [t, p, r] = dirOf(x, y, z); return O[t * NP + p] < r + 0.004; };   // true = visible (no hair above)
}
async function texSampler(prim) { const tex = prim.getMaterial()?.getBaseColorTexture(); if (!tex) return null;
  const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return (u, v) => { const x = Math.min(info.width - 1, Math.max(0, Math.round((u % 1) * (info.width - 1)))), y = Math.min(info.height - 1, Math.max(0, Math.round((v % 1) * (info.height - 1)))), o = (y * info.width + x) * 3; return [data[o], data[o + 1], data[o + 2]]; }; }
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt((h ?? "#e0b090").slice(i, i + 2), 16));
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

/** FC-HAIR-SLIVER: stretched / spiky hair triangles — long (≥ minLen) and thin (height < len / aspect). Strand tips and
 *  fine locks are short; a cage of shredded strands is long slivers. */
export function hairSlivers(doc, { minLen = 0.03, aspect = 20 } = {}) {
  let slivers = 0, tris = 0; const per = {};
  for (const [n, g] of Object.entries(parts(doc))) { if (!HAIR.test(n)) continue; let c = 0;
    for (let t = 0; t < g.I.length; t += 3) { tris++; const a = g.I[t] * 3, b = g.I[t + 1] * 3, d = g.I[t + 2] * 3, P = g.P;
      const e = [[a, b], [b, d], [d, a]].map(([u, v]) => Math.hypot(P[u] - P[v], P[u + 1] - P[v + 1], P[u + 2] - P[v + 2])), L = Math.max(...e);
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2];
      const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);   // = 2·area
      if (L >= minLen && area2 / L < L / aspect) c++; }
    per[n.replace("identity_hair_", "")] = c; slivers += c; }
  return { slivers, perLayer: per, hairTris: tris, sliverPerMille: +(1000 * slivers / Math.max(1, tris)).toFixed(2) };
}

/** FC-COLLAR-AS-HAIR: hair-layer geometry hanging BELOW the chin IN FRONT of the neck axis, close to the midline — where a
 *  generated shirt collar sits and where hanging hair never does (long locks fall beside the face / over the shoulders). */
export function collarHair(doc, { chinY = 0.79, midX = 0.2, frontZ = 0.02 } = {}) {
  let verts = 0; const per = {};
  for (const [n, g] of Object.entries(parts(doc))) { if (!HAIR.test(n)) continue; let c = 0;
    for (let i = 0; i < g.P.length; i += 3) if (g.P[i + 1] < chinY && Math.abs(g.P[i]) < midX && g.P[i + 2] > frontZ) c++;
    if (c) per[n.replace("identity_hair_", "")] = c; verts += c; }
  return { verts, perLayer: per };
}

/** FC-EAR-RESIDUE: VISIBLE generation residue (dark paint) on the skin around the ears — the band around / behind the ear
 *  root, the auricle excluded (it stands out of the canonical skull), hair-covered skin excluded. Per-triangle texel sample. */
export async function earResidue(doc, { band = 0.12, auricle = 0.012, dark = 0.72 } = {}) {
  const lm = doc.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks, sk = await skull(), ps = parts(doc), g = ps.identity_head, visible = hairCover(ps);
  const at = g.UV ? await texSampler(g.prim) : null; if (!at) return { samples: 0, darkPct: 0 };
  const skinL = lum(hexRGB(lm.skin)), ears = [lm.attach.ears.l.root, lm.attach.ears.r.root]; let samples = 0, darkN = 0;
  for (let t = 0; t < g.I.length; t += 3) { const v = [g.I[t], g.I[t + 1], g.I[t + 2]], c = [0, 1, 2].map((k) => (g.P[v[0] * 3 + k] + g.P[v[1] * 3 + k] + g.P[v[2] * 3 + k]) / 3);
    const e = ears[c[0] < 0 ? 0 : 1]; if (Math.hypot(c[0] - e[0], c[1] - e[1], c[2] - e[2]) > band || c[2] > e[2] + 0.02) continue;
    if (sk.excess(c[0], c[1], c[2]) > auricle || !visible(c[0], c[1], c[2])) continue;
    const col = at((g.UV[v[0] * 2] + g.UV[v[1] * 2] + g.UV[v[2] * 2]) / 3, (g.UV[v[0] * 2 + 1] + g.UV[v[1] * 2 + 1] + g.UV[v[2] * 2 + 1]) / 3);
    samples++; if (lum(col) < dark * skinL) darkN++; }
  return { samples, dark: darkN, darkPct: +(100 * darkN / Math.max(1, samples)).toFixed(2) };
}

/** FC-EAR-HAIR-FRAGMENT: hair-layer triangles GLUED onto the auricle (within `glue` of the ear's own skin) — strands or
 *  shell fragments lying on the ear read as dirty stripes / cut-outs over it. The auricle = head-layer vertices near the ear
 *  root that stand out of the canonical skull. Hair that hangs OVER an ear (long styles) stands off it and does not count. */
export async function earHairFragments(doc, { earR = 0.09, auricle = 0.012, glue = 0.012, cell = 0.01 } = {}) {
  const lm = doc.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks, sk = await skull(), ps = parts(doc), H = ps.identity_head.P;
  const ears = [lm.attach.ears.l.root, lm.attach.ears.r.root], grid = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`; let aur = 0;
  for (let i = 0; i < H.length; i += 3) { const x = H[i], y = H[i + 1], z = H[i + 2]; if (!ears.some((e) => Math.hypot(x - e[0], y - e[1], z - e[2]) < earR) || sk.excess(x, y, z) <= auricle) continue;
    aur++; const k = key(x, y, z); (grid.get(k) ?? grid.set(k, []).get(k)).push([x, y, z]); }
  const near = (x, y, z) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const q of grid.get(`${Math.floor(x / cell) + a},${Math.floor(y / cell) + b},${Math.floor(z / cell) + c}`) ?? []) if (Math.hypot(q[0] - x, q[1] - y, q[2] - z) < glue) return true; return false; };
  let tris = 0; const per = [0, 0];
  for (const [n, g] of Object.entries(ps)) { if (!HAIR.test(n)) continue; const P = g.P, I = g.I;
    for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3, x = (P[a] + P[b] + P[d]) / 3, y = (P[a + 1] + P[b + 1] + P[d + 1]) / 3, z = (P[a + 2] + P[b + 2] + P[d + 2]) / 3;
      if (near(x, y, z)) { tris++; per[x < 0 ? 0 : 1]++; } } }
  return { tris, perSide: per, auricleVerts: aur };
}

/** FC-HAIR-AS-SKIN: hair geometry left in the SKIN layer (classifier confusion — e.g. warm / dyed hair close to the skin
 *  tone): head-layer triangles standing well OFF the canonical skull, away from the ears and the face front, painted in a
 *  non-skin colour. Hair-layer processing (fringe lift, clearance, strand cleanup) never sees them. */
export async function hairAsSkin(doc, { standOff = 0.03, earR = 0.09, colourDist = 60 } = {}) {
  const lm = doc.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks, sk = await skull(), ps = parts(doc), g = ps.identity_head;
  const at = g.UV ? await texSampler(g.prim) : null; if (!at) return { tris: 0, areaPct: 0 };
  const skin = hexRGB(lm.skin), ears = [lm.attach.ears.l.root, lm.attach.ears.r.root], eyeZ = (lm.eyes.l[2] + lm.eyes.r[2]) / 2; let bad = 0, area = 0, tot = 0;
  for (let t = 0; t < g.I.length; t += 3) { const a = g.I[t] * 3, b = g.I[t + 1] * 3, d = g.I[t + 2] * 3, P = g.P, c = [0, 1, 2].map((k) => (P[a + k] + P[b + k] + P[d + k]) / 3);
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[d] - P[a], vy = P[d + 1] - P[a + 1], vz = P[d + 2] - P[a + 2], A = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; tot += A;
    if (c[2] > eyeZ - 0.12 || sk.excess(c[0], c[1], c[2]) < standOff || ears.some((e) => Math.hypot(c[0] - e[0], c[1] - e[1], c[2] - e[2]) < earR)) continue;
    const vi = [g.I[t], g.I[t + 1], g.I[t + 2]], col = at((g.UV[vi[0] * 2] + g.UV[vi[1] * 2] + g.UV[vi[2] * 2]) / 3, (g.UV[vi[0] * 2 + 1] + g.UV[vi[1] * 2 + 1] + g.UV[vi[2] * 2 + 1]) / 3);
    if (Math.hypot(col[0] - skin[0], col[1] - skin[1], col[2] - skin[2]) > colourDist) { bad++; area += A; } }
  return { tris: bad, areaPct: +(100 * area / Math.max(1e-9, tot)).toFixed(2) };
}

/** FC-NECK-HAIR: hair-layer geometry INSIDE the neck column at neck height (below the skull base) — a generated neck /
 *  collar painted dark and labelled hair, left hugging the neck as a dark band above the tee. Hair cannot be inside the
 *  neck; hanging hair stands off it. Column = the HumanBase neck axis (x 0, z −0.013), radius 0.17, y 0.78–0.96. */
export function neckHair(doc, { r = 0.17, y0 = 0.78, y1 = 0.96, cz = -0.013 } = {}) {
  let verts = 0; const per = {};
  for (const [n, g] of Object.entries(parts(doc))) { if (!HAIR.test(n)) continue; let c = 0;
    for (let i = 0; i < g.P.length; i += 3) { const y = g.P[i + 1]; if (y < y0 || y > y1) continue; if (Math.hypot(g.P[i], g.P[i + 2] - cz) < r) c++; }
    if (c) per[n.replace("identity_hair_", "")] = c; verts += c; }
  return { verts, perLayer: per };
}

/** FC-SKIN-FLAP: head-layer skin (incl. any generated nape skin) standing far OUT of the canonical skull below the eye line,
 *  behind the ear plane, away from the ears — a skin fin / panel no head has (the universal napeSkin's failure: it passed
 *  every closure metric while growing fins behind the neck). Count of vertices more than `out` outside the skull. */
export async function skinFlaps(doc, { out = 0.08, neckTop = 0.84 } = {}) {
  const root = doc.getRoot(), lm = root.listScenes()[0].getExtras().humanIdentity.landmarks, sk = await skull(), eyeY = lm.eyes.l[1], ears = [lm.attach.ears.l.root, lm.attach.ears.r.root]; let verts = 0, max = 0;
  for (const m of root.listMeshes()) { if (!/^identity_head|^identity_nape|^baked_nape/.test(m.getName())) continue; const P = m.listPrimitives()[0].getAttribute("POSITION").getArray();
    for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; if (y > eyeY - 0.1 || y < neckTop || z > canon.ears.z + 0.02) continue; if (ears.some((e) => Math.hypot(x - e[0], y - e[1], z - e[2]) < 0.12)) continue;
      const e = sk.excess(x, y, z); if (e > max) max = e; if (e > out) verts++; } }
  return { verts, maxExcess: +max.toFixed(3) };
}

/** FC-FACE-ASPECT-GROWTH (build record): the face's width:length aspect after chibify vs the employee's OWN generated
 *  source — a long source face compressed into the canonical eye-line envelope comes out round. */
export function faceAspectGrowth(record) {
  const g = (record.after.cheek / record.after.faceLength) / (record.source.cheek / record.source.faceLength);
  return { growth: +g.toFixed(3), source: +(record.source.cheek / record.source.faceLength).toFixed(3), after: +(record.after.cheek / record.after.faceLength).toFixed(3), faceK: +(record.params?.faceK ?? NaN).toFixed?.(3) };
}

export async function readIdentity(file) { return io.read(file); }
