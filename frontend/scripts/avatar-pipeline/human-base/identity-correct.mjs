// identity-correct.mjs — AUTOMATIC OFFSHORLY IDENTITY CORRECTION of a chibified Meshy head (HumanBase V2 build step). ZERO CREDITS.
//
//   node scripts/avatar-pipeline/human-base/identity-correct.mjs <who> <identity.glb> [--measure-only] [--s0=<identity.json>] [--out=<file>] [--report-out=<file>]
//
// Meshy gives a coherent 3D head; Stage 0 (the traced approved illustration) says who the person is. This step measures the head
// with the SAME definitions the style calibration used (dense V3 fit onto the canonical topology → measure3D: face widths at named
// levels / eye spacing, face height, chin shape, feature widths) and compares it with the person's style-translated Stage 0 target
// map (proportions.mjs: measureS0 → translate with the approved-pair calibration). Where a relation is OUTSIDE its identity tolerance
// it applies ONE smooth spatial warp to every part of the head (skin, eyes, mouth, hair layers, closure) — never per-part edits,
// never one global scale:
//   length   (--plan-length) the face height / eye spacing vs target → a face-length boost for chibify's OWN long-face retention (the
//            chin-fixed eye-line move the approved pipeline already uses; the mounted envelope stays the hard limit) — the "too wide"
//            Meshy face is a width : LENGTH error (the canonical eye-line envelope compressed it), so it is corrected in length
//   widths   below the eye line, the per-level width / eye-spacing ratios as ONE smooth lateral profile s(t) (monotone cubic), applied to
//            the FACE FRONT only (depth window in front of the ear plane) — the canonical skull width, the ears and everything at and
//            above the eye line are locked (FC-SKULL-CONTRACT: the head must keep fitting the canonical skull); the eyes never squash
// Evidence-weak targets (STYLE_PRIOR / hair-bounded) are never forced. The neck attachment (bodyskin_neckext) never moves.
import fs from "node:fs";
import { createRequire } from "node:module";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { loadTemplate, fit3D } from "./v3/fit.mjs";
import { load3D } from "./v3/evidence.mjs";
import { g3OfCanonical } from "./v3/stage1/calibrate-proportions.mjs";
import { measure3D, measureS0, translate, withEyeEvidence } from "./v3/stage1/proportions.mjs";
import { completeFor, hairOuterFrom } from "./v3/stage1/envelope.mjs";
const sharp = createRequire(import.meta.url)("sharp");
const SP1 = "scripts/avatar-pipeline/output/human-base/stage1-proof";
import { TOL, compare, eyeRatio, planCorrection, planLength, sm } from "./identity-plan.mjs";
export { TOL, compare, eyeRatio, planCorrection, planLength } from "./identity-plan.mjs";
const SP = JSON.parse(fs.readFileSync(`${SP1}/style-proportions.json`, "utf8"));

/** the person's style-translated identity target (Stage 0 → Offshorly), with provenance flags */
export async function targetFor(who, s0File = null) { const files = [s0File, `scripts/avatar-pipeline/output/human-base/studio/stage0/${who}/identity.json`, `${SP1}/population/identity.json`, "scripts/avatar-pipeline/output/human-base/stage0-identity/identity.json"].filter(Boolean);
  for (const f of files) { if (!fs.existsSync(f)) continue; const R = JSON.parse(fs.readFileSync(f, "utf8")).results, key = R[who] ? who : who === "bon" && R.jerevon ? "jerevon" : null; if (!key) continue;
    const dir = f.slice(0, f.lastIndexOf("/")), p = withEyeEvidence(R[key]), hair = fs.existsSync(`${dir}/${key}-hairmask.png`) ? await hairOuterFrom(`${dir}/${key}-hairmask.png`, sharp) : null;
    const env = completeFor(p, SP.prior.envelope, hair, key, { eyeSideMargin: SP.locked["eye.sideMargin_IOD"]?.v }), s0 = measureS0(p, { ...SP.prior, env });
    return { key, source: f, target: translate(s0.map, SP.style, SP.locked), stage0: s0.map }; }
  throw new Error(`${who}: no Stage 0 identity record — run the identity analysis first (fail closed)`); }

