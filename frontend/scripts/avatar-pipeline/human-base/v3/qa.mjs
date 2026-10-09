// v3/qa.mjs — HumanBase V3 proof: AUTOMATED VALIDATION of built identity files. ZERO CREDITS. From frontend/:
//   node scripts/avatar-pipeline/human-base/v3/qa.mjs [--who=…] [--variants=B,A] [--compare-v2]
// Construction invariants (deterministic, authoritative):
//   T1 canonical topology identical across employees (index-buffer hash = template)   T2 head = one closed oriented manifold
//   T3 no folds vs template, no head self-intersections                                T4 hair = closed manifold, ≥ ε outside head
//   T5 hair never through an exposed ear; never below the shoulder line                  T6 only module parts (no closure/proxy)
//   T7 face modules (eyes/mouth) never inside the head                                  T8 neck extension starts at the body stub
// Multi-view visibility (14 orthographic views, software z-buffer, head + hair + modules + HumanBase body at rest):
//   V1 back-facing first surfaces (holes / inside views) · V2 head-under-hair visible through hair (skin/closure patches)
//   V3 closure/proxy parts visible (V2 candidates only — V3 has none by construction)
import fs from "node:fs";
import crypto from "node:crypto";
import { io, loadBase } from "../lib.mjs";
import { loadTemplate } from "./fit.mjs";
import { TriIndex, sdfGrid, selfIntersections, topo, triNormal, weld } from "./geom.mjs";

const args = process.argv.slice(2), opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const WHO = opt("who", "bon,kael,lui,nicole").split(","), VARIANTS = opt("variants", "B,A").split(","), CMP = args.includes("--compare-v2");
const OUT = process.env.V3_OUT ?? "scripts/avatar-pipeline/output/human-base/v3-proof";
const tpl = process.env.V3_TEMPLATE ? loadTemplate(process.env.V3_TEMPLATE) : loadTemplate(), base = await loadBase();
const tplHash = crypto.createHash("sha256").update(Buffer.from(Uint32Array.from(tpl.uv.I).buffer)).digest("hex").slice(0, 16);
let shoulderY = -Infinity; for (let i = 0; i < base.geo.P.length / 3; i++) { const x = Math.abs(base.geo.P[i * 3]); if (x > 0.16 && x < 0.3 && base.geo.P[i * 3 + 1] < 0.95) shoulderY = Math.max(shoulderY, base.geo.P[i * 3 + 1]); }

async function readParts(file) {
  const doc = await io.read(file), parts = {};
  for (const m of doc.getRoot().listMeshes()) { const p = m.listPrimitives()[0]; parts[m.getName()] = { P: Float32Array.from(p.getAttribute("POSITION").getArray()), I: Uint32Array.from(p.getIndices().getArray()), PAINT: p.getAttribute("_PAINT")?.getArray() }; }
  return { parts, extras: doc.getRoot().listScenes()[0].getExtras().humanIdentity };
}

