// prep-reference.mjs — FREE, LOCAL preparation of an approved flat-colour employee illustration for Meshy head
// generation. Reads the source READ-ONLY, writes copies. Steps (automatic; measured from the image itself):
//   1. GLASSES (if present): frame = the light, near-opaque frame colour (auto: densest very-light low-chroma colour in
//      the face band, or --frame=r,g,b); LENS interiors = regions the frame encloses (flood fill from the border);
//      lens tint is a translucent white overlay — its alpha is measured (lens-skin vs open-skin mode) and UN-BLENDED;
//      the frame band (+ its cast shadow) is inpainted by neighbour-mode fill (flat colour regions continue).
//   2. FLAT LIGHT: the directional face shadow (a uniform multiply of the lit skin) is divided out on the shadow side
//      of each row's terminator.
//   3. COMPOSITION: crop above the clothing, square, 1024×1024, transparent.
//   node prep-reference.mjs <src.png> <outDir> <name> [--frame=r,g,b] [--frameTol=d] [--frameBox=x0,y0,x1,y1] [--clothTop=y] [--accessories=off] [--relight=skin]
import fs from "node:fs";
import sharp from "sharp";

const [SRC, OUT, NAME] = process.argv.slice(2);
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
fs.mkdirSync(OUT, { recursive: true });
const { data: D0, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H, D = Buffer.from(D0);
const c3 = (i) => [D[i * 4], D[i * 4 + 1], D[i * 4 + 2]], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
// the most common EXACT colour (flat-colour art) among pixels satisfying pred
const mode = (pred) => { const h = new Map(); for (let i = 0; i < N; i++) { if (D[i * 4 + 3] < 200 || !pred(i)) continue; const k = c3(i).join(","); h.set(k, (h.get(k) ?? 0) + 1); } let b = null, n = 0; for (const [k, v] of h) if (v > n) { n = v; b = k; } return b ? b.split(",").map(Number) : null; };
const log = {};
// skin (lit) = the densest warm light colour in the middle third of the image
const isWarm = (c) => c[0] > c[2] + 25 && lum(c) > 120;
const skinLit = mode((i) => { const x = i % W, y = (i / W) | 0; return x > W / 3 && x < (2 * W) / 3 && y > H * 0.15 && y < H * 0.75 && isWarm(c3(i)); });
log.skinLit = skinLit;

// SHORTEST-BRIDGE fill: each unknown pixel looks along 8 directions for the first known pixel; of the opposite pair
// with the shortest total crossing it takes the NEARER end — thin bands are bridged straight across, and region
// boundaries continue where they meet the band
function bridgeFill(band) {
  let todo = 0; for (let i = 0; i < N; i++) if (band[i]) todo++;
  log.inpainted = (log.inpainted ?? 0) + todo;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]], MAXR = Math.round(W * 0.12), src2 = Buffer.from(D);
  for (let i = 0; i < N; i++) { if (!band[i]) continue; const x = i % W, y = (i / W) | 0; let best = null, bgR = 1e9;
    for (const [dx, dy] of DIRS) { const hit = []; for (const sg of [1, -1]) { let r = 1, j = -1; for (; r <= MAXR; r++) { const xx = x + sg * dx * r, yy = y + sg * dy * r; if (xx < 0 || yy < 0 || xx >= W || yy >= H) break; const k = yy * W + xx; if (!band[k]) { j = k; break; } } hit.push(j >= 0 ? [r, j] : null); }
      for (const hh of hit) if (hh && src2[hh[1] * 4 + 3] < 10) bgR = Math.min(bgR, hh[0]);
      if (!hit[0] || !hit[1]) continue; const span = hit[0][0] + hit[1][0]; if (!best || span < best.span) best = { span, r: Math.min(hit[0][0], hit[1][0]), j: hit[0][0] <= hit[1][0] ? hit[0][1] : hit[1][1] }; }
    // background wins when it is about as near (a removed accessory that stuck out over the background leaves nothing)
    if (best && bgR <= best.r + 2) { D[i * 4 + 3] = 0; continue; }
    if (best) for (let k = 0; k < 4; k++) D[i * 4 + k] = src2[best.j * 4 + k]; }
}
// ---------------- 1. GLASSES ----------------
let frameC = arg("frame")?.split(",").map(Number);
// a LENS over skin is a white overlay of it (the same alpha in every unsaturated channel); a FRAME colour is not
const overlayOfSkin = (c) => { const a = [1, 2].map((k) => (c[k] - skinLit[k]) / Math.max(1, 255 - skinLit[k])); return a.every((v) => v > 0.03) && Math.abs(a[0] - a[1]) < 0.06; };
if (!frameC) frameC = mode((i) => { const c = c3(i), y = (i / W) | 0; return y > H * 0.25 && y < H * 0.65 && lum(c) > 215 && c[0] - c[2] < 45 && dist(c, skinLit) > 18 && !overlayOfSkin(c); });
const isFrame = (i) => D[i * 4 + 3] > 200 && dist(c3(i), frameC) < 4;   // exact frame colour; its anti-aliased edge is covered by dilation
let F = new Uint8Array(N); let fN = 0; for (let i = 0; i < N; i++) if (isFrame(i)) { F[i] = 1; fN++; }
// --frameTol=d: a multi-tone (dark) frame — outline/highlight tones within d of the frame colour also count, but only
// inside the box of the exact-colour frame (the head outline elsewhere is never taken for frame)
// --frameBox=x0,y0,x1,y1: the glasses' measured box when the frame colour also draws the head outline (clips F to it)
if (arg("frameBox")) { const [bx0, by0, bx1, by1] = arg("frameBox").split(",").map(Number); for (let i = 0; i < N; i++) { const x = i % W, y = (i / W) | 0; if (F[i] && (x < bx0 || x > bx1 || y < by0 || y > by1)) { F[i] = 0; fN--; } } }
if (arg("frameTol")) { const tol = +arg("frameTol"); let x0 = W, x1 = -1, y0 = H, y1 = -1; for (let i = 0; i < N; i++) if (F[i]) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let y = Math.max(0, y0 - 3); y <= Math.min(H - 1, y1 + 3); y++) for (let x = Math.max(0, x0 - 3); x <= Math.min(W - 1, x1 + 3); x++) { const i = y * W + x; if (!F[i] && D[i * 4 + 3] > 200 && dist(c3(i), frameC) < tol) { F[i] = 1; fN++; } }
  log.frameTol = { tol, box: [x0, y0, x1, y1] }; }
