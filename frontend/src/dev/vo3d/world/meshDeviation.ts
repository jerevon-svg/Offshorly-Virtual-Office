// vo3d world — SURFACE DEVIATION between a reference mesh and a simplified one, in the reference's own
// units. Pure (no THREE), so the MonkeyAgent stage-2 build script (Node type stripping) and the tests
// measure with the same ruler. Every `stride`-th reference vertex is projected onto the nearest triangle
// of the candidate (uniform grid over triangle centroids, ±1 cell), exact point-triangle distance.
export type Deviation = { mean: number; max: number; p99: number; samples: number };

export function surfaceDeviation(
  refPos: ArrayLike<number>, candPos: ArrayLike<number>, candIdx: ArrayLike<number>, stride = 7, cell = 0.03,
): Deviation {
  const grid = new Map<string, number[]>();
  // every triangle goes into every cell its bounding box touches (a big far-LOD triangle's centroid can
  // sit cells away from the surface point it is nearest to)
  for (let t = 0; t < candIdx.length; t += 3) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) { const v = candPos[candIdx[t + k] * 3 + c]; lo[c] = Math.min(lo[c], v); hi[c] = Math.max(hi[c], v); }
    for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++)
      for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++)
        for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) { const k2 = `${x},${y},${z}`; (grid.get(k2) ?? grid.set(k2, []).get(k2)!).push(t); }
  }
  const ds: number[] = [];
  const n = refPos.length / 3;
  for (let i = 0; i < n; i += stride) {
    const px = refPos[i * 3], py = refPos[i * 3 + 1], pz = refPos[i * 3 + 2];
    const gx = Math.floor(px / cell), gy = Math.floor(py / cell), gz = Math.floor(pz / cell);
    let best = Infinity;
    for (let r = 0; r <= 4 && best === Infinity; r++) {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
        for (const t of grid.get(`${gx + a},${gy + b},${gz + c}`) ?? []) best = Math.min(best, pointTri(px, py, pz, candPos, candIdx, t));
      }
    }
    ds.push(best);
  }
  ds.sort((a, b) => a - b);
  return { mean: ds.reduce((s, d) => s + d, 0) / ds.length, max: ds[ds.length - 1], p99: ds[Math.floor(ds.length * 0.99)], samples: ds.length };
}

function pointTri(px: number, py: number, pz: number, P: ArrayLike<number>, I: ArrayLike<number>, t: number): number {
  const ax = P[I[t] * 3], ay = P[I[t] * 3 + 1], az = P[I[t] * 3 + 2];
  const bx = P[I[t + 1] * 3], by = P[I[t + 1] * 3 + 1], bz = P[I[t + 1] * 3 + 2];
  const cx = P[I[t + 2] * 3], cy = P[I[t + 2] * 3 + 1], cz = P[I[t + 2] * 3 + 2];
  // Ericson, Real-Time Collision Detection 5.1.5 (closest point on triangle)
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const dist = (x: number, y: number, z: number) => Math.hypot(px - x, py - y, pz - z);
  if (d1 <= 0 && d2 <= 0) return dist(ax, ay, az);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return dist(bx, by, bz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return dist(ax + abx * v, ay + aby * v, az + abz * v); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return dist(cx, cy, cz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return dist(ax + acx * w, ay + acy * w, az + acz * w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return dist(bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return dist(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}
