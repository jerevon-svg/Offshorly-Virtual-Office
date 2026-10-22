// v3/identity/extract.mjs — STAGE 0: illustrated image → automatic dense 2D identity representation.
// ZERO CREDITS, local only. One generalized path for every input: names only identify files; no per-person code,
// thresholds or descriptions. MediaPipe (Apache-2.0 code + weights, run in local Chrome via ../landmarks2d.mjs) is used
// ONLY as a coarse frame + seed locator. Every contour/feature point is measured from IMAGE evidence (skin / stroke /
// hair regions), so the representation cannot regress to MediaPipe's mean face. Unobservable evidence is labelled, never
// invented.
import { createRequire } from "node:module";
const require = createRequire("/Users/lekoffshorly/Documents/AI Agents/frontend/package.json");
const sharp = require("sharp");

// ---------- canonical frame ----------
export const CW = 1024, CH = 1152, CX = 512, CY = 448, IOD = 160; // eye-mid at (CX,CY), eye line horizontal, IOD px
const N_RAYS = 96;

// ---------- colour ----------
const LIN = new Float64Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const f3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
export function lab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const fx = f3((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), fy = f3(0.2126729 * R + 0.7151522 * G + 0.072175 * B), fz = f3((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// ---------- small linear algebra / stats ----------
const median = (a) => { if (!a.length) return NaN; const s = Float64Array.from(a).sort(); const m = s.length >> 1; return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2; };
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
function kmeans(pts, k, iters = 25) { // deterministic: init at lightness quantiles
  const ord = pts.map((p, i) => [p[0], i]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let C = Array.from({ length: k }, (_, j) => pts[ord[Math.min(ord.length - 1, Math.floor(((j + 0.5) / k) * ord.length))][1]].slice());
  let lab_ = new Int32Array(pts.length);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < pts.length; i++) { let bj = 0, bd = Infinity; for (let j = 0; j < k; j++) { const d = (pts[i][0] - C[j][0]) ** 2 + (pts[i][1] - C[j][1]) ** 2 + (pts[i][2] - C[j][2]) ** 2; if (d < bd) { bd = d; bj = j; } } lab_[i] = bj; }
    const S = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) { const s = S[lab_[i]]; s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++; }
    C = C.map((c, j) => (S[j][3] ? [S[j][0] / S[j][3], S[j][1] / S[j][3], S[j][2] / S[j][3]] : c));
  }
  return { centers: C, assign: lab_ };
}

// ---------- masks ----------
function components(mask, W, H) { // 4-connected; returns Int32Array labels (0 = none) + sizes
  const L = new Int32Array(W * H), sizes = [0]; let n = 0; const q = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || L[s]) continue; n++; let h = 0, t = 0; q[t++] = s; L[s] = n; let sz = 0;
    while (h < t) { const p = q[h++]; sz++; const x = p % W, y = (p / W) | 0;
      if (x > 0 && mask[p - 1] && !L[p - 1]) { L[p - 1] = n; q[t++] = p - 1; }
      if (x < W - 1 && mask[p + 1] && !L[p + 1]) { L[p + 1] = n; q[t++] = p + 1; }
      if (y > 0 && mask[p - W] && !L[p - W]) { L[p - W] = n; q[t++] = p - W; }
      if (y < H - 1 && mask[p + W] && !L[p + W]) { L[p + W] = n; q[t++] = p + W; } }
    sizes.push(sz);
  }
  return { L, sizes, n };
}
function erode(m, W, H, r) { // square structuring element, separable
  const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let run = 0; const row = y * W; const c = new Int32Array(W + 1); for (let x = 0; x < W; x++) c[x + 1] = c[x] + (m[row + x] ? 1 : 0);
    for (let x = 0; x < W; x++) { const a = Math.max(0, x - r), b = Math.min(W - 1, x + r); t[row + x] = c[b + 1] - c[a] === b - a + 1 ? 1 : 0; } void run; }
  for (let x = 0; x < W; x++) { const c = new Int32Array(H + 1); for (let y = 0; y < H; y++) c[y + 1] = c[y] + t[y * W + x];
    for (let y = 0; y < H; y++) { const a = Math.max(0, y - r), b = Math.min(H - 1, y + r); o[y * W + x] = c[b + 1] - c[a] === b - a + 1 ? 1 : 0; } }
  return o;
}
const notM = (m) => m.map((v) => (v ? 0 : 1));
const dilate = (m, W, H, r) => notM(erode(notM(m), W, H, r));
function fillPoly(poly, W, H) { // even-odd scanline
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { const xs = []; for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)); }
    xs.sort((a, b) => a - b); for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.max(0, Math.ceil(xs[i])); x <= Math.min(W - 1, Math.floor(xs[i + 1])); x++) m[y * W + x] = 1; }
  return m;
}
function hull(pts) { const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1)); }

