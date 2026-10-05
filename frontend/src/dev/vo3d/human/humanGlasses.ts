// vo3d human — GLASSES FITTING (V1.1): any glasses style on any identity, from the identity's measured face.
//
// A glasses module is authored in FIT SPACE (build-glasses.mjs): every vertex carries `_GFIT` = [part, a, b, c]
//   part 0 (front: rims, lenses' frame, bridge): (a, b, c) = (x, y, z) in units of the eye separation, eye midpoint at the
//          origin, the lens plane at z = 0 (before wrap);
//   part 1 / 2 (temple on the +x / −x side): a = t along the temple (0 hinge → 1 tip), (b, c) = cross-section offset
//          (horizontal normal, up) in eye-separation units.
// The identity publishes `landmarks.glassesFit` (chibify.mjs), measured on its own skin surface: a front height field over
// eyes / brows / nose bridge, the face half-width at the eye line, the side of the head along the temple path, the ears.
// The fit (the same rules for every face and style) — the frame looks MADE for this face, the style stays itself:
//   · ONE uniform scale k for the whole front (a round frame stays round): from the temples (hinges just outside the
//     measured head width at the eye line) and the eye region (each lens covers its eye), bounded around the eye spacing;
//   · LENSES centred on the pupils (+ the style's offset); only the BRIDGE adapts its width between them;
//   · DEPTH: the lens plane clears lashes / lids in each lens footprint by the style's standoff; the bridge RESTS on the
//     measured nose bridge; a nose or cheek under the lower rims is cleared by a bounded lift + pantoscopic tilt first,
//     and only the remainder pushes the frame forward (never floating off the face);
//   · TEMPLES from the hinges back along the side of the head (just outside skin, under hair) OVER the ear top, then
//     tucked down behind the ear (the wearer's own ear anchors, `landmarks.attach.ears`).
import * as THREE from "three";

export type GlassesFitData = {
  v: 1;
  grid: { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; z: (number | null)[] };
  faceHalfW: number;
  side: { y: number[]; z0: number; dz: number; n: number; x: (number | null)[][] };
  ear: [number, number, number];
};
/** a style's fit-space design (sep units), published by the module (humanAccessory.fit) */
export type GlassesDesign = { lens: { dx: number; dy: number; halfW: number; halfH: number }; hingeX: number; templeY: number; standoff: number; wrap: number; rimDepth: number };
type Eyes = { l: readonly number[]; r: readonly number[] };

const CLEAR = 0.008;   // temple clearance off the skin (native head units)
type EarSet = { l: { top: number[] | null; back: number[] | null; outer: number[] | null }; r: { top: number[] | null; back: number[] | null; outer: number[] | null } };
export type GlassesAttach = { nose?: { bridge: number[] | null }; ears?: EarSet } | null | undefined;

/** the bridge zone in fit space: |a| below the inner lens edge */
const innerEdge = (d: GlassesDesign) => 0.5 + d.lens.dx - d.lens.halfW;

