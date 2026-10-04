// chibify.mjs — AUTOMATIC OFFSHORLY CHIBI NORMALISATION OF A MESHY IDENTITY HEAD. ZERO CREDITS. NO MANUAL SCULPTING.
//
//   node scripts/avatar-pipeline/human-base/chibify.mjs <raw-meshy-head.glb> <employee-id> [identityRetention=0.35]
//
// Reusable for any employee: nothing below names Bon. Three layers, kept apart on purpose:
//   1. CHIBI_RULES        — the universal Offshorly style rules (same for everyone).
//   2. measureHead()      — source traits MEASURED automatically from the generated mesh + its texture
//                            (eyes from sclera texels, ears/face from skin texels, chin/nose/mouth from the midline
//                            profile, hair from texture). The CANONICAL targets are measured from production Alex
//                            with the very same function — not typed in.
//   3. per-avatar config  — ONE bounded dial: identityRetention α ∈ [0,1] — how much of the person's deviation from
//                            the canonical proportions survives (0 = canonical proportions, 1 = Meshy's own).
// Transform (deterministic, in order): uniform skull fit → identity-preserving multi-band simplification of the face
// (fine anatomy damped hard, mid-scale features damped, large forms kept) → bounded eye enlargement about each
// measured eye → reduced facial projection → shorter lower face → neck taper into the HumanBase neck. The raw file is
// only read. Hair stays fused in this proof (texture-extraction exists: build-bon-chibi-head.mjs §5).
import fs from "node:fs";
import sharp from "sharp";
import * as THREE from "three";
import * as C from "../../../src/dev/vo3d/human/humanBaseContract.ts";
import { BASE_OUT, adjacency, computeNormals, io, loadBase, taubin, weldNormals, writeModule } from "./lib.mjs";

// ================================ 1. UNIVERSAL CHIBI RULES ===========================================================
export const CHIBI_RULES = {
  /** skull width is the canonical head's (measured on Alex): the ears' outer skin span sets the scale */
  skullFromEars: true,
  /** multi-band face simplification: keep large forms, damp mid-scale anatomy, damp fine anatomy hard */
  bands: { fineIter: 12, midIter: 160, keepMid: 0.38, keepFine: 0.2 },
  /** eyes: enlarge toward the canonical eye-width : skull-width ratio, never shrink, never beyond this */
  eyeScaleMax: 1.45,
  /** facial projection (nose tip ahead of the ear plane) and lower-face length (chin→eye) move toward canonical */
  projection: true, faceLength: true,
  /** HEAD-ONLY mount: the generated neck WALL is removed (see the mount step); the opening under the jaw is sealed by a
   *  hidden skin FUNNEL from its rim up-and-in to the HumanBase neck surface (`socketLift` above the rim's top). No
   *  taper, no collar, no floor. */
  /** generated BODY vs HANGING HAIR: below the chin, the generated mesh is body/clothing once it widens beyond
   *  shoulderFlare × the skull half-width (Meshy busts); hanging hair is kept only above that and only when connected */
  body: { shoulderFlare: 1.18, bustBase: 0.06 },
  /** contract eye-line max minus this = the highest eye line the lower-face rule may produce */
  eyeLineMargin: 0.015,
  /** v3: "rigid" (current) · v2: "stretch" (the ruleset Bon and Micah were approved with — their assets stay pinned to it) */
  upperHead: "rigid",
  hairline: "preserve",
  /** HAIR LENGTH presets (bottom of hanging hair, base native y) — per-avatar choice, applied by compressing the hair
   *  below the chin (scalp, hairline, part and face framing above the chin are untouched); clearance keeps hanging hair
   *  outside the HumanBase body (+ the thickest top) */
  hairLengths: { natural: null, chin: 0.78, shoulder: 0.7, upperBack: 0.6 }, hairClearance: 0.045, hairEnd: { uDepth: 0.09, curl: 0.05 },
  attach: { belowChin: -0.005, skirt: 0.02, wallMargin: 1.08, wallNormalY: 0.65, headTopFrac: 0.45, keepHairOutside: 1.15, socketLift: 0.045, skullFlare: 1.3, neckOverlap: 0.02, neckIntoHead: 0.06, neckInset: 0.985, underTol: 0.006, capLoops: false, skullBaseInset: 0.004 },
};

// ================================ 2. MEASUREMENT (source and canonical, same code) ==================================
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

// ---- GENERAL SKIN / HAIR / EYE-WHITE CLASSIFICATION (no colour constants per person) --------------------------------
// Seeds come from GEOMETRY, colours are LEARNED per head:
//   skin seed  = the front of the face around the nose/cheeks (frontmost band, middle of the head's height);
//   hair seed  = the crown (top 8% of the head) — or "bald" when the crown matches the skin;
//   every vertex is then labelled by nearest learned cluster in CIELAB (lightness half-weighted, so shading and
//   highlights stay in their cluster), with per-head thresholds from each seed's own spread, and isolated labels
//   are cleaned by a neighbour vote. Eye white = very light, near-neutral (checked spatially by the eye finder).
export const LABEL = { OTHER: 0, SKIN: 1, HAIR: 2 };
/** crown↔skin colour distance below which the crown is bald scalp (bald production heads measure 0.6–5) */
export const BALD_DE = 8;
const lab = (r, g, b) => { const f = (u) => { u /= 255; return u > 0.04045 ? ((u + 0.055) / 1.055) ** 2.4 : u / 12.92; }; const R = f(r), G = f(g), B = f(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const g3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116); return [116 * g3(Y) - 16, 500 * (g3(X) - g3(Y)), 200 * (g3(Y) - g3(Z))]; };
const dEw = (a, b) => Math.hypot(0.5 * (a[0] - b[0]), a[1] - b[1], a[2] - b[2]);
function modeColour(ids, LAB, A) {   // the dominant colour by SURFACE AREA among the seed vertices (coarse Lab histogram)
  const bins = new Map(); for (const i of ids) { const k = [0, 1, 2].map((q) => Math.round(LAB[i * 3 + q] / (q ? 6 : 10))).join(","); bins.set(k, (bins.get(k) ?? 0) + A[i]); }
  let best = null, bn = -1; for (const [k, c] of bins) if (c > bn) { bn = c; best = k; }
  const kk = best.split(",").map(Number), m = [0, 0, 0]; let c = 0;
  for (const i of ids) { const k = [0, 1, 2].map((q) => Math.round(LAB[i * 3 + q] / (q ? 6 : 10))); if (Math.abs(k[0] - kk[0]) <= 1 && Math.abs(k[1] - kk[1]) <= 1 && Math.abs(k[2] - kk[2]) <= 1) { for (let q = 0; q < 3; q++) m[q] += LAB[i * 3 + q] * A[i]; c += A[i]; } }
  return m.map((v) => v / c);
}
export function classifyHead(h, sel = () => true, nb = null) {
  const { P, COL, n } = h, LAB = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) LAB.set(lab(COL[i * 3], COL[i * 3 + 1], COL[i * 3 + 2]), i * 3);
  let y0 = 9, y1 = -9, zF = -9, xs = 0, xn = 0; for (let i = 0; i < n; i++) if (sel(i)) { y0 = Math.min(y0, P[i * 3 + 1]); y1 = Math.max(y1, P[i * 3 + 1]); }
  // vertex surface area (a third of each incident triangle): seed votes count AREA, not vertex density — generated
  // hair is far denser than skin
  const A = new Float32Array(n); { const I = h.I; for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2];
    const e1 = [0, 1, 2].map((q) => P[b * 3 + q] - P[a * 3 + q]), e2 = [0, 1, 2].map((q) => P[c * 3 + q] - P[a * 3 + q]);
    const ar = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 6; A[a] += ar; A[b] += ar; A[c] += ar; } }
  const H = y1 - y0; let tipY = 0; for (let i = 0; i < n; i++) if (sel(i) && P[i * 3 + 1] > y1 - 0.75 * H && P[i * 3 + 1] < y1 - 0.3 * H && P[i * 3 + 2] > zF) { zF = P[i * 3 + 2]; tipY = P[i * 3 + 1]; }
  for (let i = 0; i < n; i++) if (sel(i) && P[i * 3 + 2] > zF - 0.05 * H) { xs += P[i * 3]; xn++; } const xc = xs / Math.max(1, xn);
  // SKIN is learned from several geometric PROBES around the frontmost point — nose, both cheeks, forehead, both
  // ears — each giving its dominant colour by area; skin is the colour most probes agree on. A beard, a fringe or a
  // frame covering one or two probes is outvoted.
  const hairSeed = [], probeIds = { nose: [], cheekL: [], cheekR: [], forehead: [], earL: [], earR: [] };
  let xl = 9, xr = -9; for (let i = 0; i < n; i++) if (sel(i) && Math.abs(P[i * 3 + 1] - tipY) < 0.12 * H) { xl = Math.min(xl, P[i * 3]); xr = Math.max(xr, P[i * 3]); }
  for (let i = 0; i < n; i++) { if (!sel(i)) continue; const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], front = z > zF - 0.2 * H;
    if (y > y1 - 0.08 * H) hairSeed.push(i);
    if (front && z > zF - 0.12 * H && Math.abs(x - xc) < 0.15 * H && y < tipY + 0.01 * H && y > tipY - 0.1 * H) probeIds.nose.push(i);
    if (front && Math.abs(Math.abs(x - xc) - 0.17 * H) < 0.05 * H && y > tipY - 0.02 * H && y < tipY + 0.06 * H) (x < xc ? probeIds.cheekL : probeIds.cheekR).push(i);
    if (front && Math.abs(x - xc) < 0.08 * H && y > tipY + 0.18 * H && y < tipY + 0.26 * H) probeIds.forehead.push(i);
    if (Math.abs(y - (tipY + 0.06 * H)) < 0.08 * H && (x < xl + 0.04 * H || x > xr - 0.04 * H)) (x < xc ? probeIds.earL : probeIds.earR).push(i); }
  const probes = Object.fromEntries(Object.entries(probeIds).filter(([, ids]) => ids.length > 20).map(([k, ids]) => [k, modeColour(ids, LAB, A)]));
  // universal tie-break, not a per-person colour: human skin of ANY tone sits in a warm hue band with some chroma
  // (deep to very light) — black/grey/white/blue/green hair, frames and beards of those colours cannot win the vote
  const skinGamut = (c) => { const ch = Math.hypot(c[1], c[2]), hue = (Math.atan2(c[2], c[1]) * 180) / Math.PI; return ch >= 6 && hue >= 15 && hue <= 85; };
  const pk = Object.keys(probes); let best = null, bestSup = -1;
  for (const pass of [true, false]) { for (const k of pk) { if (pass && !skinGamut(probes[k])) continue; const sup = pk.filter((q) => dEw(probes[k], probes[q]) < 15); if (sup.length > bestSup) { bestSup = sup.length; best = sup; } } if (best) break; }
  const skinSeed = best.flatMap((k) => probeIds[k]);
  const skinC = modeColour(skinSeed, LAB, A), hairC0 = modeColour(hairSeed, LAB, A);
  // BALD: the crown has the skin's colour (tight: a white crown on very light skin is still read as hair if it differs
  // by more than the threshold — see check-classifier for the measured limit)
  const dCrown = dEw(skinC, hairC0), bald = dCrown < BALD_DE;
  const spread = (ids, c) => { const d = ids.map((i) => dEw([LAB[i * 3], LAB[i * 3 + 1], LAB[i * 3 + 2]], c)).sort((a, b) => a - b); return d[Math.floor(d.length * 0.5)]; };
  // skin threshold floor: shaded skin (ear rims, under the jaw) stays skin
  const Ts = Math.min(34, Math.max(26, 2.2 * spread(skinSeed, skinC))), Th = Math.min(45, Math.max(15, 2.5 * spread(hairSeed, hairC0)));
  const label = new Uint8Array(n), sclera = new Uint8Array(n);
  for (let i = 0; i < n; i++) { if (!sel(i)) continue; const c = [LAB[i * 3], LAB[i * 3 + 1], LAB[i * 3 + 2]], ds = dEw(c, skinC), dh = bald ? 1e9 : dEw(c, hairC0);
    label[i] = ds < Ts && ds <= dh ? LABEL.SKIN : !bald && dh < Th && dh < ds ? LABEL.HAIR : LABEL.OTHER;
    sclera[i] = c[0] > 76 && Math.hypot(c[1], c[2]) < 10 ? 1 : 0; }
  // neighbour vote: a vertex whose label disagrees with ≥ 80% of its (welded) neighbours takes theirs
  if (nb) { const nx = label.slice(); for (let i = 0; i < n; i++) { const ns = nb[i]; if (!ns || ns.length < 3) continue; const cnt = [0, 0, 0]; for (const j of ns) cnt[label[j]]++; const m = cnt.indexOf(Math.max(...cnt)); if (m !== label[i] && cnt[m] >= 0.8 * ns.length) nx[i] = m; } label.set(nx); }
  return { label, sclera, skinC, hairC: bald ? null : hairC0, bald, dCrown, probes, Ts, Th, seeds: { skin: skinSeed.length, hair: hairSeed.length } };
}

export async function readTexturedHead(file) {
  const doc = await io.read(file), prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const img = Buffer.from(prim.getMaterial().getBaseColorTexture().getImage());
  const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const P = Float32Array.from(prim.getAttribute("POSITION").getArray()), UV = prim.getAttribute("TEXCOORD_0").getArray();
  const n = P.length / 3, COL = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { const u = Math.min(info.width - 1, Math.max(0, Math.round((UV[i * 2] % 1) * (info.width - 1)))), v = Math.min(info.height - 1, Math.max(0, Math.round((UV[i * 2 + 1] % 1) * (info.height - 1)))); const o = (v * info.width + u) * 3; COL.set([data[o], data[o + 1], data[o + 2]], i * 3); }
  return { doc, prim, P, UV, N: prim.getAttribute("NORMAL").getArray(), I: prim.getIndices().getArray(), COL, img, n, J: prim.getAttribute("JOINTS_0")?.getArray(), W: prim.getAttribute("WEIGHTS_0")?.getArray() };
}