log.frame = { colour: frameC, pixels: fN };
const dil = (M, r) => { let m = M; for (let k = 0; k < r; k++) { const nx = m.slice(); for (let i = 0; i < N; i++) if (m[i]) { const x = i % W; if (x > 0) nx[i - 1] = 1; if (x < W - 1) nx[i + 1] = 1; if (i >= W) nx[i - W] = 1; if (i < N - W) nx[i + W] = 1; } m = nx; } return m; };
const glasses = fN > N * 0.003;
log.glasses = glasses;
if (glasses) {
  const Fd = dil(F, 2);
  // lens interiors: not reachable from the border without crossing the (dilated) frame
  const out = new Uint8Array(N), st = []; for (let x = 0; x < W; x++) { st.push(x, N - W + x); } for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
  while (st.length) { const i = st.pop(); if (out[i] || Fd[i]) continue; out[i] = 1; const x = i % W; if (x > 0) st.push(i - 1); if (x < W - 1) st.push(i + 1); if (i >= W) st.push(i - W); if (i < N - W) st.push(i + W); }
  // enclosed components; lenses = the large ones
  const lens = new Uint8Array(N), seen = new Uint8Array(N); const comps = [];
  for (let s = 0; s < N; s++) { if (out[s] || Fd[s] || seen[s]) continue; const m = [], q = [s]; seen[s] = 1; while (q.length) { const i = q.pop(); m.push(i); const x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && !seen[j] && !out[j] && !Fd[j]) { seen[j] = 1; q.push(j); } } comps.push(m); }
  comps.sort((a, b) => b.length - a.length); const lensComps = comps.filter((m) => m.length > N * 0.01).slice(0, 2);
  for (const m of lensComps) for (const i of m) lens[i] = 1;
  log.lenses = lensComps.map((m) => m.length);
  // lens alpha: lit skin seen through the lens vs open lit skin (white overlay)
  const lensSkin = mode((i) => lens[i] && isWarm(c3(i)) && overlayOfSkin(c3(i)));
  // no white overlay found = a CLEAR lens (alpha 0, nothing to un-blend)
  const a = !lensSkin ? [] : [0, 1, 2].map((k) => (lensSkin[k] - skinLit[k]) / Math.max(1, 255 - skinLit[k])).filter((v) => v > 0.02 && v < 0.9);
  const alpha = a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  log.lens = { seenSkin: lensSkin, alpha: +alpha.toFixed(3) };
  for (let i = 0; i < N; i++) if (lens[i]) for (let k = 0; k < 3; k++) D[i * 4 + k] = Math.max(0, Math.min(255, Math.round((D[i * 4 + k] - alpha * 255) / (1 - alpha))));
  // frame band to inpaint: the frame (dilated) + its cast shadow: non-palette pixels within 18 px of the frame
  const pal = []; { const h = new Map(); for (let i = 0; i < N; i++) { if (D[i * 4 + 3] < 200 || Fd[i]) continue; const k = c3(i).map((v) => v >> 3).join(","); h.set(k, (h.get(k) ?? 0) + 1); } for (const [k, v] of h) if (v > N * 0.004) pal.push(k.split(",").map((q) => (+q << 3) + 4)); }
  // the RIM is geometric: a ring around each lens interior (outline, highlight and edge lines in any colour) —
  // RIM_OUT px outside and RIM_IN px inside the interior boundary; bridge / temples / nose pads = the frame colour
  // (dilated); the frame's cast shadow = non-palette pixels just outside the ring
  const RIM_OUT = Math.round(W * 0.02), RIM_IN = Math.round(W * 0.013);
  const lensD = dil(lens, RIM_OUT), lensE = (() => { const inv = new Uint8Array(N).map((_, i) => (lens[i] ? 0 : 1)); const d2 = dil(inv, RIM_IN); return new Uint8Array(N).map((_, i) => (lens[i] && !d2[i] ? 1 : 0)); })();
  const band = dil(F, 4); for (let i = 0; i < N; i++) if (lensD[i] && !lensE[i]) band[i] = 1;
  // in the glasses zone, a pixel may only stay if its colour is part of the illustration's OWN palette outside the
  // glasses (skin, shadow, blush, brows, hair…) — rim edges, highlights and the frame's cast shadow are not, and
  // become unknown. The EYES only exist inside the lenses, so eye pixels (dark iris/lash/outline, near-white sclera and
  // catch-lights) are protected.
  const zone = dil(lens, RIM_OUT * 2), outPal = [];
  { const h = new Map(); for (let i = 0; i < N; i++) { if (zone[i] || D[i * 4 + 3] < 200) continue; const k = c3(i).join(","); h.set(k, (h.get(k) ?? 0) + 1); } for (const [k, v] of h) if (v > N * 0.001) outPal.push(k.split(",").map(Number)); }
  const isEye = (c) => lum(c) < 95 || (lum(c) > 232 && Math.max(...c) - Math.min(...c) < 18);
  // eyes sit well inside the lens: protection only applies away from the lens boundary (the rim's inner edge lines hug it)
  const deep = (() => { const inv = new Uint8Array(N).map((_, i) => (lens[i] ? 0 : 1)); const d2 = dil(inv, Math.round(W * 0.015)); return new Uint8Array(N).map((_, i) => (lens[i] && !d2[i] ? 1 : 0)); })();
  for (let i = 0; i < N; i++) { if (!zone[i] || band[i] || D[i * 4 + 3] < 200) continue; const c = c3(i); if (deep[i] && isEye(c)) continue; if (!outPal.some((q) => dist(q, c) < 9)) band[i] = 1; }
  log.palette = outPal.length;
  // the frame's CAST SHADOWS (under the rims, beside the nose pads, under the bridge) are darker multiples of a lit
  // palette colour forming small regions that do NOT belong to the big face shadow → unknown
  const lit = outPal.filter((q) => lum(q) > 150);
  const shadowy = (c) => lit.some((q) => { const r = [0, 1, 2].map((k) => c[k] / Math.max(1, q[k])); return r[0] > 0.5 && r[0] < 0.92 && Math.abs(r[0] - r[1]) < 0.06 && Math.abs(r[1] - r[2]) < 0.06; });
  { const sv2 = new Uint8Array(N); let cast = 0;
    for (let s0 = 0; s0 < N; s0++) { if (sv2[s0] || !zone[s0] || D[s0 * 4 + 3] < 200 || !shadowy(c3(s0))) continue; const m = [], q = [s0]; sv2[s0] = 1; let big = false;
      while (q.length) { const i = q.pop(); m.push(i); if (!zone[i]) big = true; const x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && !sv2[j] && D[j * 4 + 3] > 200 && shadowy(c3(j))) { sv2[j] = 1; q.push(j); } }
      if (!big && m.length < N * 0.01) for (const i of m) { if (!band[i]) { band[i] = 1; cast++; } } }
    log.castShadow = cast; }
  // lit-side cast shadows: the big face shadow's terminator per row (rows inside the zone interpolated); any shadowy
  // zone pixel on the LIT side is a frame shadow → unknown
  { const sh0 = mode((i) => { const c = c3(i); if (!(c[0] > c[2] + 25 && lum(c) > 90)) return false; const r = [0, 1, 2].map((k) => c[k] / skinLit[k]); return r[0] < 0.88 && r[0] > 0.55 && Math.abs(r[0] - r[1]) < 0.06 && Math.abs(r[1] - r[2]) < 0.06; });
    if (sh0) { const term = new Float32Array(H).fill(NaN); let sx = 0, sn = 0, lx = 0, ln = 0;
      for (let i = 0; i < N; i++) { if (D[i * 4 + 3] < 200) continue; const c = c3(i); if (dist(c, sh0) < 10) { sx += i % W; sn++; } else if (dist(c, skinLit) < 10) { lx += i % W; ln++; } }
      const leftSh = sx / sn < lx / ln;
      for (let y = 0; y < H; y++) { let t = NaN; for (let x = 0; x < W; x++) { const i = y * W + x; if (zone[i] || dist(c3(i), sh0) >= 10) continue; t = isNaN(t) ? x : leftSh ? Math.max(t, x) : Math.min(t, x); } term[y] = t; }
      for (let y = 0; y < H; y++) if (isNaN(term[y])) { let a = y - 1, b = y + 1; while (a >= 0 && isNaN(term[a])) a--; while (b < H && isNaN(term[b])) b++; if (a >= 0 && b < H) term[y] = term[a] + ((term[b] - term[a]) * (y - a)) / (b - a); }
      let n2 = 0; for (let i = 0; i < N; i++) { if (!zone[i] || band[i] || D[i * 4 + 3] < 200) continue; const x = i % W, y = (i / W) | 0; if (isNaN(term[y])) continue; const litSide = leftSh ? x > term[y] + 2 : x < term[y] - 2; if (litSide && shadowy(c3(i))) { band[i] = 1; n2++; } }
      log.litSideCast = n2; } }
  bridgeFill(band);
}
// ---------------- 1b. HEAD ACCESSORIES (flowers, clips, bands): strongly saturated, non-skin regions that sit ON the
// hair (most of their outline touches dark hair) — removed for generation, kept for modular reconstruction ----------
// --accessories=off: for saturated/dyed hair that the detector would otherwise take for an accessory
if (arg("accessories") !== "off") { const sat = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };
  const cand = new Uint8Array(N); for (let i = 0; i < N; i++) { const c = c3(i); if (D[i * 4 + 3] > 200 && sat(c) > 0.45 && lum(c) > 35 && dist(c, skinLit) > 60) cand[i] = 1; }
  const seen = new Uint8Array(N), acc = new Uint8Array(N), found = [];
  for (let s0 = 0; s0 < N; s0++) { if (!cand[s0] || seen[s0]) continue; const m = [], q = [s0]; seen[s0] = 1; let edge = 0, edgeHair = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
    while (q.length) { const i = q.pop(); m.push(i); const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) { if (j < 0 || j >= N) continue; if (cand[j]) { if (!seen[j]) { seen[j] = 1; q.push(j); } } else { edge++; if (lum(c3(j)) < 45) edgeHair++; } } }
    if (m.length > N * 0.002 && edgeHair > 0.25 * edge) { for (const i of m) acc[i] = 1; found.push({ px: m.length, box: [x0, y0, x1, y1], colour: c3(m[0]) }); } }
  log.accessories = found;
  if (found.length) { let band = acc; for (let k = 0; k < Math.round(W * 0.006); k++) { const nx = band.slice(); for (let i = 0; i < N; i++) if (band[i]) { const x = i % W; if (x > 0) nx[i - 1] = 1; if (x < W - 1) nx[i + 1] = 1; if (i >= W) nx[i - W] = 1; if (i < N - W) nx[i + W] = 1; } band = nx; }
    // the accessory's own dark outline/shadow pixels inside the dilated region that are not hair-dark are also unknown
    bridgeFill(band); } }