export function glassesFrame(design: GlassesDesign, eyes: Eyes & { halfW?: number; halfH?: number }, fit: GlassesFitData, front?: ArrayLike<number>, attach?: GlassesAttach) {
  const s = eyes.r[0] - eyes.l[0], ey = (eyes.l[1] + eyes.r[1]) / 2, ez = (eyes.l[2] + eyes.r[2]) / 2, lx = 0.5 + design.lens.dx;
  const G = fit.grid;
  const faceAt = (X: number, Y: number): number | null => { const fx = (X - G.x0) / G.dx, fy = (Y - G.y0) / G.dy, i = Math.floor(fx), j = Math.floor(fy); if (i < 0 || j < 0 || i >= G.nx - 1 || j >= G.ny - 1) return null;
    let a = 0, w = 0; for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const z = G.z[(j + dj) * G.nx + i + di]; if (z === null) continue; const ww = (di ? fx - i : 1 - (fx - i)) * (dj ? fy - j : 1 - (fy - j)); a += z * ww; w += ww; } return w > 1e-6 ? a / w : null; };
  const sideX = (y: number, z: number): number | null => { const S = fit.side, k = (z - S.z0) / S.dz; if (k < -0.4) return null; /* in front of the measured profile: no side there */ const k0 = Math.max(0, Math.min(S.n - 1, Math.floor(k))), k1 = Math.min(S.n - 1, k0 + 1), fk = Math.max(0, Math.min(1, k - k0));
    const row = (r: number) => { const a = S.x[r][k0], b = S.x[r][k1]; return a === null ? b : b === null ? a : a + (b - a) * fk; };
    let r0 = 0; while (r0 < S.y.length - 2 && y > S.y[r0 + 1]) r0++; const fy = Math.max(0, Math.min(1, (y - S.y[r0]) / (S.y[r0 + 1] - S.y[r0]))), a = row(r0), b = row(r0 + 1);
    return a === null ? b : b === null ? a : a + (b - a) * fy; };
  // UNIFORM SCALE k (head units per fit-space unit): the style is drawn in eye-separation units, so k = the wearer's eye
  // separation — at least enough for each lens to cover its eye; grown (≤ ×1.12) only if a hinge would sit in the face
  const temple = Math.max(sideX(ey, ez - 0.02) ?? 0, fit.faceHalfW * 0.9);
  const kE = Math.max(((eyes.halfH ?? 0.25 * s) * 1.25) / design.lens.halfH, ((eyes.halfW ?? 0.3 * s) * 1.1) / design.lens.halfW);
  const solve = (k: number, wide = 0) => {
    const cL = (lx + wide) * s;   // lens centre (pupil + style offset; + a bounded bridge widening for a prominent nose)
    const ie = innerEdge(design), ieH = cL - design.lens.halfW * k;
    const mapX = (a: number) => { const sg = Math.sign(a) || 1, aa = Math.abs(a); return aa >= ie ? sg * (cL + (aa - lx) * k) : a * (ieH / Math.max(1e-4, ie)); };
    const lhh = design.lens.halfH * k;
    // LENS PLANE: lashes / lids in each EYE box (cheeks and brows below/above the rims are cleared by lift/tilt below)
    const ehw = eyes.halfW ?? 0.3 * s, ehh = eyes.halfH ?? 0.2 * s; let zLash = -9;
    for (const sg of [-1, 1]) for (let u = -1; u <= 1.001; u += 0.125) for (let v = -1; v <= 1.001; v += 0.125) { if (u * u + v * v > 1) continue; const z = faceAt(sg * s * 0.5 + u * ehw, ey + v * ehh); if (z !== null) zLash = Math.max(zLash, z); }
    if (zLash < -8) zLash = ez + 0.02;
    let zPlane = zLash + Math.max(0.01, design.standoff * k);
    // the BRIDGE rests on the nose bridge (its back face 4 mm-eq off the measured bridge)
    let bridgeB = 9, bridgeY = 0, nb = 0; if (front) for (let i = 0; i < front.length; i += 4) if (Math.abs(front[i + 1]) < ie * 0.6) { bridgeB = Math.min(bridgeB, front[i + 3]); bridgeY += front[i + 2]; nb++; }
    const yBr = ey + (nb ? bridgeY / nb : 0) * k, fb = faceAt(0, yBr), noseZ = attach?.nose?.bridge ? Math.max(attach.nose.bridge[2], fb ?? -9) : fb;
    if (noseZ !== null && noseZ > -8 && nb) zPlane = Math.max(zPlane, noseZ + 0.004 - bridgeB * k);
    // WRAP: rigid, the style's own curve or the face's curvature at the eye line beyond the eyes
    const refZ = faceAt(cL, ey) ?? faceAt(-cL, ey) ?? zPlane;
    const curve = (X: number) => { const ax = Math.abs(X), sty = design.wrap * Math.max(0, ax - 0.3 * k) ** 2 / k, fz = ax > cL ? faceAt(Math.sign(X) * ax, ey) : null, face = fz === null ? 0 : Math.max(0, refZ - fz) * 0.75; return Math.max(sty, face); };
    // CLEARANCE: a bounded LIFT (≤ 35% of the lens half-height) and pantoscopic TILT before any forward push
    let d0 = 0, tilt = 0, lift = 0;
    if (front && front.length) { let best = { cost: 1e9, d: 0, t: 0, l: 0 };
      for (let li = 0; li <= 4; li++) for (let t = 0; t <= 0.3001; t += 0.05) { const l = (li / 4) * 0.35 * lhh; let d = 0;
        for (let i = 0; i < front.length; i += 4) { const X = mapX(front[i + 1]), Y = ey + l + front[i + 2] * k, Z = zPlane - curve(X) + t * (ey + l - Y) + front[i + 3] * k, f = faceAt(X, Y); if (f !== null) d = Math.max(d, f + 0.006 - Z); }
        const cost = 4 * d + 0.2 * l + 0.1 * t * lhh; if (cost < best.cost) best = { cost, d, t, l }; }
      d0 = best.d; tilt = best.t; lift = best.l; }
    const zFront = (X: number, Y = ey) => zPlane - curve(X) + d0 + tilt * (ey + lift - Y);
    const hingeX = cL + (design.hingeX - lx) * k, hy = ey + lift + design.templeY * k, fh = faceAt(hingeX, hy), hingeIn = fh !== null && fh > zFront(hingeX, hy) - design.rimDepth * k - 0.004;
    return { k, mapX, zPlane, zFront, d0, tilt, lift, hingeX, hingeIn, cL };
  };
  // the size that fits best: nominal first; a uniform shrink (never below eye coverage) when a prominent nose / cheek
  // would otherwise push the frame off the face; a uniform grow when a hinge would sit in the face
  const k0 = Math.min(1.12 * s, Math.max(s, kE)); let R = solve(k0), bestC = 4 * R.d0 + (R.hingeIn ? 1 : 0);
  for (const f of [1, 0.95, 0.9, 0.85, 1.03, 1.06, 1.09, 1.12]) for (const wd of [0, 0.03, 0.06, 0.09]) { const kk = k0 * f; if ((f === 1 && wd === 0) || kk < kE || kk > 1.12 * s) continue;
    const R2 = solve(kk, wd), c = 4 * R2.d0 + 0.5 * s * Math.abs(1 - kk / k0) + 0.4 * s * wd + (R2.hingeIn ? 1 : 0); if (c < bestC) { bestC = c; R = R2; } }
  const { k, mapX, zPlane, zFront, d0, tilt, lift, hingeX, cL } = R;
  return { s, k, sx: k, ey, lift, zPlane, zFront, sideX, faceAt, d0, tilt, mapX, temple, hingeX, bridgeWiden: cL / s - lx };
}