/** traits of a head (any space). `sel(i)` optionally restricts to the head (e.g. Alex's body excluded). */
export function measureHead(h, sel = () => true) {
  const { P, n } = h, cls = h.cls ?? (h.cls = classifyHead(h, sel));
  const isSkin = (i) => cls.label[i] === LABEL.SKIN, isSclera = (i) => cls.sclera[i] === 1;
  // eyes: sclera texels on the front, split left/right — centre and extent (the visible white = the eye opening)
  let zFront = -9; for (let i = 0; i < n; i++) if (sel(i)) zFront = Math.max(zFront, P[i * 3 + 2]);
  // EYE FINDER: eye-white candidates on the front, within the face's height band; per side keep the largest spatially
  // connected cluster (stray highlights, white hair, teeth drop out); validated by left/right symmetry; fallbacks:
  // dark iris clusters, then the canonical eye-line proportion (reported as low confidence)
  let hy0 = 9, hy1 = -9; for (let i = 0; i < n; i++) if (sel(i)) { hy0 = Math.min(hy0, P[i * 3 + 1]); hy1 = Math.max(hy1, P[i * 3 + 1]); }
  const HH = hy1 - hy0, inBand = (i) => sel(i) && P[i * 3 + 2] > zFront - 0.35 * Math.abs(zFront) - 0.05 && P[i * 3 + 1] > hy1 - 0.75 * HH && P[i * 3 + 1] < hy1 - 0.25 * HH;
  const largest = (ids, cell) => { if (ids.length < 3) return ids; const key = (i) => `${Math.floor(P[i * 3] / cell)},${Math.floor(P[i * 3 + 1] / cell)},${Math.floor(P[i * 3 + 2] / cell)}`;
    const g = new Map(); for (const i of ids) { const k = key(i); (g.get(k) ?? g.set(k, []).get(k)).push(i); }
    const seen = new Set(); let best = [];
    for (const k0 of g.keys()) { if (seen.has(k0)) continue; const st = [k0], comp = []; seen.add(k0);
      while (st.length) { const k = st.pop(); comp.push(...g.get(k)); const [a, b, c] = k.split(",").map(Number); for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dc = -1; dc <= 1; dc++) { const kk = `${a + da},${b + db},${c + dc}`; if (g.has(kk) && !seen.has(kk)) { seen.add(kk); st.push(kk); } } }
      if (comp.length > best.length) best = comp; }
    return best; };
  // the face's centre line: the median x of front skin in the face band (robust to asymmetric hair)
  const midX = (() => { const xs = []; for (let i = 0; i < n; i++) if (inBand(i) && isSkin(i) && P[i * 3 + 2] > zFront - 0.2 * HH) xs.push(P[i * 3]); xs.sort((a, b) => a - b); return xs.length ? xs[xs.length >> 1] : 0; })();
  // connected candidate clusters; a cluster that STRADDLES the centre line (teeth, an open grin, a white collar) is not an eye
  const straddlers = (ids) => { const cell = 0.012 * HH, key = (i) => `${Math.floor(P[i * 3] / cell)},${Math.floor(P[i * 3 + 1] / cell)},${Math.floor(P[i * 3 + 2] / cell)}`;
    const g = new Map(); for (const i of ids) { const k = key(i); (g.get(k) ?? g.set(k, []).get(k)).push(i); }
    const seen = new Set(), out = new Set();
    for (const k0 of g.keys()) { if (seen.has(k0)) continue; const st = [k0], comp = []; seen.add(k0);
      while (st.length) { const k = st.pop(); comp.push(...g.get(k)); const [a, b, c] = k.split(",").map(Number); for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dc = -1; dc <= 1; dc++) { const kk = `${a + da},${b + db},${c + dc}`; if (g.has(kk) && !seen.has(kk)) { seen.add(kk); st.push(kk); } } }
      let x0 = 9, x1 = -9; for (const i of comp) { x0 = Math.min(x0, P[i * 3]); x1 = Math.max(x1, P[i * 3]); }
      if (x0 < midX - 0.01 * HH && x1 > midX + 0.01 * HH) for (const i of comp) out.add(i); }
    return out; };
  const pick = (test) => { const all = { l: [], r: [] }; const cand = []; for (let i = 0; i < n; i++) if (inBand(i) && test(i)) cand.push(i);
    const drop = straddlers(cand); for (const i of cand) if (!drop.has(i)) (P[i * 3] < midX ? all.l : all.r).push(i);
    // the largest cluster LOCATES each eye; every candidate near it (≤ 2.5× its radius) MEASURES it — an eye white split
    // by a lid, lash or frame still counts whole, while far strays (highlights, teeth, white hair) stay out
    const cell = 0.012 * HH, grow = (core, cand) => { if (!core.length) return core; const m = [0, 1, 2].map((k) => core.reduce((s2, i) => s2 + P[i * 3 + k], 0) / core.length);
      const rad = Math.max(...core.map((i) => Math.hypot(P[i * 3] - m[0], P[i * 3 + 1] - m[1]))); return cand.filter((i) => Math.hypot(P[i * 3] - m[0], P[i * 3 + 1] - m[1]) <= rad * 2.5); };
    return { l: grow(largest(all.l, cell), all.l), r: grow(largest(all.r, cell), all.r) }; };
  const valid = (e) => e.l.length >= 30 && e.r.length >= 30 && (() => { const m = (ids, k) => ids.reduce((s, i) => s + P[i * 3 + k], 0) / ids.length; const sep = Math.abs(m(e.l, 0) - m(e.r, 0)); return sep > 0.08 * HH && Math.abs(m(e.l, 1) - m(e.r, 1)) < 0.25 * sep; })();
  let ey = pick(isSclera), eyeSource = "eye-white";
  if (!valid(ey)) { ey = pick((i) => h.cls && (() => { const c = h.COL; return lum([c[i * 3], c[i * 3 + 1], c[i * 3 + 2]]) < 40 && !isSkin(i); })()); eyeSource = "iris"; }
  if (!valid(ey)) eyeSource = "proportion (LOW CONFIDENCE)";
  const cluster = (ids) => { const m = [0, 0, 0]; for (const i of ids) for (let k = 0; k < 3; k++) m[k] += P[i * 3 + k] / ids.length;
    // the opening's extent: robust 3rd–97th percentile of the white around the centre
    const xs = ids.map((i) => P[i * 3]).sort((a, b) => a - b), ys = ids.map((i) => P[i * 3 + 1]).sort((a, b) => a - b), q = (a, f) => a[Math.floor(f * (a.length - 1))];
    return { c: m, halfW: (q(xs, 0.97) - q(xs, 0.03)) / 2, halfH: (q(ys, 0.97) - q(ys, 0.03)) / 2 }; };
  let eL = cluster(ey.l.length ? ey.l : [0]), eR = cluster(ey.r.length ? ey.r : [0]), eyeMirrored = null;
  // an eye largely hidden (hair over it): far fewer visible white texels than its partner, or a collapsed extent → the
  // visible eye is the measured anchor and its partner is its mirror about the face's centre line
  { const nl = ey.l.length, nr = ey.r.length, okL = nl >= 30 && eL.halfW > 0, okR = nr >= 30 && eR.halfW > 0;
    const weak = (a, b, ea, eb) => !a || (b && (ey[a === okL ? "l" : "r"].length < 0.35 * ey[b === okR ? "r" : "l"].length || ea.halfW < 0.5 * eb.halfW));
    const mir = (e) => ({ c: [2 * midX - e.c[0], e.c[1], e.c[2]], halfW: e.halfW, halfH: e.halfH });
    if (okR && (!okL || nl < 0.35 * nr || eL.halfW < 0.5 * eR.halfW)) { eL = mir(eR); eyeMirrored = "left"; }
    else if (okL && (!okR || nr < 0.35 * nl || eR.halfW < 0.5 * eL.halfW)) { eR = mir(eL); eyeMirrored = "right"; }
    void weak; }
  const eyeY = (eL.c[1] + eR.c[1]) / 2, eyeZ = (eL.c[2] + eR.c[2]) / 2, cx = (eL.c[0] + eR.c[0]) / 2;
  // ears: lateral skin extremes in the band around the eye line
  let exL = 0, exR = 0; const band = Math.abs(eL.c[0] - eR.c[0]);
  for (let i = 0; i < n; i++) { if (!sel(i)) continue; const y = P[i * 3 + 1]; if (Math.abs(y - eyeY) > band * 0.9 || !isSkin(i)) continue; exL = Math.min(exL, P[i * 3]); exR = Math.max(exR, P[i * 3]); }
  let earZ = 0, ez = 0; for (let i = 0; i < n; i++) { if (!sel(i)) continue; const x = P[i * 3], y = P[i * 3 + 1]; if (Math.abs(y - eyeY) <= band * 0.9 && (x < exL + 0.1 * band || x > exR - 0.1 * band) && isSkin(i)) { earZ += P[i * 3 + 2]; ez++; } }
  earZ /= Math.max(1, ez);
  // midline profile (skin): chin = lowest front point; nose = most forward point between eyes and chin; mouth = the
  // deepest notch between nose and chin
  const mid = []; for (let i = 0; i < n; i++) if (sel(i) && Math.abs(P[i * 3] - cx) < band * 0.06 && P[i * 3 + 2] > earZ && isSkin(i)) mid.push(i);
  // CHIN, geometry first: the midline FRONT PROFILE (any material: teeth, mouth, skin, clothing all count) is followed
  // down from below the nose; the chin is where the front steps back sharply (> 0.35 eye-separations behind the lower
  // face's front) and STAYS back for ≥ 0.25 eye-separations (an open mouth recovers; the throat does not). The chin is
  // then refined as the lowest front skin point above that step. Plausibility: the eye→chin length must lie in the
  // range real generated heads span (0.7–2.0 skull half-widths, measured on the approved heads) and above any
  // shoulder flare; otherwise a canonical fallback (the approved heads' median ratio, 1.15) is used and reported.
  let chin = 9, chinSource = "profile";
  { const bin = band * 0.04, prof2 = new Map(), widB = new Map();
    for (let i = 0; i < n; i++) { if (!sel(i)) continue; const y = P[i * 3 + 1]; if (y > eyeY) continue; const b = Math.floor(y / bin);
      widB.set(b, Math.max(widB.get(b) ?? 0, Math.abs(P[i * 3] - cx)));
      if (Math.abs(P[i * 3] - cx) < band * 0.08) prof2.set(b, Math.max(prof2.get(b) ?? -99, P[i * 3 + 2])); }
    const top = Math.floor((eyeY - band * 0.5) / bin), bot = Math.min(...widB.keys());
    // a SHARP step: the front drops > 0.3 eye-separations within 0.12 of height, and stays back for ≥ 0.25
    let step = null; const zb = (b) => prof2.get(b);
    for (let b = top; b >= bot; b--) { const z = zb(b); if (z === undefined) continue;
      let above = -99; for (let k = 1; k <= 3; k++) { const z2 = zb(b + k); if (z2 !== undefined) above = Math.max(above, z2); }
      if (above < -98 || z > above - band * 0.3) continue;
      let persist = 0, ok = true; for (let b2 = b; b2 >= bot && persist < 7; b2--) { const z2 = zb(b2); if (z2 === undefined) continue; if (z2 > above - band * 0.25) { ok = false; break; } persist++; }
      if (ok && persist >= 7) { step = (b + 1) * bin; break; } }
    // the shoulder flare: below which nothing can be face
    let flare = -99; for (let b = top; b >= bot; b--) if ((widB.get(b) ?? 0) > 2.6 * band) { flare = (b + 1) * bin; break; }
    if (step !== null && step > flare) { for (const i of mid) if (P[i * 3 + 2] > eyeZ - band * 0.35 && P[i * 3 + 1] > step - band * 0.1) chin = Math.min(chin, P[i * 3 + 1]); if (chin > 8) chin = step; }
    // no step because the mesh simply ENDS below the face (a head already cut at the neck): the lowest front skin point
    else if (step === null) { for (const i of mid) if (P[i * 3 + 2] > eyeZ - band * 0.35) chin = Math.min(chin, P[i * 3 + 1]); chinSource = "lowest front skin (mesh ends)"; }
    const earHalf = (exR - exL) / 2, ratio = (eyeY - chin) / Math.max(1e-6, earHalf);
    if ((step !== null && step <= flare) || chin > 8 || !(ratio >= 0.7 && ratio <= 2.0)) { chin = eyeY - 1.15 * earHalf; chinSource = "canonical fallback (LOW CONFIDENCE)"; } }
  const prof = (y0, y1) => { const bins = new Map(); for (const i of mid) { const y = P[i * 3 + 1]; if (y < y0 || y > y1) continue; const b = Math.round(y / (band * 0.02)); bins.set(b, Math.max(bins.get(b) ?? -9, P[i * 3 + 2])); } return [...bins.entries()].map(([b, z]) => [b * band * 0.02, z]).sort((a, b) => a[0] - b[0]); };
  const pf = prof(chin, eyeY); let nose = pf[0]; for (const p of pf) if (p[1] > nose[1]) nose = p;
  const below = pf.filter(([y]) => y < nose[0] - band * 0.08 && y > chin + band * 0.06); let mouth = below[0] ?? nose; for (const p of below) if (p[1] < mouth[1]) mouth = p;
  // the lips' front: the most forward point just above / below the mouth notch
  let lip = -9; for (const [y, z] of pf) if (Math.abs(y - mouth[0]) < band * 0.08) lip = Math.max(lip, z);
  // face width profile (front skin) at fixed fractions of chin→eye
  const widthAt = (f) => { const y = chin + f * (eyeY - chin); let a = 9, b = -9; for (let i = 0; i < n; i++) { if (!sel(i) || Math.abs(P[i * 3 + 1] - y) > band * 0.01 || P[i * 3 + 2] < earZ + band * 0.2 || !isSkin(i)) continue; a = Math.min(a, P[i * 3]); b = Math.max(b, P[i * 3]); } return b - a; };
  // eye socket depth: eye-centre surface vs the skin ring around it
  const sock = (e) => { let ring = 0, rn = 0; for (let i = 0; i < n; i++) { if (!sel(i)) continue; const d = Math.hypot(P[i * 3] - e.c[0], P[i * 3 + 1] - e.c[1]); if (d > e.halfW * 1.3 && d < e.halfW * 1.7 && P[i * 3 + 2] > e.c[2] - band * 0.3) { ring += P[i * 3 + 2]; rn++; } } return ring / Math.max(1, rn) - e.c[2]; };
  return {
    eyes: { l: eL, r: eR, y: eyeY, z: eyeZ, cx, sep: band }, ears: { l: exL, r: exR, half: (exR - exL) / 2, z: earZ },
    chin, nose: { y: nose[0], z: nose[1] }, mouth: { y: mouth[0], z: mouth[1], lipZ: lip },
    faceLength: eyeY - chin, projection: nose[1] - earZ, lipProjection: lip - earZ,
    jawWidth: widthAt(0.25), cheekWidth: widthAt(0.6), socketDepth: (sock(eL) + sock(eR)) / 2,
    eyeHalfW: (eL.halfW + eR.halfW) / 2, eyeHalfH: (eL.halfH + eR.halfH) / 2, eyeSource, eyeMirrored, chinSource, midX,
  };
}
/** ratios to the skull (ear half-width): what the style rules compare */
export const ratios = (m) => ({ faceLength: m.faceLength / m.ears.half, projection: m.projection / m.ears.half, eyeW: m.eyeHalfW / m.ears.half, jaw: m.jawWidth / m.ears.half, cheek: m.cheekWidth / m.ears.half, lip: m.lipProjection / m.ears.half });

