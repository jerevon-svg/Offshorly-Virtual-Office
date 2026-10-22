// build-hair-tail.mjs — TIED HAIR (gathered back hair → tie → ponytail mass) for any identity head. ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/build-hair-tail.mjs <identity.glb> <accessory-id> [--tie=low|mid|high]
//        [--length=shoulder|upperBack|midBack] [--volume=1]
//
// V1.1 rewrite of the V1 tail (a narrow hanging tube). A tied hairstyle is three reusable parts, all measured on the
// identity's own (layered) hair surface, so any employee with a ponytail / low tie / half-up style inherits it:
//   1. GATHER — the back-hair volume around the tie, swept INTO it: a lofted surface that leaves the head's own hair
//      surface on a wide ring (just outside it) and converges on the tie, with converging clump grooves — the hair
//      visibly flows from crown and sides into the tie instead of a tube starting from nowhere;
//   2. TIE — a small band where the hair is gathered;
//   3. TAIL MASS — a lofted, lobed volume (five clumps) leaving the tie back-and-down: full near the tie, a natural
//      taper, soft ends, resting just behind the HumanBase nape/back (measured clearance) down to the length preset.
// Colour: the identity's hair colour (median dark texel), grooves darker. Motion: a 3-joint chain on the shared "long"
// preset, rigid at the tie (the gather and tie never move relative to the head). Removable like any accessory: the
// identity's own hair stays complete without it.
import sharp from "sharp";
import * as THREE from "three";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { BASE_OUT, computeNormals, io, loadBase, readIdentitySurface, weldNormals, writeModule } from "./lib.mjs";