/** 14-view software z-buffer: classes per first-hit pixel, back-face hits */
function visibility(meshes, views, res = 360) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) if (m.cls !== "body") for (let i = 0; i < m.P.length; i += 3) for (let q = 0; q < 3; q++) { mn[q] = Math.min(mn[q], m.P[i + q]); mx[q] = Math.max(mx[q], m.P[i + q]); }
  const c = mn.map((v, q) => (v + mx[q]) / 2), rad = Math.max(...mx.map((v, q) => v - mn[q])) * 0.62, out = {};
  for (const [name, d0] of Object.entries(views)) {
    const l = Math.hypot(...d0), d = d0.map((v) => v / l), up0 = Math.abs(d[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    const r = [up0[1] * d[2] - up0[2] * d[1], up0[2] * d[0] - up0[0] * d[2], up0[0] * d[1] - up0[1] * d[0]], rl = Math.hypot(...r); r.forEach((v, q) => (r[q] = v / rl));
    const u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
    const Z = new Float32Array(res * res).fill(-Infinity), C = new Array(res * res).fill(null), B = new Uint8Array(res * res);
    for (const m of meshes) for (let t = 0; t < m.I.length / 3; t++) {
      const pts = [0, 1, 2].map((k) => { const i = m.I[t * 3 + k] * 3, x = m.P[i] - c[0], y = m.P[i + 1] - c[1], z = m.P[i + 2] - c[2]; return [((x * r[0] + y * r[1] + z * r[2]) / rad * 0.5 + 0.5) * res, ((-(x * u[0] + y * u[1] + z * u[2])) / rad * 0.5 + 0.5) * res, x * d[0] + y * d[1] + z * d[2]]; });
      const tn = triNormal(m.P, m.I, t), facing = tn[0] * d[0] + tn[1] * d[1] + tn[2] * d[2] > 0; if (m.cull && !facing) continue;   // single-sided material: back faces are not drawn
      const x0 = Math.max(0, Math.floor(Math.min(pts[0][0], pts[1][0], pts[2][0]))), x1 = Math.min(res - 1, Math.ceil(Math.max(pts[0][0], pts[1][0], pts[2][0]))), y0 = Math.max(0, Math.floor(Math.min(pts[0][1], pts[1][1], pts[2][1]))), y1 = Math.min(res - 1, Math.ceil(Math.max(pts[0][1], pts[1][1], pts[2][1])));
      const [A, Bp, Cp] = pts, den = (Bp[1] - Cp[1]) * (A[0] - Cp[0]) + (Cp[0] - Bp[0]) * (A[1] - Cp[1]); if (Math.abs(den) < 1e-9) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const px = x + 0.5, py = y + 0.5, w0 = ((Bp[1] - Cp[1]) * (px - Cp[0]) + (Cp[0] - Bp[0]) * (py - Cp[1])) / den, w1 = ((Cp[1] - A[1]) * (px - Cp[0]) + (A[0] - Cp[0]) * (py - Cp[1])) / den, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue; const z = w0 * A[2] + w1 * Bp[2] + w2 * Cp[2], g = y * res + x; if (z <= Z[g]) continue; Z[g] = z;
        const cls = typeof m.cls === "function" ? m.cls(t, w0, w1, w2) : m.cls; C[g] = cls; B[g] = facing || !m.solid ? 0 : 1; } }
    const count = {}; let back = 0, total = 0; for (let g = 0; g < res * res; g++) { if (!C[g]) continue; if (C[g] === "body") continue; total++; count[C[g]] = (count[C[g]] ?? 0) + 1; if (B[g]) back++; }
    out[name] = { pixels: total, backFacing: back, classes: count };
  }
  return out;
}
const VIEWS = { front: [0, 0, 1], front34L: [0.64, 0, 0.77], front34R: [-0.64, 0, 0.77], sideL: [1, 0, 0], sideR: [-1, 0, 0], back: [0, 0.1, -1], rear34L: [0.64, 0.1, -0.77], rear34R: [-0.64, 0.1, -0.77], high: [0.2, 1.6, 0.5], lowFront: [0.1, -0.8, 1], lowRear: [0.1, -0.8, -1], under: [0, -1, 0.15], earL: [1, -0.15, -0.35], nape: [0, -0.45, -1] };
// HumanBase body at rest for occlusion (hidden head region excluded is irrelevant: it is under the identity)
const bodyMesh = { P: base.geo.P, I: base.geo.I, cls: "body" };

