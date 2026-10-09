// v3/geom.mjs — HumanBase V3 proof: shared geometry core. ZERO CREDITS, no new dependencies.
// Closest-point queries on triangle meshes, narrow-band signed distance fields, topology statistics, a matrix-free
// conjugate-gradient Laplacian solver (non-rigid fitting) and UV-space rasterisation (texture bakes).

/** closest point on triangle (Ericson). Returns barycentrics (u,v,w) of the closest point and its squared distance. */
export function closestOnTri(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u, v, w;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); u = 1 - t; v = t; w = 0; }
      else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); u = 1 - t; v = 0; w = t; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - t; w = t; }
            else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; u = 1 - v - w; }
          }
        }
      }
    }
  }
  const qx = u * ax + v * bx + w * cx, qy = u * ay + v * by + w * cy, qz = u * az + v * bz + w * cz;
  out.u = u; out.v = v; out.w = w; out.x = qx; out.y = qy; out.z = qz;
  out.d2 = (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
  return out;
}

/** uniform-grid triangle index: closest point on a mesh within a search radius */
export class TriIndex {
  constructor(P, I, h = 0.02, keepTri = null) {
    this.P = P; this.I = I; this.h = h; this.map = new Map(); this.stamp = new Int32Array(I.length / 3); this.q = 0;
    for (let t = 0; t < I.length / 3; t++) {
      if (keepTri && !keepTri(t)) continue;
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) { const i = I[t * 3 + k] * 3; x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
      for (let i = Math.floor(x0 / h); i <= Math.floor(x1 / h); i++) for (let j = Math.floor(y0 / h); j <= Math.floor(y1 / h); j++) for (let k = Math.floor(z0 / h); k <= Math.floor(z1 / h); k++) {
        const key = this.key(i, j, k); let a = this.map.get(key); if (!a) this.map.set(key, (a = [])); a.push(t);
      }
    }
  }
  key(i, j, k) { return ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512); }
  /** closest point within maxD (null if none). `filter(t)` can veto triangles. */
  closest(x, y, z, maxD, filter = null) {
    const h = this.h, P = this.P, I = this.I, ci = Math.floor(x / h), cj = Math.floor(y / h), ck = Math.floor(z / h);
    const R = Math.ceil(maxD / h); let best = null, bestD2 = maxD * maxD; const tmp = {}; this.q++;
    for (let r = 0; r <= R; r++) {
      if (best && (r - 1) * h > Math.sqrt(bestD2)) break;
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
        const cell = this.map.get(this.key(i, j, k)); if (!cell) continue;
        for (const t of cell) {
          if (this.stamp[t] === this.q) continue; this.stamp[t] = this.q;
          if (filter && !filter(t)) continue;
          const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
          closestOnTri(x, y, z, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], tmp);
          if (tmp.d2 < bestD2) { bestD2 = tmp.d2; best = { t, u: tmp.u, v: tmp.v, w: tmp.w, x: tmp.x, y: tmp.y, z: tmp.z, d: Math.sqrt(tmp.d2) }; }
        }
      }
    }
    return best;
  }
}

/** nearest ray–mesh hit (Möller–Trumbore) within [0, maxT], walking the index grid along the ray */
TriIndex.prototype.raycast = function (ox, oy, oz, dx, dy, dz, maxT, filter = null) {
  const h = this.h, P = this.P, I = this.I; this.q++; let best = null;
  for (let s = 0; s <= maxT + h * 0.5; s += h * 0.45) {
    const cell = this.map.get(this.key(Math.floor((ox + dx * s) / h), Math.floor((oy + dy * s) / h), Math.floor((oz + dz * s) / h)));
    if (cell) for (const t of cell) {
      if (this.stamp[t] === this.q) continue; this.stamp[t] = this.q;
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-14) continue;
      const inv = 1 / det, tx = ox - P[a], ty = oy - P[a + 1], tz = oz - P[a + 2], u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv; if (tt < 0 || tt > maxT) continue;
      if (filter && !filter(t)) continue;
      if (!best || tt < best.d) best = { t, u: 1 - u - v, v: u, w: v, d: tt };
    }
    if (best && best.d < s - h) break;
  }
  return best;
};

export function triNormal(P, I, t) {
  const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
  const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l, l / 2];
}

export function vertexNormals(P, I) {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length / 3; t++) { const [nx, ny, nz, A] = triNormal(P, I, t); for (let k = 0; k < 3; k++) { const v = I[t * 3 + k] * 3; N[v] += nx * A; N[v + 1] += ny * A; N[v + 2] += nz * A; } }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  return N;
}

