// underside-texture.mjs — THE WELDED UNDERSIDE WEARS THE SKIN'S OWN TEXTURE (2026-10-12, EXPERIMENTAL, with underside-weld.mjs). ZERO CREDITS.
//
// At the weld the welded underside already matched the skin's colour (≤ 5 sRGB levels) but not its LOOK: the skin's generated texture
// (grain, mottling, baked shade) stopped dead at the rim while the surface below was a smooth vertex-colour gradient — read from low
// angles as a soft line following the rim's staircase. Here the surface gets its own small texture, baked from the FINISHED skin texture:
//   - near the rim it MIRRORS the skin band just above the weld (a texel δ in from the rim shows the skin δ beyond it, reflected about
//     the rim), so the skin's own grain and shade continue across the weld with no seam;
//   - deeper in it fades, over two ring steps, into the rim's own colours smoothed along the rim — the local skin tone, never a global one;
//   - where the rim is the hair base cap or a free edge under hair, it starts in the hair colour (the cap's own paint);
//   - and every column ends, at the neck, in the NECK's own tone (the person's skin tone the body and neck wear): hair → skin at the nape
//     the way a hairline does, skin → neck with no seam where the surface meets the neck. Hair and skin columns blend round the neck.
// Strip layout: u = angle round the neck (wraps), v = depth in from the rim. A triangle across the wrap gets copies of its low-u vertices
// at u + 1 (same position, normal, weights — the weld and the skinning are untouched). Deterministic: no randomness, fixed sizes.

/** closest point of triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5) → { d2, w: [wa, wb, wc] } */
function closest(p, a, b, c) {
  const sub = (x, y) => [x[0] - y[0], x[1] - y[1], x[2] - y[2]], dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap), out = (wa, wb, wc) => { const q = [0, 1, 2].map((k) => a[k] * wa + b[k] * wb + c[k] * wc), d = sub(p, q); return { d2: dot(d, d), w: [wa, wb, wc] }; };
  if (d1 <= 0 && d2 <= 0) return out(1, 0, 0);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return out(0, 1, 0);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return out(1 - v, v, 0); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return out(0, 0, 1);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return out(1 - w, 0, w); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return out(0, 1 - w, w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return out(1 - v - w, v, w);
}

/** part: the welded underside ({ P, N, I, J, W, COLOR }); strip: underside-weld's strip coordinates; skin: [{ P, I, UV }] (identity_head
 *  + identity_face_twin); tex: { data, width, height, channels } (the finished skin texture, sRGB); hairColour: [r, g, b] 0..1.
 *  Returns { part (with UV, without COLOR), image: { data, width, height } (sRGB RGB), info } */