const _up = new THREE.Vector3(0, 1, 0);
/** fitted positions for a glasses geometry (from its `_gfit` attribute) on one identity */
export function fitGlassesPositions(gfit: ArrayLike<number>, design: GlassesDesign, eyes: Eyes & { halfW?: number; halfH?: number }, fit: GlassesFitData, attach?: GlassesAttach): Float32Array {
  const n = gfit.length / 4, front: number[] = []; for (let i = 0; i < n; i++) if (Math.round(gfit[i * 4]) === 0) front.push(gfit[i * 4], gfit[i * 4 + 1], gfit[i * 4 + 2], gfit[i * 4 + 3]);
  const F = glassesFrame(design, eyes, fit, front, attach), out = new Float32Array(n * 3);
  const temple = (sg: number) => {
    const hx = sg * F.hingeX, hy = F.ey + F.lift + design.templeY * F.k, H = new THREE.Vector3(hx, hy, F.zFront(hx, hy) - design.rimDepth * 0.5 * F.k);
    // over the TOP of the wearer's ear (its own anchor), then tucked down behind it
    const ear = attach?.ears?.[sg > 0 ? "r" : "l"], top = ear?.top, back = ear?.back;
    // (V1.2: never medial of the measured ear plane — an ear top that curls in toward the head would route the arm through the skull)
    const eTop = top ? new THREE.Vector3(sg * Math.max(Math.abs(top[0]) + CLEAR * 0.5, fit.ear[0] - 0.02), top[1] + 0.012, top[2]) : new THREE.Vector3(sg * (fit.ear[0] + CLEAR), fit.ear[1] + 0.02 * F.s, fit.ear[2]);
    const tuck = back ? new THREE.Vector3(sg * (Math.abs(back[0]) - 0.012), (top ? top[1] : eTop.y) - 0.09 * F.s, back[2] - 0.02) : new THREE.Vector3(sg * (fit.ear[0] - 0.02), eTop.y - 0.13 * F.s, eTop.z - 0.2 * F.s);
    // the END PIECE: from the hinge the temple first steps sideways past the cheek at that depth (chibi faces are wide for
    // their eye spacing), then runs back along the side profile (dense control points) over the ear top, then tucks
    const out = (y: number, z: number) => (F.sideX(y, z) ?? 0) + CLEAR + 0.012 * F.k;
    const J = new THREE.Vector3(sg * Math.max(Math.abs(H.x), out(H.y, H.z - 0.02)), H.y, H.z - 0.02);
    const pts = [H, J];
    for (const f of [0.15, 0.3, 0.45, 0.6, 0.72]) { const z = J.z + (eTop.z - J.z) * f, y = J.y + (eTop.y - J.y) * f, x = Math.max(Math.abs(J.x + (eTop.x - J.x) * f), out(y, z)); pts.push(new THREE.Vector3(sg * x, y, z)); }
    pts.push(eTop, tuck);
    return new THREE.CatmullRomCurve3(pts, false, "centripetal");
  };
  const curves = new Map<number, THREE.CatmullRomCurve3>();
  const c = new THREE.Vector3(), tg = new THREE.Vector3(), nh = new THREE.Vector3();
  for (let i = 0; i < n; i++) { const part = Math.round(gfit[i * 4]), a = gfit[i * 4 + 1], b = gfit[i * 4 + 2], d = gfit[i * 4 + 3];
    // (the rigid fit clears the face; a 2 mm-eq floor over the face field catches what the sampled clearance missed)
    if (part === 0) { const X = F.mapX(a), Y = F.ey + F.lift + b * F.k, f = F.faceAt(X, Y); out[i * 3] = X; out[i * 3 + 1] = Y; out[i * 3 + 2] = Math.max(F.zFront(X, Y) + d * F.k, f === null ? -9 : f + 0.002); continue; }
    const sg = part === 1 ? 1 : -1; let cv = curves.get(sg); if (!cv) { cv = temple(sg); curves.set(sg, cv); }
    const t = Math.min(1, Math.max(0, a)); cv.getPointAt(t, c); cv.getTangentAt(t, tg); nh.crossVectors(_up, tg).normalize().multiplyScalar(sg);
    // the temple's CENTRELINE stays outside the wearer's side profile all the way to the ear (a spline can dip between
    // its control points) — then the tuck behind the ear is free
    { const wt = Math.min(1, t / 0.04) * Math.max(0, Math.min(1, (0.74 - t) / 0.1)); /* attached at the hinge, free over the ear */
      const fz = F.faceAt(c.x, c.y), side = wt > 0 && (fz === null || c.z < fz + 0.01) ? F.sideX(c.y, c.z) : null; if (side !== null) { const need = side + CLEAR * 0.6 + 0.012 * F.k; if (Math.abs(c.x) < need) c.x = sg * (Math.abs(c.x) + (need - Math.abs(c.x)) * wt); } }
    out[i * 3] = c.x + nh.x * b * F.k; out[i * 3 + 1] = c.y + d * F.k; out[i * 3 + 2] = c.z + nh.z * b * F.k; }
  return out;
}