/** the head measured exactly like the calibration: dense fit onto the canonical topology → measure3D */
export async function measureHead(file) { const tpl = loadTemplate(), ev = await load3D(file), fit = fit3D(tpl, ev), g3 = g3OfCanonical(fit.X, tpl, null), m = measure3D(g3).map, L = tpl.landmarks;
  const earZ = (fit.X[L.earLroot * 3 + 2] + fit.X[L.earRroot * 3 + 2]) / 2, iod = Math.abs(g3.cR[0] - g3.cL[0]);
  // FIT CROSS-CHECK (learned on Lui: a 251-fold fit read his chin +30% wide; the skin itself said +5% — the correction then narrowed a chin that was
  // right): below the ears the outline is unambiguous on the real skin, so each lower level's fit width is compared with the skin's own
  const P = ev.skin.P, H = g3.eyeY - g3.chinY, tM = (g3.eyeY - g3.mouthY) / H, skinW = (t) => { const y = g3.eyeY - t * H; let lo = 9, hi = -9; for (let i = 0; i < P.length; i += 3) { if (Math.abs(P[i + 1] - y) > 0.004 || P[i + 2] < earZ - 0.2 * iod) continue; lo = Math.min(lo, P[i]); hi = Math.max(hi, P[i]); } return (hi - lo) / iod; };
  const check = {}; for (const [nm, k, t] of [["mouth", "frame.mouthLevelW_IOD", tM], ["jaw", "frame.jawW_IOD", tM + 0.5 * (1 - tM)], ["chin", "frame.chinW_IOD", tM + 0.8 * (1 - tM)]]) if (m[k]) { const d = skinW(t); check[nm] = { fit: +m[k].v.toFixed(4), skin: +d.toFixed(4), agree: Math.abs(d / m[k].v - 1) <= 0.1 }; }
  return { m, g3, earZ, check, fit: { folds: fit.flipped, residual: fit.log.at(-1)?.meanD ?? null } }; }
/** ONE smooth spatial warp for every part of the head (positions; normals / lid normals by J^-T; flow by J) — returns the map */
export function makeWarp(plan, g3, lm, neck, earZ) { const H = plan.H, mid = (lm.eyes.l[0] + lm.eyes.r[0]) / 2, eyes = [lm.eyes.l, lm.eyes.r], ehw = lm.eyes.halfW, iod = Math.abs(lm.eyes.r[0] - lm.eyes.l[0]);
  const field = (x, y, z) => { const t = (g3.eyeY - y) / H, s = plan.s(t); let w = sm(earZ + 0.05 * iod, earZ + 0.3 * iod, z);   // FACE FRONT only: the ears + skull sides stay canonical
    // the neck column below the chin never moves (the body's neck extension enters there)
    if (y < g3.chinY + 0.3 * H) { const r = Math.hypot(x - neck.cx, z - neck.cz); w *= sm(neck.r, neck.r + 0.25 * H, r) + (1 - sm(neck.r, neck.r + 0.25 * H, r)) * sm(g3.chinY + 0.3 * H, g3.chinY + 0.6 * H, y); }
    return (x - mid) * (s - 1) * w; };
  // eyes move RIGIDLY with the field at their centre (eye shape, lids and iris discs are never squashed), blending into the field outside
  const eyeD = eyes.map((c) => field(c[0], c[1], c[2]) + (c[0] - mid) * ((plan.eyeMove ?? plan.eyeK ?? 1) - 1));   // field + the rigid eye-spacing move (outward only)
  const map = (x, y, z) => { let dx = field(x, y, z); for (let k = 0; k < 2; k++) { const c = eyes[k], d = Math.hypot(x - c[0], y - c[1]); if (d < 2.6 * ehw && z > c[2] - 1.2 * ehw) { const b = 1 - sm(1.3 * ehw, 2.6 * ehw, d); dx = b * eyeD[k] + (1 - b) * dx; } } return [x + dx, y, z]; };   /* a wider blend: a rigid eye move fades over the brow, temple and cheek */
  return { map, mid, eyeD }; }

