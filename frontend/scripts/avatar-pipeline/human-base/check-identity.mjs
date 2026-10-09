// check-identity.mjs — STRUCTURAL INVARIANTS of HumanBase production candidates. ZERO CREDITS. Evidence, not a verdict:
// visual 360° review (qa-360.mjs) stays part of acceptance.
//
//   node scripts/avatar-pipeline/human-base/check-identity.mjs [who …]      (default: all five; reads production/<who>-v1.glb)
//
// Per candidate (the OPTIMISED file — what ships):
//   closure    directions from the head centre that see NO surface (head, hair layers, skull base, interior) outside the
//              neck cone — an open view into the head (V1: the underside)
//   boundary   open boundary edges of the head mesh and of each hair layer (informational: hair shells are open by nature;
//              the interior closure is what keeps them from reading as holes)
//   fringe     foreground locks: vertices BEHIND the face surface over the face (must be 0), and vertices over a VISIBLE
//              living-eye texel that sit behind/too close to the shell (eye cutting through hair — must be 0)
//   glasses    each glasses module of the recipe + the universal frames, fitted at runtime to this identity: frame
//              vertices inside the face (front) or inside the head side (temples) — must be 0
//   hair acc.  tied-hair / clip accessories: vertices inside the canonical skull (must be 0)
//   skull      canonical head-size contract: ear half-width vs canonical (±1.5%)
import fs from "node:fs";
import sharp from "sharp";
import { checkGlasses, fitGlassesPositions, glassesFrame } from "../../../src/dev/vo3d/human/humanGlasses.ts";
import { checkAccessory, placeAccessory } from "../../../src/dev/vo3d/human/humanAccessoryFit.ts";
import * as THREE from "three";
import { canonicalSkull } from "./head-closure.mjs";
import { BASE_OUT, io } from "./lib.mjs";