// ================================ 3. THE TRANSFORM ====================================================================
export async function chibify(rawFile, { id, alpha = 0.35, rules = CHIBI_RULES, remeasureCanon = false, hairLength = "natural", hairMotion = null, depthK = 1, depthInfo = null }) {
  const base = await loadBase();
  // ---- canonical targets, measured on production Alex (head vertices only) ----
  const alexH = remeasureCanon ? await readTexturedHead("public/avatars/alex-v2-hq-idle9/alex-v2-lod0.glb") : null;
  const HJ = new Set(["Head", "head_end", "headfront"].map((x) => C.HUMAN_CORE_JOINTS.indexOf(x)));
  const alexSel = (i) => { let w = 0; for (let k = 0; k < 4; k++) if (HJ.has(alexH.J[i * 4 + k])) w += alexH.W[i * 4 + k]; return w > 0.5 || alexH.P[i * 3 + 1] > 0.9; };
  // the canonical envelope is LOCKED data (canonical-profile.json, measured from Alex with this same code and approved);
  // pass remeasureCanon to re-derive it — then re-approve the profile
  let canon, cr;
  if (remeasureCanon) { canon = measureHead(alexH, alexSel); cr = ratios(canon); }
  else { const pr = JSON.parse(fs.readFileSync(new URL("./canonical-profile.json", import.meta.url), "utf8")); canon = { chin: pr.chin, ears: pr.ears, eyes: pr.eyes, eyeHalfW: pr.eyeHalfW, socketDepth: null, eyeHalfH: null }; cr = pr.ratios; }

  // ---- source ----
  const h = await readTexturedHead(rawFile);
  const { P, COL, n } = h, col = (i) => [COL[i * 3], COL[i * 3 + 1], COL[i * 3 + 2]];
  const { nb, rep } = adjacency(P, h.I);                                   // topology: unchanged by the uniform fit
  h.cls = classifyHead(h, () => true, nb);
  const isSkin = (i) => h.cls.label[i] === LABEL.SKIN, isHair = (i) => h.cls.label[i] === LABEL.HAIR;
  const src0 = measureHead(h);
  // (a) uniform skull fit: ears → canonical skull width; chin → canonical chin; centred on the eyes; ears → canon depth
  const S = canon.ears.half / src0.ears.half, T = [-src0.eyes.cx * S, canon.chin - src0.chin * S, canon.ears.z - src0.ears.z * S];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) P[i * 3 + k] = P[i * 3 + k] * S + T[k];
  // (a') CANONICAL DEPTH: the head's depth (eye plane ↔ ear plane) is held inside the canonical envelope band — a scale
  // of the face side about the canonical ear plane, decided by the CLI from a first pass (depthK = 1 when already inside the band)
  if (depthK !== 1) for (let i = 0; i < n; i++) if (P[i * 3 + 2] > canon.ears.z) P[i * 3 + 2] = canon.ears.z + (P[i * 3 + 2] - canon.ears.z) * depthK;   // the FACE side only: the cranium behind the ear plane keeps its volume
  const src = measureHead(h), sr = ratios(src);
  const target = (k) => (cr[k] + alpha * (sr[k] - cr[k])) * src.ears.half;   // identity-retaining target, skull units

  // ---- face region (automatic): front skin, ahead of the ears, below the hairline; feathered over the mesh ----
  const sep = src.eyes.sep, face0 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (!isSkin(i) && !h.cls.sclera[i] && lum(col(i)) < 140) continue;      // hair (and brows/iris stay put)
    if (z < src.ears.z + sep * 0.25 || y < src.chin - sep * 0.05) continue;
    if (Math.abs(x - src.eyes.cx) > src.ears.half * 0.86) continue;                  // ears
    face0[i] = 1;
  }
  // feather the mask (12 rounds of neighbour averaging), so every operation fades out smoothly
  let w = face0; for (let it = 0; it < 12; it++) { const nx = new Float32Array(n); for (let i = 0; i < n; i++) { const r = rep[i]; if (r !== i) continue; let s = w[i], c = 1; for (const j of nb[i]) { s += w[j]; c++; } nx[i] = s / c; } for (let i = 0; i < n; i++) nx[i] = nx[rep[i]]; w = nx; }

  // (b) identity-preserving multi-band simplification: P = L2 + (L1 − L2) + (P − L1); keep large, damp mid, crush fine
  const free = new Uint8Array(n).map((_, i) => (w[i] > 0.02 ? 1 : 0));
  const L1 = Float32Array.from(P); taubin(L1, nb, rep, free, rules.bands.fineIter, 0.5, -0.505);
  const L2 = Float32Array.from(L1); taubin(L2, nb, rep, free, rules.bands.midIter, 0.5, -0.505);
  for (let i = 0; i < n; i++) { if (!free[i]) continue; for (let k = 0; k < 3; k++) { const q = i * 3 + k, simple = L2[q] + rules.bands.keepMid * (L1[q] - L2[q]) + rules.bands.keepFine * (P[q] - L1[q]); P[q] += (simple - P[q]) * w[i]; } }

  // (c) eyes: bounded enlargement about each measured eye centre (shape kept — the painted eye scales with its lids).
  // A vertex slid sideways over a curved face would sink or float, so each one keeps its OWN offset from the smooth
  // underlying face (the low band L2, rasterised as a front height field) and is re-seated on that face where it lands.
  const eyeTarget = target("eyeW"), eScale = Math.min(rules.eyeScaleMax, Math.max(1, eyeTarget / src.eyeHalfW));
  const HF = { x0: src.eyes.cx - src.ears.half, y0: src.chin, s: 0.002 }; HF.nx = Math.ceil(2 * src.ears.half / HF.s); HF.ny = Math.ceil((src.eyes.y + sep * 0.8 - src.chin) / HF.s);
  const hz = new Float32Array(HF.nx * HF.ny).fill(-9);
  for (let t = 0; t < h.I.length; t += 3) { const q = [h.I[t], h.I[t + 1], h.I[t + 2]].map((v) => [(L2[v * 3] - HF.x0) / HF.s, (L2[v * 3 + 1] - HF.y0) / HF.s, L2[v * 3 + 2]]);
    if (q.some((p) => p[2] < src.ears.z + sep * 0.2)) continue;
    const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (ar <= 0) continue;   // front-facing only
    for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(HF.ny - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
      for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(HF.nx - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
        const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue; const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], kk = y * HF.nx + x; if (z > hz[kk]) hz[kk] = z; } }
  const baseZ = (x, y) => { const fx = Math.min(HF.nx - 1.001, Math.max(0, (x - HF.x0) / HF.s)), fy = Math.min(HF.ny - 1.001, Math.max(0, (y - HF.y0) / HF.s)), x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0, g = (i, j) => hz[j * HF.nx + i];
    const v = [g(x0, y0), g(x0 + 1, y0), g(x0, y0 + 1), g(x0 + 1, y0 + 1)]; if (v.some((z) => z < -8)) return null; return (v[0] * (1 - tx) + v[1] * tx) * (1 - ty) + (v[2] * (1 - tx) + v[3] * tx) * ty; };
  for (const e of [src.eyes.l, src.eyes.r]) {
    const R = e.halfW * 1.2, R2 = e.halfW * 2.0, cxe = e.c[0], cye = e.c[1];
    for (let i = 0; i < n; i++) { if (P[i * 3 + 2] < src.ears.z + sep * 0.25) continue; const dx = P[i * 3] - cxe, dy = P[i * 3 + 1] - cye, d = Math.hypot(dx, dy * (dy > 0 ? 2.0 : 1.4)); if (d >= R2) continue;   // tight above (the brows stay), softer below   // everything on the eye (lids, lashes, iris, brows' edge)
      const f = d <= R ? 1 : 1 - (d - R) / (R2 - R), s = 1 + (eScale - 1) * f * f * (3 - 2 * f);
      const nx = cxe + dx * s, ny = cye + dy * s, b0 = baseZ(P[i * 3], P[i * 3 + 1]), b1 = baseZ(nx, ny);
      if (b0 !== null && b1 !== null) P[i * 3 + 2] = b1 + (P[i * 3 + 2] - b0);
      P[i * 3] = nx; P[i * 3 + 1] = ny; }
  }

  // (d) facial projection toward canonical: front of the face compressed toward the ear plane (smooth, whole head)
  const projT = target("projection"), pScale = Math.min(1, projT / src.projection), z0 = src.ears.z + sep * 0.35;
  for (let i = 0; i < n; i++) { const z = P[i * 3 + 2]; if (z <= z0) continue; const t = Math.min(1, (z - z0) / (sep * 0.25)), sm = t * t * (3 - 2 * t); P[i * 3 + 2] = z0 + (z - z0) * (1 + (pScale - 1) * sm); }

  // (e) shorter lower face: chin→eye compressed about the chin; above the eyes the head stretches back to its own top
  // the identity-retained face length may not push the eye line past the HEAD CONTRACT (HEAD_ENVELOPE.eyeY max) — the
  // cap is the contract maximum less the eye-centre drift the eye enlargement adds (≈0.007–0.012, measured on the
  // approved heads); it only binds unusually long-faced sources (the approved heads' targets all sit below it)
  let hairlineInfo = null;
  const flT = Math.min(target("faceLength"), C.HEAD_ENVELOPE.eyeY[1] - rules.eyeLineMargin - src.chin) || target("faceLength"), k = Math.min(1, flT / src.faceLength), eyeY2 = src.chin + src.faceLength * k;
  let top = -9; for (let i = 0; i < n; i++) top = Math.max(top, P[i * 3 + 1]);
  // ABOVE THE EYES: ruleset v2 stretched the forehead so the head top stayed put (a taller forehead the more the face
  // was shortened); ruleset v3 moves the upper head down RIGIDLY with the eye line — the person's own forehead and
  // cranium proportions are kept, the head simply becomes more compact
  const m = rules.upperHead === "stretch" ? (top - eyeY2) / (top - src.eyes.y) : 1;
  // FOREHEAD (hairline relationship, measured BEFORE the mapping): per forehead column the highest front-facing skin
  // (the hairline) and whether hair hangs IN FRONT of the forehead below it (a fringe — then the fringe, not the hairline,
  // is where the hair visibly starts)
  const foreheadCols = () => { const half = sep / 2, out = []; for (let c = -5; c <= 5; c++) { const x0 = src.eyes.cx + (c / 5) * 0.8 * half; let top2 = -9, skinZ = new Map();
      for (let i = 0; i < n; i++) { if (Math.abs(P[i * 3] - x0) > half * 0.05 || P[i * 3 + 1] < src.eyes.y + sep * 0.1 || h.N[i * 3 + 2] < 0.2) continue; if (isSkin(i)) { top2 = Math.max(top2, P[i * 3 + 1]); const b = Math.round(P[i * 3 + 1] / 0.01); skinZ.set(b, Math.max(skinZ.get(b) ?? -9, P[i * 3 + 2])); } }
      let fr = 9; for (let i = 0; i < n; i++) { if (Math.abs(P[i * 3] - x0) > half * 0.05 || !isHair(i) || h.N[i * 3 + 2] < 0.2) continue; const y = P[i * 3 + 1], sz = skinZ.get(Math.round(y / 0.01)); if (y < top2 - sep * 0.08 && sz !== undefined && P[i * 3 + 2] > sz + 0.005) fr = Math.min(fr, y); }
      out.push({ top: top2, fringe: fr < 8 }); } return out; };
  const fhCols = rules.hairline === "preserve" ? foreheadCols() : null;
  for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (y <= src.chin) continue; P[i * 3 + 1] = y < src.eyes.y ? src.chin + (y - src.chin) * k : eyeY2 + (y - src.eyes.y) * m; }
  // HAIRLINE PRESERVATION (universal): the face was shortened by k but the forehead kept its height (v3) or grew (v2) —
  // the exposed forehead then reads taller than the generated one. The forehead (above a rigid brow band) is compressed
  // so hairline-above-eyes : chin-to-eyes matches the generated head again, the cranium above stretches so the head top
  // never moves; front of the head only (fading out toward the ears); weighted by how much forehead is EXPOSED (columns
  // under a fringe are already right: the fringe sets where the hair visibly starts)
  if (fhCols) { const open2 = fhCols.filter((c) => c.top > -8 && !c.fringe), cov = 1 - open2.length / fhCols.length, wHead = (() => { const t = Math.max(0, Math.min(1, (0.7 - cov) / 0.3)); return t * t * (3 - 2 * t); })();   // fringe-covered (≥70%) → 0 · open (≤40%) → 1
    const tops = open2.map((c) => c.top).sort((a, b) => a - b), H0raw = tops.length ? tops[tops.length >> 1] : null;
    if (H0raw !== null && wHead > 0) { const H0 = eyeY2 + (H0raw - src.eyes.y) * m, Bb = eyeY2 + 0.35 * (H0 - eyeY2), Ht = Math.max(Bb + 0.25 * (H0 - Bb), eyeY2 + (H0raw - src.eyes.y) * k);
      const sm2 = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
      // the brow band (eye line → 35% of the forehead) is FIXED; above it a continuous monotone map: [Bb, H0] → [Bb, Ht],
      // [H0, top] → [Ht, top] (no fold, top unchanged)
      for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (y <= Bb || y >= top) continue; const w = wHead * sm2(src.ears.z - 0.05, src.ears.z + 0.2, P[i * 3 + 2]); if (w <= 0) continue;
        const yB = y < H0 ? Bb + (y - Bb) * (Ht - Bb) / (H0 - Bb) : Ht + (y - H0) * (top - Ht) / (top - H0); P[i * 3 + 1] = y + w * (yB - y); }
      hairlineInfo = { fringeCoverage: +cov.toFixed(2), weight: +wHead.toFixed(2), hairlineAboveEyes: { before: +(H0 - eyeY2).toFixed(3), after: +(Ht - eyeY2).toFixed(3) } }; }
    else hairlineInfo = { fringeCoverage: +cov.toFixed(2), note: "fringe covers the forehead — unchanged" };
    console.log(`hairline: ${JSON.stringify(hairlineInfo)}`); }

  // (f) HEAD-ONLY + MOUNT: HumanBase owns the neck. The generated neck/bust/stand are cut at the canonical attachment
  // line (Alex's chin height, measured); the short collar left under the jaw tapers to sit just OUTSIDE the base neck
  // there and laps over it by a hidden skirt — no gap, no double neck, nothing poking through the jaw.
  const smf = (lo, hi, x) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
  const A = rules.attach, attachY = canon.chin + A.belowChin, cutY = attachY - A.skirt;
  const ell = (Pa, ok, y0, y1) => { let x0 = 9, x1 = -9, z0b = 9, z1 = -9; for (let i = 0; i < Pa.length / 3; i++) { if (!ok(i) || Pa[i * 3 + 1] < y0 || Pa[i * 3 + 1] > y1) continue; x0 = Math.min(x0, Pa[i * 3]); x1 = Math.max(x1, Pa[i * 3]); z0b = Math.min(z0b, Pa[i * 3 + 2]); z1 = Math.max(z1, Pa[i * 3 + 2]); } return { hx: (x1 - x0) / 2, hz: (z1 - z0b) / 2, cx: (x0 + x1) / 2, cz: (z0b + z1) / 2 }; };
  const baseNeck = ell(base.geo.P, (i) => Math.round(base.geo.REG[i]) === C.BODY_REGIONS.NECK, attachY - 0.03, attachY + 0.01);
  // the generated neck column: skin below the jaw, measured at the attachment line
  // the generated neck column, measured where it is pure neck (below the chin, before the cut); a vertex belongs to the
  // column when it lies inside that ellipse (×1.25) — the chin and jaw front lie outside it and are never touched
  const skinNeck = ell(P, (i) => isSkin(i), attachY - 0.08, attachY - 0.04);
  let skinCount = 0; for (let i = 0; i < n; i++) if (isSkin(i) && P[i * 3 + 1] > attachY - 0.08 && P[i * 3 + 1] < attachY - 0.04) skinCount++;
  // GEOMETRIC NECK (colour-free): around the head's vertical axis, in 24 sectors, the neck is the INNERMOST
  // outward-facing surface (long hair, a beard's outer edge, collars lie further out); two refinement passes re-centre
  const geomNeck = (() => { let c = [src.eyes.cx, (src.ears.z + src.eyes.z) / 2 - sep * 0.15]; let e = null;
    for (let pass = 0; pass < 3; pass++) { const r = new Float32Array(24).fill(9);
      for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (y < attachY - 0.08 || y > attachY - 0.04) continue; const dx = P[i * 3] - c[0], dz = P[i * 3 + 2] - c[1], d = Math.hypot(dx, dz); if (d < 1e-4) continue;
        if ((h.N[i * 3] * dx + h.N[i * 3 + 2] * dz) / d < 0.2) continue; const s = Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * 24) % 24; r[s] = Math.min(r[s], d); }
      const at = (deg) => r[Math.floor((((deg + 180) % 360) / 360) * 24) % 24];
      const xp = at(0), xm = at(180), zp = at(90), zm = at(270); if ([xp, xm, zp, zm].some((v) => v > 8)) return null;
      e = { hx: (xp + xm) / 2, hz: (zp + zm) / 2, cx: c[0] + (xp - xm) / 2, cz: c[1] + (zp - zm) / 2 }; c = [e.cx, e.cz]; }
    return e; })();
  const agree = geomNeck && Math.abs(skinNeck.hx / geomNeck.hx - 1) < 0.15 && Math.abs(skinNeck.hz / geomNeck.hz - 1) < 0.15;
  let own = skinCount >= 300 && (agree || !geomNeck) ? skinNeck : geomNeck ?? skinNeck, neckSource = own === skinNeck ? "skin" : "geometry";
  // GEOMETRY-FIRST FALLBACK: a generated neck that cannot be measured (none visible, covered, or a bare skin bust that
  // merges into the shoulders) or is physically implausible (half-width outside 0.2–0.8 skull half-widths, or centred
  // off the head) is replaced by the canonical HumanBase neck ellipse (×1.3, a generated neck's typical girth) —
  // removal then works from the canonical attachment boundary regardless of colour
  const plausible = (e) => e && [e.hx, e.hz, e.cx, e.cz].every(Number.isFinite) && e.hx > 0.2 * src.ears.half && e.hx < 0.8 * src.ears.half && e.hz > 0.1 * src.ears.half && e.hz < 0.8 * src.ears.half && Math.abs(e.cx - src.eyes.cx) < 0.3 * src.ears.half;
  const measuredNeck = own; if (!plausible(own)) { own = { hx: baseNeck.hx * 1.3, hz: baseNeck.hz * 1.3, cx: src.eyes.cx, cz: baseNeck.cz }; neckSource = "canonical fallback"; }
  // HEAD-ONLY: the generated NECK WALL is removed, not tapered. A vertex is neck wall when it lies on the measured
  // neck column (ellipse ≤ wallMargin), faces sideways (|normal.y| < wallNormalY — the jaw underside and the skull
  // base face down and are kept, the chin lies in front of the column and is kept) and sits below the head base
  // (headTopFrac of the way from chin to eye line). Below the attachment line everything that is not hanging hair goes.
  const ed = (i) => Math.hypot((P[i * 3] - own.cx) / own.hx, (P[i * 3 + 2] - own.cz) / own.hz);
  const eyeNow = src.chin + (eyeY2 - src.chin), headTop = src.chin + A.headTopFrac * (eyeNow - src.chin);
  // the wall score is smoothed over the surface (4 neighbour rounds) before thresholding, so the rim is a clean line
  let ws = new Float32Array(n).map((_, i) => (P[i * 3 + 1] < headTop && ed(i) <= A.wallMargin && Math.abs(h.N[i * 3 + 1]) < A.wallNormalY ? 1 : 0));
  for (let it = 0; it < 4; it++) { const nx = new Float32Array(n); for (let i = 0; i < n; i++) { const r = rep[i]; if (r !== i) continue; let s2 = ws[i], c = 1; for (const j of nb[i]) { s2 += ws[j]; c++; } nx[i] = s2 / c; } for (let i = 0; i < n; i++) nx[i] = nx[rep[i]]; ws = nx; }
  // SKULL BASE (automatic): around the neck axis, in 36 sectors, walk up the INNERMOST outward-facing surface (any
  // label — scalp under hair counts); the head begins where it flares off the neck (> skullFlare × the neck's radius in
  // that direction). Front: the jaw/throat junction. Back: the base of the skull. Everything near the column below that
  // line (neck, nape, throat, collar) is deleted; the chin and jaw lie far outside the column and are untouched.
  const SEC = 36, DY = 0.01, Y0 = cutY - 0.05, NB = Math.ceil((headTop + 0.25 - Y0) / DY);
  const secOf = (i) => Math.floor(((Math.atan2(P[i * 3 + 2] - own.cz, P[i * 3] - own.cx) + Math.PI) / (2 * Math.PI)) * SEC) % SEC;
  const rad = (i) => Math.hypot(P[i * 3] - own.cx, P[i * 3 + 2] - own.cz);
  const neckR = (sx) => { const th = ((sx + 0.5) / SEC) * 2 * Math.PI - Math.PI; return 1 / Math.hypot(Math.cos(th) / own.hx, Math.sin(th) / own.hz); };
  const rIn = new Float32Array(SEC * NB).fill(9);
  for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (y < Y0) continue; const b = Math.floor((y - Y0) / DY); if (b >= NB) continue; const r = rad(i); if (r < 1e-4) continue;
    if ((h.N[i * 3] * (P[i * 3] - own.cx) + h.N[i * 3 + 2] * (P[i * 3 + 2] - own.cz)) / r < 0.2) continue; const k = secOf(i) * NB + b; if (r < rIn[k]) rIn[k] = r; }
  let skullBase = new Float32Array(SEC);
  for (let sx = 0; sx < SEC; sx++) { let y = headTop; for (let b = 0; b < NB - 1; b++) { const t = neckR(sx) * A.skullFlare, a1 = rIn[sx * NB + b], a2 = rIn[sx * NB + b + 1]; if (a1 < 8 && a2 < 8 && a1 > t && a2 > t) { y = Y0 + b * DY; break; } } skullBase[sx] = Math.min(y, headTop); }
  { const m = skullBase.slice(); for (let sx = 0; sx < SEC; sx++) { const w5 = [-2, -1, 0, 1, 2].map((d) => m[(sx + d + SEC) % SEC]).sort((a2, b2) => a2 - b2); skullBase[sx] = w5[2]; } }
  // the canonical attachment plane: the head always reaches down to the HumanBase neck top (where Alex's own head
  // began, measured from the base's NECK region) minus a hidden overlap — the base neck ends INSIDE the closed head
  let neckTop = -9; for (let i = 0; i < base.geo.REG.length; i++) if (Math.round(base.geo.REG[i]) === C.BODY_REGIONS.NECK) neckTop = Math.max(neckTop, base.geo.P[i * 3 + 1]);
  for (let sx = 0; sx < SEC; sx++) skullBase[sx] = Math.min(skullBase[sx], neckTop - A.neckOverlap);
  const nearNeck = (i) => rad(i) <= neckR(secOf(i)) * A.skullFlare;
  // CANONICAL ANATOMY (Alex): the approved neutral Alex head defines where every employee's head ends. Its UNDERSIDE
  // (jaw underside, skull base, the neck opening that exactly fits the HumanBase neck) is rasterised as a height field
  // under(x, z); generated SKIN below it is not head — it is discarded. Hair is not anatomy and may hang below.
  const alexDoc = await io.read(`${BASE_OUT}/identity/alex-neutral-head-v1.glb`), alexPrim = alexDoc.getRoot().listMeshes()[0].listPrimitives()[0];
  const AP = alexPrim.getAttribute("POSITION").getArray(), AI = alexPrim.getIndices().getArray(), AJ = alexPrim.getAttribute("JOINTS_0").getArray(), AW = alexPrim.getAttribute("WEIGHTS_0").getArray();
  const AN = computeNormals(Float32Array.from(AP), AI);
  const UG = { x0: -0.7, z0: -0.8, c: 0.005 }; UG.nx = Math.ceil(1.4 / UG.c); UG.nz = Math.ceil(1.6 / UG.c);
  const ug = new Float32Array(UG.nx * UG.nz).fill(9);
  for (let t = 0; t < AI.length; t += 3) { const v = [AI[t], AI[t + 1], AI[t + 2]]; if ((AN[v[0] * 3 + 1] + AN[v[1] * 3 + 1] + AN[v[2] * 3 + 1]) / 3 > -0.3) continue;   // truly downward-facing (jaw underside, skull base) — not the face's lower slopes
    const q = v.map((k) => [(AP[k * 3] - UG.x0) / UG.c, (AP[k * 3 + 2] - UG.z0) / UG.c, AP[k * 3 + 1]]);
    const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-9) continue;
    for (let zz = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); zz <= Math.min(UG.nz - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); zz++)
      for (let xx = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); xx <= Math.min(UG.nx - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); xx++) {
        const w0 = ((q[1][0] - xx) * (q[2][1] - zz) - (q[2][0] - xx) * (q[1][1] - zz)) / ar, w1 = ((q[2][0] - xx) * (q[0][1] - zz) - (q[0][0] - xx) * (q[2][1] - zz)) / ar, w2 = 1 - w0 - w1;
        if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue; const y = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], k = zz * UG.nx + xx; if (y < ug[k]) ug[k] = y; } }
  // only the NECK OPENING (inside the neck column) is filled from its rim; outside Alex's underside nothing is cut
  const inOpening = (xx, zz) => { const x = UG.x0 + xx * UG.c, z = UG.z0 + zz * UG.c; return ((x - baseNeck.cx) / baseNeck.hx) ** 2 + ((z - baseNeck.cz) / baseNeck.hz) ** 2 < 1.6 * 1.6; };
  for (let it = 0; it < 200; it++) { let changed = 0; const nx2 = ug.slice(); for (let zz = 0; zz < UG.nz; zz++) for (let xx = 0; xx < UG.nx; xx++) { const k = zz * UG.nx + xx; if (ug[k] < 8 || !inOpening(xx, zz)) continue; let sum = 0, c = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x2 = xx + dx, z2 = zz + dz; if (x2 < 0 || z2 < 0 || x2 >= UG.nx || z2 >= UG.nz) continue; const v2 = ug[z2 * UG.nx + x2]; if (v2 < 8) { sum += v2; c++; } }
      if (c) { nx2[k] = sum / c; changed++; } } ug.set(nx2); if (!changed) break; }
  const under = (x, z) => { const xx = Math.min(UG.nx - 1, Math.max(0, Math.round((x - UG.x0) / UG.c))), zz = Math.min(UG.nz - 1, Math.max(0, Math.round((z - UG.z0) / UG.c))); const v = ug[zz * UG.nx + xx]; return v > 8 ? -9 : v; };
  let wall = 0, longHair = 0, bust = 0, nape = 0, faceTrim = 0;
  // ---- GENERATED BODY / CLOTHING vs HANGING HAIR (universal) ----
  // (1) a CLOTHING colour is learned from the generated bust base; where it differs from the hair colour, hair-labelled
  //     vertices of that colour below the chin are clothing. (2) Where colour cannot decide (dark shirt + dark hair),
  //     GEOMETRY does: the generated SHOULDER LINE (first height below the chin where the mesh widens beyond
  //     shoulderFlare × skull half-width) — below it is body, never hair. (3) Hanging hair must be connected to the head.
  let yLo = 9, yHi = -9; for (let i = 0; i < n; i++) { yLo = Math.min(yLo, P[i * 3 + 1]); yHi = Math.max(yHi, P[i * 3 + 1]); }
  const baseIds = []; for (let i = 0; i < n; i++) if (P[i * 3 + 1] < yLo + rules.body.bustBase * (yHi - yLo)) baseIds.push(i);
  const LABv = (i) => lab(COL[i * 3], COL[i * 3 + 1], COL[i * 3 + 2]);
  const clothC = [0, 1, 2].map((q) => { const v = baseIds.map((i) => LABv(i)[q]).sort((a2, b2) => a2 - b2); return v[v.length >> 1] ?? 0; });
  const clothDistinct = h.cls.hairC && dEw(clothC, h.cls.hairC) > h.cls.Th;
  let clothing = 0; if (clothDistinct) for (let i = 0; i < n; i++) if (isHair(i) && P[i * 3 + 1] < src.chin) { const c = LABv(i); if (dEw(c, clothC) < dEw(c, h.cls.hairC)) { h.cls.label[i] = LABEL.OTHER; clothing++; } }
  let shoulderY = -9; { const slice = new Map(); for (let i = 0; i < n; i++) { const y = P[i * 3 + 1]; if (y > src.chin) continue; const b = Math.floor(y / 0.01); slice.set(b, Math.max(slice.get(b) ?? 0, Math.abs(P[i * 3] - src.eyes.cx))); }
    for (let b = Math.floor(src.chin / 0.01); b > Math.floor(yLo / 0.01); b--) if ((slice.get(b) ?? 0) > rules.body.shoulderFlare * src.ears.half) { shoulderY = (b + 1) * 0.01; break; } }
  // no generated shoulder line (no bust, or a bust that never flares): the canonical HumanBase shoulder height
  if (shoulderY < -8) shoulderY = base.rest.LeftShoulder.y;
  const keep = new Uint8Array(n).map((_, i) => { const y = P[i * 3 + 1];
    const u = under(P[i * 3], P[i * 3 + 2]);
    // the face (chin, jaw front, cheeks) lies AHEAD of the neck column and outside its footprint: it is never cut —
    // the canonical underside governs the neck opening and everything behind the neck centre (nape, skull base)
    const governed = ed(i) <= 1.6 || P[i * 3 + 2] < own.cz;
    if (governed && !isHair(i) && y < u - A.underTol) { if (P[i * 3 + 2] > src.eyes.z - sep * 0.5) faceTrim++; else nape++; return 0; }   // generated anatomy below the Alex head
    if (isHair(i) && y < u && ed(i) <= A.keepHairOutside) { nape++; return 0; }   // hair painted ON the removed nape, not hanging hair
    if (y > cutY) return 1;
    // below the generated shoulder line, hair is only trusted when the generated body/clothing colour differs from the
    // hair colour (then colour separates them); when they match (a dark shirt under dark hair), the shoulder line ends it
    if (isHair(i) && ed(i) > A.keepHairOutside && (y > shoulderY || (clothDistinct && y > cutY - 0.6))) { longHair++; return 1; }
    bust++; return 0; });
  // connectivity: kept geometry must reach the head (anything above the attachment line) through kept vertices
  let detached = 0; { const reach = new Uint8Array(n), st = []; for (let i = 0; i < n; i++) if (keep[i] && rep[i] === i && P[i * 3 + 1] > attachY) { reach[i] = 1; st.push(i); }
    while (st.length) { const v = st.pop(); for (const w2 of nb[v]) if (!reach[w2] && keep[w2]) { reach[w2] = 1; st.push(w2); } }
    for (let i = 0; i < n; i++) if (keep[i] && !reach[rep[i]]) { keep[i] = 0; detached++; } }
  // HAIR LENGTH + CLEARANCE (per-avatar preset; "natural" = no-op): hanging hair below the chin is compressed so its
  // lowest point sits at the preset height, then pushed outside the HumanBase body envelope
  const hairTarget = rules.hairLengths[hairLength] ?? null; let hairK = 1, hairPushed = 0, hairLowBefore = 9;
  for (let i = 0; i < n; i++) if (keep[i] && isHair(i)) hairLowBefore = Math.min(hairLowBefore, P[i * 3 + 1]);
  const top0 = canon.chin;
  const sm = (a2, b2, x) => { const t = Math.min(1, Math.max(0, (x - a2) / (b2 - a2))); return t * t * (3 - 2 * t); };
  // HAIR TERMINATION (with a length preset): the body/shoulder removal only says how much hair is AVAILABLE per
  // direction; the haircut is then shaped: the hanging hair is compressed per azimuth so its end follows a soft U
  // (longest at the back, rising toward the face by uDepth), and the last quarter of each strand curls gently in.
  if (hairTarget !== null && hairLowBefore < top0) {
    const SECH = 24, acx = src.eyes.cx, acz = src.ears.z, azOf2 = (i) => Math.atan2(P[i * 3] - acx, P[i * 3 + 2] - acz);
    const avail = new Float32Array(SECH).fill(9), sOf = (a) => (((a + Math.PI) / (2 * Math.PI)) * SECH) % SECH;
    for (let i = 0; i < n; i++) if (keep[i] && isHair(i) && P[i * 3 + 1] < top0) { const s2 = Math.floor(sOf(azOf2(i))); avail[s2] = Math.min(avail[s2], P[i * 3 + 1]); }
    for (let s2 = 0; s2 < SECH; s2++) if (avail[s2] > 8) avail[s2] = top0;
    const at = (arr, a) => { const f = sOf(a) - 0.5, i0 = ((Math.floor(f) % SECH) + SECH) % SECH, i1 = (i0 + 1) % SECH, u = f - Math.floor(f); return arr[i0] * (1 - u) + arr[i1] * u; };
    // the U is anchored at the back's end: the preset length, or the available hair if that is shorter
    let backAv = 9; for (let s2 = 0; s2 < SECH; s2++) { const a2 = ((s2 + 0.5) / SECH) * 2 * Math.PI - Math.PI; if (Math.cos(a2) < -0.7) backAv = Math.min(backAv, avail[s2]); }
    const base0 = Math.max(hairTarget, backAv);
    const endFor = (a) => { const front = (1 + Math.cos(a)) / 2, av = at(avail, a); return Math.min(av + (top0 - av) * 0.45, Math.max(av, base0 + rules.hairEnd.uDepth * front)); };   // never squash a strand below ~half its hanging length
    let kMin = 1;
    for (let i = 0; i < n; i++) { if (!keep[i] || !isHair(i) || P[i * 3 + 1] >= top0) continue; const a = azOf2(i), av = at(avail, a); if (top0 - av < 1e-4) continue;
      const e = endFor(a), k2 = Math.min(1, (top0 - e) / (top0 - av)); kMin = Math.min(kMin, k2);
      const y2 = top0 - (top0 - P[i * 3 + 1]) * k2, sEnd = (top0 - y2) / Math.max(1e-4, top0 - e);
      const curl = rules.hairEnd.curl * sm(0.7, 1, sEnd), r0 = Math.hypot(P[i * 3] - acx, P[i * 3 + 2] - acz);
      if (r0 > 1e-4) { const f = Math.max(0, 1 - curl / r0); P[i * 3] = acx + (P[i * 3] - acx) * f; P[i * 3 + 2] = acz + (P[i * 3 + 2] - acz) * f; }
      P[i * 3 + 1] = y2; }
    hairK = kMin; }

  if (hairLowBefore < top0) {   // CLEARANCE for any hanging hair (natural length included)
    // body envelope: per 1 cm slice and 36 sectors around the body axis, the base body's outer radius (+ clearance)
    const BP = base.geo.P, bz = base.rest.Spine02.z, SEC2 = 36, env = new Map();
    const coreReg = new Set([C.BODY_REGIONS.NECK, C.BODY_REGIONS.CHEST, C.BODY_REGIONS.BELLY]);   // the torso core — arms are posed, not envelope
    for (let i = 0; i < BP.length / 3; i++) { if (!coreReg.has(Math.round(base.geo.REG[i]))) continue; const y = BP[i * 3 + 1]; if (y > top0 || y < Math.min(hairLowBefore, hairTarget ?? 9) - 0.05) continue; const th = Math.atan2(BP[i * 3 + 2] - bz, BP[i * 3]), k2 = `${Math.floor(y / 0.01)}|${Math.floor(((th + Math.PI) / (2 * Math.PI)) * SEC2) % SEC2}`; env.set(k2, Math.max(env.get(k2) ?? 0, Math.hypot(BP[i * 3], BP[i * 3 + 2] - bz))); }
    for (let i = 0; i < n; i++) { if (!keep[i] || !isHair(i) || P[i * 3 + 1] >= top0) continue; const x = P[i * 3], z = P[i * 3 + 2] - bz, r = Math.hypot(x, z), th = Math.atan2(z, x);
      const need = (env.get(`${Math.floor(P[i * 3 + 1] / 0.01)}|${Math.floor(((th + Math.PI) / (2 * Math.PI)) * SEC2) % SEC2}`) ?? 0) + rules.hairClearance;
      if (r < need && r > 1e-4) { const f = need / r * (1 - 0.0) ; P[i * 3] = x * f; P[i * 3 + 2] = bz + z * f; hairPushed++; } }
  }
  const map = new Int32Array(n).fill(-1); let mm = 0; const I = [];
  for (let t = 0; t < h.I.length; t += 3) { const [p0, p1, p2] = [h.I[t], h.I[t + 1], h.I[t + 2]]; if (!keep[p0] || !keep[p1] || !keep[p2]) continue; for (const v of [p0, p1, p2]) { if (map[v] < 0) map[v] = mm++; I.push(map[v]); } }
  const OP = new Float32Array(mm * 3), OUV = new Float32Array(mm * 2), OJ = new Uint8Array(mm * 4), OW = new Float32Array(mm * 4);
  for (let v = 0; v < n; v++) { const q = map[v]; if (q < 0) continue; OP.set(P.subarray(v * 3, v * 3 + 3), q * 3); OUV.set(h.UV.subarray(v * 2, v * 2 + 2), q * 2); OJ.set([base.JI.Head, 0, 0, 0], q * 4); OW.set([1, 0, 0, 0], q * 4); }
  // HIDDEN SOCKET: the opening left under the jaw/skull is sealed by a skin cap (its own small part) the HumanBase
  // neck passes through — no collar, no neck anatomy; the cap's centre sits slightly INSIDE the head
  const socket = { P: [], I: [], C: [] }; let loopsCapped = 0, holesClosed = 0; const rimCols = [];
  // CLOSED UNDERSIDE: a loop is fanned to its centroid lifted `lift` up INTO the head (a shallow inverted dome);
  // every triangle faces down/out, so from below the head reads as a closed skin underside — nothing exterior
  const capLoop = (ord, lift) => { const c = [0, 1, 2].map((q) => ord.reduce((s2, v) => s2 + OP[v * 3 + q], 0) / ord.length);
    const o = socket.P.length / 3, K = ord.length; for (const v of ord) socket.P.push(OP[v * 3], OP[v * 3 + 1], OP[v * 3 + 2]); socket.P.push(c[0], c[1] + lift, c[2]);
    for (let k = 0; k < K; k++) { const a2 = o + k, b2 = o + (k + 1) % K, cI = o + K; const A3 = socket.P.slice(a2 * 3, a2 * 3 + 3), B3 = socket.P.slice(b2 * 3, b2 * 3 + 3), C3 = socket.P.slice(cI * 3, cI * 3 + 3);
      const e1 = [B3[0] - A3[0], B3[1] - A3[1], B3[2] - A3[2]], e2 = [C3[0] - A3[0], C3[1] - A3[1], C3[2] - A3[2]], ny = e1[2] * e2[0] - e1[0] * e2[2];
      socket.I.push(...(ny < 0 ? [a2, b2, cI] : [a2, cI, b2])); } };
  const inv = new Int32Array(mm); for (let v = 0; v < n; v++) if (map[v] >= 0) inv[map[v]] = v;
  { const kw = (i) => `${Math.round(OP[i * 3] * 2e4)},${Math.round(OP[i * 3 + 1] * 2e4)},${Math.round(OP[i * 3 + 2] * 2e4)}`;
    const wm = new Map(), wid = new Int32Array(mm); for (let i = 0; i < mm; i++) { const k = kw(i); if (!wm.has(k)) wm.set(k, i); wid[i] = wm.get(k); }
    const use = new Map(); const ek = (a2, b2) => (a2 < b2 ? a2 * mm + b2 : b2 * mm + a2);
    for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { const e = ek(wid[I[t + q]], wid[I[t + (q + 1) % 3]]); use.set(e, (use.get(e) ?? 0) + 1); }
    const adj = new Map(); for (const [e, c] of use) { if (c !== 1) continue; const a2 = Math.floor(e / mm), b2 = e % mm; (adj.get(a2) ?? adj.set(a2, []).get(a2)).push(b2); (adj.get(b2) ?? adj.set(b2, []).get(b2)).push(a2); }
    const seen = new Set(), R = Math.max(own.hx, own.hz) * 1.8, cands = [];
    for (const s0 of adj.keys()) { if (seen.has(s0)) continue; const comp = [], st = [s0]; seen.add(s0); while (st.length) { const v = st.pop(); comp.push(v); for (const w2 of adj.get(v)) if (!seen.has(w2)) { seen.add(w2); st.push(w2); } }
      if (comp.length < 12) continue; const c = [0, 1, 2].map((q) => comp.reduce((s2, v) => s2 + OP[v * 3 + q], 0) / comp.length);
      if (Math.hypot(c[0] - own.cx, c[2] - own.cz) > R || c[1] > headTop) continue;
      // the opening's span around the neck axis: the socket is the rim that ENCLOSES the neck (a hair edge does not)
      const bins = new Set(comp.map((v) => Math.floor(((Math.atan2(OP[v * 3 + 2] - own.cz, OP[v * 3] - own.cx) + Math.PI) / (2 * Math.PI)) * 36) % 36));
      cands.push({ comp, c, cover: bins.size }); }
    // small leftover openings of skin (not hair strand edges) near the underside: closed flat
    if (A.capLoops) for (const { comp, cover } of cands) { if (cover >= 30) continue; const skinFrac = comp.filter((v) => h.cls.label[inv[v]] !== LABEL.HAIR).length / comp.length; if (skinFrac < 0.6 || comp.length > 400) continue;
      const cc = [0, 2].map((q) => comp.reduce((s2, v) => s2 + OP[v * 3 + q], 0) / comp.length); capLoop(comp.slice().sort((p1, p2) => Math.atan2(OP[p1 * 3 + 2] - cc[1], OP[p1 * 3] - cc[0]) - Math.atan2(OP[p2 * 3 + 2] - cc[1], OP[p2 * 3] - cc[0])), 0); holesClosed++; }
    if (A.capLoops) for (const { comp, c, cover } of cands) { if (cover < 30) continue;   // encloses the neck axis (≥ 300°)
      // order the rim by angle about the neck axis, then build a FUNNEL: each rim point rises inward to the HumanBase
      // neck's own surface (measured at that height, just above the rim's highest point) — it hugs the neck, slopes up
      // into the head and stays out of sight; no floor, no collar
      const ord = comp.slice().sort((p1, p2) => Math.atan2(OP[p1 * 3 + 2] - own.cz, OP[p1 * 3] - own.cx) - Math.atan2(OP[p2 * 3 + 2] - own.cz, OP[p2 * 3] - own.cx));
      // the rim left by the cut is jagged (it follows triangles): relax it along the loop (all welded copies move together)
      { const grp = new Map(); for (let i = 0; i < mm; i++) { const g = grp.get(wid[i]); if (g) g.push(i); else grp.set(wid[i], [i]); }
        for (let it = 0; it < 10; it++) { const nx = ord.map((v, k) => { const pv = ord[(k - 1 + ord.length) % ord.length], nv = ord[(k + 1) % ord.length]; return [0, 1, 2].map((q) => 0.5 * OP[v * 3 + q] + 0.25 * (OP[pv * 3 + q] + OP[nv * 3 + q])); });
          ord.forEach((v, k) => { for (const c2 of grp.get(v) ?? [v]) OP.set(nx[k], c2 * 3); }); } }
      for (const v of ord) { const ov = inv[v]; if (h.cls.label[ov] === LABEL.SKIN) rimCols.push([COL[ov * 3], COL[ov * 3 + 1], COL[ov * 3 + 2]]); }
      capLoop(ord, A.socketLift);
      loopsCapped++; } }
  const mount = { attachY, cutY, headTop, baseNeck, generatedNeck: own, measuredNeck, neckSource, skinNeck, geomNeck, neckWallRemoved: wall, napeRemoved: nape, bodyVsHair: { clothC: clothC.map((v) => +v.toFixed(1)), clothDistinct, clothing, shoulderY: +shoulderY.toFixed(3), detached }, hair: { length: hairLength, target: hairTarget, lowestBefore: +hairLowBefore.toFixed(3), k: +hairK.toFixed(3), pushed: hairPushed }, faceTrim, canonicalUnderside: true, skullBase: { min: Math.min(...skullBase), max: Math.max(...skullBase) }, holesClosed, bustRemoved: bust, longHairKept: longHair, socketLoops: loopsCapped, socketTris: socket.I.length / 3 };
  // normals recomputed for the deformed surface (area-weighted, welded)
  const ON = weldNormals(OP, computeNormals(OP, I));

  // ---- after: measure again, same code ----
  const outH = { P: OP, COL: (() => { const c = new Uint8Array(mm * 3); for (let v = 0; v < n; v++) if (map[v] >= 0) c.set(COL.subarray(v * 3, v * 3 + 3), map[v] * 3); return c; })(), n: mm };
  { const lb = new Uint8Array(mm), sc = new Uint8Array(mm); for (let v = 0; v < n; v++) if (map[v] >= 0) { lb[map[v]] = h.cls.label[v]; sc[map[v]] = h.cls.sclera[v]; } outH.cls = { label: lb, sclera: sc }; }
  const after = measureHead(outH);
  // published landmarks honour the contract: a mirror-symmetric eye pair about the head's centre line (the shared face
  // system assumes it); the measured asymmetry stays in the geometry, not in the metadata
  // the body's skin tone = the measured median colour of the face's skin texels (between chin and eyes, front)
  const skinHex = (() => { const rs = [], gs = [], bs = []; for (let v = 0; v < mm; v++) { if (outH.cls.label[v] !== LABEL.SKIN) continue; const y = OP[v * 3 + 1], z = OP[v * 3 + 2]; if (y < after.chin || y > after.eyes.y || z < after.ears.z + after.eyes.sep * 0.25) continue; rs.push(outH.COL[v * 3]); gs.push(outH.COL[v * 3 + 1]); bs.push(outH.COL[v * 3 + 2]); }
    const med = (a2) => a2.sort((x, y) => x - y)[a2.length >> 1]; return "#" + [med(rs), med(gs), med(bs)].map((v) => v.toString(16).padStart(2, "0")).join(""); })();
  const half = (Math.abs(after.eyes.l.c[0] - after.eyes.cx) + Math.abs(after.eyes.r.c[0] - after.eyes.cx)) / 2, eyY = (after.eyes.l.c[1] + after.eyes.r.c[1]) / 2, eyZ = (after.eyes.l.c[2] + after.eyes.r.c[2]) / 2;
  const lm = { eyes: { l: [-half, eyY, eyZ], r: [half, eyY, eyZ], halfW: after.eyeHalfW, halfH: after.eyeHalfH }, mouth: { c: [0, after.mouth.y, after.mouth.z], halfW: after.eyeHalfW },
    bridge: [0, eyY, eyZ + 0.04], forward: [0, eyY, eyZ + 1], skin: skinHex, iris: "#1f1714" };
  if (depthInfo) lm.depthNormalization = depthInfo;
  const webp = await sharp(h.img).webp({ lossless: true }).toBuffer();
  const out = `${BASE_OUT}/identity/${id}.glb`;
  const sk = rimCols.length ? [0, 1, 2].map((q) => rimCols.map((c) => c[q]).sort((a2, b2) => a2 - b2)[rimCols.length >> 1] / 255)   // the socket: its rim's own shaded skin
    : [1, 3, 5].map((k) => (parseInt(lm.skin.slice(k, k + 2), 16) / 255) * 0.85);
  const sockP = Float32Array.from(socket.P), sockParts = socket.I.length ? [{ name: "baked_socket", P: sockP, N: weldNormals(sockP, computeNormals(sockP, socket.I)), I: socket.I, COLOR: Array.from({ length: sockP.length / 3 }, () => sk).flat(),
    J: new Uint8Array(sockP.length / 3 * 4).map((_, k) => (k % 4 === 0 ? base.JI.Head : 0)), W: new Float32Array(sockP.length / 3 * 4).map((_, k) => (k % 4 === 0 ? 1 : 0)), material: { name: "baked_socket", roughness: 0.85, doubleSided: true } }] : [];
  // the Alex skull base only fills where the employee's own skin was removed: per (x,z) column, Alex's surface is used
  // only BELOW the lowest kept employee skin — it never covers the employee's face, jaw or cheeks
  const BL = new Map(), blKey = (x, z) => `${Math.round(x / 0.01)},${Math.round(z / 0.01)}`;
  for (let v = 0; v < mm; v++) { if (outH.cls.label[v] === LABEL.HAIR) continue; const k = blKey(OP[v * 3], OP[v * 3 + 2]), y = OP[v * 3 + 1]; if (y < (BL.get(k) ?? 9)) BL.set(k, y); }
  // …and only in columns where the employee's own anatomy was actually REMOVED (the cut footprint): it replaces what
  // was cut, nothing else
  const RM = new Set(); for (let i = 0; i < n; i++) if (!keep[i] && !isHair(i) && P[i * 3 + 1] > cutY - 0.05) RM.add(blKey(P[i * 3], P[i * 3 + 2]));
  const inCut = (x, z) => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (RM.has(`${Math.round(x / 0.01) + dx},${Math.round(z / 0.01) + dz}`)) return true; return false; };
  const bonLow = (x, z) => { let m = 9; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) m = Math.min(m, BL.get(`${Math.round(x / 0.01) + dx},${Math.round(z / 0.01) + dz}`) ?? 9); return m; };
  const sbP = [], sbJ = [], sbW = [], sbI = [], sbMap = new Map();
  for (let t = 0; t < AI.length; t += 3) { const v = [AI[t], AI[t + 1], AI[t + 2]], cy = (AP[v[0] * 3 + 1] + AP[v[1] * 3 + 1] + AP[v[2] * 3 + 1]) / 3, cz = (AP[v[0] * 3 + 2] + AP[v[1] * 3 + 2] + AP[v[2] * 3 + 2]) / 3, ny = (AN[v[0] * 3 + 1] + AN[v[1] * 3 + 1] + AN[v[2] * 3 + 1]) / 3;
    if (!(ny < -0.1 || (cz < 0.05 && cy < 1.02))) continue;
    { const cx = (AP[v[0] * 3] + AP[v[1] * 3] + AP[v[2] * 3]) / 3; if (cy > bonLow(cx, cz) - 0.002 || !inCut(cx, cz)) continue; }
    for (const k of v) { if (!sbMap.has(k)) { sbMap.set(k, sbP.length / 3); for (let q = 0; q < 3; q++) sbP.push(AP[k * 3 + q] - AN[k * 3 + q] * A.skullBaseInset); for (let q = 0; q < 4; q++) { sbJ.push(AJ[k * 4 + q]); sbW.push(AW[k * 4 + q]); } } sbI.push(sbMap.get(k)); } }
  const skinRGB = [1, 3, 5].map((k) => parseInt(lm.skin.slice(k, k + 2), 16) / 255);
  const sbPf = Float32Array.from(sbP), skullBasePart = { name: "baked_skullbase", P: sbPf, N: weldNormals(sbPf, computeNormals(sbPf, sbI)), I: sbI, COLOR: Array.from({ length: sbPf.length / 3 }, () => skinRGB.map((c) => c * 0.92)).flat(), J: Uint8Array.from(sbJ), W: Float32Array.from(sbW), material: { name: "baked_skullbase", roughness: 0.85 } };
  // DEBUG (CHIBIFY_DEBUG=1): (1) the chibified head BEFORE the canonical cut, removed anatomy tinted green; (2) the final
  // head with hair texels dropped, to verify nothing generated sits under the hair. Gitignored output, never shipped.
  if (process.env.CHIBIFY_DEBUG) {
    const dbgDir = "scripts/avatar-pipeline/output/human-base/debug"; fs.mkdirSync(dbgDir, { recursive: true });
    const rig = (k) => ({ J: new Uint8Array(k * 4).map((_, q) => (q % 4 === 0 ? base.JI.Head : 0)), W: new Float32Array(k * 4).map((_, q) => (q % 4 === 0 ? 1 : 0)) });
    const allI = Array.from(h.I), tint = new Float32Array(n * 3).map((_, q) => (keep[Math.floor(q / 3)] ? 1 : [0.25, 1, 0.3][q % 3]));
    await writeModule(`${dbgDir}/${id}.before-cut.glb`, base, [{ name: "baked_debug", P: Float32Array.from(P), N: weldNormals(Float32Array.from(P), computeNormals(P, allI)), I: allI, UV: Float32Array.from(h.UV), COLOR: Array.from(tint).map((v) => Math.pow(v, 1 / 2.2)), ...rig(n), material: { name: "baked_debug", texture: webp, roughness: 0.8, doubleSided: true } }], {}, { compress: false });
    const noHairI = []; for (let t = 0; t < I.length; t += 3) if (![0, 1, 2].some((q) => outH.cls.label[I[t + q]] === LABEL.HAIR)) noHairI.push(I[t], I[t + 1], I[t + 2]);
    await writeModule(`${dbgDir}/${id}.no-hair.glb`, base, [skullBasePart, { name: "baked_nohair", P: OP, N: ON, I: noHairI, UV: OUV, J: OJ, W: OW, material: { name: "baked_nohair", texture: webp, roughness: 0.8, doubleSided: true } }], {}, { compress: false });
  }
  // NECK CONNECTION (owned by HumanBase): the base neck's own top cross-section (per 36 sectors around its axis, from
  // the base NECK region) is extruded straight UP, slightly inset, until it is well inside the canonical head
  // underside. Same silhouette and thickness as Alex's neck; skin UVs, weights and material are the body's own. No
  // employee geometry is extended downward.
  const neckExt = await (async () => { const BP = base.geo.P, BR = base.geo.REG, BUV = base.geo.UV, BJ = base.geo.J, BW = base.geo.W, NR = C.BODY_REGIONS.NECK, S2 = 36;
    let top = -9; for (let i = 0; i < BR.length; i++) if (Math.round(BR[i]) === NR) top = Math.max(top, BP[i * 3 + 1]);
    const band = []; for (let i = 0; i < BR.length; i++) if (Math.round(BR[i]) === NR && BP[i * 3 + 1] > top - 0.03) band.push(i);
    const cx = band.reduce((a2, i) => a2 + BP[i * 3], 0) / band.length, cz = band.reduce((a2, i) => a2 + BP[i * 3 + 2], 0) / band.length;
    const ring = Array.from({ length: S2 }, () => null);
    for (const i of band) { const th = Math.atan2(BP[i * 3 + 2] - cz, BP[i * 3] - cx), sx = Math.floor(((th + Math.PI) / (2 * Math.PI)) * S2) % S2, r = Math.hypot(BP[i * 3] - cx, BP[i * 3 + 2] - cz); if (!ring[sx] || r > ring[sx].r) ring[sx] = { r, i }; }
    for (let sx = 0; sx < S2; sx++) if (!ring[sx]) ring[sx] = ring[(sx + S2 - 1) % S2] ?? ring.find(Boolean);
    // ONE smoothed neck colour: every extension vertex samples the single neck-band texel whose colour is the band's
    // median (no seams, no streaks) — the body's own texture and material, just one uniform skin sample
    const uni = (() => { const img = base.doc.getRoot().listTextures()[0].getImage(); return img; })();
    const flatUV = await (async () => { const { data: td, info: tinf } = await sharp(Buffer.from(uni)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const cols = band.map((i) => { const u = Math.min(tinf.width - 1, Math.max(0, Math.round((BUV[i * 2] % 1) * (tinf.width - 1)))), v = Math.min(tinf.height - 1, Math.max(0, Math.round((BUV[i * 2 + 1] % 1) * (tinf.height - 1)))), o = (v * tinf.width + u) * 3; return [td[o], td[o + 1], td[o + 2], i]; });
      const med = [0, 1, 2].map((q) => cols.map((c) => c[q]).sort((x, y) => x - y)[cols.length >> 1]);
      let best = cols[0], bd = 1e9; for (const c of cols) { const d = Math.hypot(c[0] - med[0], c[1] - med[1], c[2] - med[2]); if (d < bd) { bd = d; best = c; } }
      return [BUV[best[3] * 2], BUV[best[3] * 2 + 1]]; })();
    const y0 = top - A.neckOverlap, y1 = Math.max(...ring.map((q, sx) => { const th = ((sx + 0.5) / S2) * 2 * Math.PI - Math.PI; return under(cx + Math.cos(th) * q.r, cz + Math.sin(th) * q.r); }).filter((v) => v > -8)) + A.neckIntoHead;
    const LV = 6, Pn = [], UVn = [], Jn = [], Wn = [], In = [];
    for (let l = 0; l <= LV; l++) { const t = l / LV, y = y0 + (y1 - y0) * t;
      for (let sx = 0; sx < S2; sx++) { const th = ((sx + 0.5) / S2) * 2 * Math.PI - Math.PI, q = ring[sx], r = q.r * (l === 0 ? 1 : A.neckInset); Pn.push(cx + Math.cos(th) * r, y, cz + Math.sin(th) * r); UVn.push(flatUV[0], flatUV[1]);
        // weights: the base neck's own at the bottom, blending to rigid Head at the top (the head is rigid on Head)
        const w = {}; for (let k = 0; k < 4; k++) if (BW[q.i * 4 + k] > 0) w[BJ[q.i * 4 + k]] = (w[BJ[q.i * 4 + k]] ?? 0) + BW[q.i * 4 + k] * (1 - t); w[base.JI.Head] = (w[base.JI.Head] ?? 0) + t;
        const top4 = Object.entries(w).sort((a2, b2) => b2[1] - a2[1]).slice(0, 4), sm2 = top4.reduce((a2, [, v]) => a2 + v, 0); for (let k = 0; k < 4; k++) { Jn.push(top4[k] ? +top4[k][0] : 0); Wn.push(top4[k] ? top4[k][1] / sm2 : 0); } } }
    for (let l = 0; l < LV; l++) for (let sx = 0; sx < S2; sx++) { const a2 = l * S2 + sx, b2 = l * S2 + (sx + 1) % S2, c2 = a2 + S2, d2 = b2 + S2; In.push(a2, c2, b2, b2, c2, d2); }
    const Pf = Float32Array.from(Pn); return { part: { name: "bodyskin_neckext", P: Pf, N: weldNormals(Pf, computeNormals(Pf, In)), I: In, UV: Float32Array.from(UVn), J: Uint8Array.from(Jn), W: Float32Array.from(Wn), material: { name: "bodyskin_neckext", roughness: 0.9 } }, y0, y1, top }; })();
  mount.neckExtension = { from: +neckExt.y0.toFixed(3), to: +neckExt.y1.toFixed(3), baseNeckTop: +neckExt.top.toFixed(3) };
  const flipOut = (() => { const g = neckExt.part, nrm = g.N; let out = 0; for (let i = 0; i < nrm.length / 3; i++) out += nrm[i * 3] * g.P[i * 3] + nrm[i * 3 + 2] * g.P[i * 3 + 2]; return out < 0; })();
  if (flipOut) { const I2 = neckExt.part.I; for (let t = 0; t < I2.length; t += 3) [I2[t + 1], I2[t + 2]] = [I2[t + 2], I2[t + 1]]; neckExt.part.N = weldNormals(neckExt.part.P, computeNormals(neckExt.part.P, I2)); }
  // ======================== HAIR MOTION CHAINS (universal; preset per hairstyle) ========================
  // Fused hair gets module-owned joint chains around the head (8 sectors). Per sector, hair is parameterised from its
  // top (t = 0) to its lowest point (t = 1); below t0 it is progressively weighted onto that sector's chain (smoothstep),
  // so the scalp, hairline and centre part (t < t0) stay rigid on Head and movement grows toward the tips. Adjacent
  // sectors blend, chain segments blend at their hinges — no cracks.
  const MOTION = { rigid: null, short: { joints: 1, t0: 0.55 }, medium: { joints: 2, t0: 0.4 }, long: { joints: 3, t0: 0.32 } };
  let hairLowFinal = 9; for (let v = 0; v < mm; v++) if (outH.cls.label[v] === LABEL.HAIR) hairLowFinal = Math.min(hairLowFinal, OP[v * 3 + 1]);
  const motion = hairMotion ?? (hairLowFinal < canon.chin ? "medium" : "short"), MP = MOTION[motion];
  const extraJoints = [], chains = [];
  if (MP) {
    const SECN = 8, hcx = 0, hcz = (after.ears.z + after.eyes.z) / 2 - after.eyes.sep * 0.2;
    const azOf = (v) => Math.atan2(OP[v * 3] - hcx, OP[v * 3 + 2] - hcz);           // 0 = front
    const secPos = (a) => ((a + Math.PI) / (2 * Math.PI)) * SECN - 0.5;              // continuous sector coordinate
    const top = new Float32Array(SECN).fill(-9), low = new Float32Array(SECN).fill(9);
    const hairV = []; for (let v = 0; v < mm; v++) if (outH.cls.label[v] === LABEL.HAIR) { hairV.push(v); const s2 = ((Math.round(secPos(azOf(v))) % SECN) + SECN) % SECN; top[s2] = Math.max(top[s2], OP[v * 3 + 1]); low[s2] = Math.min(low[s2], OP[v * 3 + 1]); }
    const tOf = (v, s2) => (top[s2] - OP[v * 3 + 1]) / Math.max(1e-4, top[s2] - low[s2]);
    const NJ = MP.joints, levels = Array.from({ length: NJ + 1 }, (_, k) => MP.t0 + ((1 - MP.t0) * k) / NJ);
    const JI0 = base.names.length, jointIdx = [];
    for (let s2 = 0; s2 < SECN; s2++) {
      // the chain's centreline: the mean OUTER hair position at each level in this sector
      const pts = levels.map((lv) => { const m = [0, 0, 0]; let c = 0; for (const v of hairV) { const sp = secPos(azOf(v)), d = Math.abs(((sp - s2 + SECN / 2) % SECN + SECN) % SECN - SECN / 2); if (d > 0.5 || Math.abs(tOf(v, s2) - lv) > 0.06) continue; for (let q = 0; q < 3; q++) m[q] += OP[v * 3 + q]; c++; } return c ? m.map((x) => x / c) : null; });
      if (pts.some((q) => !q) || top[s2] - low[s2] < 0.05) { jointIdx.push(null); continue; }
      const names = [], ids = [];
      for (let k = 0; k < NJ; k++) { const name = `hairS${s2}_${k}`; names.push(name); ids.push(JI0 + extraJoints.length);
        extraJoints.push({ name, parent: k ? names[k - 1] : "Head", world: new THREE.Matrix4().makeTranslation(...pts[k]) }); }
      chains.push({ id: `sector${s2}`, joints: names, hinge: pts[0], ends: pts.slice(1), hang: 0 });   // generated hair already hangs: motion is lag about its own rest shape
      jointIdx.push(ids);
    }
    let weighted = 0;
    for (const v of hairV) {
      const sp = secPos(azOf(v)), sa = ((Math.floor(sp) % SECN) + SECN) % SECN, sb = (sa + 1) % SECN, u = sp - Math.floor(sp);
      const acc = { [base.JI.Head]: 0 };
      for (const [s2, ws] of [[sa, 1 - u], [sb, u]]) { const ids = jointIdx[s2]; if (!ids || ws <= 0) { acc[base.JI.Head] += ws; continue; }
        const t = tOf(v, s2), c = smf(MP.t0, 1, t) * smf(MP.t0 - 0.02, MP.t0 + 0.15, t);
        const f = Math.max(0, Math.min(NJ - 1e-6, ((t - MP.t0) / (1 - MP.t0)) * NJ)), k = Math.floor(f), fr = f - k, blend = k > 0 ? smf(0, 0.35, fr) : 1;
        acc[base.JI.Head] += ws * (1 - c);
        acc[ids[k]] = (acc[ids[k]] ?? 0) + ws * c * blend; if (k > 0) acc[ids[k - 1]] = (acc[ids[k - 1]] ?? 0) + ws * c * (1 - blend); }
      const top4 = Object.entries(acc).filter(([, w]) => w > 1e-4).sort((a2, b2) => b2[1] - a2[1]).slice(0, 4), sum = top4.reduce((a2, [, w]) => a2 + w, 0);
      for (let q = 0; q < 4; q++) { OJ[v * 4 + q] = top4[q] ? +top4[q][0] : 0; OW[v * 4 + q] = top4[q] ? top4[q][1] / sum : 0; }
      if (top4.length > 1 || +top4[0][0] !== base.JI.Head) weighted++;
    }
    mount.hairMotion = { preset: motion, chains: chains.length, joints: extraJoints.length, weightedVerts: weighted };
  } else mount.hairMotion = { preset: "rigid" };

  // ======================== LIVING EYES + MOUTH (face life on any generated head) ========================
  // Each eye gets a shell just in front of the face whose texture is BAKED from the head's own painted eye (identical at
  // rest). Its alpha encodes the eye opening and, inside it, the vertical position (0 lower lid … 1 upper lid), so the
  // shared face layer can blink (a skin lid + lash edge descending), squint (lower lid) and look (the painted iris slides
  // over the sclera). The mouth shell draws the shared talking mouth only while it is open.
  const faceParts = [];
  { const { data: TX, info: TI } = await sharp(h.img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const texAt = (u, v) => { const x = Math.min(TI.width - 1, Math.max(0, Math.round((u % 1) * (TI.width - 1)))), y = Math.min(TI.height - 1, Math.max(0, Math.round((v % 1) * (TI.height - 1)))), o = (y * TI.width + x) * 3; return [TX[o], TX[o + 1], TX[o + 2]]; };
    // front raster of the final head: z (front-most), uv
    // the face SURFACE only: hair geometry lying in front of the face (fringes, a sweep over one eye) is skipped, so a
    // shell sits on the skin behind the hair — the hair keeps drawing in front of it and never gets baked into it
    const rasterPass = (x0, y0, w, hh, NX, NY, skipHair) => { const Z = new Float32Array(NX * NY).fill(-9), U = new Float32Array(NX * NY * 2);
      for (let t = 0; t < I.length; t += 3) { if (skipHair && outH.cls.label[I[t]] === LABEL.HAIR && outH.cls.label[I[t + 1]] === LABEL.HAIR && outH.cls.label[I[t + 2]] === LABEL.HAIR) continue; const v3 = [I[t], I[t + 1], I[t + 2]], q = v3.map((v) => [((OP[v * 3] - x0) / w) * NX, ((OP[v * 3 + 1] - y0) / hh) * NY, OP[v * 3 + 2]]);
        if (q.every((p2) => p2[0] < 0) || q.every((p2) => p2[0] > NX) || q.every((p2) => p2[1] < 0) || q.every((p2) => p2[1] > NY)) continue;
        const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-12) continue;
        for (let y = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(NY - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
          for (let x = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(NX - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
            const px = x + 0.5, py = y + 0.5, w0 = ((q[1][0] - px) * (q[2][1] - py) - (q[2][0] - px) * (q[1][1] - py)) / ar, w1 = ((q[2][0] - px) * (q[0][1] - py) - (q[0][0] - px) * (q[2][1] - py)) / ar, w2 = 1 - w0 - w1;
            if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue; const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], k = y * NX + x; if (z <= Z[k]) continue;
            Z[k] = z; for (let c = 0; c < 2; c++) U[k * 2 + c] = w0 * OUV[v3[0] * 2 + c] + w1 * OUV[v3[1] * 2 + c] + w2 * OUV[v3[2] * 2 + c]; } }
      return { Z, U }; };
    // hair-labelled triangles are skipped only where they stand IN FRONT of the face surface (real hair geometry); dark
    // paint lying ON the surface (a large dark iris, liner) stays — the surface depth under a hair-only pixel is filled
    // in from the surrounding non-hair surface along its row and column
    const raster = (x0, y0, w, hh, NX, NY) => { const all = rasterPass(x0, y0, w, hh, NX, NY, false), sk = rasterPass(x0, y0, w, hh, NX, NY, true), thr = lm.eyes.halfH * 0.25; sk.HO = new Uint8Array(NX * NY); sk.AZ = all.Z;
      for (let k = 0; k < NX * NY; k++) { if (all.Z[k] < -8 || sk.Z[k] > -8 && all.Z[k] - sk.Z[k] < 1e-6) continue;
        if (sk.Z[k] < -8) { sk.Z[k] = all.Z[k]; sk.U[k * 2] = all.U[k * 2]; sk.U[k * 2 + 1] = all.U[k * 2 + 1]; sk.HO[k] = 1; continue; }   /* nothing behind it: it IS the surface (flagged hair-only) */ const x = k % NX, y = (k / NX) | 0; let ws = 0, zs = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let s2 = 1; s2 < Math.max(NX, NY); s2++) { const xx = x + dx * s2, yy = y + dy * s2; if (xx < 0 || yy < 0 || xx >= NX || yy >= NY) break; const z = sk.Z[yy * NX + xx]; if (z > -8 && !(all.Z[yy * NX + xx] - z > 1e-6)) { ws += 1 / s2; zs += z / s2; break; } }
        const surf = ws ? zs / ws : -9; if (surf > -8 && all.Z[k] - surf < thr) { sk.Z[k] = all.Z[k]; sk.U[k * 2] = all.U[k * 2]; sk.U[k * 2 + 1] = all.U[k * 2 + 1]; } }
      return sk; };
    const grid = (x0, y0, w, hh, G, zOf, uvOf) => { const Pg = [], UVg = [], Ig = []; for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { const x = x0 + (w * i) / G, y = y0 + (hh * j) / G; Pg.push(x, y, zOf(i / G, j / G) + 0.0016); UVg.push(...uvOf(i / G, j / G)); }
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { const a2 = j * (G + 1) + i; Ig.push(a2, a2 + 1, a2 + G + 1, a2 + 1, a2 + G + 2, a2 + G + 1); } return { P: Pg, UV: UVg, I: Ig }; };
    const BW = 1.55, BH = 2.3, RES = 256, eyeImgs = [], eyeGeo = { P: [], PN: [], UV: [], I: [], SN: [], SW: [], FE: [] }; let scl = [0, 0, 0, 0];
    const eyesC = [lm.eyes.l, lm.eyes.r];
    var eyeStrands = 0; const eyeShells = [];
    const hiddenSide = src.eyeMirrored === "left" ? 0 : src.eyeMirrored === "right" ? 1 : -1;   // decided on the source measurement
    eyesC.forEach((ec, side) => {
      const w = lm.eyes.halfW * 2 * BW, hh = lm.eyes.halfH * 2 * BH, x0 = ec[0] - w / 2, y0 = ec[1] - hh / 2, NX = RES, NY = Math.round(RES * hh / w);
      const { Z, U, HO, AZ } = raster(x0, y0, w, hh, NX, NY); for (let k = 0; k < NX * NY; k++) if (Z[k] > -8 && Z[k] < ec[2] - 0.6 * w) HO[k] = 1;   /* far behind the eye: beyond the face silhouette (back of the head) — not face */
      // HO is only true where the surface really leaves the face: dark paint ON the face (a liner the classifier calls hair)
      // has nothing non-hair behind it but sits at face depth — it stays face (covered by the lid)
      { const fe = Float32Array.from(Z), ok3 = new Uint8Array(NX * NY), q = []; for (let k = 0; k < NX * NY; k++) if (!HO[k] && Z[k] > -8) { ok3[k] = 1; q.push(k); }
        for (let h = 0; h < q.length; h++) { const k = q[h], x = k % NX; for (const k2 of [k - 1, k + 1, k - NX, k + NX]) if (k2 >= 0 && k2 < NX * NY && Math.abs((k2 % NX) - x) <= 1 && !ok3[k2]) { ok3[k2] = 1; fe[k2] = fe[k]; q.push(k2); } }
        for (let k = 0; k < NX * NY; k++) if (HO[k] && Z[k] > -8 && q.length && Math.abs(Z[k] - fe[k]) < lm.eyes.halfH * 0.6) HO[k] = 0; }
      const RGB = new Uint8Array(NX * NY * 3), M = new Uint8Array(NX * NY);
      // raster HOLES (pixels no surface triangle covered: tiny gaps, slivers): take the nearest covered pixel's surface (≤ 8 px),
      // so the shell never has holes for the head's own painted eye to show through
      { const q = [], d = new Uint8Array(NX * NY).fill(255); for (let k = 0; k < NX * NY; k++) if (Z[k] > -8) { d[k] = 0; q.push(k); }
        for (let h = 0; h < q.length; h++) { const k = q[h], x = k % NX; if (d[k] >= 8) continue; for (const k2 of [k - 1, k + 1, k - NX, k + NX]) if (k2 >= 0 && k2 < NX * NY && Math.abs((k2 % NX) - x) <= 1 && d[k2] === 255) { d[k2] = d[k] + 1; Z[k2] = Z[k]; U[k2 * 2] = U[k * 2]; U[k2 * 2 + 1] = U[k * 2 + 1]; HO[k2] = HO[k]; q.push(k2); }   /* a gap filled from hair-only surface is hair-only too */ } }
      for (let k = 0; k < NX * NY; k++) if (Z[k] > -8) RGB.set(texAt(U[k * 2], U[k * 2 + 1]), k * 3);
      const L = (k) => lab(RGB[k * 3], RGB[k * 3 + 1], RGB[k * 3 + 2]);
      for (let k = 0; k < NX * NY; k++) { const c = L(k); if (c[0] > 70 && Math.hypot(c[1], c[2]) < 12) { M[k] = 1; scl = [scl[0] + RGB[k * 3], scl[1] + RGB[k * 3 + 1], scl[2] + RGB[k * 3 + 2], scl[3] + 1]; } }
      // the iris/pupil: dark pixels with eye white both left and right on their row (within the box)
      for (let y = 0; y < NY; y++) { let l = -1, r = -1; for (let x = 0; x < NX; x++) if (M[y * NX + x]) { if (l < 0) l = x; r = x; } if (l < 0) continue; for (let x = l; x <= r; x++) { const k = y * NX + x; if (!M[k] && L(k)[0] < 40) M[k] = 2; } }
      // keep only the eye itself: the largest 8-connected eye region in the central band (stray light/dark specks on
      // the brow or cheek are not the eye)
      { const comp = new Int32Array(NX * NY).fill(-1); let best = -1, bestN = 0, id = 0; const cy0 = NY * 0.5, band = NY * (1 / BH) * 1.1;
        for (let k0 = 0; k0 < NX * NY; k0++) { if (!M[k0] || comp[k0] >= 0) continue; const st = [k0]; comp[k0] = id; let nn = 0, central = 0;
          while (st.length) { const k = st.pop(); nn++; const x = k % NX, y = (k / NX) | 0; if (Math.abs(y - cy0) < band) central++;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= NX || yy >= NY) continue; const k2 = yy * NX + xx; if (M[k2] && comp[k2] < 0) { comp[k2] = id; st.push(k2); } } }
          if (central > bestN) { bestN = central; best = id; } id++; }
        for (let k = 0; k < NX * NY; k++) if (comp[k] !== best) M[k] = 0; }
      // the eye region M: eye white (1) and dark iris/pupil (2)
      // PAINTED HAIR across the eye: the iris is the most COMPACT dark component inside the opening; other dark
      // components that cross the opening vertically (≥ 40% of its local height — strands, not the horizontal lash line)
      // are repainted with the eye-white colour in the shell, so the living eye is clean while real hair geometry still
      // draws in front of it
      { const comps2 = [], cid = new Int32Array(NX * NY).fill(-1);
        for (let k0 = 0; k0 < NX * NY; k0++) { if (M[k0] !== 2 || cid[k0] >= 0) continue; const st = [k0], m2 = []; cid[k0] = comps2.length;
          while (st.length) { const k = st.pop(); m2.push(k); const x = k % NX; for (const k2 of [k - 1, k + 1, k - NX, k + NX]) if (k2 >= 0 && k2 < NX * NY && Math.abs((k2 % NX) - x) <= 1 && M[k2] === 2 && cid[k2] < 0) { cid[k2] = comps2.length; st.push(k2); } }
          let x0 = NX, x1 = 0, y0 = NY, y1 = 0; for (const k of m2) { const x = k % NX, y = (k / NX) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          const w2 = x1 - x0 + 1, h2 = y1 - y0 + 1; comps2.push({ m: m2, w: w2, h: h2, x0, x1, compact: m2.length / (Math.max(w2, h2) ** 2) }); }
        if (comps2.length > 1) {
          const iris = comps2.reduce((a2, b2) => (b2.m.length * b2.compact > a2.m.length * a2.compact ? b2 : a2));
          const colH = (x) => { let b = -1, t2 = -1; for (let y = 0; y < NY; y++) if (M[y * NX + x]) { if (b < 0) b = y; t2 = y; } return b < 0 ? 0 : t2 - b + 1; };
          const scl0 = (() => { const a2 = []; for (let k = 0; k < NX * NY; k++) if (M[k] === 1) a2.push(k); const md = (q) => a2.map((k) => RGB[k * 3 + q]).sort((x, y) => x - y)[a2.length >> 1] ?? 235; return [md(0), md(1), md(2)]; })();
          let strands = 0; for (const c2 of comps2) { if (c2 === iris) continue; const hLocal = Math.max(1, colH(Math.round((c2.x0 + c2.x1) / 2)));
            if (c2.h >= 0.4 * hLocal && c2.w < c2.h * 1.5) { for (const k of c2.m) { RGB.set(scl0, k * 3); M[k] = 1; } strands++; } }
          if (strands) eyeStrands = (eyeStrands ?? 0) + strands; } }
      // the IRIS region (flagged in alpha's lowest bit): its dark pixels, filled across each row (catch-lights included)
      // and grown by one pixel — so a sliding iris takes its whole disc along and leaves no ring behind
      const IR = new Uint8Array(NX * NY); let IRIS = null;
      // per row: the dark span is iris when it is narrower than 80% of that row's own eye opening (a span filling the
      // whole opening is a lid/lash shadow, not the iris) — relative to the opening, so large irises are fully flagged
      for (let y = 0; y < NY; y++) { let l = -1, r = -1, ol = -1, orr = -1; for (let x = 0; x < NX; x++) { if (M[y * NX + x]) { if (ol < 0) ol = x; orr = x; } if (M[y * NX + x] === 2) { if (l < 0) l = x; r = x; } } if (l >= 0 && r - l < 0.8 * (orr - ol + 1)) for (let x = l; x <= r; x++) IR[y * NX + x] = 1; }
      // complete the iris as a DISC: its equator is the widest confidently-flagged row; every dark pixel inside that
      // circle is iris (rows where a heavy lash band overlaps the iris top are recovered)
      { let yq = -1, best = 0, lq = 0, rq = 0; for (let y = 0; y < NY; y++) { let l = -1, r = -1; for (let x = 0; x < NX; x++) if (IR[y * NX + x]) { if (l < 0) l = x; r = x; } if (l >= 0 && r - l > best) { best = r - l; yq = y; lq = l; rq = r; } }
        if (yq >= 0) { const cxq = (lq + rq) / 2, rad = (best / 2) * 1.05; IRIS = { cx: cxq, cy: yq, r: rad }; for (let k = 0; k < NX * NY; k++) { const inD = Math.hypot((k % NX) - cxq, ((k / NX) | 0) - yq) <= rad; if (M[k] === 2 && inD) IR[k] = 1; else if (!inD) IR[k] = 0; } } }   // nothing outside the disc (lash-row streaks) is iris
      { const g2 = IR.slice(); for (let k = 0; k < NX * NY; k++) if (g2[k]) { const x = k % NX; for (const k2 of [k - 1, k + 1, k - NX, k + NX]) if (k2 >= 0 && k2 < NX * NY && Math.abs((k2 % NX) - x) <= 1) IR[k2] = 1; } }
      // the iris is ONE disc: keep the largest connected flagged region (lash-corner specks are not iris)
      { const cid = new Int32Array(NX * NY).fill(-1); let best = -1, bestN = 0, id = 0;
        for (let k0 = 0; k0 < NX * NY; k0++) { if (!IR[k0] || cid[k0] >= 0) continue; const st = [k0]; cid[k0] = id; let nn = 0;
          while (st.length) { const k = st.pop(); nn++; const x = k % NX; for (const k2 of [k - 1, k + 1, k - NX, k + NX]) if (k2 >= 0 && k2 < NX * NY && Math.abs((k2 % NX) - x) <= 1 && IR[k2] && cid[k2] < 0) { cid[k2] = id; st.push(k2); } }
          if (nn > bestN) { bestN = nn; best = id; } id++; }
        for (let k = 0; k < NX * NY; k++) if (cid[k] !== best) IR[k] = 0; }
      // HOLES in the iris (catch-lights, light flecks) are iris: they travel with it — a light pixel the iris encloses (not
      // reachable from the eye box border through non-iris pixels) is flagged
      { const out2 = new Uint8Array(NX * NY), q = []; for (let x = 0; x < NX; x++) for (const y of [0, NY - 1]) { const k = y * NX + x; if (!IR[k] && !out2[k]) { out2[k] = 1; q.push(k); } }
        for (let y = 0; y < NY; y++) for (const x of [0, NX - 1]) { const k = y * NX + x; if (!IR[k] && !out2[k]) { out2[k] = 1; q.push(k); } }
        for (let h2 = 0; h2 < q.length; h2++) { const k = q[h2], x = k % NX; for (const k2 of [k - 1, k + 1, k - NX, k + NX]) if (k2 >= 0 && k2 < NX * NY && Math.abs((k2 % NX) - x) <= 1 && !IR[k2] && !out2[k2]) { out2[k2] = 1; q.push(k2); } }
        for (let k = 0; k < NX * NY; k++) if (!IR[k] && !out2[k]) IR[k] = 1; }
      // per column the opening is the CONTIGUOUS eye run (gaps ≤ 3 px) nearest the eye's centre row — eye-white-like
      // specks on the lid or cheek above/below in the same column are not part of it
      const runOf = (x) => { const cy0 = NY >> 1; let best = null; for (let y = 0; y < NY; y++) { if (!M[y * NX + x]) continue; let e = y, gap = 0; while (e + 1 < NY && gap <= 3) { if (M[(e + 1) * NX + x]) { e++; gap = 0; } else { gap++; if (gap > 3) break; e++; } } while (e > y && !M[e * NX + x]) e--;
        const d = cy0 < y ? y - cy0 : cy0 > e ? cy0 - e : 0; if (!best || d < best.d) best = { b: y, t: e, d }; y = e; } return best; };
      for (let x = 0; x < NX; x++) { const run = runOf(x); for (let y = 0; y < NY; y++) if (M[y * NX + x] && (!run || y < run.b || y > run.t)) M[y * NX + x] = 0; }
      // ---- LID RECONSTRUCTION (universal): a closing lid is REBUILT from the eye's surroundings, never recoloured ----
      // 1. smoothed opening contours: per column the eye run's bottom/top, gaps interpolated, median-5 then mean-5 — the
      //    opening is the clean region between them (no jagged mask, no holes, no stray texels)
      const lumK = (k) => 0.3 * RGB[k * 3] + 0.59 * RGB[k * 3 + 1] + 0.11 * RGB[k * 3 + 2];
      const ob = new Float32Array(NX).fill(NaN), ot = new Float32Array(NX).fill(NaN);
      for (let x = 0; x < NX; x++) for (let y = 0; y < NY; y++) if (M[y * NX + x]) { if (Number.isNaN(ob[x])) ob[x] = y; ot[x] = y; }
      let xa = 0; while (xa < NX && Number.isNaN(ob[xa])) xa++; let xz = NX - 1; while (xz > xa && Number.isNaN(ob[xz])) xz--;
      const hasEye = xa < NX;
      for (let x = xa; x <= xz; x++) if (Number.isNaN(ob[x])) { let r = x + 1; while (Number.isNaN(ob[r])) r++; const l = x - 1; for (let q = x; q < r; q++) { const f = (q - l) / (r - l); ob[q] = ob[l] + (ob[r] - ob[l]) * f; ot[q] = ot[l] + (ot[r] - ot[l]) * f; } x = r; }
      // windows scale with the bake resolution (median ±3.5%, then two means ±3% of the box width)
      const wMed = Math.max(2, Math.round(NX * 0.035)), wMean = Math.max(2, Math.round(NX * 0.03));
      const smooth = (a2, med) => { const m2 = a2.slice(); if (med) for (let x = xa; x <= xz; x++) { const w2 = []; for (let d = -wMed; d <= wMed; d++) if (x + d >= xa && x + d <= xz) w2.push(a2[x + d]); w2.sort((p2, q2) => p2 - q2); m2[x] = w2[w2.length >> 1]; }
        let o2 = m2; for (let pass = 0; pass < 2; pass++) { const src2 = o2; o2 = src2.slice(); for (let x = xa; x <= xz; x++) { let s2 = 0, c2 = 0; for (let d = -wMean; d <= wMean; d++) if (x + d >= xa && x + d <= xz) { s2 += src2[x + d]; c2++; } o2[x] = s2 / c2; } } return o2; };
      const cb = hasEye ? smooth(ob, true) : ob, ct = hasEye ? smooth(ot, true) : ot;
      const B0 = new Int16Array(NX), H0 = new Int16Array(NX);
      if (hasEye) for (let x = 0; x < NX; x++) { const xi = Math.min(xz, Math.max(xa, x)), b = Math.round(cb[xi]), t2 = Math.max(b, Math.round(ct[xi])); B0[x] = b; H0[x] = x < xa || x > xz ? 0 : t2 - b + 1; }
      // 2. the PAINTED LASH BAND above the opening and the lower RIM below it: per column, the dark texels contiguous with
      //    the opening — their thickness travels with the lid and their colour is the employee's own liner
      const LT = new Float32Array(NX), RB = new Float32Array(NX), padUp = Math.max(3, Math.round(NY * 0.3)), padDn = Math.max(2, Math.round(NY * 0.08));
      const bandOf = (x, y0, dir, pad) => { let nb = 0, gap = 0; for (let y = y0, s2 = 0; s2 < pad && y >= 0 && y < NY; y += dir, s2++) { if (lumK(y * NX + x) < 100) { nb = s2 + 1; gap = 0; } else if (++gap > 1) break; } return nb; };
      if (hasEye) for (let x = xa; x <= xz; x++) { LT[x] = bandOf(x, B0[x] + H0[x], 1, padUp); RB[x] = bandOf(x, B0[x] - 1, -1, padDn); }
      // the DRAWN lash thickness is capped by this eye's own typical lash (median over its full-height columns): dark iris
      // tops or brows touching the band cannot inflate the stroke (they are still covered — the shell uses the raw band)
      const LTc = (() => { if (!hasEye) return LT; let mh = 0; for (let x = xa; x <= xz; x++) mh = Math.max(mh, H0[x]); const v2 = []; for (let x = xa; x <= xz; x++) if (H0[x] > 0.5 * mh) v2.push(LT[x]); v2.sort((a2, b2) => a2 - b2);
        const cap = 1.6 * (v2[v2.length >> 1] ?? 2) + 1; return LT.map((v) => Math.min(v, cap)); })();
      const LTs = hasEye ? smooth(LTc, true) : LT;
      // 3. the SHELL: opening + lash band + rim, plus painted flicks beyond the corners (dark texels 8-connected to it within
      //    12% of the box width — kept exactly as painted), grown by 3 px so the old paint's soft fringe is covered too
      const inR = new Uint8Array(NX * NY), FIX = new Uint8Array(NX * NY), SH = new Uint8Array(NX * NY);
      if (hasEye) for (let x = xa; x <= xz; x++) for (let y = Math.max(0, B0[x] - Math.ceil(RB[x]) - 1); y <= Math.min(NY - 1, B0[x] + H0[x] + Math.ceil(LT[x])); y++) inR[y * NX + x] = 1;
      { const st = []; for (let k = 0; k < NX * NY; k++) if (inR[k]) st.push(k); const reach = Math.round(NX * 0.12);
        while (st.length) { const k = st.pop(), x = k % NX, y = (k / NX) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= NX || yy >= NY || (xx >= xa && xx <= xz) || xx < xa - reach || xx > xz + reach) continue; const k2 = yy * NX + xx; if (!FIX[k2] && !inR[k2] && lumK(k2) < 100) { FIX[k2] = 1; st.push(k2); } } } }
      const grow = (src2, r2, dst) => { for (let k = 0; k < NX * NY; k++) if (src2(k)) { const x = k % NX, y = (k / NX) | 0; for (let dy = -r2; dy <= r2; dy++) for (let dx = -r2; dx <= r2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < NX && yy < NY) dst[yy * NX + xx] = 1; } } return dst; };
      grow((k) => inR[k] || FIX[k], 3, SH); for (let k = 0; k < NX * NY; k++) if (Z[k] < -8) SH[k] = 0;
      // NO FACE behind it (hair hanging beside the face): never part of the shell outside the eye itself — a
      // shell there would stand in mid-air (seen from the side); inside the eye (a raised painted iris) it stays
      for (let k = 0; k < NX * NY; k++) if (HO[k] && !inR[k]) { SH[k] = 0; FIX[k] = 0; }
      // HAIR stays a foreground layer: dark texels in the shell that are neither opening nor lash band and connect
      // (through dark texels) to dark paint outside the shell — a strand or sweep over the eye — keep their paint at every
      // lid state; a closing lid never erases hair
      { const lashOrOpen = (k) => { const x = k % NX, y = (k / NX) | 0; return hasEye && x >= xa && x <= xz && y >= B0[x] - Math.ceil(RB[x]) && y < B0[x] + H0[x] + Math.ceil(LT[x]); };
        const dark = (k) => lumK(k) < 100, st = []; for (let k = 0; k < NX * NY; k++) if (!SH[k] && dark(k)) { const x = k % NX, y = (k / NX) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < NX && yy < NY && SH[yy * NX + xx]) { st.push(k); break; } } }
        const seen = new Uint8Array(NX * NY); for (const k of st) seen[k] = 1;
        while (st.length) { const k = st.pop(), x = k % NX, y = (k / NX) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= NX || yy >= NY) continue; const k2 = yy * NX + xx;
          if (seen[k2] || !SH[k2] || !dark(k2) || lashOrOpen(k2)) continue; seen[k2] = 1; FIX[k2] = 1; st.push(k2); } }
        // only SIZEABLE dark regions are hair (a strand, a sweep): specks are lash fragments the lid covers
        const cid = new Int32Array(NX * NY).fill(-1), minN = Math.round(NX * NY * 0.002); for (let k0 = 0; k0 < NX * NY; k0++) { if (!FIX[k0] || cid[k0] >= 0) continue; const c2 = [k0]; cid[k0] = k0;
          for (let h = 0; h < c2.length; h++) { const k = c2[h], x = k % NX, y = (k / NX) | 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= NX || yy >= NY) continue; const k2 = yy * NX + xx; if (FIX[k2] && cid[k2] < 0) { cid[k2] = k0; c2.push(k2); } } }
          if (c2.length < minN) for (const k of c2) FIX[k] = 0; } }
      // the iris takes its own DARK RIM along (anti-aliased edge texels next to it inside the opening), so a moving iris leaves
      // no dark crescent behind
      if (hasEye) for (let pass = 0; pass < 2; pass++) { const g3 = IR.slice(); for (let k = 0; k < NX * NY; k++) { if (g3[k]) continue; const x = k % NX, y = (k / NX) | 0; if (x < xa || x > xz || y < B0[x] || y >= B0[x] + H0[x] || lumK(k) >= 110) continue;
        if ((x > 0 && g3[k - 1]) || (x < NX - 1 && g3[k + 1]) || (y > 0 && g3[k - NX]) || (y < NY - 1 && g3[k + NX])) IR[k] = 1; } }
      // coded alpha: 1 outside (discarded, colour kept so filtering stays clean) · 2 lid region · 8/9 opening (+iris) · 10 flick
      const A = new Uint8Array(NX * NY).fill(1); if (false && process.env.EYEDBG) { const x = NX >> 1; console.error("DBG", side, x, xa, xz, B0[x], H0[x], LT[x], RB[x], [...Array(NY).keys()].map((y) => (inR[y * NX + x] ? "R" : SH[y * NX + x] ? "s" : Z[y * NX + x] < -8 ? "z" : ".") + M[y * NX + x]).join("")); }
      for (let k = 0; k < NX * NY; k++) if (SH[k]) { const x = k % NX, y = (k / NX) | 0, open = hasEye && x >= xa && x <= xz && y >= B0[x] && y < B0[x] + H0[x]; A[k] = FIX[k] ? 10 : open ? 8 + IR[k] : 2; }
      // 4. the LID SURFACE: the eye's own surrounding skin continued smoothly across the whole region (a harmonic fill from
      //    the clean skin right around it — hair, brows, lashes and the eye itself never feed it): what a closing lid shows
      const skinLike = (k) => { const r = RGB[k * 3], g = RGB[k * 3 + 1], b = RGB[k * 3 + 2]; return Z[k] > -8 && r > b + 15 && r >= g && lumK(k) > 80; };
      const known = new Uint8Array(NX * NY); for (let k = 0; k < NX * NY; k++) known[k] = !SH[k] && skinLike(k) ? 1 : 0;   // anchored AT the shell border: seamless
      const SP = new Float32Array(NX * NY * 3);
      { const ks = []; for (let k = 0; k < NX * NY; k++) if (known[k]) ks.push(k); const md = [0, 1, 2].map((q) => ks.map((k) => RGB[k * 3 + q]).sort((a2, b2) => a2 - b2)[ks.length >> 1] ?? 200);
        for (let k = 0; k < NX * NY; k++) for (let q = 0; q < 3; q++) SP[k * 3 + q] = known[k] ? RGB[k * 3 + q] : md[q];
        const free = []; for (let k = 0; k < NX * NY; k++) if (!known[k]) free.push(k);
        for (let it = 0; it < 600; it++) for (const k of free) { const x = k % NX, y = (k / NX) | 0; let nn = 0, s0 = 0, s1 = 0, s2 = 0;
          if (x > 0) { const j = (k - 1) * 3; s0 += SP[j]; s1 += SP[j + 1]; s2 += SP[j + 2]; nn++; } if (x < NX - 1) { const j = (k + 1) * 3; s0 += SP[j]; s1 += SP[j + 1]; s2 += SP[j + 2]; nn++; }
          if (y > 0) { const j = (k - NX) * 3; s0 += SP[j]; s1 += SP[j + 1]; s2 += SP[j + 2]; nn++; } if (y < NY - 1) { const j = (k + NX) * 3; s0 += SP[j]; s1 += SP[j + 1]; s2 += SP[j + 2]; nn++; }
          const j = k * 3; SP[j] += 1.85 * (s0 / nn - SP[j]); SP[j + 1] += 1.85 * (s1 / nn - SP[j + 1]); SP[j + 2] += 1.85 * (s2 / nn - SP[j + 2]); } }
      const LID = Buffer.alloc(NX * NY * 4); for (let k = 0; k < NX * NY; k++) { for (let q = 0; q < 3; q++) LID[k * 4 + q] = Math.max(0, Math.min(255, Math.round(SP[k * 3 + q]))); LID[k * 4 + 3] = 255; }
      // CLEAN SCLERA: the opening with the iris removed (a harmonic fill from the opening's own non-iris paint) — what a moving
      // iris uncovers. IRIS: the measured disc, its median colour, and the travel that keeps it inside the opening.
      const isOpen = (k) => A[k] === 8 || A[k] === 9, WP = Buffer.alloc(NX * NY * 4);
      { const F = new Float32Array(NX * NY * 3), unk = new Uint8Array(NX * NY), ws = []; for (let k = 0; k < NX * NY; k++) { for (let q = 0; q < 3; q++) F[k * 3 + q] = RGB[k * 3 + q]; if (isOpen(k)) { if (IR[k]) unk[k] = 1; else ws.push(k); } }
        const md = [0, 1, 2].map((q) => ws.map((k) => RGB[k * 3 + q]).sort((a2, b2) => a2 - b2)[ws.length >> 1] ?? 235), free = []; for (let k = 0; k < NX * NY; k++) if (unk[k]) { free.push(k); for (let q = 0; q < 3; q++) F[k * 3 + q] = md[q]; }
        for (let it = 0; it < 500; it++) for (const k of free) { const x = k % NX; let n2 = 0, s0 = 0, s1 = 0, s2 = 0; for (const k2 of [k - 1, k + 1, k - NX, k + NX]) { if (k2 < 0 || k2 >= NX * NY || Math.abs((k2 % NX) - x) > 1 || !(isOpen(k2) || unk[k2])) continue; s0 += F[k2 * 3]; s1 += F[k2 * 3 + 1]; s2 += F[k2 * 3 + 2]; n2++; }
          if (n2) { F[k * 3] += 1.85 * (s0 / n2 - F[k * 3]); F[k * 3 + 1] += 1.85 * (s1 / n2 - F[k * 3 + 1]); F[k * 3 + 2] += 1.85 * (s2 / n2 - F[k * 3 + 2]); } }
        // median over the sclera (opening, non-iris; ~3.5% of the box, then 5×5): painted streaks go, its own shading stays
        for (let pass = 0; pass < 2; pass++) { const G2 = F.slice(), rM = pass === 0 ? Math.max(2, Math.round(NX * 0.018)) : 2; for (let k = 0; k < NX * NY; k++) { if (!(isOpen(k) || unk[k])) continue; const x = k % NX, y = (k / NX) | 0; const v3 = [[], [], []];
          for (let dy = -rM; dy <= rM; dy++) for (let dx = -rM; dx <= rM; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= NX || yy >= NY) continue; const k2 = yy * NX + xx; if (!(isOpen(k2) || unk[k2])) continue; for (let q = 0; q < 3; q++) v3[q].push(G2[k2 * 3 + q]); }
          for (let q = 0; q < 3; q++) { v3[q].sort((a2, b2) => a2 - b2); F[k * 3 + q] = v3[q][v3[q].length >> 1]; } } }
        for (let k = 0; k < NX * NY; k++) { for (let q = 0; q < 3; q++) WP[k * 4 + q] = Math.max(0, Math.min(255, Math.round(F[k * 3 + q]))); WP[k * 4 + 3] = 255; } }
      const PRM = Buffer.alloc(8 * 4); if (IRIS && hasEye) { const iv = []; for (let k = 0; k < NX * NY; k++) if (IR[k] && isOpen(k)) iv.push(k); const ic = [0, 1, 2].map((q) => iv.map((k) => RGB[k * 3 + q]).sort((a2, b2) => a2 - b2)[iv.length >> 1] ?? 20);
        const row = Math.min(NY - 1, Math.max(0, Math.round(IRIS.cy))); let l2 = -1, r2 = -1; for (let x = 0; x < NX; x++) if (isOpen(row * NX + x)) { if (l2 < 0) l2 = x; r2 = x; }
        const roomX = l2 < 0 ? 0 : Math.max(IRIS.r * 0.15, Math.min(IRIS.cx - l2, r2 - IRIS.cx) - IRIS.r * 0.85) * 0.55, roomY = IRIS.r * 0.18;
        const vals = [Math.floor(IRIS.cx), Math.round((IRIS.cx % 1) * 255), Math.floor(IRIS.cy), Math.round((IRIS.cy % 1) * 255), Math.min(255, Math.round(IRIS.r * 4)), Math.min(255, Math.round(roomX * 4)), Math.min(255, Math.round(roomY * 4)), 1];
        vals.forEach((v, j2) => { PRM[j2 * 4 + 3] = v; }); for (let q = 0; q < 3; q++) PRM[q] = ic[q]; }
      // 5. per-column eye geometry for the shader (the atlas' extra top row): opening bottom, height, lash ×4, rim + 1
      const lashC = (() => { const c = []; if (hasEye) for (let x = xa; x <= xz; x++) for (let y = B0[x] + H0[x]; y < B0[x] + H0[x] + LT[x] && y < NY; y++) if (lumK(y * NX + x) < 100) c.push(y * NX + x);
        return c.length > 8 ? [0, 1, 2].map((q) => c.map((k) => RGB[k * 3 + q]).sort((a2, b2) => a2 - b2)[c.length >> 1]) : [30, 24, 22]; })();
      const LT9 = LTs;
      // the CLOSED LINE: one smooth arc — a cubic fitted (weighted by opening height) to 30% up the opening, clamped inside
      // it; the upper lid travels to it and the lower lid meets it, whatever bumps the iris puts in the contours
      const CL = new Float32Array(NX); if (hasEye) { const N4 = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]; const cx2 = (xa + xz) / 2, sx = Math.max(1, (xz - xa) / 2);
        for (let x = xa; x <= xz; x++) { const hf = ct[x] - cb[x] + 1; if (hf <= 0) continue; const t = (x - cx2) / sx, ph = [1, t, t * t, t * t * t], yv = cb[x] + 0.3 * hf; for (let i = 0; i < 4; i++) { for (let j = 0; j < 4; j++) N4[i][j] += hf * ph[i] * ph[j]; N4[i][4] += hf * ph[i] * yv; } }
        for (let i = 0; i < 4; i++) { let pv = i; for (let r = i + 1; r < 4; r++) if (Math.abs(N4[r][i]) > Math.abs(N4[pv][i])) pv = r; [N4[i], N4[pv]] = [N4[pv], N4[i]]; for (let r = 0; r < 4; r++) if (r !== i && N4[i][i]) { const f = N4[r][i] / N4[i][i]; for (let c = i; c < 5; c++) N4[r][c] -= f * N4[i][c]; } }
        const cf = N4.map((r, i) => (r[i] ? r[4] / r[i] : 0));
        for (let x = 0; x < NX; x++) { const xi = Math.min(xz, Math.max(xa, x)), t = (xi - cx2) / sx, hf = Math.max(0, ct[xi] - cb[xi] + 1); CL[x] = Math.min(cb[xi] + 0.6 * hf, Math.max(cb[xi] + 0.1 * hf, cf[0] + cf[1] * t + cf[2] * t * t + cf[3] * t * t * t)); } }
      const DAT = Buffer.alloc(NX * 8); for (let x = 0; x < NX; x++) { const xi = Math.min(xz, Math.max(xa, x)), bf = hasEye ? Math.max(0, cb[xi]) : 0, hf = hasEye && x >= xa && x <= xz ? Math.max(0, ct[xi] - cb[xi] + 1) : 0, cl = hasEye ? Math.max(0, x >= xa && x <= xz ? CL[x] : bf) : 0;
        DAT[x * 8] = Math.min(255, Math.floor(bf)); DAT[x * 8 + 1] = Math.round((bf % 1) * 255); DAT[x * 8 + 2] = Math.min(255, Math.floor(hf)); DAT[x * 8 + 3] = Math.round((hf % 1) * 255); DAT[x * 8 + 4] = Math.min(255, Math.round(LT9[x] * 4)); DAT[x * 8 + 5] = Math.min(255, Math.round(RB[x]) + 1);
        DAT[x * 8 + 6] = Math.min(255, Math.floor(cl)); DAT[x * 8 + 7] = Math.round((cl % 1) * 255); }
      // glTF v=0 is the image's first row: row 0 = the bottom of the eye box (grid v=0)
      const img = Buffer.alloc(NX * NY * 4); for (let k = 0; k < NX * NY; k++) { img[k * 4] = RGB[k * 3]; img[k * 4 + 1] = RGB[k * 3 + 1]; img[k * 4 + 2] = RGB[k * 3 + 2]; img[k * 4 + 3] = A[k]; }
      // a mirrored (hidden) eye gets no living shell: the head's own painted eye stays under the hair
      if (side === hiddenSide) img.fill(0);
      eyeImgs.push({ img, NX, NY, LID, DAT, lashC, WP, PRM });
      const zOf = (u, v) => { const x = Math.min(NX - 1, Math.floor(u * NX)), y = Math.min(NY - 1, Math.floor(v * NY)); let z = Z[y * NX + x]; if (z < -8) { for (let r2 = 1; r2 < 20 && z < -8; r2++) for (let dy = -r2; dy <= r2; dy++) for (let dx = -r2; dx <= r2; dx++) { const xx = Math.min(NX - 1, Math.max(0, x + dx)), yy = Math.min(NY - 1, Math.max(0, y + dy)); z = Math.max(z, Z[yy * NX + xx]); } } return z; };
      // the shell lies IN FRONT of the head's sculpted relief everywhere (lash ridges, iris bump): its grid follows the
      // surface max-filtered over one grid cell, so no head geometry can poke through between its vertices
      const GS = 96, rr = Math.ceil(NX / GS) + 1, Zfill = new Float32Array(NX * NY), Zmx = new Float32Array(NX * NY);
      for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) Zfill[y * NX + x] = zOf((x + 0.5) / NX, (y + 0.5) / NY);
      // shell depth follows the FACE: hair-only pixels outside the eye take the nearest face depth (hair standing off the
      // face must not pull the shell out into the air)
      { const q = [], ok2 = new Uint8Array(NX * NY); for (let k = 0; k < NX * NY; k++) if (!((HO[k] || Z[k] < -8) && !inR[k])) { ok2[k] = 1; q.push(k); }
        for (let h = 0; h < q.length; h++) { const k = q[h], x = k % NX; for (const k2 of [k - 1, k + 1, k - NX, k + NX]) if (k2 >= 0 && k2 < NX * NY && Math.abs((k2 % NX) - x) <= 1 && !ok2[k2]) { ok2[k2] = 1; Zfill[k2] = Zfill[k]; q.push(k2); } } }
      for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let m2 = -9; for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < NX && yy < NY) m2 = Math.max(m2, Zfill[yy * NX + xx]); } Zmx[y * NX + x] = m2; }
      const lift = lm.eyes.halfH * 0.08;   // clear of the sculpted eye relief, well under any real hair layer's gap (≥ ~1 halfH)
      const zMax = (u, v) => Zmx[Math.min(NY - 1, Math.floor(v * NY)) * NX + Math.min(NX - 1, Math.floor(u * NX))] + lift;
      // the shell's POSITIONS form a smooth DOME over the eye (a raised iris or lash ridge must not put steps in it — steps
      // shift under perspective): the face surface box-blurred (slopes and curvature kept), lifted by a smooth envelope that
      // still clears every relief bump above it (box-blur of a same-radius max-filter never falls below the original)
      const Zdome = (() => { const Zs = Zfill.slice(), T0 = new Float32Array(NX * NY), rb2 = Math.max(2, Math.round(NY * 0.1));
        for (let pass = 0; pass < 2; pass++) { for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let a2 = 0, c2 = 0; for (let d = -rb2; d <= rb2; d++) { const xx = x + d; if (xx >= 0 && xx < NX) { a2 += Zs[y * NX + xx]; c2++; } } T0[y * NX + x] = a2 / c2; }
          for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let a2 = 0, c2 = 0; for (let d = -rb2; d <= rb2; d++) { const yy = y + d; if (yy >= 0 && yy < NY) { a2 += T0[yy * NX + x]; c2++; } } Zs[y * NX + x] = a2 / c2; } }
        const R2 = Math.max(2, Math.round(NY * 0.15)), E = new Float32Array(NX * NY), E2 = new Float32Array(NX * NY), T2 = new Float32Array(NX * NY); for (let k = 0; k < NX * NY; k++) E[k] = Math.max(0, Zfill[k] - Zs[k]);   /* relief above the blurred face — a slope adds none */
        for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let m2 = 0; for (let d = -R2; d <= R2; d++) { const xx = x + d; if (xx >= 0 && xx < NX) m2 = Math.max(m2, E[y * NX + xx]); } T2[y * NX + x] = m2; }
        for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let m2 = 0; for (let d = -R2; d <= R2; d++) { const yy = y + d; if (yy >= 0 && yy < NY) m2 = Math.max(m2, T2[yy * NX + x]); } E2[y * NX + x] = m2; }
        for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let a2 = 0, c2 = 0; for (let d = -R2; d <= R2; d++) { const xx = x + d; if (xx >= 0 && xx < NX) { a2 += E2[y * NX + xx]; c2++; } } T2[y * NX + x] = a2 / c2; }
        for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let a2 = 0, c2 = 0; for (let d = -R2; d <= R2; d++) { const yy = y + d; if (yy >= 0 && yy < NY) { a2 += T2[yy * NX + x]; c2++; } } E[y * NX + x] = Zs[y * NX + x] + a2 / c2; }
        return E; })();
      // interior lift (clears thin sculpted lash spikes the raster cannot sample), tapering to the base lift at the shell
      // border so no sliver shows in profile; well under the ~1 halfH gap to real hair layers
      let RAMPW = null; const LIFT = (() => { const dist = new Float32Array(NX * NY).fill(1e9), q = []; for (let k = 0; k < NX * NY; k++) if (!SH[k]) { dist[k] = 0; q.push(k); }
        for (let h = 0; h < q.length; h++) { const k = q[h], x = k % NX; for (const k2 of [k - 1, k + 1, k - NX, k + NX]) if (k2 >= 0 && k2 < NX * NY && Math.abs((k2 % NX) - x) <= 1 && dist[k2] > dist[k] + 1) { dist[k2] = dist[k] + 1; q.push(k2); } }
        const ramp = Math.max(3, NY * 0.08); RAMPW = dist.map((d) => { const t = Math.min(1, d / ramp); return t * t * (3 - 2 * t); }); return dist.map((d) => lift + lm.eyes.halfH * 0.22 * Math.min(1, d / ramp)); })();
      const zDome = (u, v) => { const k = Math.min(NY - 1, Math.floor(v * NY)) * NX + Math.min(NX - 1, Math.floor(u * NX)); return Zfill[k] + lm.eyes.halfH * 0.02 + (Zdome[k] + LIFT[k] - Zfill[k] - lm.eyes.halfH * 0.02) * RAMPW[k]; };   // the border sits ON the face (no ledge at an angle); the interior keeps its clearance
      // the OPEN eye keeps the true surface normals (its rest shading); they are computed on the relief-following grid
      { const gn = grid(x0, y0, w, hh, GS, zMax, () => [0, 0]); eyeGeo.PN.push(...gn.P); }
      const g = grid(x0, y0, w, hh, GS, zDome, (u, v) => [side / 6 + u / 6, v * NY / (NY + 9)]), o = eyeGeo.P.length / 3;   // atlas: [eyeL | eyeR | lidL | lidR]
      // SMOOTH LID SHADING: the head's sculpted eye relief (eyeball bulge, lid ridges) must not show through a rebuilt lid
      // — inside the shell, normals come from a smoothed surface (blurred depth), blending back to the true normals at the
      // shell border so it meets the surrounding skin without a seam
      { const Zf = Zfill.slice();
        // the LID MEMBRANE: depth inside the shell is a harmonic fill from the depth at its border (the eyeball bump, iris
        // relief and lash ridges never shape it), then lightly blurred below
        { const free = []; for (let k = 0; k < NX * NY; k++) if (SH[k]) free.push(k);
          for (let it = 0; it < 800; it++) for (const k of free) { const x = k % NX, y = (k / NX) | 0; let a2 = 0, c2 = 0;
            if (x > 0) { a2 += Zf[k - 1]; c2++; } if (x < NX - 1) { a2 += Zf[k + 1]; c2++; } if (y > 0) { a2 += Zf[k - NX]; c2++; } if (y < NY - 1) { a2 += Zf[k + NX]; c2++; }
            Zf[k] += 1.85 * (a2 / c2 - Zf[k]); } }
        const rb = Math.max(2, Math.round(NY * 0.05)), tmp = new Float32Array(NX * NY);
        for (let pass = 0; pass < 3; pass++) { for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let a2 = 0, c2 = 0; for (let d = -rb; d <= rb; d++) { const xx = x + d; if (xx >= 0 && xx < NX) { a2 += Zf[y * NX + xx]; c2++; } } tmp[y * NX + x] = a2 / c2; }
          for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let a2 = 0, c2 = 0; for (let d = -rb; d <= rb; d++) { const yy = y + d; if (yy >= 0 && yy < NY) { a2 += tmp[yy * NX + x]; c2++; } } Zf[y * NX + x] = a2 / c2; } }
        const dist = new Float32Array(NX * NY).fill(1e9), q = []; for (let k = 0; k < NX * NY; k++) if (!SH[k]) { dist[k] = 0; q.push(k); }
        for (let h = 0; h < q.length; h++) { const k = q[h], x = k % NX; for (const k2 of [k - 1, k + 1, k - NX, k + NX]) if (k2 >= 0 && k2 < NX * NY && Math.abs((k2 % NX) - x) <= 1 && dist[k2] > dist[k] + 1) { dist[k2] = dist[k] + 1; q.push(k2); } }
        const G = GS, dxw = w / NX, dyw = hh / NY;
        for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { const x = Math.min(NX - 2, Math.max(1, Math.round((i / G) * NX))), y = Math.min(NY - 2, Math.max(1, Math.round((j / G) * NY)));
          const gx = (Zf[y * NX + x + 1] - Zf[y * NX + x - 1]) / (2 * dxw), gy = (Zf[(y + 1) * NX + x] - Zf[(y - 1) * NX + x]) / (2 * dyw), l = Math.hypot(gx, gy, 1);
          const dd = dist[y * NX + Math.min(NX - 1, x)], t = Math.min(1, Math.max(0, (dd - 1) / 4)); eyeGeo.SN.push(-gx / l, -gy / l, 1 / l); eyeGeo.SW.push(t * t * (3 - 2 * t)); const f2 = Math.min(1, Math.max(0, (dd - 0.5) / 1.5));   /* feather only the outermost ~2 px */ eyeGeo.FE.push(f2); } }
      eyeGeo.P.push(...g.P); eyeGeo.UV.push(...g.UV); eyeGeo.I.push(...g.I.map((i) => i + o));
      if (side !== hiddenSide) eyeShells.push({ x0, y0, w, hh, NX, NY, A, ZD: Zdome.map((z, k) => Zfill[k] + lm.eyes.halfH * 0.02 + (z + LIFT[k] - Zfill[k] - lm.eyes.halfH * 0.02) * RAMPW[k]), ZF: Zfill });
    });
    if (eyeImgs[0].NY !== eyeImgs[1].NY || eyeImgs[0].NX !== eyeImgs[1].NX) throw new Error("eye boxes differ in size");
    // + 8 DATA ROWS on top: per column (alpha only — alpha is never colour-converted): opening bottom (int, frac), height (int, frac), lash ×4, rim + 1, closed line (int, frac); row 0's RGB = the eye's own lash colour
    // atlas: [eyeL | eyeR | lidL | lidR | scleraL | scleraR]; row 8 of the data rows = per-eye iris parameters (+ iris colour)
    const NX1 = eyeImgs[0].NX, NXa = 6 * NX1, NYb = eyeImgs[0].NY, NYa = NYb + 9, atlas = Buffer.alloc(NXa * NYa * 4);
    eyeImgs.forEach((e, side) => { const xo0 = side * e.NX, xs = 2 * NX1 + xo0, xw = 4 * NX1 + xo0; for (let y = 0; y < NYb; y++) for (let x = 0; x < e.NX; x++) { const s2 = (y * e.NX + x) * 4; e.img.copy(atlas, (y * NXa + xo0 + x) * 4, s2, s2 + 4); e.LID.copy(atlas, (y * NXa + xs + x) * 4, s2, s2 + 4); e.WP.copy(atlas, (y * NXa + xw + x) * 4, s2, s2 + 4); }
      for (let x = 0; x < e.NX; x++) for (let r = 0; r < 9; r++) { atlas[((NYb + r) * NXa + xo0 + x) * 4 + 3] = r < 8 ? e.DAT[x * 8 + r] : x < 8 ? e.PRM[x * 4 + 3] : 0; if (r === 0) for (let q = 0; q < 3; q++) atlas[(NYb * NXa + xo0 + x) * 4 + q] = e.lashC[q]; atlas[((NYb + r) * NXa + xs + x) * 4 + 3] = 255; atlas[((NYb + r) * NXa + xw + x) * 4 + 3] = 255; }
      for (let q = 0; q < 3; q++) atlas[((NYb + 8) * NXa + xo0) * 4 + q] = e.PRM[q]; });
    const eyeTex = await sharp(atlas, { raw: { width: NXa, height: NYa, channels: 4 } }).webp({ lossless: true }).toBuffer();
    const ePf = Float32Array.from(eyeGeo.P);
    // the true normals stay (the open eye keeps its shading); the smoothed LID normals ride along as _LIDN, blended in by
    // the shader only where lid surface is shown
    const ePN = Float32Array.from(eyeGeo.PN), eN = weldNormals(ePN, computeNormals(ePN, eyeGeo.I)), lidN = new Float32Array(eN.length);
    for (let v = 0; v < eN.length / 3; v++) { const t = eyeGeo.SW[v]; let a2 = 0; for (let c = 0; c < 3; c++) { lidN[v * 3 + c] = eN[v * 3 + c] * (1 - t) + eyeGeo.SN[v * 3 + c] * t; a2 += lidN[v * 3 + c] ** 2; } a2 = Math.sqrt(a2) || 1; for (let c = 0; c < 3; c++) lidN[v * 3 + c] /= a2; }
    faceParts.push({ name: "face_eyes", P: ePf, N: eN, extraAttrs: { _LIDN: { type: "VEC3", array: lidN }, _EDGE: { type: "SCALAR", array: Float32Array.from(eyeGeo.FE) } }, I: eyeGeo.I, UV: Float32Array.from(eyeGeo.UV),
      J: new Uint8Array(ePf.length / 3 * 4).map((_, q) => (q % 4 === 0 ? base.JI.Head : 0)), W: new Float32Array(ePf.length / 3 * 4).map((_, q) => (q % 4 === 0 ? 1 : 0)), material: { name: "face_eyes", texture: eyeTex, roughness: 0.35 } });
    // EYE-REGION GEOMETRY CLEANUP (conservative, universal): generated head geometry that stands IN FRONT of the visible
    // lid/eye surface (lid region or opening — never under hair kept as foreground, never outside the shell) in a SMALL
    // isolated piece (a sculpted lash spike) is pressed back onto the face surface; large pieces are left and reported
    { const nV = OP.length / 3, poke = new Map();
      for (const sh of eyeShells) for (let v = 0; v < nV; v++) { const px = Math.floor((OP[v * 3] - sh.x0) / sh.w * sh.NX), py = Math.floor((OP[v * 3 + 1] - sh.y0) / sh.hh * sh.NY); if (px < 0 || py < 0 || px >= sh.NX || py >= sh.NY) continue;
        const k = py * sh.NX + px, a = sh.A[k]; if ((a === 2 || a === 8 || a === 9) && OP[v * 3 + 2] > sh.ZD[k] - 1e-4) poke.set(v, sh.ZF[k]); }
      const adj = new Map(); for (let t = 0; t < I.length; t += 3) for (const [p2, q2] of [[I[t], I[t + 1]], [I[t + 1], I[t + 2]], [I[t + 2], I[t]]]) if (poke.has(p2) && poke.has(q2)) { (adj.get(p2) ?? adj.set(p2, []).get(p2)).push(q2); (adj.get(q2) ?? adj.set(q2, []).get(q2)).push(p2); }
      const seen = new Set(); let flattened = 0, pieces = 0, skinKept = 0; const kept = [];
      for (const v0 of poke.keys()) { if (seen.has(v0)) continue; const c2 = [v0]; seen.add(v0); for (let h = 0; h < c2.length; h++) for (const u2 of adj.get(c2[h]) ?? []) if (!seen.has(u2)) { seen.add(u2); c2.push(u2); }
        let pr = 0; for (const u2 of c2) pr = Math.max(pr, OP[u2 * 3 + 2] - poke.get(u2));
        // SKIN is never moved (eyelid creases, brows, cheeks are legitimate relief): only a piece that is mostly NON-skin
        // (sculpted lash/hair spikes — classifier hair/other) is pressed
        let nonSkin = 0; for (const u2 of c2) if (outH.cls.label[u2] !== LABEL.SKIN) nonSkin++;
        if (nonSkin * 2 <= c2.length) { skinKept += c2.length; continue; }
        if (c2.length <= 64 && pr <= lm.eyes.halfH) { for (const u2 of c2) OP[u2 * 3 + 2] = Math.min(OP[u2 * 3 + 2], poke.get(u2)); flattened += c2.length; pieces++; } else kept.push({ n: c2.length, protrude: +pr.toFixed(4) }); }
      mount.eyeRegionCleanup = { pieces, vertices: flattened, skinUntouched: skinKept, keptLarge: kept }; console.log(`eye-region cleanup: ${pieces} non-skin spike piece(s), ${flattened} verts pressed · skin relief untouched: ${skinKept} verts · large kept: ${kept.length}`); }
    mount.eyeStrandsRemoved = eyeStrands;
    lm.eyeBake = { sclera: scl[3] ? "#" + scl.slice(0, 3).map((v) => Math.round(v / scl[3]).toString(16).padStart(2, "0")).join("") : "#eeeae4", look: [0.25 * 0.22 / BW, 0.13 / BH], lid: 3 };   // subtle gaze travel
    // the LIP LINE (where a talking mouth opens): the darkest midline row between the nose tip and the chin
    { const bins = new Map(), nz = after.nose.y; for (let v = 0; v < mm; v++) { const y = OP[v * 3 + 1]; if (Math.abs(OP[v * 3]) > after.eyes.sep * 0.06 || y <= after.chin + 0.01 || y >= after.chin + 0.6 * (nz - after.chin) || OP[v * 3 + 2] < after.ears.z + after.eyes.sep * 0.3) continue;
        const b = Math.round(y / 0.004), e = bins.get(b) ?? [0, 0]; e[0] += lum([outH.COL[v * 3], outH.COL[v * 3 + 1], outH.COL[v * 3 + 2]]); e[1]++; bins.set(b, e); }
      let best = null, bl = 1e9; for (const [b, [sum, c]] of bins) if (c >= 3 && sum / c < bl) { bl = sum / c; best = b; }
      if (best !== null) lm.mouth.c[1] = best * 0.004; lm.mouth.lipLine = true; }
    // mouth shell: a grid at the mouth in mouth-half-width units (the shared talking mouth)
    const mw = lm.mouth.halfW * 1.25, mx0 = lm.mouth.c[0] - mw * 1.35, my0 = lm.mouth.c[1] - mw * 1.35, ms = mw * 2.7;
    const MR = raster(mx0, my0, ms, ms, 64, 64);
    const mz = (u, v) => { const x = Math.min(63, Math.floor(u * 64)), y = Math.min(63, Math.floor(v * 64)); return MR.Z[y * 64 + x] > -8 ? MR.Z[y * 64 + x] : lm.mouth.c[2]; };
    const mg = grid(mx0, my0, ms, ms, 40, mz, (u, v) => [(u * 2 - 1) * 1.35, (v * 2 - 1) * 1.35]), mPf = Float32Array.from(mg.P);
    faceParts.push({ name: "face_mouth", P: mPf, N: weldNormals(mPf, computeNormals(mPf, mg.I)), I: mg.I, UV: Float32Array.from(mg.UV),
      J: new Uint8Array(mPf.length / 3 * 4).map((_, q) => (q % 4 === 0 ? base.JI.Head : 0)), W: new Float32Array(mPf.length / 3 * 4).map((_, q) => (q % 4 === 0 ? 1 : 0)), material: { name: "face_mouth", roughness: 0.7 } });
  }
  // CANONICAL CRANIUM FLOOR (universal): behind the ears the identity head (skull + the hair on it) never sits INSIDE the
  // canonical skull — where it does (a shallow generated occiput), it is pushed radially out onto the canonical skull
  // surface, blended in smoothly; heads that already enclose the canonical skull there are untouched
  { const AH = (await io.read(`${BASE_OUT}/identity/alex-neutral-head-v1.glb`)).getRoot().listMeshes(), AP = (AH.find((m) => m.getName() === "identity_head") ?? AH[0]).listPrimitives()[0].getAttribute("POSITION").getArray();
    const CC = [0, 1.25, canon.ears.z], NB = 48, RA = new Float32Array(NB * NB);
    const ang = (x, y, z) => { const dx = x - CC[0], dy = y - CC[1], dz = z - CC[2], r = Math.hypot(dx, dy, dz) || 1e-9; return [Math.acos(Math.max(-1, Math.min(1, dy / r))) / Math.PI * NB - 0.5, (Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI) * NB - 0.5, r]; };
    for (let i = 0; i < AP.length / 3; i++) { if (AP[i * 3 + 1] < 0.78) continue; const [a, b, r] = ang(AP[i * 3], AP[i * 3 + 1], AP[i * 3 + 2]); const k = Math.min(NB - 1, Math.max(0, Math.round(a))) * NB + ((Math.round(b) % NB) + NB) % NB; RA[k] = Math.max(RA[k], r); }
    { const R2 = RA.slice(); for (let t = 0; t < NB; t++) for (let q = 0; q < NB; q++) { let s2 = 0, c2 = 0; for (let dt = -1; dt <= 1; dt++) for (let dq = -1; dq <= 1; dq++) { const tt = t + dt; if (tt < 0 || tt >= NB) continue; const v = R2[tt * NB + ((q + dq) % NB + NB) % NB]; if (v) { s2 += v; c2++; } } if (!R2[t * NB + q] && c2) RA[t * NB + q] = s2 / c2; else if (c2) RA[t * NB + q] = Math.max(R2[t * NB + q], s2 / c2); } }
    const Rat = (a, b) => { const t0 = Math.max(0, Math.min(NB - 1, Math.floor(a))), t1 = Math.min(NB - 1, t0 + 1), ft = Math.max(0, Math.min(1, a - t0)), q0 = ((Math.floor(b) % NB) + NB) % NB, q1 = (q0 + 1) % NB, fq = b - Math.floor(b);
      const g = (t, q) => RA[t * NB + q]; return (g(t0, q0) * (1 - fq) + g(t0, q1) * fq) * (1 - ft) + (g(t1, q0) * (1 - fq) + g(t1, q1) * fq) * ft; };
    const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const moved = []; let worst = 0;
    for (let v = 0; v < mm; v++) { const x = OP[v * 3], y = OP[v * 3 + 1], z = OP[v * 3 + 2]; const w = sm(canon.ears.z - 0.1, canon.ears.z - 0.15, z) * sm(0.92, 0.97, y); if (w <= 0) continue;
      const [a, b, r] = ang(x, y, z), R = Rat(a, b); if (!R || r >= R + 0.004) continue; const nr = r + w * (R + 0.004 - r), f = nr / r; OP[v * 3] = CC[0] + (x - CC[0]) * f; OP[v * 3 + 1] = CC[1] + (y - CC[1]) * f; OP[v * 3 + 2] = CC[2] + (z - CC[2]) * f; moved.push(v); worst = Math.max(worst, nr - r); }
    if (moved.length) { const NN = weldNormals(OP, computeNormals(OP, I)), touch = new Set(moved); for (let t = 0; t < I.length; t += 3) if (touch.has(I[t]) || touch.has(I[t + 1]) || touch.has(I[t + 2])) for (const u of [I[t], I[t + 1], I[t + 2]]) for (let c = 0; c < 3; c++) ON[u * 3 + c] = NN[u * 3 + c]; }
    mount.craniumFloor = { vertices: moved.length, maxPush: +worst.toFixed(4) }; console.log(`canonical cranium floor: ${moved.length} verts pushed onto the canonical skull (max ${worst.toFixed(3)})`); }
  const bytes = await writeModule(out, base, [neckExt.part, skullBasePart, ...faceParts, { name: "identity_head", P: OP, N: ON, I, UV: OUV, J: OJ, W: OW, extraAttrs: { _PAINT: { type: "VEC4", array: new Uint8Array(mm * 4) } }, material: { name: "identity_skin", texture: webp, roughness: 0.8, doubleSided: true } }, ...sockParts],
    { humanIdentity: { id, base: C.HUMAN_BASE_VERSION, source: rawFile, chibify: { alpha, ruleset: rules.upperHead === "stretch" ? "v2" : "v3", rules, S, T, eScale, pScale, faceK: k }, landmarks: lm, hides: [], mount, hairFused: true, chains, hairMotion: mount.hairMotion.preset } }, { compress: false, extraJoints });
  return { skinHex: lm.skin, cls: { skinC: h.cls.skinC, hairC: h.cls.hairC, bald: h.cls.bald, Ts: h.cls.Ts, Th: h.cls.Th, seeds: h.cls.seeds }, mount, canon, src, after, cr, sr, ar: ratios(after), params: { S, T, eScale, pScale, faceK: k, alpha }, out, bytes, verts: mm, tris: I.length / 3 };
}