const noGlasses = Buffer.from(D);

// ---------------- 2. FLAT LIGHT ----------------
const skinSh = mode((i) => { const c = c3(i); if (!isWarm(c) && !(c[0] > c[2] + 25 && lum(c) > 90)) return false; const r = [0, 1, 2].map((k) => c[k] / skinLit[k]); return r[0] < 0.88 && r[0] > 0.55 && Math.abs(r[0] - r[1]) < 0.06 && Math.abs(r[1] - r[2]) < 0.06; });
log.skinShadow = skinSh;
if (skinSh) {
  const K = [0, 1, 2].map((k) => skinLit[k] / skinSh[k]);
  const isSh0 = (i) => D[i * 4 + 3] > 200 && dist(c3(i), skinSh) < 12;
  // the face shadow = the large connected shadow-tone regions (stray specks elsewhere do not count)
  const SH = new Uint8Array(N), sv = new Uint8Array(N);
  for (let s0 = 0; s0 < N; s0++) { if (sv[s0] || !isSh0(s0)) continue; const m = [], q = [s0]; sv[s0] = 1; while (q.length) { const i = q.pop(); m.push(i); const x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && !sv[j] && isSh0(j)) { sv[j] = 1; q.push(j); } } if (m.length > N * 0.005) for (const i of m) SH[i] = 1; }
  const isSh = (i) => SH[i] === 1;
  // the side the shadow falls on: where its pixels are relative to the lit skin's centre
  let sx = 0, sn = 0, lx = 0, ln = 0; for (let i = 0; i < N; i++) { if (isSh(i)) { sx += i % W; sn++; } else if (dist(c3(i), skinLit) < 10) { lx += i % W; ln++; } }
  const left = sx / sn < lx / ln; log.shadowSide = left ? "left" : "right";
  let relit = 0;
  for (let y = 0; y < H; y++) { let term = -1; for (let x = 0; x < W; x++) { const i = y * W + x; if (isSh(i)) { if (left) term = Math.max(term, x); else if (term < 0) term = x; } }
    if (term < 0) continue;
    for (let x = 0; x < W; x++) { if (left ? x > term + 1 : x < term - 1) continue; const i = y * W + x; if (D[i * 4 + 3] < 200) continue; const c = c3(i); if (lum(c) < 55 || dist(c, skinLit) < 24 || lum(c) >= lum(skinLit) - 4) continue;
      if (arg("relight") === "skin" && Math.max(...[0, 1, 2].map((k) => c[k] / skinSh[k])) - Math.min(...[0, 1, 2].map((k) => c[k] / skinSh[k])) > 0.15) continue;   // --relight=skin: light (dyed) hair keeps its own shading   // outlines, hair, irises and already-lit pixels stay
      const seg = [0, 1, 2].map((k) => skinLit[k] - skinSh[k]), sl2 = seg.reduce((a2, v) => a2 + v * v, 0), t = Math.max(0, Math.min(1, ((c[0] - skinSh[0]) * seg[0] + (c[1] - skinSh[1]) * seg[1] + (c[2] - skinSh[2]) * seg[2]) / sl2));
      if (Math.hypot(c[0] - skinSh[0] - t * seg[0], c[1] - skinSh[1] - t * seg[1], c[2] - skinSh[2] - t * seg[2]) < 22) { for (let k = 0; k < 3; k++) D[i * 4 + k] = skinLit[k]; relit++; continue; }   // a shadow↔lit blend
      for (let k = 0; k < 3; k++) D[i * 4 + k] = Math.min(255, skinLit[k] + 8, Math.round(c[k] * K[k])); relit++; } }   // 255 cap: a Buffer wraps 262 → 6 (teal hair)
  log.relit = relit;
}
// ---------------- 3. COMPOSITION ----------------
// clothing top: the first row (from the face down) where a non-skin, non-hair coloured band spans the middle
let clothTop = arg("clothTop") ? +arg("clothTop") : H;
if (!arg("clothTop")) { // scanning down the centre: face/neck skin, then the first 8 consecutive rows that are mostly NOT skin
  const skinish = (c) => c[0] > c[2] + 18 && c[0] > c[1] + 18 && lum(c) > 95; let seen = false, run = 0;
  for (let y = Math.floor(H * 0.45); y < H; y++) { let sk = 0, tot = 0; for (let x = Math.floor(W * 0.47); x < W * 0.53; x++) { const i = y * W + x; if (D[i * 4 + 3] < 200) continue; tot++; if (skinish(c3(i))) sk++; }
    const isSk = tot && sk / tot > 0.5; if (isSk) { seen = true; run = 0; } else if (seen) { if (++run >= Math.round(H * 0.05)) { clothTop = y - run + 1; break; } } } }   // a mouth / teeth run is short; clothing runs on