/** apply the warp to an identity GLB in place (all head parts except the neck extension) + landmarks + glasses grid */
export async function applyWarp(file, outFile, warpFor) { const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), doc = await io.read(file), root = doc.getRoot(), ex = root.listScenes()[0].getExtras(), hid = ex.humanIdentity;
  const neckMesh = root.listMeshes().find((m) => m.getName() === "bodyskin_neckext"); let neck = { cx: 0, cz: 0.02, r: 0.09 };
  if (neckMesh) { const a = neckMesh.listPrimitives()[0].getAttribute("POSITION").getArray(); let cx = 0, cz = 0, c = 0, r = 0; for (let i = 0; i < a.length; i += 3) { cx += a[i]; cz += a[i + 2]; c++; } cx /= c; cz /= c; for (let i = 0; i < a.length; i += 3) r = Math.max(r, Math.hypot(a[i] - cx, a[i + 2] - cz)); neck = { cx, cz, r }; }
  const W = warpFor(neck), e = 1e-4, stats = {};
  for (const mesh of root.listMeshes()) { if (mesh.getName() === "bodyskin_neckext") continue; let moved = 0, maxD = 0;
    for (const prim of mesh.listPrimitives()) { const P = prim.getAttribute("POSITION"); if (!P) continue; const a = P.getArray().slice(), n = a.length / 3, N = prim.getAttribute("NORMAL"), LN = prim.getAttribute("_LIDN"), FL = prim.getAttribute("_FLOW"), na = N?.getArray().slice(), la = LN && LN.getElementSize() === 3 ? LN.getArray().slice() : null, fa = FL && FL.getElementSize() === 3 ? FL.getArray().slice() : null;
      for (let i = 0; i < n; i++) { const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2], q = W.map(x, y, z), d = q[0] - x; if (Math.abs(d) > 1e-7) { moved++; maxD = Math.max(maxD, Math.abs(d)); }
        if (na || la || fa) { const jx = W.map(x + e, y, z), jy = W.map(x, y + e, z), jz = W.map(x, y, z + e), J = [[(jx[0] - q[0]) / e, (jy[0] - q[0]) / e, (jz[0] - q[0]) / e], [0, 1, 0], [0, 0, 1]];   // only x changes: J = [[a,b,c],[0,1,0],[0,0,1]]
          const inv = (v) => { const nx = v[0] / J[0][0], ny = v[1] - J[0][1] * nx, nz = v[2] - J[0][2] * nx, l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l]; };   // J^-T n
          const fwd = (v) => { const fx = J[0][0] * v[0] + J[0][1] * v[1] + J[0][2] * v[2], l = Math.hypot(fx, v[1], v[2]) || 1; return [fx / l, v[1] / l, v[2] / l]; };
          if (na) na.set(inv([na[i * 3], na[i * 3 + 1], na[i * 3 + 2]]), i * 3); if (la) la.set(inv([la[i * 3], la[i * 3 + 1], la[i * 3 + 2]]), i * 3); if (fa) fa.set(fwd([fa[i * 3], fa[i * 3 + 1], fa[i * 3 + 2]]), i * 3); }
        a[i * 3] = q[0]; }
      P.setArray(a); if (na) N.setArray(na); if (la) LN.setArray(la); if (fa) FL.setArray(fa); }
    stats[mesh.getName()] = { moved, maxShift: +maxD.toFixed(4) }; }
  // landmarks + glasses-fit depth grid travel with the head
  const L = hid?.landmarks; if (L) { for (const k of ["l", "r"]) if (L.eyes?.[k]) L.eyes[k] = W.map(...L.eyes[k]); if (L.mouth?.c) { const c0 = L.mouth.c, c1 = W.map(...c0), cR = W.map(c0[0] + L.mouth.halfW, c0[1], c0[2]); L.mouth.c = c1; L.mouth.halfW = Math.abs(cR[0] - c1[0]); } for (const k of ["bridge", "forward"]) if (Array.isArray(L[k])) L[k] = W.map(...L[k]);
    const G = L.glassesFit?.grid; if (G?.z) { const old = G.z.slice(), at = (x, y) => { const fx = (x - G.x0) / G.dx, fy = (y - G.y0) / G.dy, i = Math.floor(fx), j = Math.floor(fy); if (i < 0 || j < 0 || i + 1 >= G.nx || j + 1 >= G.ny) return null; const v = [old[j * G.nx + i], old[j * G.nx + i + 1], old[(j + 1) * G.nx + i], old[(j + 1) * G.nx + i + 1]]; if (v.some((q) => q == null)) return null; const u = fx - i, w2 = fy - j; return (v[0] * (1 - u) + v[1] * u) * (1 - w2) + (v[2] * (1 - u) + v[3] * u) * w2; };
      for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { const x = G.x0 + i * G.dx, y = G.y0 + j * G.dy; let xo = x; for (let it = 0; it < 4; it++) xo += x - W.map(xo, y, 0.3)[0]; const z = at(xo, y); G.z[j * G.nx + i] = z == null ? null : +z.toFixed(4); } } }
  if (hid) hid.identityCorrection = { v: 1, stats }; root.listScenes()[0].setExtras(ex);   // NO wall-clock time in the artifact: a rebuild must be byte-identical so a hash-bound sign-off carries over to the promote build (the report keeps builtAt)
 await io.write(outFile, doc); return stats; }

