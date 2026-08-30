// ---------------------------------------------------------------------------
// atlas-dilate.mjs — UV-atlas gap padding for build-character-lods.mjs.
//
// Meshy's remesh/rig stage emits a base-color atlas whose UV charts are
// packed edge-to-edge with OPAQUE BLACK gaps between them (the PNG carries an
// alpha channel, but it is 255 everywhere — measured on bon-v2/alex/micah
// 2026-08-29, so alpha cannot be used to find the gaps, and neither can
// colour: black is also real hair/shirt paint). Every downstream step that
// samples across a chart border — JPEG/WebP encoding, mipmap generation,
// bilinear/anisotropic filtering — blends those black gap texels into the
// chart edge, which shows up on the character as dark "scratches" along
// every UV seam (quality diagnosis 2026-08-29).
//
// The gap mask therefore comes from the MESH: rasterizeUvCoverage() marks
// every texel touched by a UV triangle (plus a 1-texel conservative margin),
// and dilateAtlasRgba() then fills each uncovered texel with the RGB of the
// NEAREST covered texel (multi-source BFS, Chebyshev radius `radius`), so any
// sample that bleeds past a chart border picks up that chart's own edge
// colour instead of black. Covered texels are never touched. Both are pure
// functions over flat buffers so they are unit-testable without sharp/GLB IO.
// ---------------------------------------------------------------------------

/**
 * @param {Uint8Array|Uint8ClampedArray|Buffer} rgba  interleaved RGBA, length = width*height*4 (mutated in place)
 * @param {number} width
 * @param {number} height
 * @param {{ radius?: number, alphaThreshold?: number, coverage?: Uint8Array }} [opts]
 *   radius          guaranteed fill distance in texels (default 16; 8–16 is right for a 2048 atlas)
 *   fillRemainder   after `radius`, keep flooding until NO gap texel is left (default false).
 *                   The LOD build turns this on so deep gap interiors can't stay black and
 *                   bleed into charts at very low mip levels.
 *   coverage        optional width*height mask (non-zero = chart texel, from rasterizeUvCoverage).
 *                   When given it defines the sources; otherwise alpha >= alphaThreshold does.
 *   alphaThreshold  alpha-keyed fallback threshold (default 128) — only used without `coverage`
 * @returns {{ filled: number, opaque: number, remainingTransparent: number }}
 *   (`opaque` = source/chart texels, `remainingTransparent` = gap texels beyond the radius)
 */
export function dilateAtlasRgba(rgba, width, height, opts = {}) {
  const radius = opts.radius ?? 16;
  const fillRemainder = opts.fillRemainder ?? false;
  const alphaThreshold = opts.alphaThreshold ?? 128;
  const coverage = opts.coverage ?? null;
  if (rgba.length !== width * height * 4) {
    throw new Error(`dilateAtlasRgba: buffer length ${rgba.length} != ${width}x${height}x4`);
  }
  const n = width * height;
  if (coverage && coverage.length !== n) {
    throw new Error(`dilateAtlasRgba: coverage length ${coverage.length} != ${width}x${height}`);
  }
  // dist[i] = Chebyshev distance to the nearest opaque texel (0 for opaque, -1 = unvisited)
  const dist = new Int16Array(n).fill(-1);
  // Frontier as a flat index queue (multi-source BFS from every opaque texel).
  let queue = new Int32Array(n);
  let qLen = 0;
  let opaque = 0;
  for (let i = 0; i < n; i++) {
    const isSource = coverage ? coverage[i] !== 0 : rgba[i * 4 + 3] >= alphaThreshold;
    if (isSource) {
      dist[i] = 0;
      queue[qLen++] = i;
      opaque++;
    }
  }
  let filled = 0;
  let next = new Int32Array(n);
  for (let d = 1; (d <= radius || fillRemainder) && qLen > 0; d++) {
    let nLen = 0;
    for (let k = 0; k < qLen; k++) {
      const i = queue[k];
      const x = i % width;
      const y = (i - x) / width;
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (dist[j] !== -1) continue;
          dist[j] = d;
          // Copy RGB only — alpha stays whatever the source had (0 in gaps).
          rgba[j * 4] = r; rgba[j * 4 + 1] = g; rgba[j * 4 + 2] = b;
          next[nLen++] = j;
          filled++;
        }
      }
    }
    const tmp = queue; queue = next; next = tmp; qLen = nLen;
  }
  let remainingTransparent = 0;
  for (let i = 0; i < n; i++) if (dist[i] === -1) remainingTransparent++;
  return { filled, opaque, remainingTransparent };
}