// ================================ CLI ================================================================================
if (process.argv[1]?.endsWith("chibify.mjs")) {
  const [raw, id, a] = process.argv.slice(2);
  const RULESETS = { v3: CHIBI_RULES, v2: { ...CHIBI_RULES, upperHead: "stretch" } }, ruleset = process.argv.find((x) => x.startsWith("--ruleset="))?.slice(10) ?? "v3";
  const opts = { id, rules: RULESETS[ruleset], alpha: a && !a.startsWith("--") ? Number(a) : 0.35, remeasureCanon: process.argv.includes("--remeasure-canon"), hairLength: process.argv.find((x) => x.startsWith("--hair="))?.slice(7) ?? "natural", hairMotion: process.argv.find((x) => x.startsWith("--motion="))?.slice(9) ?? null };
  // CANONICAL DEPTH BAND (universal): eye-plane depth in front of the canonical ear plane must lie within ±5% of the
  // canonical skull's (Alex: alex-neutral-head-v1). Outside it, the fit is rerun with a depth scale that brings it to the
  // nearest band edge (minimal change); inside it, nothing changes.
  const alexLm = (await io.read(`${BASE_OUT}/identity/alex-neutral-head-v1.glb`)).getRoot().listScenes()[0].getExtras().humanIdentity.landmarks, DEPTH_TOL = 0.05;
  let r = await chibify(raw, opts);
  const eyeZ = (q) => (q.after.eyes.l.c[2] + q.after.eyes.r.c[2]) / 2, d0 = alexLm.eyes.l[2] - r.canon.ears.z;
  { let k = 1, ratio = (eyeZ(r) - r.canon.ears.z) / d0; const first = ratio;
    for (let pass = 0; pass < 3 && Math.abs(ratio - 1) > DEPTH_TOL + 0.005; pass++) { k *= (1 + Math.sign(ratio - 1) * DEPTH_TOL) / ratio; r = await chibify(raw, { ...opts, depthK: k, depthInfo: { measured: +first.toFixed(4), k: +k.toFixed(4), band: DEPTH_TOL } }); ratio = (eyeZ(r) - r.canon.ears.z) / d0; }
    console.log(`canonical depth: eye-plane depth ${(first * 100).toFixed(1)}% of canonical → ${(ratio * 100).toFixed(1)}% (depth scale ${k.toFixed(4)}${k === 1 ? ", inside the ±5% band — unchanged" : ""})`); }
  const f = (v) => (typeof v === "number" ? +v.toFixed(3) : v);
  const row = (k, c, s, x) => console.log(`${k.padEnd(22)} canon ${String(f(c)).padEnd(8)} source ${String(f(s)).padEnd(8)} after ${f(x)}`);
  console.log(`eye strands repainted: ${r.mount.eyeStrandsRemoved ?? 0} · long hair kept ${r.mount.longHairKept}`);
  console.log(`measured: eyes via ${r.src.eyeSource}${r.src.eyeMirrored ? ` (${r.src.eyeMirrored} eye mirrored)` : ""} · chin via ${r.src.chinSource} · neck via ${r.mount.neckSource} · shoulder y ${f(r.mount.bodyVsHair.shoulderY)}`);
  console.log(`params: skull scale ${f(r.params.S)} · eye scale ${f(r.params.eScale)} · projection ×${f(r.params.pScale)} · lower face ×${f(r.params.faceK)} · α ${r.params.alpha}`);
  for (const k of ["faceLength", "projection", "lip", "eyeW", "jaw", "cheek"]) row(`${k} / skull`, r.cr[k], r.sr[k], r.ar[k]);
  row("socket depth (abs)", r.canon.socketDepth ?? "-", r.src.socketDepth, r.after.socketDepth);
  row("eye halfH (abs)", r.canon.eyeHalfH ?? "-", r.src.eyeHalfH, r.after.eyeHalfH);
  row("eye line y", r.canon.eyes.y, r.src.eyes.y, r.after.eyes.y);
  row("ear half (skull)", r.canon.ears.half, r.src.ears.half, r.after.ears.half);
  row("chin y", r.canon.chin, r.src.chin, r.after.chin);
  console.log(`classes: skin ${r.cls.skinC.map((v) => v.toFixed(1))} hair ${r.cls.hairC ? r.cls.hairC.map((v) => v.toFixed(1)) : "(bald)"} · Ts ${f(r.cls.Ts)} Th ${f(r.cls.Th)} · eyes via ${r.src.eyeSource} · neck via ${r.mount.neckSource} (skin ${f(r.mount.skinNeck.hx * 2)}×${f(r.mount.skinNeck.hz * 2)}, geometry ${r.mount.geomNeck ? f(r.mount.geomNeck.hx * 2) + "×" + f(r.mount.geomNeck.hz * 2) : "n/a"}) · long hair kept ${r.mount.longHairKept}`);
  console.log(`skin tone (measured): ${r.skinHex} · hair motion ${JSON.stringify(r.mount.hairMotion)}`);
  console.log(`body vs hair: ${JSON.stringify(r.mount.bodyVsHair)} · hair: ${JSON.stringify(r.mount.hair)}`);
  console.log(`mount: head base y ${f(r.mount.headTop)} · skull base y ${f(r.mount.skullBase.min)}–${f(r.mount.skullBase.max)} · neck extension y ${f(r.mount.neckExtension.from)}→${f(r.mount.neckExtension.to)} (base neck top ${f(r.mount.neckExtension.baseNeckTop)}) · below-Alex anatomy removed ${r.mount.napeRemoved} (front/jaw ${r.mount.faceTrim}) · holes closed ${r.mount.holesClosed} · bust removed ${r.mount.bustRemoved} · socket loops ${r.mount.socketLoops} (${r.mount.socketTris} tris) · attach y ${f(r.mount.attachY)} · cut y ${f(r.mount.cutY)} · base neck ${f(r.mount.baseNeck.hx * 2)}×${f(r.mount.baseNeck.hz * 2)} @z${f(r.mount.baseNeck.cz)} · generated neck ${f(r.mount.generatedNeck.hx * 2)}×${f(r.mount.generatedNeck.hz * 2)} @z${f(r.mount.generatedNeck.cz)}`);
  console.log(`${r.out} · ${r.verts} verts ${r.tris} tris · ${(r.bytes / 1048576).toFixed(1)} MB`);
  fs.writeFileSync(`scripts/avatar-pipeline/output/human-base/${process.argv[3]}-chibify.json`, JSON.stringify({ params: r.params, canon: r.cr, source: r.sr, after: r.ar, abs: { canon: r.canon, src: r.src, after: r.after } }, null, 1));
}