export type GlassesCheck = { inFace: number; templeInHead: number; minFrontGap: number; maxFrontGap: number; floating: boolean; widthRatio: number; templeToEar: number | null; ok: boolean; issues: string[] };
/** PRECISE glasses validation on the wearer's own face field + side profile (the radial envelope is too coarse near the
 *  nose / ears): frame inside the face, temples inside the head, floating off the face, over/undersized, temples that do
 *  not reach the ears */
export function checkGlasses(pos: ArrayLike<number>, gfit: ArrayLike<number>, fit: GlassesFitData, attach?: GlassesAttach): GlassesCheck {
  const G = fit.grid, n = gfit.length / 4; let inFace = 0, templeIn = 0, minGap = 9, maxGap = -9, x0 = 9, x1 = -9, reach = 9;
  const F0 = glassesFrame({ lens: { dx: 0, dy: 0, halfW: 0.3, halfH: 0.2 }, hingeX: 0.8, templeY: 0, standoff: 0, wrap: 0, rimDepth: 0 }, { l: [-0.15, G.y0 + G.dy * G.ny * 0.5, 0], r: [0.15, G.y0 + G.dy * G.ny * 0.5, 0] }, fit);
  for (let i = 0; i < n; i++) { const part = Math.round(gfit[i * 4]), x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (part === 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); const f = F0.faceAt(x, y); if (f !== null) { const g = z - f; if (g < -0.002) inFace++; minGap = Math.min(minGap, g); maxGap = Math.max(maxGap, g); } continue; }
    const t = gfit[i * 4 + 1];
    if (t > 0.05 && t < 0.7) { const sx = F0.sideX(y, z), fz = F0.faceAt(x, y);   /* (t ≤ 0.05 = the hinge: validated with the front) */ /* inside = within the silhouette AND behind the frontal surface there */ if (sx !== null && Math.abs(x) < sx - 0.006 && (fz === null || z < fz - 0.004)) templeIn++; }
    const e = attach?.ears?.[part === 1 ? "r" : "l"]?.top; if (e && t > 0.7 && t < 0.9) reach = Math.min(reach, Math.hypot(x - e[0], y - e[1], z - e[2])); }
  const widthRatio = (x1 - x0) / (2 * Math.max(fit.faceHalfW, 0.2)), issues: string[] = [];
  if (inFace > 0) issues.push(`frame in face ${inFace}`); if (templeIn > 0) issues.push(`temple in head ${templeIn}`);
  const floating = minGap > 0.06; if (floating) issues.push(`floating (closest ${minGap.toFixed(3)})`);
  if (widthRatio > 1.35 || widthRatio < 0.7) issues.push(`width ${widthRatio.toFixed(2)} × face`);
  if (reach < 8 && reach > 0.06) issues.push(`temple misses the ear by ${reach.toFixed(3)}`);
  return { inFace, templeInHead: templeIn, minFrontGap: +minGap.toFixed(4), maxFrontGap: +maxGap.toFixed(4), floating, widthRatio: +widthRatio.toFixed(3), templeToEar: reach < 8 ? +reach.toFixed(3) : null, ok: issues.length === 0, issues };
}