const args = process.argv.slice(2), [idFile, outId] = args, opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const LENGTHS = { shoulder: 0.7, upperBack: 0.6, midBack: 0.5 }, TIES = { low: -0.13, mid: 0.03, high: 0.22 };
const endY = LENGTHS[opt("length", "upperBack")], tieDY = TIES[opt("tie", "low")], VOL = +opt("volume", "1"), STYLE = opt("style", "pony");   // pony = hanging locks · bun = locks coiled into a knot
const doc = await io.read(idFile);
const lm = doc.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks;
const S = await readIdentitySurface(doc), n = S.P.length / 3, HP = S.P;
const { data: T, info: ti } = await sharp(S.texture).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const tex = (i) => { const u = Math.min(ti.width - 1, Math.max(0, Math.round((S.UV[i * 2] % 1) * (ti.width - 1)))), v = Math.min(ti.height - 1, Math.max(0, Math.round((S.UV[i * 2 + 1] % 1) * (ti.height - 1)))), o = (v * ti.width + u) * 3; return [T[o], T[o + 1], T[o + 2]]; };
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const isHair = (i) => S.layer[i] !== "identity_head" || lum(tex(i)) < 60;
// hair colour (median dark hair texel)
const dark = []; for (let i = 0; i < n; i += 3) if (isHair(i)) { const c = tex(i); if (lum(c) < 70) dark.push(c); }
const hair = [0, 1, 2].map((k) => dark.map((c) => c[k]).sort((a, b) => a - b)[dark.length >> 1] / 255);
const eyeY = lm.eyes.r[1], tieY = eyeY + tieDY;
// the head's OUTER surface as a radial map about the cranium centre (every identity layer counts: the gather lies on top)
const CC = new THREE.Vector3(0, tieY + 0.02, -0.05), NT = 64, NP = 128, RM = new Float32Array(NT * NP);
const binOf = (d) => [Math.min(NT - 1, Math.floor(Math.acos(Math.max(-1, Math.min(1, d.y))) / Math.PI * NT)), Math.min(NP - 1, Math.floor((Math.atan2(d.z, d.x) + Math.PI) / (2 * Math.PI) * NP))];
{ const p = new THREE.Vector3(); for (let i = 0; i < n; i++) { p.set(HP[i * 3], HP[i * 3 + 1], HP[i * 3 + 2]).sub(CC); const r = p.length(); if (r < 1e-4) continue; const [a, b] = binOf(p.divideScalar(r)); RM[a * NP + b] = Math.max(RM[a * NP + b], r); } }
{ const R2 = RM.slice(); for (let a = 0; a < NT; a++) for (let b = 0; b < NP; b++) { if (R2[a * NP + b]) continue; let s = 0, c = 0; for (let da = -2; da <= 2; da++) for (let db = -2; db <= 2; db++) { const aa = a + da; if (aa < 0 || aa >= NT) continue; const v = R2[aa * NP + ((b + db) % NP + NP) % NP]; if (v) { s += v; c++; } } if (c) RM[a * NP + b] = s / c; } }
const outer = (d) => { const [a, b] = binOf(d); return RM[a * NP + b]; };   // radius of the outer hair surface along d
const back = new THREE.Vector3(0, 0, -1);
const tieR = outer(back), tieC = CC.clone().addScaledVector(back, tieR + 0.012);
const rTie = 0.056 * VOL;   // a gathered bunch: the root has real volume (never a narrow extrusion)
const P = [], I = [], COL = [], JW = [];   // JW: per vertex 0 = rigid on Head, else the tail parameter t
const addV = (p, c, t = 0) => { P.push(p.x, p.y, p.z); COL.push(...c); JW.push(t); return P.length / 3 - 1; };
const shade = (k) => hair.map((v) => Math.min(1, v * k));
const HL = (0.3 * hair[0] + 0.59 * hair[1] + 0.11 * hair[2]) < 0.24 ? [0.36, 0.37, 0.4] : hair.map((c) => c + (1 - c) * 0.35);
const lit = (k, h) => shade(k).map((c, i) => c + (HL[i] - c) * h);   // a lighter variation of the hair along lock crests
const quadStrip = (rows, cols, closed) => { for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < cols - (closed ? 0 : 1); c++) { const c1 = (c + 1) % cols, a = rows[r][c], b = rows[r][c1], d = rows[r + 1][c], e = rows[r + 1][c1]; I.push(a, d, b, b, d, e); } };
// ---- 1. GATHER: a ring of directions around "back" (wider sideways, reaching higher than lower), lofted into the tie ----
// V1.2: the LOWER half reaches the measured NAPE (lowest head surface at the back centre — where the head meets the neck)
// and wraps further round behind the ears: long hair gathered from the nape up into the tie, never short hair + a tail
let napeY = 9; for (let i = 0; i < n; i++) if (Math.abs(HP[i * 3]) < 0.08 && HP[i * 3 + 2] < CC.z - 0.1 && S.layer[i] === "identity_head") napeY = Math.min(napeY, HP[i * 3 + 1]);
if (napeY > 8) napeY = tieY - 0.2;
// the elevation whose point ON the measured surface sits just above the nape (bisection: the back curves in to the neck)
const surfY = (el) => { const d = new THREE.Vector3(0, -Math.sin(el), -Math.cos(el)); return CC.y + d.y * (outer(d) + 0.004); };
let EL_DN = 0.3; { let lo = 0.3, hi = 1.45; for (let it = 0; it < 30; it++) { const mid = (lo + hi) / 2; if (surfY(mid) > napeY + 0.02) lo = mid; else hi = mid; } EL_DN = lo; }
// ROUNDED WEDGE (V1.2): long hair gathered up is a VOLUME, not a skin-tight sheet — the gather stands off the head by a
// profile that peaks between the outer ring and the tie, much fuller on the lower half (the rear skull / nape mass that
// carries the tied silhouette from the side), so there is no break where "normal hair ends and the tail begins"
const WEDGE = 0.045 * VOL, WEDGE_UP = 0.014 * VOL;
const NA = 64, NS = 16, AZ = 0.78, AZ_DN = 1.32, EL_UP = 0.72, rows = [];
for (let s = 0; s <= NS; s++) { const f = s / NS, row = [];
  for (let k = 0; k < NA; k++) { const a = (k / NA) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    // outer ring direction (spherical offsets about the back direction), shrinking toward the tie as f → 1
    const g = 1 - f, az = (sa > 0 ? AZ : AZ + (AZ_DN - AZ) * Math.min(1, -sa * 1.6)) * ca * g, el = (sa > 0 ? EL_UP : EL_DN) * sa * g;
    const d = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    // on the hair surface (+ a small lift that grows toward the tie: the gathered hair stands up into the band)
    const wedge = (sa < 0 ? WEDGE_UP + (WEDGE - WEDGE_UP) * Math.min(1, -sa * 1.4) : WEDGE_UP) * Math.sin(Math.PI * Math.min(1, f * 1.1)) * Math.min(1, f * 4);
    const onSurf = CC.clone().addScaledVector(d, outer(d) + 0.004 + 0.012 * f * f + wedge);
    // the tie ring point for this angle (in the plane facing back)
    const ringP = tieC.clone().add(new THREE.Vector3(ca * rTie, sa * rTie * 0.85, 0));
    const w = f ** 2.2, p = onSurf.multiplyScalar(1 - w).addScaledVector(ringP, w);
    // never inside the head's hair surface
    const rel = p.clone().sub(CC), r = rel.length(), dd = rel.clone().divideScalar(r), rmin = outer(dd) + 0.003; if (r < rmin) p.copy(CC).addScaledVector(dd, rmin);
    const groove = 0.78 + 0.22 * Math.cos(a * 11 + f * 1.5) ** 2;   // converging clump grooves
    row.push(addV(p, lit(groove * (0.9 + 0.15 * f), 0.18 * Math.max(0, Math.cos(a * 11 + f * 1.5)) ** 6))); }
  rows.push(row); }
