// fringe-exact.mjs — FC-FRINGE-INTO-FACE-EXACT (2026-10-12, REPORT-ONLY until proven; the blocking FC-FRINGE-EYE is unchanged).
//
// FC-FRINGE-EYE's "into the face" count compares each fringe vertex with the face depth at the NEAREST point of a 4 mm grid
// (check-identity.mjs frontRaster). Where the face curves away steeply (temple, hairline) that sample is off by up to ~1 cm-eq,
// and on a compressed (decimated) head the vertex set changes from build to build — so one vertex can land on the 30 mm window
// edge in one build and not in the next: France's verdict flipped with identical fringe geometry (2026-10-12).
//
// Exact definition (deterministic): the face depth is RAY-CAST at each fringe point's own (x, y) — the frontmost of identity_head +
// identity_face_twin — and FC-FRINGE-EYE's own window (5–30 mm behind the face), frontal zone (face z ≥ 0.05) and silhouette rule
// (slope < 1.2) are evaluated on that exact surface. The defect measure is the AREA of fringe triangles SUNK whole inside the face (all
// three corners in the window) — area, not a vertex count: isolated tucked vertices (the hairline / outline tucks every approved head
// has: Bon 11, France 6, Clang 2 exact inside vertices, all read 0 by the 4 mm grid only by sampling luck) carry no area, and it does
// not change with mesh density / compression. Calibration 2026-10-12: approved five 0 · France fair6/v10/v11 0 · France v8 (the
// uncapped-fairing build that also failed FC-EYE-COVERED) 1.9e-5 · negative fixtures (fixtures/report-only) 3.6e-4 and 6.5e-4.
// KNOWN BLIND SPOT: a strand sunk right at the face's outline (its corners fall to the zone / silhouette rules: fixture
// bon-broken-fringe-into-face, 0 here) — FC-FRINGE-EYE still catches it, which is one reason this stays report-only.
// Rejected (each failed a negative or an approved head): exempting the lock's attachment by skin weight (most of the fringe is rigid),
// by flow direction (side edges blur root/tip), by distance to other hair (excused a whole sunk strand); exempting the face region's
// edge (blind to outline sinks the current check catches); counting 2-of-3 sunk corners (fires on approved Bon).
export const FRINGE_WINDOW = { near: 0.005, far: 0.03, minFaceZ: 0.05, slopeMax: 1.2, cell: 0.004 };

/** the frontmost surface of `meshes` ([{ P, I }]) at an exact (x, y): max z over the triangles covering it (NaN where none) */
export function exactFrontDepth(meshes, bucket = 0.01) {
  const g = new Map(), T = [];
  for (const { P, I } of meshes) for (let t = 0; t < I.length; t += 3) { const v = [I[t], I[t + 1], I[t + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]), id = T.push(v) - 1;
    for (let gx = Math.floor(Math.min(v[0][0], v[1][0], v[2][0]) / bucket); gx <= Math.floor(Math.max(v[0][0], v[1][0], v[2][0]) / bucket); gx++)
      for (let gy = Math.floor(Math.min(v[0][1], v[1][1], v[2][1]) / bucket); gy <= Math.floor(Math.max(v[0][1], v[1][1], v[2][1]) / bucket); gy++) { const k = gx * 100003 + gy; const L = g.get(k); if (L) L.push(id); else g.set(k, [id]); } }
  return (x, y) => { let best = NaN; for (const id of g.get(Math.floor(x / bucket) * 100003 + Math.floor(y / bucket)) ?? []) { const [a, b, c] = T[id], ar = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]); if (Math.abs(ar) < 1e-14) continue;
    const w0 = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / ar, w1 = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / ar, w2 = 1 - w0 - w1; if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue; const z = w0 * a[2] + w1 * b[2] + w2 * c[2]; if (!(z <= best)) best = z; } return best; };
}

/** fringe: { P, I }; face: [{ P, I }] (identity_head + identity_face_twin).
 *  Returns { sunkArea (head units²), sunkTris, inside, nearWindowEdge, verts, hits } — `sunkArea` is the defect measure */
export function fringeIntoFaceExact({ fringe, face }, W = FRINGE_WINDOW) {
  if (!fringe || !face.length) return { sunkArea: 0, sunkTris: 0, inside: 0, nearWindowEdge: 0, verts: 0, hits: [] };
  const depth = exactFrontDepth(face), c = W.cell, n = fringe.P.length / 3, sunk = new Uint8Array(n); let inside = 0, near = 0; const hits = [];
  for (let v = 0; v < n; v++) { const x = fringe.P[v * 3], y = fringe.P[v * 3 + 1], z = fringe.P[v * 3 + 2], zf = depth(x, y); if (!(zf >= W.minFaceZ)) continue;
    const sl = Math.max(Math.abs((depth(x + c, y) - depth(x - c, y)) / (2 * c)), Math.abs((depth(x, y + c) - depth(x, y - c)) / (2 * c))); if (!(sl < W.slopeMax)) continue;   // the silhouette, as FC-FRINGE-EYE
    const d = zf - z; if (Math.abs(d - W.near) < 0.001 || Math.abs(d - W.far) < 0.001) near++; if (!(d > W.near && d < W.far)) continue;
    inside++; sunk[v] = 1; if (hits.length < 6) hits.push([x, y, z, d].map((u) => +u.toFixed(4))); }
  let sunkArea = 0, sunkTris = 0; const I = fringe.I, P = fringe.P;
  for (let t = 0; t < I.length; t += 3) { const [a, b, cc] = [I[t], I[t + 1], I[t + 2]]; if (!sunk[a] || !sunk[b] || !sunk[cc]) continue; sunkTris++;
    const u = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), w = [0, 1, 2].map((k) => P[cc * 3 + k] - P[a * 3 + k]); sunkArea += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; }
  return { sunkArea: +sunkArea.toExponential(3), sunkTris, inside, nearWindowEdge: near, verts: n, hits };
}
