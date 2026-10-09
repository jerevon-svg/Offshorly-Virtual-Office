// v3/build.mjs — HumanBase V3 PROOF BUILD: canonical head + identity fit + fixed-UV bake + modular hair + modules.
// ZERO CREDITS. Never writes to production/ or public/. From frontend/:
//   node scripts/avatar-pipeline/human-base/v3/build.mjs --who=bon,kael,lui,nicole --variant=B
// Variant B = 2D identity (the approved illustration lives inside the evidence's style transform) + existing local 3D
// evidence (the chibified Meshy head: skin shape, painted texture, hair shape, eye/mouth shells, landmarks).
// Variant A = 2D-only (see fit2d.mjs). Output: scripts/avatar-pipeline/output/human-base/v3-proof/<who>/<variant>/pass1/<who>-v1.glb
import fs from "node:fs";
import crypto from "node:crypto";
import sharp from "sharp";
import { MeshoptSimplifier } from "meshoptimizer";
import { loadBase, writeModule } from "../lib.mjs";
import { loadTemplate, fit3D } from "./fit.mjs";
import { load3D, colourAt } from "./evidence.mjs";
import { TriIndex, compact, dilateGutter, distToLoopXY, insideLoopXY, neighbours, pushPull, rasterUV, repairManifold, topo, triNormal, vertexNormals } from "./geom.mjs";
import { silhouetteRemap } from "./envelope.mjs";
import { NP, NT, buildHairSolid, dirBin, faceBinsOf, headRadiusMap, regionBins, sampleMap, thicknessFrom3D } from "./hair.mjs";
await MeshoptSimplifier.ready;

const args = process.argv.slice(2), opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const WHO = opt("who", "bon,kael,lui,nicole").split(","), VARIANT = opt("variant", "B"), TEX = Number(opt("tex", 2048));
const OUT = "scripts/avatar-pipeline/output/human-base/v3-proof";
const base = await loadBase(), tpl = loadTemplate(), HEAD = base.JI.Head;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

// the shoulder line of the HumanBase body (hair floor) and the neck column (from the template's neck stub ring)
let shoulderY = -Infinity; for (let i = 0; i < base.geo.P.length / 3; i++) { const x = Math.abs(base.geo.P[i * 3]); if (x > 0.16 && x < 0.3 && base.geo.P[i * 3 + 1] < 0.95) shoulderY = Math.max(shoulderY, base.geo.P[i * 3 + 1]); }
const ring = tpl.neckRing; let ncx = 0, ncz = 0, ny = 0; for (const r of ring) { ncx += r.p[0] / ring.length; ncz += r.p[2] / ring.length; ny += r.p[1] / ring.length; }
let nr = 0; for (const r of ring) nr += Math.hypot(r.p[0] - ncx, r.p[2] - ncz) / ring.length;