quadStrip(rows, NA, true);
{ let lo = 9; for (const v of rows[0]) lo = Math.min(lo, P[v * 3 + 1]); console.log(`gather: nape y ${napeY.toFixed(3)} · EL_DN ${EL_DN.toFixed(3)} · outer ring lowest y ${lo.toFixed(3)} · CC ${CC.toArray().map((v) => v.toFixed(3))} · outer(down-back) ${outer(new THREE.Vector3(0, -Math.sin(EL_DN), -Math.cos(EL_DN))).toFixed(3)}`); }
// ---- 2. TIE band ----
{ const TR = [], NB = 28, NTU = 8, tube = 0.011 * VOL;
  for (let k = 0; k <= NB; k++) { const a = (k / NB) * 2 * Math.PI, ring = [];
    for (let j = 0; j < NTU; j++) { const b = (j / NTU) * 2 * Math.PI, rr = rTie * 1.02 + Math.cos(b) * tube;
      ring.push(addV(new THREE.Vector3(tieC.x + Math.cos(a) * rr, tieC.y + Math.sin(a) * rr * 0.85, tieC.z - 0.004 + Math.sin(b) * tube), shade(0.55))); }
    TR.push(ring); }
  quadStrip(TR, NTU, true); }
// ---- 3. TAIL MASS: centreline back-and-down, clear of the base body's back ----
const base = await loadBase(), BP = base.geo.P;
const backZ = (y) => { let z = 9; for (let i = 0; i < BP.length / 3; i++) if (Math.abs(BP[i * 3]) < 0.1 && Math.abs(BP[i * 3 + 1] - y) < 0.02) z = Math.min(z, BP[i * 3 + 2]); return z > 8 ? -0.12 : z; };
const Rmax = (STYLE === "bun" ? 0.068 : 0.082) * VOL, clear = 0.03;
const pts = [tieC.clone(), tieC.clone().add(new THREE.Vector3(0, -0.04, -0.045))];
if (STYLE === "bun") {
  // BUN: from the tie the hair rises up-and-back and coils once and a half round a knot centre, spiralling inward so the
  // ends tuck — the same lock machinery wraps the coil (a twisted-rope knot of broad locks, not a ball)
  pts.length = 0; const Cb = tieC.clone().add(new THREE.Vector3(0, 0.07 * VOL, -0.075 * VOL)), a0 = Math.atan2(tieC.y - Cb.y, -(tieC.z - Cb.z));
  for (let k = 0; k <= 14; k++) { const u = k / 14, a = a0 - u * 1.55 * 2 * Math.PI * 0.5 * 2, r = 0.075 * VOL * (1 - 0.45 * u), q = new THREE.Vector3(0.012 * Math.sin(u * 5), Cb.y + Math.sin(a) * r, Cb.z - Math.cos(a) * r);
    const rel = q.clone().sub(CC), l = rel.length(), dd = rel.clone().divideScalar(l), rmin = outer(dd) + Rmax * 0.55; if (l < rmin) q.copy(CC).addScaledVector(dd, rmin);   // never through the head
    pts.push(q); }
} else for (const y of [tieY - 0.16, (tieY - 0.16 + endY) / 2 + 0.04, endY + 0.03, endY]) if (y < pts.at(-1).y - 0.03) pts.push(new THREE.Vector3(0, y, Math.min(pts.at(-1).z, backZ(y) - clear - Rmax * 0.8)));
const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
// V1.2 TAIL = SEVERAL LOCKS (universal stylised ponytail): LOCKS tapered clumps with their own roots inside the tie, a
// coherent root direction (they leave the band together), slightly different lengths, curvature and twist, overlapping,
// tips fanning a little — around a hidden CORE (no see-through between locks). Crest highlight runs root → tip on each
// lock. Every vertex carries its tail parameter t, so all locks ride the same chain and move together.
const radius = (t) => { const bulge = rTie * 1.1 + (Rmax - rTie * 1.1) * Math.min(1, t / 0.14) ** 0.6, mid = t < 0.2 ? bulge : Rmax * (1 - 0.35 * (t - 0.2) / 0.6); return t < 0.8 ? mid : Rmax * 0.65 * (1 - ((t - 0.8) / 0.2) ** 1.6) + 0.006; };
const LOCKS = 5, LEN = 44, SEG = 14, Rlock = Rmax * 0.58, rand = (k) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const frameAt = (t) => { const tg = curve.getTangentAt(t).normalize(), sd = new THREE.Vector3(1, 0, 0).sub(tg.clone().multiplyScalar(tg.x)).normalize(), nr = new THREE.Vector3().crossVectors(tg, sd).normalize(); return { c: curve.getPointAt(t), tg, sd, nr }; };
const tube = (centre, rad, flat, colOf, tMax) => { const R2 = [];
  for (let k = 0; k <= LEN; k++) { const u = k / LEN, t = u * tMax, f = frameAt(t), c = centre(t, f), r = rad(u), ring = [];
    for (let q = 0; q < SEG; q++) { const a = (q / SEG) * 2 * Math.PI; ring.push(addV(c.clone().addScaledVector(f.sd, Math.cos(a) * r).addScaledVector(f.nr, Math.sin(a) * r * flat), colOf(u, a), Math.max(1e-3, t))); }
    R2.push(ring); }
  quadStrip(R2, SEG, true); const tipP = centre(tMax, frameAt(tMax)), c0 = addV(tipP, colOf(1, 0), tMax); for (let q = 0; q < SEG; q++) I.push(R2[LEN][q], c0, R2[LEN][(q + 1) % SEG]); };