export function bakeUndersideTexture({ part, strip, skin, tex, hairColour, neckTone = null, ringEdge, width = 1024, height = 64 }) {
  const { M, rim, inward, hairBin, maxDepth, wallDepth } = strip, band = 2 * ringEdge, sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-9, b - a))); return t * t * (3 - 2 * t); };
  // the skin triangles near the rim (a grid), sampled by closest point → their own UVs → the finished texture (bilinear)
  const cell = 2 * ringEdge, grid = new Map(), T = [], key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const lo = [0, 1, 2].map((k) => Math.min(...rim.map((p) => p[k])) - 3 * band), hi = [0, 1, 2].map((k) => Math.max(...rim.map((p) => p[k])) + 3 * band);
  for (const { P, I, UV } of skin) for (let t = 0; t < I.length; t += 3) { const v = [I[t], I[t + 1], I[t + 2]], q = v.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    if ([0, 1, 2].some((k) => Math.max(q[0][k], q[1][k], q[2][k]) < lo[k] || Math.min(q[0][k], q[1][k], q[2][k]) > hi[k])) continue; const id = T.push({ q, uv: v.map((i) => [UV[i * 2], UV[i * 2 + 1]]) }) - 1;
    for (let x = Math.floor(Math.min(q[0][0], q[1][0], q[2][0]) / cell); x <= Math.floor(Math.max(q[0][0], q[1][0], q[2][0]) / cell); x++) for (let y = Math.floor(Math.min(q[0][1], q[1][1], q[2][1]) / cell); y <= Math.floor(Math.max(q[0][1], q[1][1], q[2][1]) / cell); y++)
      for (let z = Math.floor(Math.min(q[0][2], q[1][2], q[2][2]) / cell); z <= Math.floor(Math.max(q[0][2], q[1][2], q[2][2]) / cell); z++) { const k = `${x},${y},${z}`; (grid.get(k) ?? grid.set(k, []).get(k)).push(id); } }
  const texel = (u, v) => { const x = u * tex.width - 0.5, y = v * tex.height - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, out = [0, 0, 0];
    for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) { const X = Math.min(tex.width - 1, Math.max(0, x0 + dx)), Y = Math.min(tex.height - 1, Math.max(0, y0 + dy)), o = (Y * tex.width + X) * tex.channels; for (let c = 0; c < 3; c++) out[c] += tex.data[o + c] * w; }
    return out; };
  const skinAt = (p, reach) => { let best = null; const R = Math.ceil(reach / cell), c0 = [0, 1, 2].map((k) => Math.floor(p[k] / cell)), seen = new Set();
    for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) for (const id of grid.get(`${c0[0] + x},${c0[1] + y},${c0[2] + z}`) ?? []) { if (seen.has(id)) continue; seen.add(id);
      const t = T[id], r = closest(p, ...t.q); if (!best || r.d2 < best.d2) best = { d2: r.d2, uv: [0, 1].map((k) => t.uv[0][k] * r.w[0] + t.uv[1][k] * r.w[1] + t.uv[2][k] * r.w[2]) }; }
    return best && best.d2 <= reach * reach ? texel(...best.uv) : null; };
  // per column: the rim point, the inward direction along the surface, hair or skin
  const col = Array.from({ length: width }, (_, i) => { const b = ((i + 0.5) / width) * M, j0 = Math.floor(b) % M, j1 = (j0 + 1) % M, f = b - Math.floor(b), lerp = (A, B) => [0, 1, 2].map((k) => A[k] + (B[k] - A[k]) * f);
    const R = lerp(rim[j0], rim[j1]), Q = lerp(inward[j0], inward[j1]), w = [0, 1, 2].map((k) => Q[k] - R[k]), l = Math.hypot(...w) || 1, D = wallDepth ? wallDepth[j0] + (wallDepth[j1] - wallDepth[j0]) * f : maxDepth;
    return { R, w: w.map((x) => x / l), hair: hairBin[Math.round(b) % M], D }; });
  const hairRGB = (hairColour ?? [0.1, 0.08, 0.07]).map((c) => c * 255);
  // the skin's own rim tone (skin columns only; hair columns take their neighbours'), smoothed along the rim
  const rimCol = col.map((c) => (c.hair ? null : skinAt(c.R, band) ?? null)); for (let pass = 0; pass < width && rimCol.some((c) => !c) && rimCol.some(Boolean); pass++) for (let i = 0; i < width; i++) if (!rimCol[i]) rimCol[i] = rimCol[(i + width - 1) % width] ?? rimCol[(i + 1) % width];
  const neck = neckTone ? neckTone.map((c) => c * 255) : (() => { const sk = rimCol.filter(Boolean); return sk.length ? [0, 1, 2].map((q) => sk.reduce((a, c) => a + c[q], 0) / sk.length) : hairRGB; })();
  const H2 = Math.round(width / 24), smooth = rimCol.map((_, i) => { const a = [0, 0, 0]; for (let d = -H2; d <= H2; d++) { const c = rimCol[(i + d + width * 4) % width] ?? neck; for (let q = 0; q < 3; q++) a[q] += c[q]; } return a.map((x) => x / (2 * H2 + 1)); });
  const HW = Math.round(width / 48), hairW = col.map((_, i) => { let a = 0; for (let d = -HW; d <= HW; d++) a += col[(i + d + width * 4) % width].hair ? 1 : 0; return a / (2 * HW + 1); });   // hair ↔ skin, blended round the neck
  const data = new Uint8Array(width * height * 3); let mirrored = 0;
  for (let row = 0; row < height; row++) { const delta = ((row + 0.5) / height) * maxDepth, t = Math.min(1, delta / band), f = t * t * (3 - 2 * t);
    for (let i = 0; i < width; i++) { const c = col[i], D = Math.max(band, c.D); let sk = smooth[i];
      if (hairW[i] < 1 && f < 1) { const m = skinAt([0, 1, 2].map((k) => c.R[k] - c.w[k] * delta), delta + band); if (m) { mirrored++; sk = [0, 1, 2].map((q) => m[q] * (1 - f) + smooth[i][q] * f); } }
      const toNeck = sstep(0.5 * D, D, delta), hairToNeck = sstep(0, 0.6 * D, delta), h = hairW[i];
      const rgb = [0, 1, 2].map((q) => (sk[q] * (1 - toNeck) + neck[q] * toNeck) * (1 - h) + (hairRGB[q] * (1 - hairToNeck) + neck[q] * hairToNeck) * h);
      const o = (row * width + i) * 3; for (let q = 0; q < 3; q++) data[o + q] = Math.max(0, Math.min(255, Math.round(rgb[q]))); } }
  // UVs (u wraps round the neck; v = depth / maxDepth) with copies of low-u vertices for triangles across the wrap
  const nv = part.P.length / 3, P = Array.from(part.P), N = Array.from(part.N), J = Array.from(part.J), W = Array.from(part.W), UV = []; for (let v = 0; v < nv; v++) UV.push(strip.u[v], maxDepth > 0 ? strip.depth[v] / maxDepth : 0);
  const I = Array.from(part.I), dup = new Map(); let copies = 0;
  for (let t = 0; t < I.length; t += 3) { const us = [0, 1, 2].map((q) => UV[I[t + q] * 2]); if (Math.max(...us) - Math.min(...us) <= 0.5) continue;
    for (let q = 0; q < 3; q++) { const v = I[t + q]; if (UV[v * 2] >= 0.5) continue; if (!dup.has(v)) { const n2 = P.length / 3; dup.set(v, n2); P.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); N.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); for (let k = 0; k < 4; k++) { J.push(J[v * 4 + k]); W.push(W[v * 4 + k]); } UV.push(UV[v * 2] + 1, UV[v * 2 + 1]); copies++; } I[t + q] = dup.get(v); } }
  const { COLOR, ...rest } = part; void COLOR;
  return { part: { ...rest, P: Float32Array.from(P), N: Float32Array.from(N), I, J: Uint8Array.from(J), W: Float32Array.from(W), UV: Float32Array.from(UV) }, image: { data, width, height }, info: { mirroredTexels: mirrored, wrapCopies: copies, texture: `${width}×${height}` } };
}