export async function buildB(who, { envRatio = null } = {}) {
  const t0 = Date.now(), report = { who, variant: "B", evidence: {}, timings: {} };
  const evFile = `public/avatars/human-base-v1/identity/${who}-meshy-chibi-v1.glb`;
  const ev = await load3D(evFile); report.evidence.file = evFile;
  // FACIAL ENVELOPE CORRECTION (identity, from the approved illustration via the approved-five 2D→3D relationship): the
  // evidence's lateral face silhouette is remapped per height band before the canonical fit — skin, hair framing and the
  // face modules move together; features inside the eye/mouth zone and the cranium behind the face are untouched
  const ratioFile = `${OUT}/${who}/B/envelope-ratio.json`;
  envRatio ??= fs.existsSync(ratioFile) ? JSON.parse(fs.readFileSync(ratioFile, "utf8")).ratio : null;
  if (envRatio) { const FL = ev.fitLandmarks, eyeY = (FL.eyes.l[1] + FL.eyes.r[1]) / 2, chinY = ev.chin[1], earZ = FL.attach?.ears?.l?.root?.[2] ?? ev.landmarks.attach?.ears?.l?.root?.[2] ?? -0.05;
    const eyeOut = Math.abs(FL.eyes.l[0]) + 1.15 * (FL.eyes.halfW ?? 0.07), mouthOut = 1.1 * (FL.mouth?.halfW ?? 0.08);
    const innerAt = (t) => (t <= 0.3 ? eyeOut : t >= 0.6 ? mouthOut : eyeOut + (mouthOut - eyeOut) * (t - 0.3) / 0.3);
    const f = silhouetteRemap(envRatio, { eyeY, chinY, earZ, innerAt });
    // the HAIR FRAMING evidence moves with the face; the face skin evidence stays (the correction is applied to the fitted
    // canonical head itself, so hair-covered temples/cheeks — where there is no skin evidence — narrow too)
    for (const S of [ev.hair]) { for (let i = 0; i < S.P.length / 3; i++) S.P[i * 3] = f(S.P[i * 3], S.P[i * 3 + 1], S.P[i * 3 + 2]); S.N = vertexNormals(S.P, S.I); S.index = new TriIndex(S.P, S.I, 0.02); }
    report.envelopeMap = f;
    for (const sh of ev.shells) { const A = Float32Array.from(sh.attrs.POSITION.array); for (let i = 0; i < A.length / 3; i++) A[i * 3] = f(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]); sh.attrs.POSITION = { ...sh.attrs.POSITION, array: A }; }
    if (ev.mouth) { for (let i = 0; i < ev.mouth.P.length / 3; i++) ev.mouth.P[i * 3] = f(ev.mouth.P[i * 3], ev.mouth.P[i * 3 + 1], ev.mouth.P[i * 3 + 2]); ev.mouth.index = new TriIndex(ev.mouth.P, ev.mouth.I, 0.02); }
    report.envelopeRatio = envRatio.map((r) => +r.toFixed(3)); }
  // ---- 1. identity fit of the canonical head -------------------------------------------------------------------------
  const fit = fit3D(tpl, ev); const X = fit.X, I = tpl.I, n = tpl.n;
  if (report.envelopeMap) { const f = report.envelopeMap, X0 = Float32Array.from(X); for (let i = 0; i < n; i++) X[i * 3] = f(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]);
    let inv = 0; for (let t = 0; t < I.length / 3; t++) { const a = triNormal(X0, I, t), b = triNormal(X, I, t); if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] < 0) inv++; }
    report.envelopeFolds = inv; if (inv) throw new Error(`envelope correction folded ${inv} triangles — fail closed`); delete report.envelopeMap; }
  const N = vertexNormals(X, I);
  report.landmarkAudit = ev.skin.audit;
  report.fit = { accepted: fit.accepted, folds: fit.flipped, minAreaRatio: fit.minAreaRatio, maxDisp: fit.maxDisp, earFit: fit.earFit, finalMeanResidual: fit.log.at(-1).meanD };
  report.timings.fit = Date.now() - t0;
  const TL = tpl.landmarks, at = (i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]];
  const centre = [0, (at(TL.earLroot)[1] + at(TL.earRroot)[1]) / 2, (at(TL.earLroot)[2] + at(TL.earRroot)[2]) / 2];
  // ---- 2. modular hair (separate closed solid on the complete head) -------------------------------------------------
  const RG = tpl.REGION, faceBins = faceBinsOf(X, centre, tpl.region, (r) => r === RG.face || r === RG.eyeL || r === RG.eyeR || r === RG.nose || r === RG.mouth || r === RG.jaw);
  // canonical regions per direction: the UNDERSIDE (only hanging hair) and the BACK of the head behind the ear plane
  const RB = regionBins(X, centre, tpl.region), underBins = new Uint8Array(NT * NP), backBins = new Uint8Array(NT * NP);
  for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) { const k = t * NP + p, ph = (p + 0.5) / NP * 2 * Math.PI - Math.PI, th = (t + 0.5) / NT * Math.PI;
    if (RB[k] === RG.under) underBins[k] = 1; else if ((RB[k] === RG.scalp || RB[k] === RG.nape || RB[k] === RG.side) && Math.sin(th) * Math.sin(ph) < -0.05) backBins[k] = 1; }
  const headR = headRadiusMap(X, centre), { T, mask, Ms, backCover } = thicknessFrom3D(ev.hair.P, headR, centre, { faceBins, underBins, backBins });
  const earVerts = { l: [], r: [] }; for (let i = 0; i < n; i++) { if (tpl.region[i] === tpl.REGION.earL) earVerts.l.push(i); if (tpl.region[i] === tpl.REGION.earR) earVerts.r.push(i); }
  const earSide = new Uint8Array(I.length / 3).fill(0); const sideOf = (i) => (tpl.region[i] === tpl.REGION.earL ? "l" : tpl.region[i] === tpl.REGION.earR ? "r" : null);
  const earTriSide = []; for (let t = 0; t < I.length / 3; t++) earTriSide.push(sideOf(I[t * 3]) && sideOf(I[t * 3]) === sideOf(I[t * 3 + 1]) && sideOf(I[t * 3]) === sideOf(I[t * 3 + 2]) ? sideOf(I[t * 3]) : null); void earSide;
  const earIndex = new TriIndex(X, I, 0.02, (t) => earTriSide[t] !== null);
  const hs = buildHairSolid({ P: X, I }, { centre, headR, T, Ms, ears: { verts: earVerts, index: earIndex, side: earTriSide }, neck: { cx: ncx, cz: ncz, r: nr, y1: centre[1] }, floorY: shoulderY + 0.015 });
  report.hair = { earMode: hs.earMode, backCover: backCover == null ? null : +backCover.toFixed(3), rawTris: hs.I.length / 3 };
  let { P: hairP, I: hairI } = finishHairMesh(hs, report, { H: { S: hs.headSDF.S, ...hs.grid }, earIndex, earSide: earTriSide, earMode: hs.earMode });
  const hairN = vertexNormals(hairP, hairI), nh = hairP.length / 3;
  report.hair.topology = (({ bEdges, ...r }) => r)(topo(hairP, hairI));
  // colours, flow and clump transferred from the evidence hair (nearest surface point); hair base = median hair colour
  const hairCols = []; for (let t = 0; t < ev.hair.I.length / 3; t += 7) hairCols.push(colourAt(ev.hair, t, 1 / 3, 1 / 3, 1 / 3)); hairCols.sort((a, b) => lum(a) - lum(b));
  const hairBase = hairCols[Math.floor(hairCols.length * 0.4)] ?? [40, 34, 32];
  const HC = new Float32Array(nh * 4), FL = new Float32Array(nh * 3), CL = new Float32Array(nh);
  for (let i = 0; i < nh; i++) { const q = ev.hair.index.closest(hairP[i * 3], hairP[i * 3 + 1], hairP[i * 3 + 2], 0.05);
    let c = hairBase.map((v) => v * 0.8); if (q) { c = colourAt(ev.hair, q.t, q.u, q.v, q.w);
      const a = ev.hair.I[q.t * 3], b = ev.hair.I[q.t * 3 + 1], d = ev.hair.I[q.t * 3 + 2];
      const f = [0, 1, 2].map((k) => ev.hair.FLOW[a * 3 + k] * q.u + ev.hair.FLOW[b * 3 + k] * q.v + ev.hair.FLOW[d * 3 + k] * q.w), dn = f[0] * hairN[i * 3] + f[1] * hairN[i * 3 + 1] + f[2] * hairN[i * 3 + 2];
      const ft = [f[0] - dn * hairN[i * 3], f[1] - dn * hairN[i * 3 + 1], f[2] - dn * hairN[i * 3 + 2]], fl = Math.hypot(...ft); if (fl > 1e-4) FL.set(ft.map((v) => v / fl), i * 3);
      CL[i] = ev.hair.CLUMP[a] * q.u + ev.hair.CLUMP[b] * q.v + ev.hair.CLUMP[d] * q.w; }
    HC.set([c[0] / 255, c[1] / 255, c[2] / 255, 1], i * 4); }
  // ---- 3. FIXED-UV TEXTURE BAKE of the head: evidence skin paint → canonical UV; scalp under hair = hair base ----------
  const cover = new Float32Array(n); for (let i = 0; i < n; i++) { const [th, ph] = dirBin(X[i * 3] - centre[0], X[i * 3 + 1] - centre[1], X[i * 3 + 2] - centre[2]); cover[i] = smooth(0.35, 0.6, sampleMap(Ms, th, ph)); }
  const S = TEX, RGB = new Float32Array(S * S * 3), known = new Uint8Array(S * S), cov = new Float32Array(S * S), inside = new Uint8Array(S * S);
  const src = tpl.uv.src, UI = tpl.uv.I; let found = 0, texels = 0;
  rasterUV(tpl.uv.UV, UI, S, (g, t, w0, w1, w2) => {
    const a = src[UI[t * 3]], b = src[UI[t * 3 + 1]], c = src[UI[t * 3 + 2]];
    const p = [0, 1, 2].map((q) => X[a * 3 + q] * w0 + X[b * 3 + q] * w1 + X[c * 3 + q] * w2), nn = [0, 1, 2].map((q) => N[a * 3 + q] * w0 + N[b * 3 + q] * w1 + N[c * 3 + q] * w2);
    inside[g] = 1; texels++; cov[g] = cover[a] * w0 + cover[b] * w1 + cover[c] * w2;
    // PROJECTION BAKE (cage ray along −normal from 2.5 cm-eq outside, 6 cm-eq deep): the first evidence surface facing the
    // ray — recessed painted features (a grin's teeth, an open mouth, nostrils) project onto the canonical surface
    const nl = Math.hypot(...nn) || 1, d = nn.map((v) => -v / nl), o = p.map((v, q) => v - d[q] * 0.025);
    let q = ev.skin.index.raycast(o[0], o[1], o[2], d[0], d[1], d[2], 0.085, (tt) => { const tn = triNormal(ev.skin.P, ev.skin.I, tt); return -(tn[0] * d[0] + tn[1] * d[1] + tn[2] * d[2]) > 0.15; });
    if (!q) q = ev.skin.index.closest(p[0], p[1], p[2], 0.03, (tt) => { const tn = triNormal(ev.skin.P, ev.skin.I, tt); return tn[0] * nn[0] + tn[1] * nn[1] + tn[2] * nn[2] > 0.2; });
    if (q) { const col = colourAt(ev.skin, q.t, q.u, q.v, q.w); RGB[g * 3] = col[0]; RGB[g * 3 + 1] = col[1]; RGB[g * 3 + 2] = col[2]; known[g] = 1; found++; } });
  // skin the evidence does not cover is filled from SKIN-LIKE evidence texels only (dark hairline / brow paint must not
  // bleed into the nape or behind the ears); the evidence's own texels keep their colour
  const skinRef = (() => { const v = []; for (let g = 0; g < S * S; g += 13) if (known[g]) v.push([RGB[g * 3], RGB[g * 3 + 1], RGB[g * 3 + 2]]); v.sort((a, b) => lum(a) - lum(b)); return v[Math.floor(v.length * 0.7)] ?? [230, 180, 160]; })();
  const skinLike = new Uint8Array(S * S); for (let g = 0; g < S * S; g++) if (known[g] && lum([RGB[g * 3], RGB[g * 3 + 1], RGB[g * 3 + 2]]) > lum(skinRef) * 0.72) skinLike[g] = 1;
  const filled = pushPull(RGB, skinLike, S); for (let g = 0; g < S * S; g++) if (known[g]) for (let q = 0; q < 3; q++) filled[g * 3 + q] = RGB[g * 3 + q];
  // LIP SEAM PAINT: inside the evidence mouth opening (front projection) the seam darkens softly toward the opening's
  // centre line — the closed-mouth line the opening drew in the evidence
  let seam = 0; if (ev.skin.mouthLoop) { rasterUV(tpl.uv.UV, UI, S, (g, t, w0, w1, w2) => { const a = src[UI[t * 3]], b = src[UI[t * 3 + 1]], c = src[UI[t * 3 + 2]];
      const x = X[a * 3] * w0 + X[b * 3] * w1 + X[c * 3] * w2, y = X[a * 3 + 1] * w0 + X[b * 3 + 1] * w1 + X[c * 3 + 1] * w2, z = X[a * 3 + 2] * w0 + X[b * 3 + 2] * w1 + X[c * 3 + 2] * w2;
      const zIn = insideLoopXY(ev.skin.mouthLoop, x, y); if (zIn === null || z < zIn - 0.05) return; const d = distToLoopXY(ev.skin.mouthLoop, x, y), k = Math.min(1, d / 0.004);
      for (let q = 0; q < 3; q++) filled[g * 3 + q] *= 1 - 0.45 * k; seam++; }); }
  const scalp = hairBase.map((v) => v * 0.85), img = Buffer.alloc(S * S * 3);
  for (let g = 0; g < S * S; g++) { const k = inside[g] ? cov[g] : 0; for (let q = 0; q < 3; q++) img[g * 3 + q] = Math.max(0, Math.min(255, Math.round(filled[g * 3 + q] * (1 - k) + scalp[q] * k))); }
  dilateGutter(img, inside, S);
  const webp = await sharp(img, { raw: { width: S, height: S, channels: 3 } }).webp({ quality: 92 }).toBuffer();
  report.bake = { size: S, coveredTexels: texels, evidenceTexels: found, evidenceCoverage: +(found / texels).toFixed(3), lipSeamTexels: seam, webpBytes: webp.length };
  // ---- 4. modules carried over: living eyes + mouth shells, re-seated on the fitted surface ---------------------------
  const headIdx = new TriIndex(X, I, 0.02), shells = [];
  // SEATING RULE: a face module (eyes, mouth) keeps its own shape and its original lift above the face, measured on the
  // evidence, but is placed on the FITTED head and never sinks below MIN_LIFT (it can never be swallowed by the head)
  const MIN_LIFT = 0.0015;
  for (const sh of ev.shells) { const Pp = Float32Array.from(sh.attrs.POSITION.array); let moved = 0, lifted = 0;
    for (let i = 0; i < Pp.length / 3; i++) { const x = Pp[i * 3], y = Pp[i * 3 + 1], z = Pp[i * 3 + 2];
      const e = ev.skin.index.closest(x, y, z, 0.06); const f = headIdx.closest(e ? e.x : x, e ? e.y : y, e ? e.z : z, 0.08); if (!f) continue;
      const tn = triNormal(X, I, f.t); let lift = e ? (x - e.x) * tn[0] + (y - e.y) * tn[1] + (z - e.z) * tn[2] : MIN_LIFT; if (lift < MIN_LIFT) { lift = MIN_LIFT; lifted++; }
      // keep the shell's own tangential layout (offset from its evidence anchor), re-anchor on the fitted surface, re-lift
      const tx = e ? x - e.x : 0, ty = e ? y - e.y : 0, tz = e ? z - e.z : 0, dn = tx * tn[0] + ty * tn[1] + tz * tn[2];
      Pp[i * 3] = f.x + (tx - dn * tn[0]) + lift * tn[0]; Pp[i * 3 + 1] = f.y + (ty - dn * tn[1]) + lift * tn[1]; Pp[i * 3 + 2] = f.z + (tz - dn * tn[2]) + lift * tn[2]; moved++; }
    // a final visibility pass: no shell vertex may sit inside the head
    for (let i = 0; i < Pp.length / 3; i++) { const f = headIdx.closest(Pp[i * 3], Pp[i * 3 + 1], Pp[i * 3 + 2], 0.01); if (!f) continue; const tn = triNormal(X, I, f.t), d = (Pp[i * 3] - f.x) * tn[0] + (Pp[i * 3 + 1] - f.y) * tn[1] + (Pp[i * 3 + 2] - f.z) * tn[2];
      if (d < MIN_LIFT) { const k = MIN_LIFT - d; Pp[i * 3] += k * tn[0]; Pp[i * 3 + 1] += k * tn[1]; Pp[i * 3 + 2] += k * tn[2]; lifted++; } }
    const extra = {}; for (const [k, v] of Object.entries(sh.attrs)) if (k.startsWith("_")) extra[k] = { type: v.type, array: v.array, normalized: v.normalized };
    shells.push({ name: sh.name, P: Pp, N: sh.attrs.NORMAL.array, I: Array.from(sh.I), UV: sh.attrs.TEXCOORD_0 ? sh.attrs.TEXCOORD_0.array : undefined, J: sh.attrs.JOINTS_0.array, W: sh.attrs.WEIGHTS_0.array, extraAttrs: extra,
      material: { name: sh.material ?? sh.name, texture: sh.texture ? Buffer.from(sh.texture) : undefined } });
    report[`shell_${sh.name}`] = { verts: Pp.length / 3, reseated: moved, liftedToMin: lifted }; }
  // ---- 5. HumanBase neck extension (body skin from the neck stub up inside the closed head) ---------------------------
  const neck = neckExtension();
  // ---- 6. landmarks: the evidence's face landmarks + the canonical ears' fitted landmark vertices ----------------------
  const L = JSON.parse(JSON.stringify(ev.landmarks));
  if (L.attach?.ears) for (const s of ["l", "r"]) { const S2 = s.toUpperCase(), old = L.attach.ears[s]?.root;
    L.attach.ears[s] = { root: at(TL[`ear${S2}root`]), outer: at(TL[`ear${S2}outer`]), top: at(TL[`ear${S2}top`]), lobe: at(TL[`ear${S2}lobe`]), back: at(TL[`ear${S2}back`]), measured: true, canonical: true };
    if (s === "r" && L.glassesFit?.ear && old) { const d = L.attach.ears.r.root.map((v, q) => v - old[q]); L.glassesFit.ear = L.glassesFit.ear.map((v, q) => v + d[q]); } }
  // ---- 7. write the identity module ------------------------------------------------------------------------------------
  const uvN = tpl.uv.src.length, HP = new Float32Array(uvN * 3), HN = new Float32Array(uvN * 3);
  for (let j = 0; j < uvN; j++) { const i = src[j]; HP.set([X[i * 3], X[i * 3 + 1], X[i * 3 + 2]], j * 3); HN.set([N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], j * 3); }
  const rigid = (m) => { const J = new Uint8Array(m * 4), W = new Float32Array(m * 4); for (let i = 0; i < m; i++) { J[i * 4] = HEAD; W[i * 4] = 1; } return { J, W }; };
  const hr = rigid(uvN), hh = rigid(nh);
  const meshes = [
    { name: "identity_head", P: HP, N: HN, I: Array.from(UI), UV: tpl.uv.UV, J: hr.J, W: hr.W, extraAttrs: { _PAINT: { type: "VEC4", array: new Float32Array(uvN * 4) } }, material: { name: "identity_skin", texture: webp, roughness: 0.9 } },
    { name: "identity_hair_main", P: hairP, N: hairN, I: Array.from(hairI), J: hh.J, W: hh.W, extraAttrs: { _PAINT: { type: "VEC4", array: HC }, _FLOW: { type: "VEC3", array: FL }, _CLUMP: { type: "SCALAR", array: CL } }, material: { name: "identity_hair", roughness: 0.9 } },
    ...shells, neck,
  ];
  const id = `${who}-v3${VARIANT.toLowerCase()}`, dir = `${OUT}/${who}/${VARIANT}/pass1`, file = `${dir}/${who}-v1.glb`;
  const extras = { humanIdentity: { id, base: "human-base-v1", source: evFile, v3: { template: tpl.id, variant: VARIANT, pipeline: "humanbase-v3-proof-1" }, landmarks: L, hides: [], hairFused: false, hairMotion: "short" } };
  await writeModule(file, base, meshes, extras, { compress: false });
  const bytes = fs.readFileSync(file); report.artifactHash = crypto.createHash("sha256").update(bytes).digest("hex"); report.bytes = bytes.length;
  report.counts = { headTris: UI.length / 3, headVerts: n, hairTris: hairI.length / 3, eyeTris: shells.find((s) => s.name === "face_eyes")?.I.length / 3 ?? 0, mouthTris: shells.find((s) => s.name === "face_mouth")?.I.length / 3 ?? 0, neckTris: neck.I.length / 3 };
  report.timings.total = Date.now() - t0;
  // the fitted head + hair positions for QA (topology identity, invariants)
  fs.writeFileSync(`${dir}/qa-geometry.json`, JSON.stringify({ X: Array.from(X), hairP: Array.from(hairP), hairI: Array.from(hairI), centre, T: Array.from(T), Ms: Array.from(Ms), headR: Array.from(headR), earMode: hs.earMode }));
  fs.writeFileSync(`${dir}/build.json`, JSON.stringify(report, null, 1));
  console.log(`${who} ${VARIANT}: ${file} ${(bytes.length / 1e6).toFixed(2)} MB · fit ${JSON.stringify(report.fit)} · hair ${JSON.stringify(report.hair)} · bake ${JSON.stringify(report.bake)} · ${report.timings.total} ms`);
  return report;
}