// the core: slimmer than the locks, ends before them
tube((t, f) => f.c, (u) => Math.max(0.004, radius(u * 0.82) * 0.62), 0.85, () => shade(0.6), 0.82);
for (let L = 0; L < LOCKS; L++) {
  const th = (L / LOCKS) * 2 * Math.PI + 0.35 * rand(L), len = 0.86 + 0.14 * rand(L + 7), curl = (rand(L + 3) - 0.5) * 0.05, fan = 0.35 + 0.4 * rand(L + 11), ph = rand(L + 5) * 6.28;
  const o = [Math.cos(th), Math.sin(th) * 0.85];
  const centre = (t, f) => { const root = rTie * 0.42, spread = root * (1 - t) ** 1.5 + Rmax * 0.45 * fan * Math.sin(Math.PI * Math.min(1, t * 1.1)) * 0.6 + Rmax * 0.35 * fan * t ** 2;
    const wig = curl * Math.sin(t * Math.PI * 1.3 + ph); return f.c.clone().addScaledVector(f.sd, o[0] * spread + wig).addScaledVector(f.nr, o[1] * spread + wig * 0.5); };
  const rad = (u) => { const swell = u < 0.12 ? 0.75 + 0.25 * u / 0.12 : 1, taper = u < 0.55 ? 1 : 1 - ((u - 0.55) / 0.45) ** 1.35; return Math.max(0.0025, Rlock * swell * taper * (0.92 + 0.12 * rand(L + 13))); };
  // crest highlight: on the lock's outward face, strongest mid-length, fading to the tip
  const colOf = (u, a) => { const crest = Math.max(0, Math.cos(a - th)) ** 4, along = Math.sin(Math.PI * Math.min(1, u * 1.15)); return lit((0.74 + 0.22 * crest) * (1 - 0.1 * u), 0.3 * crest * along); };
  tube(centre, rad, 0.78, colOf, len); }