const WHO = process.argv.slice(2).length ? process.argv.slice(2) : ["bon", "micah", "angelo", "clang", "france"];
const R = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/human-base/employees.json", "utf8"));
const canon = JSON.parse(fs.readFileSync("scripts/avatar-pipeline/human-base/canonical-profile.json", "utf8"));
const AP = (await io.read(`${BASE_OUT}/identity/alex-neutral-head-v1.glb`)).getRoot().listMeshes()[0].listPrimitives()[0].getAttribute("POSITION").getArray();
const skull = canonicalSkull(AP, [0, 1.25, canon.ears.z]);
const prim = (doc, n) => doc.getRoot().listMeshes().find((m) => m.getName() === n)?.listPrimitives()[0] ?? null;
const arr = (p, a) => p.getAttribute(a)?.getArray();
function frontRaster(parts, G) { const Z = new Float32Array(G.nx * G.ny).fill(NaN);
  for (const { P, I } of parts) for (let t = 0; t < I.length; t += 3) { const q = [0, 1, 2].map((k) => { const v = I[t + k]; return [(P[v * 3] - G.x0) / G.c, (P[v * 3 + 1] - G.y0) / G.c, P[v * 3 + 2]]; });
    const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-12) continue;
    for (let y = Math.max(0, Math.ceil(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(G.ny - 1, Math.floor(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
      for (let x = Math.max(0, Math.ceil(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(G.nx - 1, Math.floor(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
        if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue; const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], k = y * G.nx + x; if (!(z <= Z[k])) Z[k] = z; } }
  return Z; }
/** Every structural metric of ONE identity file (the importable core of this checker — the failure registry's artifact
 *  detectors read these numbers; the verdict is the registry's, not this function's).
 *  @param who      employee id (accessory list lookup only)
 *  @param file     the identity GLB to measure (default: that employee's production file)
 *  @param record   the build's chibify record (skull contract), default output/human-base/<who>-meshy-chibi-v1-chibify.json */
export async function identityMetrics(who, { file = `${BASE_OUT}/production/${who}-v1.glb`, record = `scripts/avatar-pipeline/output/human-base/${who}-meshy-chibi-v1-chibify.json`, accessories = R.employees[who]?.accessories ?? [] } = {}) {
  const doc = await io.read(file), lm = doc.getRoot().listScenes()[0].getExtras().humanIdentity.landmarks;
  const parts = Object.fromEntries(doc.getRoot().listMeshes().map((m) => { const p = m.listPrimitives()[0]; return [m.getName(), { P: arr(p, "POSITION"), I: p.getIndices().getArray() }]; }));
  const r = { who };
  // ---- closure: a spherical visibility map from the head centre ----
  { const C = [0, 1.25, canon.ears.z], NT = 90, NP = 180, hit = new Uint8Array(NT * NP);
    for (const [n, { P, I }] of Object.entries(parts)) { if (!/^identity_|^baked_|^bodyskin_/.test(n)) continue;
      for (let t = 0; t < I.length; t += 3) for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1 / 3, 1 / 3], [0.5, 0.5], [0.5, 0], [0, 0.5]]) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const x = P[a] + (P[b] - P[a]) * u + (P[c] - P[a]) * v - C[0], y = P[a + 1] + (P[b + 1] - P[a + 1]) * u + (P[c + 1] - P[a + 1]) * v - C[1], z = P[a + 2] + (P[b + 2] - P[a + 2]) * u + (P[c + 2] - P[a + 2]) * v - C[2], rr = Math.hypot(x, y, z) || 1;
        hit[Math.min(NT - 1, Math.floor(Math.acos(y / rr) / Math.PI * NT)) * NP + Math.min(NP - 1, Math.floor((Math.atan2(z, x) + Math.PI) / (2 * Math.PI) * NP))] = 1; } }
    // the neck cone (straight down, where the HumanBase neck enters) is legitimately open
    let open = 0, total = 0; const where = {}; for (let t = 0; t < NT; t++) { const th = ((t + 0.5) / NT) * Math.PI; if (th > Math.PI * 0.82 || th < Math.PI * 0.04) continue; for (let p = 0; p < NP; p++) { total++; /* (the pole bins are too small to sample) */ if (!hit[t * NP + p]) { let near = 0; for (let dt = -1; dt <= 1; dt++) for (let dp = -1; dp <= 1; dp++) { const tt = t + dt; if (tt >= 0 && tt < NT && hit[tt * NP + ((p + dp) % NP + NP) % NP]) near++; } if (near < 3) { open++; const k = `el${Math.round(90 - th * 180 / Math.PI)}|az${Math.round(((p + 0.5) / NP * 360 - 180))}`; where[k] = 1; } } } }
    r.openDirections = +(100 * open / total).toFixed(2); if (process.env.WHERE) r.openAt = Object.keys(where).slice(0, 40); }
  // ---- boundary edges ----
  { const be = (P, I) => { const k = (i) => `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`, c = new Map(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { const a = k(I[t + q]), b = k(I[t + (q + 1) % 3]), e = a < b ? a + "|" + b : b + "|" + a; c.set(e, (c.get(e) ?? 0) + 1); } let n = 0; for (const v of c.values()) if (v === 1) n++; return n; };
    r.boundaryEdges = Object.fromEntries(Object.entries(parts).filter(([n]) => n.startsWith("identity_") || n === "baked_interior").map(([n, g]) => [n.replace("identity_", ""), be(g.P, g.I)])); }
  // ---- V1.4 FAILURE-CLASS INVARIANTS (each one a defect found by hand on the first five employees) ----
  { const ex = Math.abs(lm.eyes.r[0]), ey = lm.eyes.l[1], hw = lm.eyes.halfW, hh = Math.max(lm.eyes.halfH, 0.5 * hw), earZ = canon.ears.z, mshs = doc.getRoot().listMeshes();
    // (a) facial features on hair-motion joints: hair-layer vertices on the face front must be 100 % Head (the brow drifted off the face)
    { const headJ = doc.getRoot().listNodes().filter((nd) => nd.getName() === "Head")[0]; let bad = 0;
      for (const m of mshs) { const n = m.getName(); if (!n.startsWith("identity_hair_") || n === "identity_hair_fringe") continue; const p = m.listPrimitives()[0], P = arr(p, "POSITION"), J = arr(p, "JOINTS_0"), W = arr(p, "WEIGHTS_0"); if (!J) continue;
        const skin = m.listParents().find((x) => x.propertyType === "Node")?.getSkin?.() ?? doc.getRoot().listSkins()[0], joints = skin.listJoints(), hi = joints.indexOf(headJ);
        for (let v = 0; v < P.length / 3; v++) { const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2]; if (z < earZ + 0.2 || y > ey + 0.2 || y < ey + hh || Math.abs(Math.abs(x) - ex) > hw * 1.2) continue; let wh = 0;   /* the brow band */ for (let k = 0; k < 4; k++) if (J[v * 4 + k] === hi) wh += W[v * 4 + k]; if (wh < 0.99) bad++; } }
      r.featuresOnHairJoints = bad; }
    // (b) face-front holes (eye openings excluded — the living-eye shell owns them)
    { const parts2 = Object.entries(parts).filter(([n]) => n === "identity_head" || n === "identity_face_twin" || n === "baked_holefill" || (n.startsWith("identity_hair_") && n !== "identity_hair_fringe" && n !== "identity_hair_base"));
      const key = (x, y, z) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`, id = new Map(), pos = [], ec = new Map();
      const hairV = new Set(); for (const [n, g] of parts2) { const loc = new Int32Array(g.P.length / 3); for (let v = 0; v < loc.length; v++) { const k = key(g.P[v * 3], g.P[v * 3 + 1], g.P[v * 3 + 2]); if (!id.has(k)) { id.set(k, pos.length / 3); pos.push(g.P[v * 3], g.P[v * 3 + 1], g.P[v * 3 + 2]); } loc[v] = id.get(k); if (n.startsWith("identity_hair_")) hairV.add(loc[v]); }
        for (let t = 0; t < g.I.length; t += 3) for (let q = 0; q < 3; q++) { const a = loc[g.I[t + q]], b = loc[g.I[t + (q + 1) % 3]], kk = a < b ? `${a}_${b}` : `${b}_${a}`; ec.set(kk, (ec.get(kk) ?? 0) + 1); } }
      let holes = 0; const bv = new Set(); for (const [k, c] of ec) { if (c !== 1) continue; const [a, b] = k.split("_").map(Number); if (hairV.has(a) || hairV.has(b)) continue; bv.add(a); bv.add(b); }   /* skin-only edges (hair shells are open by nature) */
      // (the mirrored twin patch overlays the face by design: its rim and the own surface it owns are not holes)
      const TW = parts.identity_face_twin, cov = new Set(); if (TW) for (let v = 0; v < TW.P.length / 3; v++) for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) cov.add(`${Math.round(TW.P[v * 3] / 0.004) + dx},${Math.round(TW.P[v * 3 + 1] / 0.004) + dy}`);
      for (const v of bv) { const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2]; if (cov.has(`${Math.round(x / 0.004)},${Math.round(y / 0.004)}`)) continue; if (z < earZ + 0.2 || y < ey - 0.25 || y > ey + 0.3 || Math.abs(x) > 0.3) continue; if (Math.hypot((Math.abs(x) - ex) / (hw * 1.3), (y - ey) / (hh * 1.4)) < 1) continue; holes++; }
      r.faceHoleVerts = holes; }
    // (c) closure geometry visible below the head underside (the ragged band under the jaw)
    { const HL = new Map(), hk = (x, z) => `${Math.round(x / 0.01)},${Math.round(z / 0.01)}`; for (const n of ["identity_head", "identity_face_twin"]) { const g = parts[n]; if (!g) continue; for (let v = 0; v < g.P.length / 3; v++) { const k = hk(g.P[v * 3], g.P[v * 3 + 2]); if (g.P[v * 3 + 1] < (HL.get(k) ?? 9)) HL.set(k, g.P[v * 3 + 1]); } }
      const nk = (() => { const g = parts.bodyskin_neckext; if (!g) return { cx: 0, cz: canon.ears.z, r: 0.12 }; let cx = 0, cz = 0; const n2 = g.P.length / 3; for (let v = 0; v < n2; v++) { cx += g.P[v * 3] / n2; cz += g.P[v * 3 + 2] / n2; } let r2 = 0; for (let v = 0; v < n2; v++) r2 = Math.max(r2, Math.hypot(g.P[v * 3] - cx, g.P[v * 3 + 2] - cz)); return { cx, cz, r: r2 }; })();
      let below = 0; for (const n of ["baked_skullbase", "baked_interior"]) { const g = parts[n]; if (!g) continue; for (let t = 0; t < g.I.length; t += 3) { const x = (g.P[g.I[t] * 3] + g.P[g.I[t + 1] * 3] + g.P[g.I[t + 2] * 3]) / 3, y = (g.P[g.I[t] * 3 + 1] + g.P[g.I[t + 1] * 3 + 1] + g.P[g.I[t + 2] * 3 + 1]) / 3, z = (g.P[g.I[t] * 3 + 2] + g.P[g.I[t + 1] * 3 + 2] + g.P[g.I[t + 2] * 3 + 2]) / 3;
        if (z < nk.cz || Math.hypot(x - nk.cx, z - nk.cz) < nk.r * 0.92) continue;   /* the jaw band (in front of the neck axis) */ let h = 9; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) h = Math.min(h, HL.get(`${Math.round(x / 0.01) + dx},${Math.round(z / 0.01) + dz}`) ?? 9); if (h < 8 && y < h - 0.01) below++; } }
      r.closureBelowJaw = below; }
    // (d) bald pockets: on the side/back of the head, skin seen from outside that is enclosed by hair in its row (radial map)
    { const C = [0, 1.3, earZ], NT = 64, NP = 128, Rm = new Float32Array(NT * NP), L = new Uint8Array(NT * NP);
      for (const [n, g] of Object.entries(parts)) { const cls = n === "identity_head" || n === "identity_face_twin" ? 1 : n.startsWith("identity_hair_") || n.startsWith("accessory") ? 2 : 0; if (!cls) continue;
        for (let v = 0; v < g.P.length / 3; v++) { const x = g.P[v * 3] - C[0], y = g.P[v * 3 + 1] - C[1], z = g.P[v * 3 + 2] - C[2], rr = Math.hypot(x, y, z); if (rr < 1e-4) continue; const t = Math.min(NT - 1, Math.floor(Math.acos(y / rr) / Math.PI * NT)), p = Math.min(NP - 1, Math.floor((Math.atan2(z, x) + Math.PI) / (2 * Math.PI) * NP)), k = t * NP + p; if (rr > Rm[k]) { Rm[k] = rr; L[k] = cls; } } }
      let pockets = 0, earPocket = 0; for (let t = 4; t < NT / 2 + 4; t++) { for (let p = 0; p < NP; p++) { const k = t * NP + p; if (L[k] !== 1) continue; const ph = ((p + 0.5) / NP) * 2 * Math.PI - Math.PI, zf = Math.sin(ph), xf = Math.cos(ph); if (zf > -0.15 || Math.abs(xf) < 0.2 && zf > -0.9) { if (zf > -0.15) continue; }
          let l = 0, rgt = 0; for (let d = 1; d <= 10; d++) { if (!l && L[t * NP + (p - d + NP) % NP] === 2) l = 1; if (!rgt && L[t * NP + (p + d) % NP] === 2) rgt = 1; } if (l && rgt) { const th = ((t + 0.5) / NT) * Math.PI, rr = Rm[k], px = C[0] + Math.sin(th) * xf * rr, py = C[1] + Math.cos(th) * rr, pz = C[2] + Math.sin(th) * zf * rr; if (Math.abs(px) > 0.3 && Math.abs(py - (lm.eyes.l[1] ?? 1.2)) < 0.16 && Math.abs(pz - earZ) < 0.16) earPocket++; else { pockets++; if (process.env.HB_POCKETS) (r.pocketAt ??= []).push([+px.toFixed(3), +py.toFixed(3), +pz.toFixed(3)]); } } } }
      r.baldPocketCells = pockets; r.earPocketCells = earPocket; } }
  // ---- (e) EXPOSED INTERIOR from OUTSIDE (V1.4): orthographic z-buffers from 48 underside / low-rear / low-side directions;
  //      % of head pixels whose FIRST surface is closure geometry (baked_interior / baked_skullbase) BELOW the eye line — must be ~0
  { const nk2 = (() => { const g = parts.bodyskin_neckext; if (!g) return { cx: 0, cz: canon.ears.z, r: 0.12 }; let cx = 0, cz = 0; const n2 = g.P.length / 3; for (let v = 0; v < n2; v++) { cx += g.P[v * 3] / n2; cz += g.P[v * 3 + 2] / n2; } let r2 = 0; for (let v = 0; v < n2; v++) r2 = Math.max(r2, Math.hypot(g.P[v * 3] - cx, g.P[v * 3 + 2] - cz)); return { cx, cz, r: r2 * 1.05 }; })();
    const surf = Object.entries(parts).filter(([n]) => /^identity_|^baked_|^bodyskin_/.test(n)), RES = 96; let bad = 0, tot = 0, worst = 0;
    for (const el of [-15, -35, -55, -75]) for (let az = 0; az < 360; az += 30) { const e = el * Math.PI / 180, a = az * Math.PI / 180, f = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];   // camera → head direction is -f
      const up0 = Math.abs(f[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0], rt = [up0[1] * f[2] - up0[2] * f[1], up0[2] * f[0] - up0[0] * f[2], up0[0] * f[1] - up0[1] * f[0]], rl = Math.hypot(...rt); for (let k = 0; k < 3; k++) rt[k] /= rl; const up = [f[1] * rt[2] - f[2] * rt[1], f[2] * rt[0] - f[0] * rt[2], f[0] * rt[1] - f[1] * rt[0]];
      const C = [0, 1.15, canon.ears.z], Z = new Float32Array(RES * RES).fill(-9), M = new Int8Array(RES * RES).fill(-1), HX = new Float32Array(RES * RES), HY = new Float32Array(RES * RES), HZ = new Float32Array(RES * RES), half = 0.75;
      surf.forEach(([n, g], mi) => { if (n.startsWith("bodyskin") && false) return; for (let t = 0; t < g.I.length; t += 3) { const q = [0, 1, 2].map((kk) => { const v = g.I[t + kk], d = [g.P[v * 3] - C[0], g.P[v * 3 + 1] - C[1], g.P[v * 3 + 2] - C[2]]; return [((d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2]) / half * 0.5 + 0.5) * RES, ((d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / half * 0.5 + 0.5) * RES, d[0] * f[0] + d[1] * f[1] + d[2] * f[2]]; });
        const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-9) continue;
        for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(RES - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); y++) for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(RES - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
          const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1; if (w0 < 0 || w1 < 0 || w2 < 0) continue; const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], k = y * RES + x; if (z > Z[k]) { Z[k] = z; M[k] = mi; const u = ((x / RES) - 0.5) * 2 * half, vv = ((y / RES) - 0.5) * 2 * half; HX[k] = C[0] + rt[0] * u + up[0] * vv + f[0] * z; HY[k] = C[1] + rt[1] * u + up[1] * vv + f[1] * z; HZ[k] = C[2] + rt[2] * u + up[2] * vv + f[2] * z; }   /* the exact hit point */ } } });
      // (closure seen up the neck tube is covered by the body neck + collar in the avatar: excluded)
      let b2 = 0, t2 = 0; for (let k = 0; k < M.length; k++) { if (M[k] < 0) continue; t2++; if (/^baked_(interior|skullbase)$/.test(surf[M[k]][0]) && Math.hypot(HX[k] - nk2.cx, HZ[k] - nk2.cz) > nk2.r && HY[k] < lm.eyes.l[1] - 0.05) {   /* the underside / nape zone (above it the interior is the designed scalp under hair cavities) */ b2++; if (process.env.HB_EXPOSED) (r.exposedAt ??= []).length < 400 && r.exposedAt.push([el, az, +HX[k].toFixed(2), +HY[k].toFixed(2), +HZ[k].toFixed(2)]); } } bad += b2; tot += t2; worst = Math.max(worst, t2 ? b2 / t2 : 0); }
    r.exposedInteriorPct = +(100 * bad / Math.max(1, tot)).toFixed(2); r.exposedInteriorWorstViewPct = +(100 * worst).toFixed(2); }
  // ---- fringe vs face and vs the visible eye shell ----
  const fr = parts.identity_hair_fringe, head = parts.identity_head, twinP = parts.identity_face_twin;   // V1.3: the face = head + mirrored twin patch
  if (fr) { const G = { x0: -0.6, y0: 0.8, c: 0.004, nx: 300, ny: 220 }, Zh = frontRaster(twinP ? [head, twinP] : [head], G); let behind = 0;
    for (let v = 0; v < fr.P.length / 3; v++) { const i = Math.round((fr.P[v * 3] - G.x0) / G.c), j = Math.round((fr.P[v * 3 + 1] - G.y0) / G.c); if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue; const z = Zh[j * G.nx + i]; if (Number.isNaN(z) || z < 0.05) continue;
      // frontal face only: along the silhouette (steep slope) a lock tucked just behind the cheek edge is hidden by design
      const sl = Math.max(Math.abs((Zh[j * G.nx + i + 1] - Zh[j * G.nx + i - 1]) / (2 * G.c)), Math.abs((Zh[(j + 1) * G.nx + i] - Zh[(j - 1) * G.nx + i]) / (2 * G.c))); if (!(sl < 1.2)) continue;
      if (fr.P[v * 3 + 2] < z - 0.005 && fr.P[v * 3 + 2] > z - 0.03) { behind++; if (process.env.WHERE) (r.intoFaceAt ??= []).push([fr.P[v * 3], fr.P[v * 3 + 1], fr.P[v * 3 + 2], z].map((q) => +q.toFixed(3))); } }   // INTERPENETRATING the face (deeper = hair passing behind the cheek edge, hidden by design)
    const ep = prim(doc, "face_eyes"), E = arr(ep, "POSITION"), EU = arr(ep, "TEXCOORD_0"), Gs = Math.round(Math.sqrt(E.length / 3 / 2)), per = Gs * Gs;
    const { data: TA, info: TI } = await sharp(Buffer.from(ep.getMaterial().getBaseColorTexture().getImage())).raw().toBuffer({ resolveWithObject: true });
    const vis = (vi) => { const a = TA[(Math.min(TI.height - 1, Math.floor(EU[vi * 2 + 1] * TI.height)) * TI.width + Math.min(TI.width - 1, Math.floor(EU[vi * 2] * TI.width))) * 4 + 3]; return a === 2 || a === 8 || a === 9 || a === 10; };
    let cut = 0; for (let e = 0; e < 2; e++) { const o = e * per, x0 = E[o * 3], y0 = E[o * 3 + 1], x1 = E[(o + Gs - 1) * 3], y1 = E[(o + per - 1) * 3 + 1];
      for (let v = 0; v < fr.P.length / 3; v++) { const fx = (fr.P[v * 3] - x0) / (x1 - x0) * (Gs - 1), fy = (fr.P[v * 3 + 1] - y0) / (y1 - y0) * (Gs - 1); if (fx < 0 || fy < 0 || fx > Gs - 1 || fy > Gs - 1) continue;
        const v00 = o + Math.min(Gs - 2, Math.floor(fy)) * Gs + Math.min(Gs - 2, Math.floor(fx)); if (!vis(v00)) continue; const z = E[v00 * 3 + 2]; if (fr.P[v * 3 + 2] < z + 0.002 && fr.P[v * 3 + 2] > z - 0.03) cut++; } }
    r.fringe = { verts: fr.P.length / 3, intoFace: behind, eyeCutsHair: cut }; }
  else r.fringe = null;
  // ---- glasses: the recipe's + the universal frames, runtime-fitted ----
  // V1.1 ACCESSORY CONTRACT: EVERY glasses module of the recipe on EVERY identity (one style must fit all wearers)
  { const ids = [...new Set([...Object.values(R.employees).flatMap((e) => (e.accessories ?? []).filter((a) => a.build === "glasses").map((a) => a.id)), ...(R.sharedAccessories ?? []).filter((a) => a.build === "glasses").map((a) => a.id)])];
    const G = { x0: -0.6, y0: 0.8, c: 0.004, nx: 300, ny: 220 }, Zh = frontRaster(twinP ? [head, twinP] : [head], G); r.glasses = {};
    for (const id of ids) { const f = `${BASE_OUT}/accessories/${id}.glb`; if (!fs.existsSync(f)) { r.glasses[id] = "missing"; continue; }
      const gd = await io.read(f), design = gd.getRoot().listScenes()[0].getExtras().humanAccessory.fit, gp = gd.getRoot().listMeshes()[0].listPrimitives()[0], GF = arr(gp, "_GFIT");
      if (!design || !GF || !lm.glassesFit) { r.glasses[id] = "not fit-space"; continue; }
      const P = fitGlassesPositions(GF, design, lm.eyes, lm.glassesFit, lm.attach); let inFace = 0, inSide = 0;
      const front = []; for (let v = 0; v < GF.length / 4; v++) if (Math.round(GF[v * 4]) === 0) front.push(GF[v * 4], GF[v * 4 + 1], GF[v * 4 + 2], GF[v * 4 + 3]);
      const F = glassesFrame(design, lm.eyes, lm.glassesFit, front, lm.attach), GI = gp.getIndices()?.getArray() ?? null;
      // temple reach: the temple tip region (t 0.75–0.9) must pass at the ear (within 3 cm-eq of the ear-top anchor)
      let reach = 9; const et = lm.attach?.ears; if (et) for (let v = 0; v < P.length / 3; v++) { const part = Math.round(GF[v * 4]); if (part === 0 || GF[v * 4 + 1] < 0.7 || GF[v * 4 + 1] > 0.9) continue; const e = (part === 1 ? et.r : et.l).top; if (!e) continue; reach = Math.min(reach, Math.hypot(P[v * 3] - e[0], P[v * 3 + 1] - e[1], P[v * 3 + 2] - e[2])); }
      const chk = checkGlasses(P, GF, lm.glassesFit, lm.attach), pc = lm.attach ? checkAccessory(P, GI, lm.attach, "face") : null; if (pc) { chk.pieces = pc.pieces; chk.detached = pc.detached; if (pc.detached) { chk.ok = false; chk.issues.push(`${pc.detached} detached piece(s)`); } }
      for (let v = 0; v < P.length / 3; v++) { const part = Math.round(GF[v * 4]), i = Math.round((P[v * 3] - G.x0) / G.c), j = Math.round((P[v * 3 + 1] - G.y0) / G.c);
        if (part === 0) { const z = Zh[j * G.nx + i]; if (!Number.isNaN(z) && P[v * 3 + 2] < z - 0.002) inFace++; }
        else if (GF[v * 4 + 1] < 0.8) { const ex = skull.excess(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); if (ex < -0.01) inSide++; } }
      r.glasses[id] = { inFace, templeInsideSkull: inSide, scale: +(F.k / F.s).toFixed(3), push: +F.d0.toFixed(4), lift: +F.lift.toFixed(4), tilt: +F.tilt.toFixed(2), bridgeWiden: +(F.bridgeWiden ?? 0).toFixed(2), templeToEar: reach < 8 ? +reach.toFixed(3) : null, check: chk }; } }
  // ---- attach-spec accessories (flowers / clips / earrings …): every one of the recipe seated on THIS identity ----
  r.attached = {};
  for (const a of Object.values(R.employees).flatMap((e) => e.accessories ?? []).filter((a) => a.build === "flower")) { const f = `${BASE_OUT}/accessories/${a.id}.glb`; if (!fs.existsSync(f)) continue;
    const ad = await io.read(f), spec = ad.getRoot().listScenes()[0].getExtras().humanAccessory?.attach, ap = ad.getRoot().listMeshes()[0].listPrimitives()[0], L = arr(ap, "_ALOCAL");
    if (!spec || !L || !lm.attach) { r.attached[a.id] = "not attach-spec"; continue; }
    const M = placeAccessory(lm.attach, spec), q = new THREE.Vector3(), PP = new Float32Array(L.length); for (let v = 0; v < L.length / 3; v++) { q.set(L[v * 3], L[v * 3 + 1], L[v * 3 + 2]).applyMatrix4(M); PP[v * 3] = q.x; PP[v * 3 + 1] = q.y; PP[v * 3 + 2] = q.z; }
    let inside = 0; for (let v = 0; v < PP.length / 3; v++) if (skull.excess(PP[v * 3], PP[v * 3 + 1], PP[v * 3 + 2]) < -0.004) inside++;
    r.attached[a.id] = { insideSkull: inside, check: checkAccessory(PP, ap.getIndices()?.getArray() ?? null, lm.attach, "hair") }; }
  // ---- hair accessories inside the canonical skull ----
  r.hairAccessories = {};
  for (const a of accessories.filter((a) => a.build === "tail" || a.build === "flower")) { const f = `${BASE_OUT}/accessories/${a.id}.glb`; if (!fs.existsSync(f)) continue;
    const P = (await io.read(f)).getRoot().listMeshes()[0].listPrimitives()[0].getAttribute("POSITION").getArray(); let inside = 0; for (let v = 0; v < P.length / 3; v++) if (skull.excess(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]) < -0.004) inside++; r.hairAccessories[a.id] = { insideSkull: inside }; }
  // ---- skull contract (the build's own measurement) + budget ----
  if (record && fs.existsSync(record)) { const j = JSON.parse(fs.readFileSync(record, "utf8")); r.skullWidth = +(j.abs.after.ears.half / canon.ears.half).toFixed(4); }
  r.tris = Object.fromEntries(Object.entries(parts).map(([n, g]) => [n, g.I.length / 3])); r.totalTris = Object.values(r.tris).reduce((a, b) => a + b, 0);
  r.pass = legacyPass(r);
  return r;
}
/** the V1.4 checker's own verdict (kept for the CLI; the failure registry is the build's gate) */
export const legacyPass = (r) => {  return r.featuresOnHairJoints === 0 && r.closureBelowJaw < 40 && /* exposedInterior*: informational (hidden-angle metric; visual QA decides) */ true &&   /* faceHoleVerts: informational (generated heads carry legitimate open edges) */ r.baldPocketCells < 20 && r.openDirections < 0.5 && (!r.fringe || (r.fringe.intoFace === 0 && r.fringe.eyeCutsHair === 0)) && Object.values(r.glasses).every((g) => typeof g === "object" && g.inFace === 0 && g.templeInsideSkull === 0 && g.check.ok) && Object.values(r.hairAccessories).every((h) => h.insideSkull === 0) && Object.values(r.attached).every((h) => typeof h === "object" && h.insideSkull === 0 && h.check.ok) && Math.abs(r.skullWidth - 1) <= 0.015; };

if (process.argv[1]?.endsWith("check-identity.mjs")) {
const rows = [];
for (const who of WHO) { const r = { ...(await identityMetrics(who, process.env.HB_SRC === "identity" ? { file: `${BASE_OUT}/identity/${who}-meshy-chibi-v1.glb` } : {})) }; rows.push(r); console.log(JSON.stringify(r)); }
// ---- GARMENTS (static): open boundary loops, loose pieces ("threads"), degenerate triangles, spikes ----
const garments = {};
for (const f of fs.readdirSync(`${BASE_OUT}/garments`).filter((x) => x.endsWith(".glb"))) {
  const pr = (await io.read(`${BASE_OUT}/garments/${f}`)).getRoot().listMeshes()[0].listPrimitives()[0], P = arr(pr, "POSITION"), I = pr.getIndices().getArray(), n = P.length / 3;
  const key = (i) => `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`, wid = new Map(), id = new Int32Array(n); for (let i = 0; i < n; i++) { const k = key(i); if (!wid.has(k)) wid.set(k, wid.size); id[i] = wid.get(k); }
  const ec = new Map(); let degenerate = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    if (Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) < 1e-10) degenerate++;
    for (let q = 0; q < 3; q++) { const u = id[I[t + q]], v = id[I[t + (q + 1) % 3]], k = u < v ? `${u}|${v}` : `${v}|${u}`; ec.set(k, (ec.get(k) ?? 0) + 1); } }
  // boundary loops (connected chains of boundary edges)
  const badj = new Map(); for (const [k, c] of ec) { if (c !== 1) continue; const [u, v] = k.split("|").map(Number); (badj.get(u) ?? badj.set(u, []).get(u)).push(v); (badj.get(v) ?? badj.set(v, []).get(v)).push(u); }
  const seen = new Set(); let loops = 0, smallLoops = 0; for (const s0 of badj.keys()) { if (seen.has(s0)) continue; loops++; const st = [s0]; seen.add(s0); let len = 0; while (st.length) { const v = st.pop(); len++; for (const u of badj.get(v)) if (!seen.has(u)) { seen.add(u); st.push(u); } } if (len < 12) smallLoops++; }
  // connected pieces: tiny ones are loose threads
  const par = new Int32Array(wid.size).map((_, i) => i), find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < I.length; t += 3) { const a = find(id[I[t]]); par[find(id[I[t + 1]])] = a; par[find(id[I[t + 2]])] = a; }
  const size = new Map(); for (let t = 0; t < I.length; t += 3) { const r = find(id[I[t]]); size.set(r, (size.get(r) ?? 0) + 1); }
  const pieces = size.size, threads = [...size.values()].filter((x) => x < 24).length;
  garments[f.replace(".glb", "")] = { tris: I.length / 3, pieces, looseThreads: threads, openLoops: loops, smallHoles: smallLoops, degenerate };
}
console.log("garments:", JSON.stringify(garments));
fs.mkdirSync("scripts/avatar-pipeline/output/human-base/v1.2-release", { recursive: true });
fs.writeFileSync("scripts/avatar-pipeline/output/human-base/v1.2-release/invariants.json", JSON.stringify({ identities: rows, garments }, null, 1));
console.log(rows.map((r) => `${r.who.padEnd(7)} ${r.pass ? "PASS" : "FAIL"}`).join("\n"));
}