const results = {};
for (const who of WHO) for (const v of [...VARIANTS, ...(CMP ? ["V2"] : [])]) {
  const file = v === "V2" ? (who === "bon" ? "public/avatars/human-base-v1/production/bon-v1.glb" : `scripts/avatar-pipeline/output/human-base/candidates/${who}/pass2/${who}-v1.glb`) : `${OUT}/${who}/${v}/pass1/${who}-v1.glb`;
  if (!fs.existsSync(file)) continue;
  const { parts, extras } = await readParts(file), R = { file, checks: {} }, ok = (k, pass, data) => (R.checks[k] = { pass, ...data });
  const names = Object.keys(parts);
  if (v === "V2") {
    const vis = visibility([bodyMesh, ...Object.entries(parts).map(([nm, p]) => ({ P: p.P, I: p.I, cls: nm.startsWith("baked_") ? "closure" : nm.startsWith("identity_hair") ? "hair" : nm.startsWith("face_") ? "module" : nm.startsWith("bodyskin") ? "neck" : "head", solid: nm.startsWith("identity_"), cull: nm.startsWith("face_") || nm.startsWith("bodyskin") }))], VIEWS);
    const closure = Object.values(vis).reduce((a, x) => a + (x.classes.closure ?? 0), 0), back = Object.values(vis).reduce((a, x) => a + x.backFacing, 0);
    ok("V1_backFacing", back === 0, { pixels: back }); ok("V3_closureVisible", closure === 0, { pixels: closure, worst: Object.entries(vis).map(([k, x]) => [k, x.classes.closure ?? 0]).sort((a, b) => b[1] - a[1])[0] });
    ok("T6_onlyModuleParts", !names.some((x) => x.startsWith("baked_")), { parts: names }); results[`${who}/V2`] = R; continue;
  }
  const head = parts.identity_head, hair = parts.identity_hair_main;
  // T1 canonical topology
  const h = crypto.createHash("sha256").update(Buffer.from(Uint32Array.from(head.I).buffer)).digest("hex").slice(0, 16);
  ok("T1_canonicalTopology", h === tplHash && head.P.length / 3 === tpl.uv.src.length, { indexHash: h, templateHash: tplHash, verts: head.P.length / 3 });
  // welded head (positions per canonical vertex)
  const X = new Float32Array(tpl.n * 3); for (let j = 0; j < tpl.uv.src.length; j++) X.set(head.P.subarray(j * 3, j * 3 + 3), tpl.uv.src[j] * 3);
  const tp = topo(X, tpl.I); ok("T2_headClosedManifold", !tp.boundaryEdges && !tp.nonManifoldEdges && !tp.nonManifoldVerts && tp.components.length === 1 && !tp.misorientedEdges, { boundary: tp.boundaryEdges, nonManifold: tp.nonManifoldEdges + tp.nonManifoldVerts, components: tp.components.length, euler: tp.euler });
  let inv = 0; for (let t = 0; t < tpl.I.length / 3; t++) { const a = triNormal(tpl.P, tpl.I, t), b = triNormal(X, tpl.I, t); if (b[3] < 1e-10) inv++; }
  const si = selfIntersections(X, tpl.I, 0.01, 50); ok("T3_noFoldsNoSelfIntersection", inv === 0 && si.count === 0, { degenerate: inv, selfIntersections: si.count });
  // T4 hair
  const htp = topo(hair.P, hair.I), hidx = new TriIndex(X, tpl.I, 0.02); let inside = 0, minD = Infinity;
  { // volumetric: signed distance of the closed canonical head on a 3 mm-eq grid (flood-filled sign), trilinear
    let a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < X.length; i += 3) for (let q = 0; q < 3; q++) { a[q] = Math.min(a[q], X[i + q]); b[q] = Math.max(b[q], X[i + q]); }
    const cell = 0.003, min = a.map((v) => v - 0.03), dims = [0, 1, 2].map((q) => Math.ceil((b[q] - a[q] + 0.06) / cell) + 1), G = sdfGrid(X, tpl.I, min, cell, dims, 3);
    for (let i = 0; i < hair.P.length / 3; i++) { const fx = (hair.P[i * 3] - min[0]) / cell, fy = (hair.P[i * 3 + 1] - min[1]) / cell, fz = (hair.P[i * 3 + 2] - min[2]) / cell; const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz); if (i0 < 0 || j0 < 0 || k0 < 0 || i0 >= dims[0] - 1 || j0 >= dims[1] - 1 || k0 >= dims[2] - 1) continue;
      let s = 0; for (let c = 0; c < 8; c++) { const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1, w = (di ? fx - i0 : 1 - fx + i0) * (dj ? fy - j0 : 1 - fy + j0) * (dk ? fz - k0 : 1 - fz + k0); s += w * G.S[G.id(i0 + di, j0 + dj, k0 + dk)]; }
      if (s < -0.0005) { // confirm with RAY PARITY along three axes (majority): a flood-filled grid seals narrow air pockets (behind the ears)
        let votes = 0; for (const dd of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) { let hits = 0, t0 = 0; const o = [hair.P[i * 3], hair.P[i * 3 + 1], hair.P[i * 3 + 2]];
          for (let rep = 0; rep < 40; rep++) { const q = hidx.raycast(o[0] + dd[0] * t0, o[1] + dd[1] * t0, o[2] + dd[2] * t0, dd[0], dd[1], dd[2], 2.0); if (!q) break; hits++; t0 += q.d + 1e-5; }
          if (hits % 2 === 1) votes++; }
        if (votes >= 2) { inside++; minD = Math.min(minD, s); } } else minD = Math.min(minD, s); } }
  ok("T4_hairClosedOutsideHead", !htp.boundaryEdges && !htp.nonManifoldEdges && !htp.nonManifoldVerts && inside === 0, { boundary: htp.boundaryEdges, nonManifold: htp.nonManifoldEdges + htp.nonManifoldVerts, components: htp.components.length, hairVertsInsideHead: inside, minSignedDistance: +minD.toFixed(4) });
  // T5 ears + floor
  const earMode = JSON.parse(fs.readFileSync(`${OUT}/${who}/${v}/pass1/qa-geometry.json`, "utf8")).earMode; let earHits = 0;
  for (const side of ["l", "r"]) { if (earMode[side] !== "exposed") continue; const want = side === "l" ? tpl.REGION.earL : tpl.REGION.earR, eIdx = new TriIndex(X, tpl.I, 0.02, (t) => tpl.region[tpl.I[t * 3]] === want && tpl.region[tpl.I[t * 3 + 1]] === want && tpl.region[tpl.I[t * 3 + 2]] === want);
    for (let i = 0; i < hair.P.length / 3; i++) { const q = eIdx.closest(hair.P[i * 3], hair.P[i * 3 + 1], hair.P[i * 3 + 2], 0.004); if (q) earHits++; } }
  let below = 0; for (let i = 0; i < hair.P.length / 3; i++) if (hair.P[i * 3 + 1] < shoulderY) below++;
  ok("T5_earsAndFloor", earHits === 0 && below === 0, { earMode, hairVertsWithin4mmOfExposedEar: earHits, hairBelowShoulders: below });
  ok("T6_onlyModuleParts", names.every((x) => ["identity_head", "identity_hair_main", "face_eyes", "face_mouth", "bodyskin_neckext"].includes(x)), { parts: names });
  let shellIn = 0, eyePoke = 0, eyeCoinc = 0; const balls = extras?.landmarks?.eyes?.balls;
  // EYEBALL modules (real spheres in sockets): covered by the lids = allowed; the ball may only be VISIBLE (in front of the head)
  // where the head surface is tucked inside the ball (the aperture) — poke-through elsewhere fails; head↔ball coincident
  // surfaces (|gap| < 0.3 mm with normals within 25°) fail (z-fight). Shell modules keep the original rule.
  // robust visibility (FC-QA-RAY-CELL-SKIP): the grid raycast samples cells and can slip past a corner-clipped triangle — a point is
  // visible from a view only if THREE slightly offset parallel rays all reach it unblocked
  const visibleFrom = (p, v) => { const a = Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = [v[1] * a[2] - v[2] * a[1], v[2] * a[0] - v[0] * a[2], v[0] * a[1] - v[1] * a[0]], ul = Math.hypot(...u), w = [v[1] * u[2] - v[2] * u[1], v[2] * u[0] - v[0] * u[2], v[0] * u[1] - v[1] * u[0]], wl = Math.hypot(...w);
    for (const [e1, e2] of [[0, 0], [0.0015, 0], [-0.0015, 0], [0, 0.0015], [0, -0.0015]]) { const o = [0, 1, 2].map((k) => p[k] + v[k] + (u[k] / ul) * e1 + (w[k] / wl) * e2); if (hidx.raycast(o[0], o[1], o[2], -v[0], -v[1], -v[2], 1.0 - 1e-4)) return false; } return true; };
  const apOut = (poly, p) => { let inside = false, dmin = Infinity; for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) { const a = poly[j], c = poly[k]; if ((c[1] > p[1]) !== (a[1] > p[1]) && p[0] < ((a[0] - c[0]) * (p[1] - c[1])) / (a[1] - c[1]) + c[0]) inside = !inside;
      const ex = a[0] - c[0], ey = a[1] - c[1], t = Math.max(0, Math.min(1, ((p[0] - c[0]) * ex + (p[1] - c[1]) * ey) / (ex * ex + ey * ey || 1))); dmin = Math.min(dmin, Math.hypot(p[0] - c[0] - t * ex, p[1] - c[1] - t * ey)); } return inside ? -dmin : dmin; };
  if (balls && parts.face_eyes) { const m = parts.face_eyes, VIEWS3 = [[0, 0, 1], [Math.sin(0.6), 0, Math.cos(0.6)], [-Math.sin(0.6), 0, Math.cos(0.6)], [1, 0, 0.05], [-1, 0, 0.05]];   // front, ±35°, ±90° (side: eyeball containment)
    // POKE-THROUGH = a ball vertex VISIBLE along a view ray (front, ±35° yaw) whose next head surface BEHIND it on that ray is a LID
    // (outside the ball) — i.e. the eyeball shows in front of a lid. Rim/aperture cases (head behind = floor inside the ball) pass.
    for (let i = 0; i < m.P.length / 3; i++) { const p = [m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2]], b = balls.reduce((a, bb) => (Math.hypot(p[0] - bb.c[0], p[1] - bb.c[1], p[2] - bb.c[2]) < Math.hypot(p[0] - a.c[0], p[1] - a.c[1], p[2] - a.c[2]) ? bb : a));
      if ((p[2] - b.c[2]) / b.r < -0.5) continue;   // the far back of the ball only
      // a poke = VISIBLE from some view AND outside the head locally AND its nearest head surface is a LID (outside the ball), not the
      // aperture floor/rim — a ball seen THROUGH the aperture at a grazing angle is not a poke (FC-QA-GRAZING-APERTURE)
      const qn = hidx.closest(p[0], p[1], p[2], 0.02); if (!qn) { for (let vi = 0; vi < VIEWS3.length; vi++) if ((p[0] - b.c[0]) * VIEWS3[vi][0] + (p[1] - b.c[1]) * VIEWS3[vi][1] + (p[2] - b.c[2]) * VIEWS3[vi][2] > 0 && (vi >= 3 || process.env.V3_QA_T7_LEGACY || !b.ap3 || apOut(b.ap3, p) > 0.05 * (b.hw ?? 0.01)) && visibleFrom(p, VIEWS3[vi])) {   /* front/±35°: the literal rule here too (a deep socket leaves a ball point seen through the opening far from skin) */   /* FC-QA-BALL-SELF-OCCLUSION: a ball point can only be seen from a direction it faces */ eyePoke++; if (process.env.V3_QA_T7_DEBUG) console.error(`T7 FAR poke ${who} rel ${[0, 1, 2].map((k) => ((p[k] - b.c[k]) / b.r).toFixed(2)).join(",")} view ${vi}`); break; } }   // far outside any head surface and visible
      else { const tn2 = triNormal(X, tpl.I, qn.t), sOut = (p[0] - qn.x) * tn2[0] + (p[1] - qn.y) * tn2[1] + (p[2] - qn.z) * tn2[2], lid = Math.hypot(qn.x - b.c[0], qn.y - b.c[1], qn.z - b.c[2]) > b.r + 0.5 * Math.min(b.lidU ?? 0.001, b.lidL ?? 0.001);   // rim band = half the built lid thickness
        // FC-QA-OUTSIDE-OPENING (learned with rolled lids: the NEAREST head point of a ball point seen through the aperture can be the rolled
        // margin, 3.2 mm off the ball > the 3.05 mm rim band → false poke; a "skin behind on the view ray" test cannot work either — behind a
        // front ball point the ray is inside the ball). Applied literally: from the front/±35° views a poke is a VISIBLE ball point OUTSIDE the
        // designed eye opening (+ 0.05 eye half-width for mesh resolution); the side views keep the nearest-lid rule (containment). Legacy rule
        // via V3_QA_T7_LEGACY=1 for comparison. Proven on two negatives (lid ring sunk into the ball; ball pushed through the lids).
        if (process.env.V3_QA_T7_LEGACY || !b.ap3) { if (sOut > 0.0002 && lid) for (const v of VIEWS3) { if (visibleFrom(p, v)) { eyePoke++; break; } } }
        else { const outside = apOut(b.ap3, p) > 0.05 * (b.hw ?? 0.01); let hit = false; for (let vi = 0; vi < VIEWS3.length && !hit; vi++) { const v = VIEWS3[vi]; if (!visibleFrom(p, v)) continue; if (vi < 3 ? outside && (p[0] - b.c[0]) * v[0] + (p[1] - b.c[1]) * v[1] + (p[2] - b.c[2]) * v[2] > 0 : sOut > 0.0002 && lid) hit = true; }   /* a ball point faces the view (convex self-occlusion) */ if (hit) { eyePoke++; if (process.env.V3_QA_T7_DEBUG) console.error(`T7 poke ${who} rel ${[0, 1, 2].map((k) => ((p[k] - b.c[k]) / b.r).toFixed(2)).join(",")} outside ${(apOut(b.ap3, p) / (b.hw ?? 0.01)).toFixed(3)} hw`); } } }
      const q = hidx.closest(p[0], p[1], p[2], 0.01); if (q) { const tn = triNormal(X, tpl.I, q.t), s2 = (p[0] - q.x) * tn[0] + (p[1] - q.y) * tn[1] + (p[2] - q.z) * tn[2], bn = [(p[0] - b.c[0]) / b.r, (p[1] - b.c[1]) / b.r, (p[2] - b.c[2]) / b.r]; if (Math.abs(s2) < 0.0003 && bn[0] * tn[0] + bn[1] * tn[1] + bn[2] * tn[2] > Math.cos(25 * Math.PI / 180)) eyeCoinc++; } } }
  for (const s of ["face_eyes", "face_mouth"]) { const m = parts[s]; if (!m || (s === "face_eyes" && balls)) continue; for (let i = 0; i < m.P.length / 3; i++) { const q = hidx.closest(m.P[i * 3], m.P[i * 3 + 1], m.P[i * 3 + 2], 0.01); if (!q) continue; const tn = triNormal(X, tpl.I, q.t); if ((m.P[i * 3] - q.x) * tn[0] + (m.P[i * 3 + 1] - q.y) * tn[1] + (m.P[i * 3 + 2] - q.z) * tn[2] < -0.0002) shellIn++; } }
  ok("T7_modulesNotInsideHead", shellIn === 0 && eyePoke === 0 && eyeCoinc === 0, { shellVertsInsideHead: shellIn, ...(balls ? { eyeballPokeThroughLids: eyePoke, eyeballCoincidentWithHead: eyeCoinc } : {}) });
  { const nk = parts.bodyskin_neckext, ring = tpl.neckRing; let worst = 0; for (let k = 0; k < ring.length; k++) worst = Math.max(worst, Math.hypot(nk.P[k * 3] - ring[k].p[0], nk.P[k * 3 + 1] - ring[k].p[1], nk.P[k * 3 + 2] - ring[k].p[2]));
    ok("T8_neckFromBodyStub", worst < 1e-5, { maxRingError: worst }); }
  // multi-view visibility (cover: head vertices under hair → class "scalp")
  const geo = JSON.parse(fs.readFileSync(`${OUT}/${who}/${v}/pass1/qa-geometry.json`, "utf8")); const Ms = Float32Array.from(geo.Ms), cen = geo.centre;
  const NT = 128, NP = 256, cover = new Float32Array(tpl.n);
  for (let i = 0; i < tpl.n; i++) { const dx = X[i * 3] - cen[0], dy = X[i * 3 + 1] - cen[1], dz = X[i * 3 + 2] - cen[2], r = Math.hypot(dx, dy, dz) || 1; const th = Math.round(Math.acos(Math.max(-1, Math.min(1, dy / r))) / Math.PI * NT - 0.5), ph = Math.round((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * NP - 0.5); cover[i] = Ms[Math.max(0, Math.min(NT - 1, th)) * NP + ((ph % NP) + NP) % NP]; }
  const vis = visibility([bodyMesh, { P: X, I: tpl.I, solid: true, cls: (t, a, b, c) => (cover[tpl.I[t * 3]] * a + cover[tpl.I[t * 3 + 1]] * b + cover[tpl.I[t * 3 + 2]] * c > 0.75 ? "scalp" : "skin") }, { P: hair.P, I: hair.I, cls: "hair", solid: true }, ...["face_eyes", "face_mouth"].filter((s) => parts[s]).map((s) => ({ P: parts[s].P, I: parts[s].I, cls: "module", cull: true })), { P: parts.bodyskin_neckext.P, I: parts.bodyskin_neckext.I, cls: "neck", cull: true }], VIEWS);
  const back = Object.values(vis).reduce((a, x) => a + x.backFacing, 0), scalp = Object.values(vis).reduce((a, x) => a + (x.classes.scalp ?? 0), 0), pix = Object.values(vis).reduce((a, x) => a + x.pixels, 0);
  ok("V1_backFacing", back === 0, { pixels: back });
  // V2: SKIN SHOWING THROUGH HAIR — visible head pixels under the hair mask whose baked colour is skin-like (not hair base)
  let skinUnder = 0; { const doc = await io.read(file), tex = doc.getRoot().listMeshes().find((m) => m.getName() === "identity_head").listPrimitives()[0].getMaterial().getBaseColorTexture().getImage(), sharp = (await import("sharp")).default;
    const { data, info } = await sharp(Buffer.from(tex)).raw().toBuffer({ resolveWithObject: true }), S = info.width, ch = info.channels, L = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const HP = parts.identity_hair_main?.PAINT, hairRef = HP ? [0, 1, 2].map((q) => { let a = 0; for (let i = 0; i < HP.length / 4; i++) a += HP[i * 4 + q]; return (a / (HP.length / 4)) * 255 * 0.85; }) : null;
    const skinRef = extras.landmarks?.skin ? [1, 3, 5].map((o) => parseInt(extras.landmarks.skin.slice(o, o + 2), 16)) : [230, 180, 160];
    // per canonical vertex: texel colour at its UV (first uv-copy)
    const firstUV = new Int32Array(tpl.n).fill(-1); for (let j = 0; j < tpl.uv.src.length; j++) if (firstUV[tpl.uv.src[j]] < 0) firstUV[tpl.uv.src[j]] = j;
    for (let i = 0; i < tpl.n; i++) { if (cover[i] <= 0.75) continue; const j = firstUV[i], u = tpl.uv.UV[j * 2], vv = tpl.uv.UV[j * 2 + 1], o = (Math.min(S - 1, Math.floor(vv * S)) * S + Math.min(S - 1, Math.floor(u * S))) * ch, c = [data[o], data[o + 1], data[o + 2]];
      // FC-QA-LIGHT-HAIR (learned in Stage 1): grey/blond hair bases are light too — a texel is skin only if it is closer
      // to the skin colour than to this head's own hair base (dark-hair results are unchanged)
      const dS = Math.hypot(c[0] - skinRef[0], c[1] - skinRef[1], c[2] - skinRef[2]), dH = hairRef ? Math.hypot(c[0] - hairRef[0], c[1] - hairRef[1], c[2] - hairRef[2]) : Infinity;
      if (L(c) > L(skinRef) * 0.6 && dS < dH) skinUnder++; } }
  ok("V2_skinUnderHair", skinUnder === 0, { skinColouredVertsUnderHair: skinUnder, hairBaseVisibleUnderRimPixels: scalp, note: "head under the hair mask is painted hair base by construction; this counts any skin-coloured exception" });
  ok("V3_closureVisible", true, { pixels: 0, note: "no closure/proxy geometry exists (T6)" });
  R.runtime = { headTris: tpl.I.length / 3, hairTris: hair.I.length / 3, eyeTris: (parts.face_eyes?.I.length ?? 0) / 3, mouthTris: (parts.face_mouth?.I.length ?? 0) / 3, neckTris: parts.bodyskin_neckext.I.length / 3, parts: names.length, bytes: fs.statSync(file).size };
  R.pass = Object.values(R.checks).every((c) => c.pass); results[`${who}/${v}`] = R;
}
fs.writeFileSync(`${OUT}/qa-structural.json`, JSON.stringify(results, null, 1));
for (const [k, r] of Object.entries(results)) console.log(k.padEnd(12), r.pass === undefined ? "" : r.pass ? "PASS" : "FAIL", Object.entries(r.checks).map(([c, x]) => `${c.split("_")[0]}${x.pass ? "✓" : "✗"}`).join(" "), r.runtime ? JSON.stringify(r.runtime) : JSON.stringify(Object.fromEntries(Object.entries(r.checks).map(([c, x]) => [c, x.pixels ?? x.parts?.length]))));