// BUN CORE: the coil's centre is filled (an ellipsoid hidden inside the locks) — a knot never shows a hole through it
if (STYLE === "bun") { const Cb = tieC.clone().add(new THREE.Vector3(0, 0.07 * VOL, -0.075 * VOL)), RX = 0.062 * VOL, RY = 0.07 * VOL, RZ = 0.07 * VOL, NU = 20, NV = 14, rowsC = [];
  for (let j = 0; j <= NV; j++) { const ph = (j / NV) * Math.PI, row = []; for (let k = 0; k < NU; k++) { const th = (k / NU) * 2 * Math.PI; row.push(addV(new THREE.Vector3(Cb.x + RX * Math.sin(ph) * Math.cos(th), Cb.y + RY * Math.cos(ph), Cb.z + RZ * Math.sin(ph) * Math.sin(th)), shade(0.62), 0)); } rowsC.push(row); }
  quadStrip(rowsC, NU, true); }
// ---- motion: 3 joints along the tail (hinge just past the tie); gather + tie + root rigid on Head ----
const JT = [0.06, 0.38, 0.7, 1].map((t) => curve.getPointAt(t));
const extraJoints = [0, 1, 2].map((k) => ({ name: `tail_${k}`, parent: k ? `tail_${k - 1}` : "Head", world: new THREE.Matrix4().makeTranslation(JT[k].x, JT[k].y, JT[k].z) }));
const chains = [{ id: "tail", joints: extraJoints.map((j) => j.name), hinge: JT[0].toArray(), ends: [JT[1].toArray(), JT[2].toArray(), JT[3].toArray()], hang: 0 }];
const nv = P.length / 3, Jw = new Uint8Array(nv * 4), Ww = new Float32Array(nv * 4), J0 = base.names.length;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
for (let v = 0; v < nv; v++) { const t = STYLE === "bun" ? Math.min(JW[v], 0.06 + 0.25 * JW[v]) * (JW[v] > 0.06 ? 1 : 0) : JW[v]; if (t < 0.06) { /* a knot barely swings */ Jw[v * 4] = base.JI.Head; Ww[v * 4] = 1; continue; }
  const f = Math.min(2.999, ((t - 0.06) / 0.94) * 3), seg = Math.floor(f), fr = f - seg, root = sm(0.06, 0.16, t);
  Jw[v * 4] = J0 + seg; Ww[v * 4] = root * (seg < 2 ? 1 - fr * 0.5 : 1); Jw[v * 4 + 1] = seg < 2 ? J0 + seg + 1 : base.JI.Head; Ww[v * 4 + 1] = seg < 2 ? root * fr * 0.5 : 0;
  Jw[v * 4 + 2] = base.JI.Head; Ww[v * 4 + 2] = 1 - root; }
const Pf = Float32Array.from(P);
const bytes = await writeModule(`${BASE_OUT}/accessories/${outId}.glb`, base, [{ name: "accessory_hairtail", P: Pf, N: weldNormals(Pf, computeNormals(Pf, I)), I, COLOR: COL, J: Jw, W: Ww, material: { name: "accessory_hairtail", roughness: 0.55, doubleSided: true } }],
  { humanAccessory: { id: outId, slot: "accessory", base: C.HUMAN_BASE_VERSION, kind: "hair-tied", style: STYLE, tie: opt("tie", "low"), length: opt("length", "upperBack"), volume: VOL, fittedTo: idFile.split("/").pop(), chains, hairMotion: "long" } }, { compress: false, extraJoints });
console.log(`${outId}: tie ${opt("tie", "low")} at ${tieC.toArray().map((v) => v.toFixed(3))} (r ${rTie.toFixed(3)}) → end y ${endY} · tail max r ${Rmax.toFixed(3)} · hair rgb(${hair.map((v) => Math.round(v * 255)).join(",")}) · ${I.length / 3} tris · ${(bytes / 1024).toFixed(0)} KB`);
