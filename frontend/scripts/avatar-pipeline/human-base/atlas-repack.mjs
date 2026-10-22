// atlas-repack.mjs — SEAM-SAFE TEXTURE ATLAS for generated heads. ZERO CREDITS. Texel-exact (islands are translated,
// never resampled).
//
// Generated (Meshy) textures pack hundreds of UV islands edge to edge with almost no gutter: a skin island's border
// texels sit right next to black hair islands. Bilinear filtering, mipmaps and the optimiser's resize then pull those
// foreign texels in along every UV seam — the dashed dark lines across foreheads and cheeks. Padding cannot fix that
// (there is no room to pad into). This re-packs every island into a new square atlas with a gutter around each one,
// filled with the island's OWN edge colours, and returns the remapped UVs.
//
//   repackAtlas({ rgb, width, height }, UV, I, { pad }) → { rgb, size, UV, islands, fill }
import sharp from "sharp";

export async function repackAtlas(src, UV, I, { pad = 6, mipSafe = 2 } = {}) {
  const { rgb, width: TW, height: TH } = src, nv = UV.length / 2;
  // ---- islands: triangles joined through shared UV positions (welded by value, so split vertices still join) ----
  const key = (v) => `${Math.round(UV[v * 2] * 1e6)},${Math.round(UV[v * 2 + 1] * 1e6)}`;
  const uvId = new Int32Array(nv), ids = new Map(); for (let v = 0; v < nv; v++) { const k = key(v); if (!ids.has(k)) ids.set(k, ids.size); uvId[v] = ids.get(k); }
  const par = new Int32Array(ids.size).map((_, i) => i), find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < I.length; t += 3) { const a = find(uvId[I[t]]), b = find(uvId[I[t + 1]]), c = find(uvId[I[t + 2]]); par[b] = a; par[find(c)] = a; }
  const islandOfTri = new Int32Array(I.length / 3), islIndex = new Map();
  for (let t = 0; t < I.length / 3; t++) { const r = find(uvId[I[t * 3]]); if (!islIndex.has(r)) islIndex.set(r, islIndex.size); islandOfTri[t] = islIndex.get(r); }
  const NI = islIndex.size;
  // ---- texel coverage per island (rasterised, then grown by mipSafe px: the filter footprint of its own edge) ----
  const owner = new Int32Array(TW * TH).fill(-1), touch = new Array(NI);   // touch: every texel each island samples (shared texels belong to ALL their islands)
  const bb = Array.from({ length: NI }, () => [1e9, 1e9, -1e9, -1e9]);
  const px = (v) => [UV[v * 2] * TW - 0.5, UV[v * 2 + 1] * TH - 0.5];   // texel centres at integer coordinates
  for (let t = 0; t < I.length / 3; t++) {
    const q = [px(I[t * 3]), px(I[t * 3 + 1]), px(I[t * 3 + 2])], isl = islandOfTri[t];
    const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0])) - 1), x1 = Math.min(TW - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1])) - 1), y1 = Math.min(TH - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])) + 1);
    const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let inside;
      // V1.3: a ZERO-AREA UV triangle (generated meshes collapse paint onto one texel) still samples the texel(s) at its
      // corners — dropping it left those triangles reading the atlas fill colour (Clang's brown brow window, brown irises)
      if (Math.abs(ar) < 1e-9) inside = q.some((p2) => Math.abs(p2[0] - x) <= 1 && Math.abs(p2[1] - y) <= 1);
      else { const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
        const e = 0.75 / Math.sqrt(Math.abs(ar)); inside = w0 > -e && w1 > -e && w2 > -e; }   // conservative: texels the triangle touches
      if (!inside) continue; const k = y * TW + x; if (owner[k] < 0) owner[k] = isl; (touch[isl] ??= new Set()).add(k);
      const b = bb[isl]; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
  }
  // grow each island's own texels by mipSafe (texels another island owns keep their owner — they are copied for both)
  const mask = Array.from({ length: NI }, () => null);
  for (let i = 0; i < NI; i++) { const b = bb[i]; if (b[2] < b[0]) continue; b[0] -= mipSafe; b[1] -= mipSafe; b[2] += mipSafe; b[3] += mipSafe;
    const w = b[2] - b[0] + 1, h = b[3] - b[1] + 1, m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = b[0] + x, sy = b[1] + y; if (sx >= 0 && sy >= 0 && sx < TW && sy < TH && touch[i]?.has(sy * TW + sx)) m[y * w + x] = 2; }   // V1.3: not only texels it owns — mirrored halves share texels
    for (let r = 0; r < mipSafe; r++) { const m2 = m.slice(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (m[y * w + x]) continue; if ((x > 0 && m[y * w + x - 1]) || (x < w - 1 && m[y * w + x + 1]) || (y > 0 && m[(y - 1) * w + x]) || (y < h - 1 && m[(y + 1) * w + x])) m2[y * w + x] = 1; } m.set(m2); }
    mask[i] = { w, h, m }; }
  // ---- shelf packing (tallest first) into the smallest square that fits, each island inside a `pad` gutter ----
  const order = [...Array(NI).keys()].filter((i) => mask[i]).sort((a, b) => mask[b].h - mask[a].h || mask[b].w - mask[a].w);
  let area = 0; for (const i of order) area += (mask[i].w + 2 * pad) * (mask[i].h + 2 * pad);
  let A = Math.ceil(Math.sqrt(area * 1.08) / 64) * 64, place = null;
  for (;;) { place = new Array(NI); let x = 0, y = 0, rowH = 0, ok = true;
    for (const i of order) { const w = mask[i].w + 2 * pad, h = mask[i].h + 2 * pad; if (x + w > A) { x = 0; y += rowH; rowH = 0; } if (y + h > A) { ok = false; break; } place[i] = [x + pad, y + pad]; x += w; rowH = Math.max(rowH, h); }
    if (ok) break; A += 64; }
  // ---- copy texels; fill each island's gutter from its own nearest texel (BFS inside the padded box) ----
  const out = new Uint8Array(A * A * 3), set = new Uint8Array(A * A);
  for (const i of order) { const { w, h, m } = mask[i], b = bb[i], [ox, oy] = place[i];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!m[y * w + x]) continue; const sx = Math.min(TW - 1, Math.max(0, b[0] + x)), sy = Math.min(TH - 1, Math.max(0, b[1] + y)), d = ((oy + y) * A + ox + x);
      out[d * 3] = rgb[(sy * TW + sx) * 3]; out[d * 3 + 1] = rgb[(sy * TW + sx) * 3 + 1]; out[d * 3 + 2] = rgb[(sy * TW + sx) * 3 + 2]; set[d] = 1; }
    const q = []; const x0 = ox - pad, y0 = oy - pad, x1 = ox + w + pad - 1, y1 = oy + h + pad - 1;
    for (let y = oy; y < oy + h; y++) for (let x = ox; x < ox + w; x++) if (set[y * A + x]) q.push(y * A + x);
    for (let k = 0; k < q.length; k++) { const d = q[k], x = d % A, y = (d / A) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < x0 || yy < y0 || xx > x1 || yy > y1 || xx < 0 || yy < 0 || xx >= A || yy >= A) continue; const e = yy * A + xx; if (set[e]) continue;
        set[e] = 1; out[e * 3] = out[d * 3]; out[e * 3 + 1] = out[d * 3 + 1]; out[e * 3 + 2] = out[d * 3 + 2]; q.push(e); } } }
  // the rest of the atlas (between gutters) — never sampled; filled flat with the mean so mip levels stay calm
  { let s = [0, 0, 0], c = 0; for (let k = 0; k < A * A; k++) if (set[k]) { s[0] += out[k * 3]; s[1] += out[k * 3 + 1]; s[2] += out[k * 3 + 2]; c++; } const m = s.map((v) => Math.round(v / Math.max(1, c)));
    for (let k = 0; k < A * A; k++) if (!set[k]) { out[k * 3] = m[0]; out[k * 3 + 1] = m[1]; out[k * 3 + 2] = m[2]; } }
  // ---- remapped UVs: per vertex, its island's translation (a vertex shared by two islands cannot exist: islands are
  //      unions of shared UVs) ----
  const islandOfV = new Int32Array(nv).fill(-1); for (let t = 0; t < I.length / 3; t++) for (let q = 0; q < 3; q++) islandOfV[I[t * 3 + q]] = islandOfTri[t];
  const NUV = new Float32Array(nv * 2);
  for (let v = 0; v < nv; v++) { const i = islandOfV[v]; if (i < 0 || !place[i]) { NUV[v * 2] = UV[v * 2]; NUV[v * 2 + 1] = UV[v * 2 + 1]; continue; }
    const [ox, oy] = place[i], b = bb[i]; NUV[v * 2] = (UV[v * 2] * TW - b[0] + ox) / A; NUV[v * 2 + 1] = (UV[v * 2 + 1] * TH - b[1] + oy) / A; }
  return { rgb: out, size: A, UV: NUV, islands: NI, fill: +(area / (A * A)).toFixed(3) };
}

/** convenience: decode an encoded image to RGB */
export async function decodeRGB(buf) { const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { rgb: data, width: info.width, height: info.height }; }