// ---------- MediaPipe index groups (generic face-mesh topology, used only as seeds) ----------
const MP = {
  irisR: 468, irisL: 473, noseTip: 1, lipTop: 0, lipBot: 17, mouthIn: [13, 14], cornerR: 61, cornerL: 291,
  eyeR: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], eyeL: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  browR: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46], browL: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  nose: [1, 2, 98, 327, 129, 358, 64, 294, 168, 6, 197, 195, 5, 4],
  mouth: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
  skinSeeds: [50, 280, 101, 330, 36, 266, 205, 425, 187, 411, 123, 352, 117, 346, 118, 347, 147, 376, 213, 433, 192, 416, 207, 427, 151, 9, 108, 337, 69, 299, 104, 333, 6, 197, 195, 5, 199, 175, 200, 201, 421, 211, 431, 32, 262],
};

// ---------- 1. source normalisation (background) ----------
export async function loadSource(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, px = new Uint8ClampedArray(data);
  let transparent = 0; for (let i = 3; i < px.length; i += 4) if (px[i] < 128) transparent++;
  const bg = { mode: "alpha", transparentFrac: transparent / (W * H) };
  if (bg.transparentFrac < 0.005) { // opaque input: background = dominant colours on the top + upper-side borders, flood-filled from the border
    const samp = [], idx = [];
    const push = (x, y) => { const i = (y * W + x) * 4; samp.push(lab(px[i], px[i + 1], px[i + 2])); idx.push(y * W + x); };
    for (let x = 0; x < W; x += 2) for (let y = 0; y < 3; y++) push(x, y);
    for (let y = 0; y < Math.floor(H * 0.7); y += 2) for (let x = 0; x < 3; x++) { push(x, y); push(W - 1 - x, y); }
    const km = kmeans(samp, 4), share = [0, 0, 0, 0]; for (const a of km.assign) share[a]++;
    const order = [0, 1, 2, 3].sort((a, b) => share[b] - share[a]); const keep = []; let cum = 0;
    for (const j of order) { if (cum >= 0.8 * samp.length) break; keep.push(km.centers[j]); cum += share[j]; }
    const near = (p) => { const l = lab(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]); return keep.some((c) => (l[0] - c[0]) ** 2 + (l[1] - c[1]) ** 2 + (l[2] - c[2]) ** 2 < 100); };
    const seen = new Uint8Array(W * H), q = []; for (const p of idx) if (!seen[p] && near(p)) { seen[p] = 1; q.push(p); }
    for (let h = 0; h < q.length; h++) { const p = q[h], x = p % W, y = (p / W) | 0;
      for (const n of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (n >= 0 && !seen[n] && near(n)) { seen[n] = 1; q.push(n); } }
    // FC-BACKDROP-SHADOW (learned): a cast shadow on the backdrop never touches the border, so the first flood misses it
    // and it reads as hair. Extend smoothly from background into darker pixels of the SAME chromaticity as a backdrop colour.
    // Only CHROMATIC backdrops qualify (an achromatic backdrop's shadow is indistinguishable from grey/black hair by colour).
    const chromatic = keep.filter((c) => Math.hypot(c[1], c[2]) >= 6);
    const chromaNear = (p) => { const l = lab(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]); return chromatic.some((c) => Math.hypot(l[1] - c[1], l[2] - c[2]) < 5 && l[0] > 0.45 * c[0] && l[0] < c[0] + 5); };
    if (chromatic.length) for (let h = 0; h < q.length; h++) { const p = q[h], x = p % W, y = (p / W) | 0;
      for (const n of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (n >= 0 && !seen[n] && chromaNear(n)) { seen[n] = 1; q.push(n); } }
    for (let p = 0; p < W * H; p++) if (seen[p]) px[p * 4 + 3] = 0;
    Object.assign(bg, { mode: "border-flood", clusters: keep.map((c) => c.map((v) => +v.toFixed(1))), bgFrac: q.length / (W * H) });
  }
  return { W, H, px, bg };
}