/** merge vertices closer than tol (grid hash), drop degenerate triangles */
export function weld(P, I, tol = 1e-6) {
  const n = P.length / 3, map = new Int32Array(n), m = new Map(), out = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(P[i * 3] / tol)},${Math.round(P[i * 3 + 1] / tol)},${Math.round(P[i * 3 + 2] / tol)}`;
    let j = m.get(k); if (j === undefined) { j = out.length / 3; m.set(k, j); out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); } map[i] = j;
  }
  const J = []; for (let t = 0; t < I.length; t += 3) { const a = map[I[t]], b = map[I[t + 1]], c = map[I[t + 2]]; if (a !== b && b !== c && a !== c) J.push(a, b, c); }
  return { P: Float32Array.from(out), I: Uint32Array.from(J), map };
}

/** drop unreferenced vertices (keeps first-use order deterministic) */
export function compact(P, I) {
  const map = new Int32Array(P.length / 3).fill(-1), out = [], J = new Uint32Array(I.length);
  for (let k = 0; k < I.length; k++) { const i = I[k]; if (map[i] < 0) { map[i] = out.length / 3; out.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); } J[k] = map[i]; }
  return { P: Float32Array.from(out), I: J, map };
}

/** edges → triangle counts, boundary loops, components, non-manifold edges/vertices, orientation consistency */
export function topo(P, I) {
  const n = P.length / 3, E = new Map();
  for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = I[t * 3 + k], b = I[t * 3 + (k + 1) % 3], key = a < b ? a * n + b : b * n + a;
    let e = E.get(key); if (!e) E.set(key, (e = { a, b, c: 0, dir: 0 })); e.c++; e.dir += a < b ? 1 : -1;
  }
  let boundary = 0, nonManifold = 0, misoriented = 0; const bEdges = [];
  for (const e of E.values()) { if (e.c === 1) { boundary++; bEdges.push(e); } else if (e.c > 2) nonManifold++; else if (e.dir !== 0) misoriented++; }
  const par = Int32Array.from({ length: n }, (_, i) => i), f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  for (let t = 0; t < I.length; t += 3) { const a = f(I[t]); par[f(I[t + 1])] = a; par[f(I[t + 2])] = a; }
  const comp = new Map(); for (let t = 0; t < I.length; t += 3) { const r = f(I[t]); comp.set(r, (comp.get(r) ?? 0) + 1); }
  // non-manifold vertices: a vertex whose triangle fan is not a single edge-connected fan
  const fan = Array.from({ length: n }, () => []); for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) fan[I[t * 3 + k]].push(t);
  let nmVerts = 0;
  for (let v = 0; v < n; v++) { const ts = fan[v]; if (ts.length < 2) continue;
    const seen = new Set([ts[0]]), st = [ts[0]];
    while (st.length) { const t = st.pop(); for (const u of ts) { if (seen.has(u)) continue; let sh = 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (I[t * 3 + a] === I[u * 3 + b] && I[t * 3 + a] !== v) sh++; if (sh) { seen.add(u); st.push(u); } } }
    if (seen.size !== ts.length) nmVerts++; }
  const used = new Set(I); const V = used.size, F = I.length / 3, Ec = E.size;
  return { verts: V, tris: F, edges: Ec, boundaryEdges: boundary, nonManifoldEdges: nonManifold, nonManifoldVerts: nmVerts, misorientedEdges: misoriented, components: [...comp.values()].sort((a, b) => b - a), euler: V - Ec + F, bEdges };
}

/** boundary loops as vertex index arrays */
export function boundaryLoops(I, n) {
  const next = new Map(), E = new Map();
  for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) { const a = I[t * 3 + k], b = I[t * 3 + (k + 1) % 3]; const key = a < b ? a * n + b : b * n + a; E.set(key, (E.get(key) ?? 0) + 1); }
  for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) { const a = I[t * 3 + k], b = I[t * 3 + (k + 1) % 3]; const key = a < b ? a * n + b : b * n + a; if (E.get(key) === 1) next.set(b, a); }   // reversed so the loop runs with the hole
  const loops = [], done = new Set();
  for (const s of next.keys()) { if (done.has(s)) continue; const L = []; let v = s; while (v !== undefined && !done.has(v)) { done.add(v); L.push(v); v = next.get(v); } if (L.length > 2) loops.push(L); }
  return loops;
}

/** neighbours (unique) per vertex */
export function neighbours(I, n) {
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; nb[a].add(b); nb[b].add(a); }
  return nb.map((s) => Int32Array.from(s));
}

/** matrix-free conjugate gradient for a symmetric positive-definite operator (3 right-hand sides solved together) */
export function cg3(apply, B, X, iters = 400, tol = 1e-7, diag = null) {
  // Jacobi-preconditioned CG; diag = per-VERTEX diagonal of the operator (shared by x, y, z)
  const n = B.length, R = new Float64Array(n), Z = new Float64Array(n), Pp = new Float64Array(n), AP = new Float64Array(n);
  const pre = (i) => (diag ? 1 / diag[Math.floor(i / 3)] : 1);
  apply(X, AP); for (let i = 0; i < n; i++) { R[i] = B[i] - AP[i]; Z[i] = R[i] * pre(i); Pp[i] = Z[i]; }
  const dot = (a, b, c) => { let s = 0; for (let i = c; i < n; i += 3) s += a[i] * b[i]; return s; };
  let rz = [dot(R, Z, 0), dot(R, Z, 1), dot(R, Z, 2)]; const b0 = Math.max(1e-30, dot(B, B, 0) + dot(B, B, 1) + dot(B, B, 2));
  let it = 0;
  for (; it < iters; it++) {
    if ((dot(R, R, 0) + dot(R, R, 1) + dot(R, R, 2)) / b0 < tol * tol) break;
    apply(Pp, AP);
    for (let c = 0; c < 3; c++) {
      const pap = dot(Pp, AP, c); if (pap <= 0) continue; const a = rz[c] / pap;
      for (let i = c; i < n; i += 3) { X[i] += a * Pp[i]; R[i] -= a * AP[i]; Z[i] = R[i] * pre(i); }
      const rn = dot(R, Z, c), beta = rn / (rz[c] || 1e-30); rz[c] = rn;
      for (let i = c; i < n; i += 3) Pp[i] = Z[i] + beta * Pp[i];
    }
  }
  return it;
}

/** Gaussian RBF warp: displacements d_j at centres c_j interpolated smoothly over all points (σ = falloff) */
export function rbfWarp(P, centres, disps, sigma) {
  const m = centres.length, K = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => Math.exp(-(((centres[a][0] - centres[b][0]) ** 2 + (centres[a][1] - centres[b][1]) ** 2 + (centres[a][2] - centres[b][2]) ** 2) / (sigma * sigma))) + (a === b ? 1e-6 : 0)));
  // solve K w = d (3 rhs) by Gauss–Jordan
  const A = K.map((r, i) => [...r, ...disps[i]]);
  for (let c = 0; c < m; c++) { let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c]; for (let k = c; k < m + 3; k++) A[c][k] /= d;
    for (let r = 0; r < m; r++) if (r !== c) { const f = A[r][c]; if (f) for (let k = c; k < m + 3; k++) A[r][k] -= f * A[c][k]; } }
  const Wt = A.map((r) => r.slice(m)), out = Float32Array.from(P);
  for (let i = 0; i < P.length / 3; i++) { let dx = 0, dy = 0, dz = 0; for (let j = 0; j < m; j++) { const g = Math.exp(-(((P[i * 3] - centres[j][0]) ** 2 + (P[i * 3 + 1] - centres[j][1]) ** 2 + (P[i * 3 + 2] - centres[j][2]) ** 2) / (sigma * sigma))); dx += Wt[j][0] * g; dy += Wt[j][1] * g; dz += Wt[j][2] * g; }
    out[i * 3] += dx; out[i * 3 + 1] += dy; out[i * 3 + 2] += dz; }
  return out;
}

/** combinatorial (graph) Laplacian applied to a stride-3 field: (L x)_i = deg_i x_i − Σ_j x_j */
export function lap3(nb, X, out) {
  const n = nb.length;
  for (let i = 0; i < n; i++) { const d = nb[i].length; let sx = 0, sy = 0, sz = 0; for (const j of nb[i]) { sx += X[j * 3]; sy += X[j * 3 + 1]; sz += X[j * 3 + 2]; }
    out[i * 3] = d * X[i * 3] - sx; out[i * 3 + 1] = d * X[i * 3 + 1] - sy; out[i * 3 + 2] = d * X[i * 3 + 2] - sz; }
  return out;
}

/** bi-Laplacian deformation: minimise Σ w_i |x_i − c_i|² + λ |L(x − x0)|². Returns the new positions. */
export function deform(nb, X0, W, C, lambda, iters = 600, start = null) {
  const n = nb.length, tmp = new Float64Array(n * 3), tmp2 = new Float64Array(n * 3);
  const apply = (X, out) => { lap3(nb, X, tmp); lap3(nb, tmp, tmp2); for (let i = 0; i < n; i++) for (let q = 0; q < 3; q++) out[i * 3 + q] = W[i] * X[i * 3 + q] + lambda * tmp2[i * 3 + q]; };
  // rhs = W c + λ LᵀL x0
  const X0d = Float64Array.from(X0); lap3(nb, X0d, tmp); lap3(nb, tmp, tmp2);
  const B = new Float64Array(n * 3); for (let i = 0; i < n; i++) for (let q = 0; q < 3; q++) B[i * 3 + q] = W[i] * C[i * 3 + q] + lambda * tmp2[i * 3 + q];
  const diag = new Float64Array(n); for (let i = 0; i < n; i++) { const d = nb[i].length; diag[i] = W[i] + lambda * (d * d + d); }
  const X = Float64Array.from(start ?? X0); const it = cg3(apply, B, X, iters, 1e-7, diag);
  return { X: Float32Array.from(X), iterations: it };
}

/** narrow-band signed distance on a grid from a CLOSED (or nearly closed) triangle mesh: unsigned distance in a band,
 *  sign by flood-filling the outside from the grid border (robust to small cracks narrower than the band). */
export function sdfGrid(P, I, min, cell, dims, band = 3) {
  const [nx, ny, nz] = dims, N = nx * ny * nz, D = new Float32Array(N).fill(band * cell * 4), id = (i, j, k) => (k * ny + j) * nx + i;
  const tmp = {};
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const lo = [0, 1, 2].map((q) => Math.max(0, Math.floor((Math.min(P[a + q], P[b + q], P[c + q]) - min[q]) / cell) - band));
    const hi = [0, 1, 2].map((q) => Math.min(dims[q] - 1, Math.ceil((Math.max(P[a + q], P[b + q], P[c + q]) - min[q]) / cell) + band));
    for (let k = lo[2]; k <= hi[2]; k++) for (let j = lo[1]; j <= hi[1]; j++) for (let i = lo[0]; i <= hi[0]; i++) {
      const x = min[0] + i * cell, y = min[1] + j * cell, z = min[2] + k * cell;
      closestOnTri(x, y, z, P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2], tmp);
      const d = Math.sqrt(tmp.d2), g = id(i, j, k); if (d < D[g]) D[g] = d;
    }
  }
  // flood fill outside through voxels farther than ~0.87 cell from the surface
  const thr = cell * 0.87, out = new Uint8Array(N), st = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) { const g = id(i, j, k); if (D[g] > thr) { out[g] = 1; st.push(g); } }
  while (st.length) { const g = st.pop(), i = g % nx, j = Math.floor(g / nx) % ny, k = Math.floor(g / (nx * ny));
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const h = id(a, b, c); if (!out[h] && D[h] > thr) { out[h] = 1; st.push(h); } } }
  // near-surface voxels: outside if a 6-neighbour is flooded and this voxel is farther than that neighbour... use majority of
  // flooded neighbours within 2 voxels — a voxel touching the outside region with no deeper inside neighbour is outside
  const S = new Float32Array(N);
  for (let g = 0; g < N; g++) S[g] = out[g] ? D[g] : -D[g];
  for (let pass = 0; pass < 2; pass++) for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const g = id(i, j, k); if (out[g] || D[g] > thr) continue;
    // near-surface voxel: sign = outside if it is closer to the outside region than to the deep inside
    let o = 0, n = 0; for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const h = id(i + di, j + dj, k + dk); if (out[h]) o++; else if (D[h] > thr) n++; }
    if (o > n) S[g] = D[g]; else if (n > o) S[g] = -D[g];
  }
  return { S, D, out, id };
}

/** rasterise every triangle in UV space (size×size texels); cb(texelIndex, tri, b0, b1, b2) per covered texel centre */
export function rasterUV(UV, I, size, cb) {
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[t * 3] * 2, b = I[t * 3 + 1] * 2, c = I[t * 3 + 2] * 2;
    const ax = UV[a] * size, ay = UV[a + 1] * size, bx = UV[b] * size, by = UV[b + 1] * size, cx = UV[c] * size, cy = UV[c + 1] * size;   // glTF: v runs down the image
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cx))), y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by, cy)));
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w2 = 1 - w0 - w1;
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      cb(y * size + x, t, w0, w1, w2);
    }
  }
}

/** push-pull fill: texels with mask=0 get colours diffused from their filled neighbours (gutters + unknown regions) */
export function fillTexels(RGB, mask, size, iterations = 64) {
  const M = Uint8Array.from(mask);
  for (let it = 0; it < iterations; it++) {
    const add = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const g = y * size + x; if (M[g]) continue;
      let r = 0, gg = 0, b = 0, c = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= size || Y >= size) continue; const h = Y * size + X; if (!M[h]) continue; r += RGB[h * 3]; gg += RGB[h * 3 + 1]; b += RGB[h * 3 + 2]; c++; }
      if (c) add.push(g, r / c, gg / c, b / c); }
    if (!add.length) break;
    for (let q = 0; q < add.length; q += 4) { const g = add[q]; RGB[g * 3] = add[q + 1]; RGB[g * 3 + 1] = add[q + 2]; RGB[g * 3 + 2] = add[q + 3]; M[g] = 1; }
  }
  return RGB;
}

/** sample an RGB(A) raw image at uv (glTF convention: v down from the top in image rows), bilinear */
export function sampleImage(img, u, v) {
  const { data, width: W, height: H, channels: C } = img;
  const x = Math.min(W - 1.001, Math.max(0, u * W - 0.5)), y = Math.min(H - 1.001, Math.max(0, v * H - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, out = [0, 0, 0, 0];
  for (let q = 0; q < C; q++) {
    const a = data[(y0 * W + x0) * C + q], b = data[(y0 * W + x0 + 1) * C + q], c = data[((y0 + 1) * W + x0) * C + q], d = data[((y0 + 1) * W + x0 + 1) * C + q];
    out[q] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  if (C === 3) out[3] = 255;
  return out;
}

/** segment–triangle intersection test (Möller) used by the self-intersection check */
function triTriSep(P, a, b) {
  // separating-axis-free approximation: test each edge of a against triangle b and vice versa
  const edgeHits = (s, t) => {
    const T = [t[0], t[1], t[2]];
    for (let e = 0; e < 3; e++) {
      const o = s[e], d = [s[(e + 1) % 3][0] - o[0], s[(e + 1) % 3][1] - o[1], s[(e + 1) % 3][2] - o[2]];
      const e1 = [T[1][0] - T[0][0], T[1][1] - T[0][1], T[1][2] - T[0][2]], e2 = [T[2][0] - T[0][0], T[2][1] - T[0][1], T[2][2] - T[0][2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-14) continue; const inv = 1 / det, tv = [o[0] - T[0][0], o[1] - T[0][1], o[2] - T[0][2]];
      const u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) * inv; if (u < 1e-6 || u > 1 - 1e-6) continue;
      const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]], v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv; if (v < 1e-6 || u + v > 1 - 1e-6) continue;
      const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv; if (tt > 1e-6 && tt < 1 - 1e-6) return true;
    }
    return false;
  };
  return edgeHits(a, b) || edgeHits(b, a);
}

/** count intersecting pairs of non-adjacent triangles (grid broad phase). Optionally between two meshes. */
export function selfIntersections(P, I, h = 0.01, limit = 200) {
  const nT = I.length / 3, grid = new Map();
  const tri = (t) => [0, 1, 2].map((k) => [P[I[t * 3 + k] * 3], P[I[t * 3 + k] * 3 + 1], P[I[t * 3 + k] * 3 + 2]]);
  for (let t = 0; t < nT; t++) { const T = tri(t); const lo = [0, 1, 2].map((q) => Math.floor(Math.min(T[0][q], T[1][q], T[2][q]) / h)), hi = [0, 1, 2].map((q) => Math.floor(Math.max(T[0][q], T[1][q], T[2][q]) / h));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const key = `${i},${j},${k}`; let a = grid.get(key); if (!a) grid.set(key, (a = [])); a.push(t); } }
  const seen = new Set(); let count = 0; const examples = [];
  for (const cell of grid.values()) for (let x = 0; x < cell.length; x++) for (let y = x + 1; y < cell.length; y++) {
    const s = cell[x], t = cell[y], key = s < t ? s * nT + t : t * nT + s; if (seen.has(key)) continue; seen.add(key);
    let share = false; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (I[s * 3 + a] === I[t * 3 + b]) share = true; if (share) continue;
    if (triTriSep(P, tri(s), tri(t))) { count++; if (examples.length < 5) examples.push([s, t]); if (count >= limit) return { count, examples, capped: true }; }
  }
  return { count, examples, capped: false };
}

/** SURFACE NETS on a precomputed grid (values V, negative inside), triangulated so that the result is 2-manifold:
 *  each quad is split along its shorter diagonal unless that diagonal is already used by another quad (two quads
 *  sharing a diagonal give an edge with four triangles). Output faces point along +gradient (outward). */
export function surfaceNetsGrid(V, dims, min, cell) {
  const [nx, ny, nz] = dims, id = (i, j, k) => (k * ny + j) * nx + i, cid = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  // AMBIGUOUS FACES: a grid face whose corners alternate in sign (checkerboard) gives four quads on one cell pair → an
  // edge with four triangles. Resolve before meshing by moving the corner nearest zero across zero (minimal change).
  V = Float32Array.from(V); let fixed = 0;
  for (let pass = 0; pass < 6; pass++) { let f = 0;
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) for (const [a, b] of [[[1, 0, 0], [0, 1, 0]], [[1, 0, 0], [0, 0, 1]], [[0, 1, 0], [0, 0, 1]]]) {
      const c = [id(i, j, k), id(i + a[0], j + a[1], k + a[2]), id(i + a[0] + b[0], j + a[1] + b[1], k + a[2] + b[2]), id(i + b[0], j + b[1], k + b[2])];
      const s0 = V[c[0]] < 0, s1 = V[c[1]] < 0, s2 = V[c[2]] < 0, s3 = V[c[3]] < 0;
      if (s0 === s2 && s1 === s3 && s0 !== s1) { let m = c[0]; for (const x of c) if (Math.abs(V[x]) < Math.abs(V[m])) m = x; V[m] = V[m] < 0 ? 1e-6 : -1e-6; f++; } }
    fixed += f; if (!f) break; }
  const vert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), P = [], Q = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let inside = 0; for (let c = 0; c < 8; c++) { v[c] = V[id(i + corners[c][0], j + corners[c][1], k + corners[c][2])]; if (v[c] < 0) inside++; }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) { if ((v[a] < 0) === (v[b] < 0)) continue; const t = v[a] / (v[a] - v[b]), pa = corners[a], pb = corners[b]; sx += pa[0] + (pb[0] - pa[0]) * t; sy += pa[1] + (pb[1] - pa[1]) * t; sz += pa[2] + (pb[2] - pa[2]) * t; n++; }
    vert[cid(i, j, k)] = P.length / 3; P.push(min[0] + (i + sx / n) * cell, min[1] + (j + sy / n) * cell, min[2] + (k + sz / n) * cell);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const s0 = V[id(i, j, k)] < 0;
    if (s0 !== (V[id(i + 1, j, k)] < 0)) { const q = [vert[cid(i, j - 1, k - 1)], vert[cid(i, j, k - 1)], vert[cid(i, j, k)], vert[cid(i, j - 1, k)]]; if (q.every((x) => x >= 0)) Q.push(s0 ? q : [q[0], q[3], q[2], q[1]]); }
    if (s0 !== (V[id(i, j + 1, k)] < 0)) { const q = [vert[cid(i - 1, j, k - 1)], vert[cid(i - 1, j, k)], vert[cid(i, j, k)], vert[cid(i, j, k - 1)]]; if (q.every((x) => x >= 0)) Q.push(s0 ? q : [q[0], q[3], q[2], q[1]]); }
    if (s0 !== (V[id(i, j, k + 1)] < 0)) { const q = [vert[cid(i - 1, j - 1, k)], vert[cid(i, j - 1, k)], vert[cid(i, j, k)], vert[cid(i - 1, j, k)]]; if (q.every((x) => x >= 0)) Q.push(s0 ? q : [q[0], q[3], q[2], q[1]]); }
  }
  const nv = P.length / 3, d2 = (a, b) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  const ek = (a, b) => (a < b ? a * nv + b : b * nv + a);
  const use = new Map(); const inc = (a, b, d) => use.set(ek(a, b), (use.get(ek(a, b)) ?? 0) + d);
  for (const q of Q) for (let e = 0; e < 4; e++) inc(q[e], q[(e + 1) % 4], 1);
  const diag = new Uint8Array(Q.length);   // 0: q0–q2, 1: q1–q3
  for (let t = 0; t < Q.length; t++) { const q = Q[t]; diag[t] = d2(q[0], q[2]) <= d2(q[1], q[3]) ? 0 : 1; const [a, b] = diag[t] ? [q[1], q[3]] : [q[0], q[2]]; inc(a, b, 2); }
  for (let pass = 0; pass < 4; pass++) { let changed = 0;
    for (let t = 0; t < Q.length; t++) { const q = Q[t], [a, b] = diag[t] ? [q[1], q[3]] : [q[0], q[2]]; if ((use.get(ek(a, b)) ?? 0) <= 2) continue;
      const [c, d] = diag[t] ? [q[0], q[2]] : [q[1], q[3]]; if ((use.get(ek(c, d)) ?? 0) + 2 > 2) continue; inc(a, b, -2); inc(c, d, 2); diag[t] ^= 1; changed++; }
    if (!changed) break; }
  const I = [];
  for (let t = 0; t < Q.length; t++) { const q = Q[t]; if (diag[t]) I.push(q[0], q[1], q[3], q[1], q[2], q[3]); else I.push(q[0], q[1], q[2], q[0], q[2], q[3]); }
  // orientation: faces must point along +gradient (outward)
  let wrong = 0, total = 0;
  for (let t = 0; t < I.length; t += 3 * 37) { const a = I[t], b = I[t + 1], c = I[t + 2];
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const gi = Math.round((P[a * 3] - min[0]) / cell), gj = Math.round((P[a * 3 + 1] - min[1]) / cell), gk = Math.round((P[a * 3 + 2] - min[2]) / cell);
    if (gi < 1 || gj < 1 || gk < 1 || gi >= nx - 1 || gj >= ny - 1 || gk >= nz - 1) continue;
    const g = [V[id(gi + 1, gj, gk)] - V[id(gi - 1, gj, gk)], V[id(gi, gj + 1, gk)] - V[id(gi, gj - 1, gk)], V[id(gi, gj, gk + 1)] - V[id(gi, gj, gk - 1)]];
    total++; if (nn[0] * g[0] + nn[1] * g[1] + nn[2] * g[2] < 0) wrong++; }
  if (wrong > total / 2) for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]];
  return { P: Float32Array.from(P), I: Uint32Array.from(I), ambiguousFixed: fixed };
}

/** TRIANGLE QUALITY for an authored template (topology-preserving except edge flips): Delaunay edge flips + tangential
 *  relaxation re-projected onto a reference surface (the dense mesh), so slivers left by simplification disappear
 *  without changing the shape. Returns new {P, I}. */
export function improveQuality(P, I, refIndex, { rounds = 3, relax = 8 } = {}) {
  P = Float32Array.from(P); I = Uint32Array.from(I);
  const n = P.length / 3, ang = (a, b, c) => { // angle at a in triangle abc
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz) || 1)))); };
  const nrm = (a, b, c) => { const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]]; const x = e1[1] * e2[2] - e1[2] * e2[1], y = e1[2] * e2[0] - e1[0] * e2[2], z = e1[0] * e2[1] - e1[1] * e2[0], l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  const flipPass = () => {
    const E = new Map(), key = (a, b) => (a < b ? a * n + b : b * n + a);
    for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) { const kk = key(I[t * 3 + k], I[t * 3 + (k + 1) % 3]); (E.get(kk) ?? E.set(kk, []).get(kk)).push(t); }
    let flips = 0; const touched = new Uint8Array(I.length / 3);
    for (const [kk, ts] of E) {
      if (ts.length !== 2) continue; const [t1, t2] = ts; if (touched[t1] || touched[t2]) continue;
      const a = Math.floor(kk / n), b = kk % n;
      const c = [0, 1, 2].map((q) => I[t1 * 3 + q]).find((v) => v !== a && v !== b), d = [0, 1, 2].map((q) => I[t2 * 3 + q]).find((v) => v !== a && v !== b);
      if (c === undefined || d === undefined || c === d || E.has(key(c, d))) continue;
      if (ang(c, a, b) + ang(d, a, b) <= Math.PI + 1e-3) continue;
      // keep orientation: t1 has a→b or b→a; rebuild both triangles with the same winding as t1
      const o1 = [I[t1 * 3], I[t1 * 3 + 1], I[t1 * 3 + 2]], i = o1.indexOf(a), ab = o1[(i + 1) % 3] === b;
      const n0 = nrm(...o1), A = ab ? [a, d, c] : [a, c, d], B = ab ? [d, b, c] : [c, b, d];
      const nA = nrm(...A), nB = nrm(...B); if (nA[0] * n0[0] + nA[1] * n0[1] + nA[2] * n0[2] < 0.5 || nB[0] * n0[0] + nB[1] * n0[1] + nB[2] * n0[2] < 0.5) continue;
      I.set(A, t1 * 3); I.set(B, t2 * 3); touched[t1] = touched[t2] = 1; flips++;
    }
    return flips;
  };
  for (let r = 0; r < rounds; r++) {
    let f = 0; for (let k = 0; k < 10; k++) { const x = flipPass(); f += x; if (!x) break; }
    const nb = neighbours(I, n), N = vertexNormals(P, I);
    for (let it = 0; it < relax; it++) { const T = Float32Array.from(P);
      for (let i = 0; i < n; i++) { const d = nb[i].length; if (!d) continue; let cx = 0, cy = 0, cz = 0; for (const j of nb[i]) { cx += P[j * 3]; cy += P[j * 3 + 1]; cz += P[j * 3 + 2]; }
        let dx = cx / d - P[i * 3], dy = cy / d - P[i * 3 + 1], dz = cz / d - P[i * 3 + 2]; const dn = dx * N[i * 3] + dy * N[i * 3 + 1] + dz * N[i * 3 + 2]; dx -= dn * N[i * 3]; dy -= dn * N[i * 3 + 1]; dz -= dn * N[i * 3 + 2];
        let x = P[i * 3] + 0.5 * dx, y = P[i * 3 + 1] + 0.5 * dy, z = P[i * 3 + 2] + 0.5 * dz; const q = refIndex.closest(x, y, z, 0.03); if (q) { x = q.x; y = q.y; z = q.z; } T[i * 3] = x; T[i * 3 + 1] = y; T[i * 3 + 2] = z; }
      P.set(T); }
    void f;
  }
  return { P, I };
}

/** PUSH-PULL hole filling (image pyramid): every texel with mask=0 gets a smooth colour from the known texels around it
 *  (fast, O(N); used for texture gutters and for skin the evidence does not cover) */
export function pushPull(RGB, mask, size) {
  const levels = []; let s = size, C = Float32Array.from(RGB), M = Float32Array.from(mask, (m) => (m ? 1 : 0));
  for (let i = 0; i < s * s; i++) for (let q = 0; q < 3; q++) C[i * 3 + q] *= M[i];
  levels.push({ s, C, M });
  while (s > 1) { const h = s >> 1, C2 = new Float32Array(h * h * 3), M2 = new Float32Array(h * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) { let m = 0; const c = [0, 0, 0];
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = (y * 2 + dy) * s + x * 2 + dx; m += M[k]; for (let q = 0; q < 3; q++) c[q] += C[k * 3 + q]; }
      const k2 = y * h + x; M2[k2] = Math.min(1, m); if (m > 0) for (let q = 0; q < 3; q++) C2[k2 * 3 + q] = c[q] / m * Math.min(1, m); }
    s = h; C = C2; M = M2; levels.push({ s, C, M }); }
  for (let l = levels.length - 2; l >= 0; l--) { const { s: S, C: CC, M: MM } = levels[l], up = levels[l + 1];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const k = y * S + x; if (MM[k] >= 1) continue;
      const uy = Math.min(up.s - 1, y >> 1), ux = Math.min(up.s - 1, x >> 1), ku = uy * up.s + ux, um = up.M[ku] || 1e-9;
      for (let q = 0; q < 3; q++) { const cu = up.C[ku * 3 + q] / um; CC[k * 3 + q] = CC[k * 3 + q] + (1 - MM[k]) * cu; } MM[k] = 1; } }
  const out = new Float32Array(size * size * 3); out.set(levels[0].C); return out;
}

/** GENERIC MANIFOLD REPAIR for meshed solids (no employee knowledge): pinch vertices are split into one copy per edge-
 *  connected fan; triangles on edges used more than twice are removed and the small holes refilled (fan from the loop
 *  centroid); tiny components dropped. Loops until the mesh is a closed 2-manifold (or reports what is left). */
export function repairManifold(P, I, { minComponent = 200, maxRounds = 6 } = {}) {
  let Pa = Array.from(P), Ia = Array.from(I), log = [];
  for (let round = 0; round < maxRounds; round++) {
    let n = Pa.length / 3;
    // 1. edges used > 2 times: drop their triangles
    const E = new Map(); for (let t = 0; t < Ia.length / 3; t++) for (let k = 0; k < 3; k++) { const a = Ia[t * 3 + k], b = Ia[t * 3 + (k + 1) % 3], key = a < b ? a * n + b : b * n + a; (E.get(key) ?? E.set(key, []).get(key)).push(t); }
    const drop = new Set(); for (const ts of E.values()) if (ts.length > 2) for (const t of ts) drop.add(t);
    if (drop.size) { const J = []; for (let t = 0; t < Ia.length / 3; t++) if (!drop.has(t)) J.push(Ia[t * 3], Ia[t * 3 + 1], Ia[t * 3 + 2]); Ia = J; }
    // 2. pinch vertices: one copy per edge-connected fan
    const fan = Array.from({ length: n }, () => []); for (let t = 0; t < Ia.length / 3; t++) for (let k = 0; k < 3; k++) fan[Ia[t * 3 + k]].push(t);
    let split = 0;
    for (let v = 0; v < n; v++) { const ts = fan[v]; if (ts.length < 2) continue;
      const comp = new Map(); let c = 0;
      for (const t0 of ts) { if (comp.has(t0)) continue; const st = [t0]; comp.set(t0, c);
        while (st.length) { const t = st.pop(); for (const u of ts) { if (comp.has(u)) continue; let sh = 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (Ia[t * 3 + a] === Ia[u * 3 + b] && Ia[t * 3 + a] !== v) sh++; if (sh) { comp.set(u, c); st.push(u); } } }
        c++; }
      if (c < 2) continue;
      for (let k = 1; k < c; k++) { const nv = Pa.length / 3; Pa.push(Pa[v * 3], Pa[v * 3 + 1], Pa[v * 3 + 2]); for (const [t, cc] of comp) if (cc === k) for (let q = 0; q < 3; q++) if (Ia[t * 3 + q] === v) Ia[t * 3 + q] = nv; split++; } }
    // 3. fill holes left by step 1
    n = Pa.length / 3; const loops = boundaryLoops(Uint32Array.from(Ia), n); let filled = 0;
    for (const L of loops) { if (L.length > 64) continue; let cx = 0, cy = 0, cz = 0; for (const v of L) { cx += Pa[v * 3]; cy += Pa[v * 3 + 1]; cz += Pa[v * 3 + 2]; } const c = Pa.length / 3; Pa.push(cx / L.length, cy / L.length, cz / L.length); for (let k = 0; k < L.length; k++) Ia.push(L[k], L[(k + 1) % L.length], c); filled++; }
    // 4. drop tiny components
    { const m = Pa.length / 3, par = Int32Array.from({ length: m }, (_, i) => i), f = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
      for (let t = 0; t < Ia.length; t += 3) { const a = f(Ia[t]); par[f(Ia[t + 1])] = a; par[f(Ia[t + 2])] = a; }
      const cnt = new Map(); for (let t = 0; t < Ia.length; t += 3) cnt.set(f(Ia[t]), (cnt.get(f(Ia[t])) ?? 0) + 1);
      const J = []; for (let t = 0; t < Ia.length; t += 3) if (cnt.get(f(Ia[t])) >= minComponent) J.push(Ia[t], Ia[t + 1], Ia[t + 2]); Ia = J; }
    const c = compact(Float32Array.from(Pa), Uint32Array.from(Ia)); Pa = Array.from(c.P); Ia = Array.from(c.I);
    const tp = topo(c.P, c.I); log.push({ round, dropped: drop.size, split, filled, nmE: tp.nonManifoldEdges, nmV: tp.nonManifoldVerts, boundary: tp.boundaryEdges });
    if (!tp.nonManifoldEdges && !tp.nonManifoldVerts && !tp.boundaryEdges) break;
  }
  return { P: Float32Array.from(Pa), I: Uint32Array.from(Ia), log };
}

/** extend a narrow-band signed distance field to the whole grid (two-pass 26-neighbour chamfer transform, sign kept) */
export function extendSDF(S, dims, cell, trusted) {
  const [nx, ny, nz] = dims, N = nx * ny * nz, D = new Float32Array(N), id = (i, j, k) => (k * ny + j) * nx + i;
  for (let g = 0; g < N; g++) D[g] = Math.abs(S[g]) <= trusted ? Math.abs(S[g]) : 1e9;
  const nbh = []; for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj || dk) nbh.push([di, dj, dk, cell * Math.hypot(di, dj, dk)]);
  const fwd = nbh.filter(([di, dj, dk]) => dk < 0 || (dk === 0 && (dj < 0 || (dj === 0 && di < 0)))), bwd = nbh.filter((x) => !fwd.includes(x));
  for (let rep = 0; rep < 2; rep++) {
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const g = id(i, j, k); let d = D[g]; for (const [di, dj, dk, w] of fwd) { const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const v = D[id(a, b, c)] + w; if (v < d) d = v; } D[g] = d; }
    for (let k = nz - 1; k >= 0; k--) for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { const g = id(i, j, k); let d = D[g]; for (const [di, dj, dk, w] of bwd) { const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const v = D[id(a, b, c)] + w; if (v < d) d = v; } D[g] = d; }
  }
  const out = new Float32Array(N); for (let g = 0; g < N; g++) out[g] = S[g] < 0 ? -D[g] : D[g];
  return out;
}

/** ADAPTIVE 1→4 SUBDIVISION of the triangles flagged by `pick(t)` with crack-free (red–green) transitions; new
 *  midpoints are projected onto a reference surface. Topology stays one closed manifold. */
export function subdivideRegion(P, I, pick, refIndex) {
  const n = P.length / 3, nT = I.length / 3, key = (a, b) => (a < b ? a * n + b : b * n + a), mid = new Map(), out = Array.from(P);
  const split = new Set(); for (let t = 0; t < nT; t++) if (pick(t)) for (let k = 0; k < 3; k++) split.add(key(I[t * 3 + k], I[t * 3 + (k + 1) % 3]));
  const m = (a, b) => { const k = key(a, b); let v = mid.get(k); if (v === undefined) { let x = (P[a * 3] + P[b * 3]) / 2, y = (P[a * 3 + 1] + P[b * 3 + 1]) / 2, z = (P[a * 3 + 2] + P[b * 3 + 2]) / 2; const q = refIndex?.closest(x, y, z, 0.02); if (q) { x = q.x; y = q.y; z = q.z; } v = out.length / 3; out.push(x, y, z); mid.set(k, v); } return v; };
  const J = [];
  for (let t = 0; t < nT; t++) {
    const v = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]], s = [0, 1, 2].map((k) => split.has(key(v[k], v[(k + 1) % 3])));
    const c = s.filter(Boolean).length;
    if (c === 0) { J.push(...v); continue; }
    if (c === 3) { const ab = m(v[0], v[1]), bc = m(v[1], v[2]), ca = m(v[2], v[0]); J.push(v[0], ab, ca, ab, v[1], bc, ca, bc, v[2], ab, bc, ca); continue; }
    if (c === 1) { const k = s.indexOf(true), a = v[k], b = v[(k + 1) % 3], cc = v[(k + 2) % 3], x = m(a, b); J.push(a, x, cc, x, b, cc); continue; }
    // two split edges: the unsplit edge is k; quad + triangle
    const k = s.indexOf(false), a = v[k], b = v[(k + 1) % 3], cc = v[(k + 2) % 3], bc = m(b, cc), ca = m(cc, a);
    J.push(ca, bc, cc, a, b, bc, a, bc, ca);
  }
  return { P: Float32Array.from(out), I: Uint32Array.from(J) };
}

/** point-in-polygon on the front (x, y) projection of a 3D loop; returns the loop's mean depth when inside */
export function insideLoopXY(loop, x, y) {
  let inside = false, zs = 0; const n = loop.length / 3;
  for (let i = 0, j = n - 1; i < n; j = i++) { const xi = loop[i * 3], yi = loop[i * 3 + 1], xj = loop[j * 3], yj = loop[j * 3 + 1]; zs += loop[i * 3 + 2]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside; }
  return inside ? zs / n : null;
}
/** distance (front projection) from (x, y) to a 3D loop's polyline */
export function distToLoopXY(loop, x, y) {
  let best = Infinity; const n = loop.length / 3;
  for (let i = 0, j = n - 1; i < n; j = i++) { const ax = loop[j * 3], ay = loop[j * 3 + 1], bx = loop[i * 3], by = loop[i * 3 + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-12, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy)); }
  return best;
}

/** GUTTER DILATION: texels outside every chart take the average of their in-chart neighbours, ring by ring — bilinear
 *  filtering and mipmaps at chart borders then read the chart's own colour (no seam lines) */
export function dilateGutter(img, inside, S, passes = 8) {
  const M = Uint8Array.from(inside);
  for (let it = 0; it < passes; it++) { const add = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const g = y * S + x; if (M[g]) continue; let r = 0, gg = 0, b = 0, c = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= S || Y >= S) continue; const h = Y * S + X; if (!M[h]) continue; r += img[h * 3]; gg += img[h * 3 + 1]; b += img[h * 3 + 2]; c++; }
      if (c) add.push(g, r / c, gg / c, b / c); }
    for (let q = 0; q < add.length; q += 4) { const g = add[q]; img[g * 3] = Math.round(add[q + 1]); img[g * 3 + 1] = Math.round(add[q + 2]); img[g * 3 + 2] = Math.round(add[q + 3]); M[g] = 1; } }
  return img;
}