/** smooth (Taubin), repair to a closed 2-manifold, simplify to the hair budget — shared by every variant */
export function finishHairMesh(hs, report, guard = null) {
  let hairP = hs.P, hairI = hs.I;
  // Taubin smoothing (no shrink), then simplification to a runtime budget
  { const nb = neighbours(hairI, hairP.length / 3), Tm = new Float32Array(hairP.length);
    for (let it = 0; it < 6; it++) for (const k of [0.5, -0.53]) { Tm.set(hairP); for (let i = 0; i < nb.length; i++) { const d = nb[i].length; if (!d) continue; for (let q = 0; q < 3; q++) { let s = 0; for (const j of nb[i]) s += hairP[j * 3 + q]; Tm[i * 3 + q] = hairP[i * 3 + q] + k * (s / d - hairP[i * 3 + q]); } } hairP.set(Tm); } }
  report.hair.rawTopology = (({ bEdges, ...r }) => r)(topo(hairP, hairI));
  if (process.env.V3_DEBUG_HAIR) { // where are the non-manifold vertices? (debug)
    const tp = topo(hairP, hairI), nv = hairP.length / 3, fan = Array.from({ length: nv }, () => 0); void tp;
    const E = new Map(); for (let t = 0; t < hairI.length / 3; t++) for (let k = 0; k < 3; k++) { const a = hairI[t * 3 + k], b = hairI[t * 3 + (k + 1) % 3], key = a < b ? a * nv + b : b * nv + a; E.set(key, (E.get(key) ?? 0) + 1); }
    const pts = []; for (const [key, c] of E) if (c > 2) { const a = Math.floor(key / nv); pts.push([hairP[a * 3], hairP[a * 3 + 1], hairP[a * 3 + 2]]); }
    const hist = {}; for (const p of pts) { const k = `y${(Math.round(p[1] * 10) / 10).toFixed(1)} z${p[2] > -0.05 ? "front" : "back"} ${Math.abs(p[0]) > 0.3 ? "side" : "mid"}`; hist[k] = (hist[k] ?? 0) + 1; }
    console.log("nm-edge locations", JSON.stringify(hist), "T range", Math.min(...T), Math.max(...T)); void fan; }
  { const n0 = hairP.length / 3, par = Int32Array.from({ length: n0 }, (_, i) => i), f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    for (let t = 0; t < hairI.length; t += 3) { const a = f(hairI[t]); par[f(hairI[t + 1])] = a; par[f(hairI[t + 2])] = a; }
    const acc = new Map(); for (let v = 0; v < n0; v++) { const r = f(v), a = acc.get(r) ?? [0, 0, 0, 0]; a[0] += hairP[v * 3]; a[1] += hairP[v * 3 + 1]; a[2] += hairP[v * 3 + 2]; a[3]++; acc.set(r, a); }
    report.hair.pieces = [...acc.values()].sort((a, b) => b[3] - a[3]).map((a) => ({ verts: a[3], centroid: [a[0] / a[3], a[1] / a[3], a[2] / a[3]].map((v) => +v.toFixed(3)) })); }
  { const rp = repairManifold(hairP, hairI); hairP = rp.P; hairI = rp.I; report.hair.repair = rp.log; }
  // simplify to the hair budget, but only accept a result that is still a closed 2-manifold (relax the target if not)
  { const target = Number(opt("hairTris", 16000));
    for (const tg of [target, target * 1.4, target * 2, target * 3]) { if (hairI.length / 3 <= tg) break;
      const [idx] = MeshoptSimplifier.simplify(hairI, hairP, 3, Math.round(tg) * 3, 0.004, []); let c = compact(hairP, idx); c = repairManifold(c.P, c.I); const tp = topo(c.P, c.I);
      if (!tp.nonManifoldEdges && !tp.nonManifoldVerts && !tp.boundaryEdges) { hairP = c.P; hairI = c.I; report.hair.simplifiedTo = Math.round(tg); break; } } }
  // FINAL CONSTRUCTION GUARANTEE (not a repair of a detected failure): smoothing/simplification may drift a vertex inward;
  // every hair vertex is held ≥ ε outside the head and ≥ the clearance from an exposed ear, measured on the head's own
  // signed distance field (volumetric inside test) and the ear surfaces
  if (guard) { let pushed = 0; const { H, earIndex, earSide, earMode, eps = 0.0015, earGap = 0.006 } = guard, [nx, ny, nz] = H.dims;
    const tri = (x, y, z) => { const fx = (x - H.min[0]) / H.cell, fy = (y - H.min[1]) / H.cell, fz = (z - H.min[2]) / H.cell, i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
      if (i0 < 0 || j0 < 0 || k0 < 0 || i0 >= nx - 1 || j0 >= ny - 1 || k0 >= nz - 1) return null; let s = 0;
      for (let c = 0; c < 8; c++) { const di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1; s += (di ? fx - i0 : 1 - fx + i0) * (dj ? fy - j0 : 1 - fy + j0) * (dk ? fz - k0 : 1 - fz + k0) * H.S[((k0 + dk) * ny + j0 + dj) * nx + i0 + di]; } return s; };
    for (let it = 0; it < 4; it++) for (let i = 0; i < hairP.length / 3; i++) { const x = hairP[i * 3], y = hairP[i * 3 + 1], z = hairP[i * 3 + 2], d = tri(x, y, z); if (d === null) continue;
      if (d < eps) { const e = H.cell * 0.5, gr = [tri(x + e, y, z) - tri(x - e, y, z), tri(x, y + e, z) - tri(x, y - e, z), tri(x, y, z + e) - tri(x, y, z - e)], l = Math.hypot(...gr) || 1, k = eps - d + 0.0005;
        hairP[i * 3] += gr[0] / l * k; hairP[i * 3 + 1] += gr[1] / l * k; hairP[i * 3 + 2] += gr[2] / l * k; pushed++; }
      if (it) continue;
      const q = earIndex.closest(hairP[i * 3], hairP[i * 3 + 1], hairP[i * 3 + 2], earGap, (t) => earSide[t] && earMode[earSide[t]] === "exposed");
      if (q) { const dx = hairP[i * 3] - q.x, dy = hairP[i * 3 + 1] - q.y, dz = hairP[i * 3 + 2] - q.z, l = Math.hypot(dx, dy, dz) || 1e-6, k = earGap - l; hairP[i * 3] += dx / l * k; hairP[i * 3 + 1] += dy / l * k; hairP[i * 3 + 2] += dz / l * k; pushed++; } }
    report.hair.guardPushed = pushed; }
  return { P: hairP, I: hairI };
}