const CUT = clothTop - 6; log.crop = { clothTop, cut: CUT };
{ const skinish = (c) => c[0] > c[2] + 18 && c[0] > c[1] + 18 && lum(c) > 95;
  // the chin: scanning down from mid-face, the first row whose skin extent narrows below 65% of the widest face row
  // (face → neck), whatever the jaw outline, mouth or hair crossing the face look like
  let chinY = -1; { let widest = 0; for (let y = Math.floor(H * 0.35); y < CUT; y++) { let l = W, r = -1; for (let x = 0; x < W; x++) if (D[(y * W + x) * 4 + 3] > 200 && skinish(c3(y * W + x))) { if (x < l) l = x; r = x; }
      const ext = r - l; if (ext > widest) widest = ext; else if (widest > W * 0.2 && ext > 0 && ext < widest * 0.65) { chinY = y; break; } } }
  if (chinY > 0) { const Mk = new Uint8Array(N); for (let y = chinY; y < CUT; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (D[i * 4 + 3] > 200 && !skinish(c3(i))) Mk[i] = 1; }
    // erode (outlines are not masses)
    let E = Mk; for (let r = 0; r < 3; r++) { const nx = E.slice(); for (let i = 0; i < N; i++) if (E[i]) { const x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j < 0 || j >= N || !E[j]) { nx[i] = 0; break; } } E = nx; }
    const comp = new Int32Array(N).fill(-1); let id = 0, removed = 0; const kill = new Uint8Array(N);
    for (let s0 = 0; s0 < N; s0++) { if (!E[s0] || comp[s0] >= 0) continue; const m = [], q = [s0]; comp[s0] = id; let bottom = false, top = H;
      while (q.length) { const i = q.pop(); m.push(i); const y = (i / W) | 0; top = Math.min(top, y); if (y >= CUT - 4) bottom = true; const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && E[j] && comp[j] < 0 && dist(c3(j), c3(i)) < 40) { comp[j] = id; q.push(j); } }
      if (bottom && top > chinY + 3) { for (const i of m) kill[i] = 1; removed += m.length; } id++; }
    let K2 = kill; for (let r = 0; r < 5; r++) { const nx = K2.slice(); for (let i = 0; i < N; i++) if (K2[i]) { const x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N && Mk[j]) nx[j] = 1; } K2 = nx; }
    for (let i = 0; i < N; i++) if (K2[i]) D[i * 4 + 3] = 0;
    // leftover thin clothing strokes (outlines/seams) below the chin, outside the neck column and not part of a kept
    // (hair) mass, go too
    const keepMass = new Uint8Array(N); for (let i = 0; i < N; i++) if (E[i] && !kill[i]) keepMass[i] = 1;
    let KM = keepMass; for (let r = 0; r < 6; r++) { const nx = KM.slice(); for (let i = 0; i < N; i++) if (KM[i]) { const x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (j >= 0 && j < N) nx[j] = 1; } KM = nx; }
    const nW = (() => { const y = CUT - 2, c0 = Math.floor(W / 2); let l = c0, r = c0; while (l > 0 && skinish(c3(y * W + l - 1))) l--; while (r < W - 1 && skinish(c3(y * W + r + 1))) r++; return [l - W * 0.02, r + W * 0.02]; })();
    for (let y = chinY + 1; y < CUT; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (D[i * 4 + 3] > 0 && !KM[i] && !skinish(c3(i)) && (x < nW[0] || x > nW[1])) D[i * 4 + 3] = 0; }   // incl. anti-aliased stroke pixels
    log.clothingRemoved = { chinY, px: removed }; } }
let x0 = W, x1 = 0, y0 = H; for (let y = 0; y < CUT; y++) for (let x = 0; x < W; x++) if (D[(y * W + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); }
const compose = async (buf, file) => { const cw = x1 - x0 + 1, ch = CUT - y0; const crop = await sharp(buf, { raw: info }).extract({ left: x0, top: y0, width: cw, height: ch }).png().toBuffer();
  const s = (1024 * 0.88) / Math.max(cw, ch), w = Math.round(cw * s), h = Math.round(ch * s); const r = await sharp(crop).resize(w, h, { kernel: "lanczos3" }).png().toBuffer();
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).composite([{ input: r, left: Math.round((1024 - w) / 2), top: Math.round((1024 - h) / 2) }]).png().toFile(file); };
await compose(D0, `${OUT}/${NAME}-ref-original.png`);
await compose(noGlasses, `${OUT}/${NAME}-ref-noglasses.png`);
await compose(D, `${OUT}/${NAME}-ref-final.png`);
fs.writeFileSync(`${OUT}/${NAME}-prep.json`, JSON.stringify(log, null, 1));
console.log(JSON.stringify(log));