// ---------- 2. canonical resample (eye-mid → (CX,CY), roll removed, IOD → 160 px) ----------
export async function canonical(src0, lm0) {
  // FC-ALIAS-THIN-LINES (learned from the noise test): plain bilinear sampling at ~0.4× aliased 1–3 px drawn lines into
  // dotted fragments that changed with scale/roll. Downscale with a proper low-pass filter FIRST, then rotate/translate ≈1:1.
  let src = src0, lm = lm0;
  { const eR = lm0[MP.irisR], eL = lm0[MP.irisL], k = IOD / Math.hypot(eL[0] - eR[0], eL[1] - eR[1]);
    if (k < 0.999) { const w = Math.max(1, Math.round(src0.W * k)), h = Math.max(1, Math.round(src0.H * k));
      const data = await sharp(Buffer.from(src0.px.buffer), { raw: { width: src0.W, height: src0.H, channels: 4 } }).resize(w, h, { kernel: "lanczos3", fit: "fill" }).raw().toBuffer();
      src = { W: w, H: h, px: new Uint8ClampedArray(data) }; lm = lm0.map((p) => [p[0] * (w / src0.W), p[1] * (h / src0.H), p[2]]); } }
  const eR = lm[MP.irisR], eL = lm[MP.irisL], em = [(eR[0] + eL[0]) / 2, (eR[1] + eL[1]) / 2];
  const roll = Math.atan2(eL[1] - eR[1], eL[0] - eR[0]), iod = Math.hypot(eL[0] - eR[0], eL[1] - eR[1]), s = IOD / iod, co = Math.cos(roll), si = Math.sin(roll);
  const rgb = new Uint8ClampedArray(CW * CH * 3), A = new Uint8Array(CW * CH), OUT = new Uint8Array(CW * CH);
  const { W, H, px } = src;
  for (let v = 0; v < CH; v++) for (let u = 0; u < CW; u++) {
    const dx = (u - CX) / s, dy = (v - CY) / s, sx = em[0] + co * dx - si * dy, sy = em[1] + si * dx + co * dy, o = v * CW + u;
    if (sx < 0 || sy < 0 || sx > W - 1 || sy > H - 1) { OUT[o] = 1; continue; }
    const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4, i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
    const a = w00 * px[i00 + 3] + w10 * px[i10 + 3] + w01 * px[i01 + 3] + w11 * px[i11 + 3]; A[o] = Math.round(a);
    if (a < 1) continue;
    for (let c = 0; c < 3; c++) rgb[o * 3 + c] = Math.round((w00 * px[i00 + c] * px[i00 + 3] + w10 * px[i10 + c] * px[i10 + 3] + w01 * px[i01 + c] * px[i01 + 3] + w11 * px[i11 + c] * px[i11 + 3]) / a);
  }
  const toC = (p) => { const dx = p[0] - em[0], dy = p[1] - em[1]; return [CX + s * (co * dx + si * dy), CY + s * (-si * dx + co * dy)]; };
  return { rgb, A, OUT, lm: lm.map(toC), xf: { prescale: src.W / src0.W, em, rollDeg: (roll * 180) / Math.PI, iodSrc: iod / (src.W / src0.W), scale: s * (src.W / src0.W) } };
}