/** the HumanBase neck stub ring extruded up inside the closed head (body skin, body material) */
export function neckExtension() {
  const rows = [[0, 1, 0], [0.035, 0.985, 0.5], [0.07, 0.96, 1], [0.11, 0.93, 1]], m = ring.length, P = [], Nn = [], UV = [], J = [], W = [], I = [];
  for (const [dy, sc, hb] of rows) for (const r of ring) { P.push(ncx + (r.p[0] - ncx) * sc, r.p[1] + dy, ncz + (r.p[2] - ncz) * sc); Nn.push(...r.n); UV.push(...r.uv);
    // blend the ring's own weights toward the Head joint as the extension rises inside the head
    const w = {}; r.j.forEach((j, k) => { w[j] = (w[j] ?? 0) + r.w[k] * (1 - hb); }); w[HEAD] = (w[HEAD] ?? 0) + hb;
    const e = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4), s = e.reduce((a, [, v]) => a + v, 0); for (let k = 0; k < 4; k++) { J.push(e[k] ? Number(e[k][0]) : 0); W.push(e[k] ? e[k][1] / s : 0); } }
  for (let r = 0; r < rows.length - 1; r++) for (let k = 0; k < m; k++) { const a = r * m + k, b = r * m + (k + 1) % m, c = (r + 1) * m + k, d = (r + 1) * m + (k + 1) % m; I.push(a, b, d, a, d, c); }
  // orient outward
  const t = triNormal(P, I, 0), mid = [(P[I[0] * 3] + P[I[1] * 3]) / 2 - ncx, 0, (P[I[0] * 3 + 2] + P[I[1] * 3 + 2]) / 2 - ncz];
  if (t[0] * mid[0] + t[2] * mid[2] < 0) for (let q = 0; q < I.length; q += 3) [I[q + 1], I[q + 2]] = [I[q + 2], I[q + 1]];
  return { name: "bodyskin_neckext", P, N: Nn, UV, J: Uint8Array.from(J), W: Float32Array.from(W), I, material: { name: "bodyskin_neckext" } };
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (VARIANT !== "B") throw new Error("this entry point builds variant B; variant A is fit2d.mjs");
  for (const who of WHO) await buildB(who);
}