/**
 * Rasterizes UV triangles into a width*height coverage mask (1 = texel is
 * part of a chart). glTF UV convention: (0,0) is the image's top-left texel,
 * v grows downward, so texel x = u*width, y = v*height (no flip). Texel
 * centres inside a triangle are marked, then the mask is grown by
 * `margin` texels (default 1) so chart-border texels that the centre test
 * misses are still treated as chart, never as gap.
 *
 * @param {Float32Array|number[]} uv       interleaved u,v per vertex
 * @param {Uint32Array|Uint16Array|number[]|null} indices  triangle list (null = non-indexed)
 * @param {number} width
 * @param {number} height
 * @param {{ margin?: number }} [opts]
 * @returns {{ mask: Uint8Array, covered: number, triangles: number }}
 */
export function rasterizeUvCoverage(uv, indices, width, height, opts = {}) {
  const margin = opts.margin ?? 1;
  const mask = new Uint8Array(width * height);
  const vertexCount = uv.length / 2;
  const triCount = indices ? indices.length / 3 : vertexCount / 3;
  const idx = (t, k) => (indices ? indices[t * 3 + k] : t * 3 + k);
  const clampX = (v) => Math.min(width - 1, Math.max(0, v));
  const clampY = (v) => Math.min(height - 1, Math.max(0, v));
  for (let t = 0; t < triCount; t++) {
    const a = idx(t, 0), b = idx(t, 1), c = idx(t, 2);
    const ax = uv[a * 2] * width, ay = uv[a * 2 + 1] * height;
    const bx = uv[b * 2] * width, by = uv[b * 2 + 1] * height;
    const cx = uv[c * 2] * width, cy = uv[c * 2 + 1] * height;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) continue;
    const x0 = clampX(Math.floor(Math.min(ax, bx, cx))), x1 = clampX(Math.ceil(Math.max(ax, bx, cx)));
    const y0 = clampY(Math.floor(Math.min(ay, by, cy))), y1 = clampY(Math.ceil(Math.max(ay, by, cy)));
    const sign = area > 0 ? 1 : -1;
    let marked = 0;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * sign;
        const w1 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) * sign;
        const w2 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * sign;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) { mask[y * width + x] = 1; marked++; }
      }
    }
    // A sub-texel triangle that contains no texel centre still owns paint:
    // mark its vertex texels so it is never classified as gap.
    if (marked === 0) {
      mask[clampY(Math.floor(ay)) * width + clampX(Math.floor(ax))] = 1;
      mask[clampY(Math.floor(by)) * width + clampX(Math.floor(bx))] = 1;
      mask[clampY(Math.floor(cy)) * width + clampX(Math.floor(cx))] = 1;
    }
  }
  // Conservative margin: grow the mask by `margin` texels (3x3 max filter, repeated).
  let cur = mask;
  for (let m = 0; m < margin; m++) {
    const grown = Uint8Array.from(cur);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (cur[y * width + x]) continue;
        let hit = 0;
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= width) continue;
            if (cur[yy * width + xx]) { hit = 1; break; }
          }
        }
        if (hit) grown[y * width + x] = 1;
      }
    }
    cur = grown;
  }
  let covered = 0;
  for (let i = 0; i < cur.length; i++) covered += cur[i];
  return { mask: cur, covered, triangles: triCount };
}

/**
 * Convenience wrapper used by build-character-lods.mjs: decode a texture
 * buffer with sharp, pad its gaps (sources = the UV coverage mask when given,
 * else alpha), and return an OPAQUE RGB PNG at the source resolution — so no
 * gap texel is ever black by the time textureCompress resizes/encodes it.
 */
export async function padAtlasImage(sharp, imageBuffer, opts = {}) {
  const img = sharp(imageBuffer).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const stats = dilateAtlasRgba(data, info.width, info.height, opts);
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .removeAlpha()
    .png({ compressionLevel: 6 })
    .toBuffer();
  return { png, width: info.width, height: info.height, ...stats };
}