// ---------- 3. pixel evidence ----------
export function evidence(C) {
  const N = CW * CH, Lab = new Float32Array(N * 3), BG = new Uint8Array(N);
  for (let o = 0; o < N; o++) { if (C.OUT[o]) continue; if (C.A[o] < 128) { BG[o] = 1; continue; } const l = lab(C.rgb[o * 3], C.rgb[o * 3 + 1], C.rgb[o * 3 + 2]); Lab[o * 3] = l[0]; Lab[o * 3 + 1] = l[1]; Lab[o * 3 + 2] = l[2]; }
  // skin model: k-means over seed patches (cheeks / forehead / nose bridge / chin from the generic mesh), keep the majority tones
  const samples = [], seedPix = [];
  for (const i of MP.skinSeeds) { const [x, y] = C.lm[i].map(Math.round); seedPix.push(y * CW + x);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= CW || yy >= CH) continue; const o = yy * CW + xx; if (C.OUT[o] || BG[o]) continue; samples.push([Lab[o * 3], Lab[o * 3 + 1], Lab[o * 3 + 2]]); } }
  const km = kmeans(samples, 3), tones = [];
  for (let j = 0; j < 3; j++) { const mem = samples.filter((_, i) => km.assign[i] === j); if (mem.length < 0.15 * samples.length) continue;
    const m = km.centers[j], chroma = Math.hypot(m[1], m[2]); if (chroma < 4 || m[0] < 20) continue;
    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (const p of mem) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r * 3 + c] += ((p[r] - m[r]) * (p[c] - m[c])) / mem.length;
    cov[0] += 36; cov[4] += 9; cov[8] += 9; tones.push({ mean: m, share: mem.length / samples.length, inv: inv3(cov), invAB: inv3([cov[4], cov[5], 0, cov[7], cov[8], 0, 0, 0, 1]) }); }
  if (!tones.length) return { fail: "FC-SKIN-MODEL", Lab, BG };
  // FC-SKIN-HAIR-TONE (learned on the Stage 0 set): seeds that land on hair / brows form a dark "skin tone" that then
  // swallows the hair. A secondary tone is skin only if it stays a lighter, same-hue, comparably chromatic variant of the
  // dominant (largest-share) tone — exactly what a cel-shadow band is, and what hair never is.
  const dom = tones.reduce((a, b) => (b.share > a.share ? b : a)), hue = (m) => Math.atan2(m[2], m[1]), Cm = (m) => Math.hypot(m[1], m[2]);
  const rejected = [];
  for (const t of tones.slice()) { if (t === dom) continue; const dh = Math.abs(((hue(t.mean) - hue(dom.mean) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (t.mean[0] < 0.6 * dom.mean[0] || dh > (30 * Math.PI) / 180 || Cm(t.mean) < 0.4 * Cm(dom.mean)) { rejected.push(t.mean.map((v) => +v.toFixed(1))); tones.splice(tones.indexOf(t), 1); } }
  tones.sort((a, b) => b.mean[0] - a.mean[0]);
  const Lfloor = 0.55 * dom.mean[0];
  const SKIN = new Uint8Array(N), tone = new Int8Array(N).fill(-1);
  for (let o = 0; o < N; o++) { if (C.OUT[o] || BG[o]) continue; const l0 = Lab[o * 3], a0 = Lab[o * 3 + 1], b0 = Lab[o * 3 + 2];
    let best = Infinity, bj = -1;
    for (let j = 0; j < tones.length; j++) { const t = tones[j], d = [l0 - t.mean[0], a0 - t.mean[1], b0 - t.mean[2]], I = t.inv;
      const m2 = d[0] * (I[0] * d[0] + I[1] * d[1] + I[2] * d[2]) + d[1] * (I[3] * d[0] + I[4] * d[1] + I[5] * d[2]) + d[2] * (I[6] * d[0] + I[7] * d[1] + I[8] * d[2]);
      const J = t.invAB, ab2 = d[1] * (J[0] * d[1] + J[1] * d[2]) + d[2] * (J[3] * d[1] + J[4] * d[2]);
      const ok = m2 <= 16 || (ab2 <= 9 && d[0] > -40 && d[0] < 10);
      if (ok && m2 < best) { best = m2; bj = j; } }
    if (bj >= 0 && l0 >= Lfloor) { SKIN[o] = 1; tone[o] = bj; } }
  return { Lab, BG, SKIN, tone, tones, rejectedTones: rejected, seedPix, nSamples: samples.length };
}
export { MP, median, components, erode, dilate, fillPoly, hull, kmeans, N_RAYS, inv3 };