if (process.argv[1]?.endsWith("identity-correct.mjs")) { const [who, file] = process.argv.slice(2), opt = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const t0 = Date.now(), T = await targetFor(who, opt("s0")), H = await measureHead(file), rows = compare(H.m, T.target);
  console.log(`${who}: fit folds ${H.fit.folds} residual ${H.fit.residual?.toFixed(4)} · Stage 0 ${T.key} · ${Date.now() - t0} ms`);
  for (const r of rows) console.log(`  ${r.out ? "✗" : r.weak ? "·" : "✓"} ${r.k.padEnd(24)} now ${String(r.current).padEnd(7)} target ${String(r.target).padEnd(7)} ${r.abs ? "Δ" : "err"} ${r.err > 0 ? "+" : ""}${r.err}${r.abs ? "" : "%"} ${r.weak ? "(weak evidence — not forced)" : ""}`);
  if (process.argv.includes("--measure-only")) process.exit(0);
  if (process.argv.includes("--plan-length")) { const L = planLength(H.m, T.target), rec = opt("record"), cur = rec && fs.existsSync(rec) ? JSON.parse(fs.readFileSync(rec, "utf8")).longFace?.boost ?? 1 : 1;
    const plan = { ...L, boost: L.apply ? +(cur * L.mul).toFixed(4) : cur, currentBoost: cur }; console.log(`LENGTH_PLAN ${JSON.stringify(plan)}`); process.exit(0); }
  const plan = planCorrection(H.m, T.target, H.g3, H.check), rec = opt("record"); console.log(`  fit cross-check (fit vs skin, × eye spacing): ${JSON.stringify(H.check)} · fit folds ${H.fit.folds}`); console.log(`  plan: ${plan.apply ? "APPLY" : "within tolerance — no change"} · worst level ${(100 * plan.worst).toFixed(1)}% · levels ${JSON.stringify(plan.levels)}`);
  const out = opt("out") ?? file; let stats = null;
  if (plan.apply) { const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), lm = (await io.read(file)).getRoot().listScenes()[0].getExtras().humanIdentity.landmarks;
    stats = await applyWarp(file, out, (neck) => makeWarp(plan, H.g3, lm, neck, H.earZ)); console.log(`  warped → ${out} · ${JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.maxShift])))}`);
    const H2 = await measureHead(out), rows2 = compare(H2.m, T.target); console.log("  AFTER:"); for (const r of rows2) if (/W_IOD|faceH|chinRound|IOD_cheekW/.test(r.k)) console.log(`  ${r.out ? "✗" : r.weak ? "·" : "✓"} ${r.k.padEnd(24)} now ${String(r.current).padEnd(7)} target ${String(r.target).padEnd(7)} ${r.abs ? "Δ" : "err"} ${r.err > 0 ? "+" : ""}${r.err}${r.abs ? "" : "%"}`);
    // the chibify record (gate evidence) follows the corrected head: cheek / jaw widths and the skull half-width at the levels it measures them
    if (rec && fs.existsSync(rec)) { const R2 = JSON.parse(fs.readFileSync(rec, "utf8")), A = R2.abs?.after; if (A) {
        // the gate's record values are RE-MEASURED on the corrected skin with chibify's own width definition (front skin, ear plane + 0.2 eye spacing)
        const io2 = new NodeIO().registerExtensions(ALL_EXTENSIONS), sk = (await io2.read(out)).getRoot().listMeshes().find((q) => q.getName() === "identity_head").listPrimitives()[0].getAttribute("POSITION").getArray(), band = Math.abs(A.eyes.r.c[0] - A.eyes.l.c[0]), eyeYr = (A.eyes.l.c[1] + A.eyes.r.c[1]) / 2;
        const wAt = (f) => { const y = A.chin + f * (eyeYr - A.chin); let lo = 9, hi = -9; for (let i = 0; i < sk.length; i += 3) { if (Math.abs(sk[i + 1] - y) > band * 0.01 || sk[i + 2] < A.ears.z + band * 0.2) continue; lo = Math.min(lo, sk[i]); hi = Math.max(hi, sk[i]); } return hi - lo; };
        const c0 = A.cheekWidth, j0 = A.jawWidth, kc = wAt(0.6) / c0, kj = wAt(0.25) / j0; A.cheekWidth = wAt(0.6); A.jawWidth = wAt(0.25); if (R2.after) { R2.after.cheek = A.cheekWidth / A.ears.half; R2.after.jaw = A.jawWidth / A.ears.half; }   /* skull (ears) locked */
        R2.identityCorrection = { ...(R2.identityCorrection ?? {}), plan: plan.levels, worst: plan.worst, scales: { cheek: +kc.toFixed(4), jaw: +kj.toFixed(4), skull: 1 }, before: rows.filter((r) => r.out).map((r) => [r.k, r.err]), after: rows2.filter((r) => r.out).map((r) => [r.k, r.err]) }; fs.writeFileSync(rec, JSON.stringify(R2, null, 1)); } } }
  fs.writeFileSync(opt("report-out") ?? `${out}.identity-correction.json`, JSON.stringify({ who, stage0: T.key, plan: { apply: plan.apply, worst: plan.worst, levels: plan.levels }, before: rows, stats }, null, 1)); }
