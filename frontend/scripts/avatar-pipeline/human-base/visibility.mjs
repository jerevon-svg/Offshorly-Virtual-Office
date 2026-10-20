// visibility.mjs — WHAT THE CAMERA SEES OF AN IDENTITY HEAD AT REST (2026-10-10, shared by assembly steps). ZERO CREDITS.
//
// Orthographic z-buffers of every identity part (bind pose, identity space, all parts occlude) from a set of view directions; per
// triangle of the parts asked for, whether it is the FIRST surface in at least one pixel of at least one view. Assembly steps use it
// to change only what nobody sees at rest (scalp backing) or to find closure that floats in plain sight (skull-base cleanup).
// The default views are the mounted gate's WALL_VIEWS (src/dev/vo3d/human/gate/mountedGate.ts — kept identical by the contract test):
// level ring, neck views, the under-hairline ring to −16°, eye-level front / three-quarters.
export const REST_VIEWS = { rear: { az: 180, el: 6 }, rear34L: { az: 140, el: 6 }, rear34R: { az: -140, el: 6 }, sideL: { az: 90, el: 2 }, sideR: { az: -90, el: 2 }, neckFront: { az: 0, el: -8 }, neckBack: { az: 180, el: -10 },
  rearUnder: { az: 180, el: -8 }, rearUnderLow: { az: 180, el: -16 }, rear34LUnder: { az: 150, el: -8 }, rear34RUnder: { az: -150, el: -8 }, rear34LUnderLow: { az: 140, el: -16 }, rear34RUnderLow: { az: -140, el: -16 },
  sideLUnder: { az: 90, el: -12 }, sideRUnder: { az: -90, el: -12 }, front: { az: 0, el: 4 }, front34L: { az: 45, el: 4 }, front34R: { az: -45, el: 4 } };

/** per requested part name: a Uint8Array (one per triangle) — 1 = visible from at least one view. `parts` = every identity part as
 *  { name, P (Float32Array, identity space), I (index array) }; resolution is relative to the head's size. */
export function visibleTriangles(parts, want, { views = REST_VIEWS, res = 512 } = {}) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.P.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.P[i + k]); hi[k] = Math.max(hi[k], p.P[i + k]); }
  const cen = lo.map((v, k) => (v + hi[k]) / 2), half = 0.55 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), out = new Map();
  for (const name of want) { const p = parts.find((q) => q.name === name); if (p) out.set(name, new Uint8Array(p.I.length / 3)); }
  const Z = new Float32Array(res * res), WHO = new Int32Array(res * res), TRI = new Int32Array(res * res);
  for (const { az, el } of Object.values(views)) {
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180, d = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];   // toward the camera
    let r = [d[2], 0, -d[0]]; const rl = Math.hypot(...r); r = rl < 1e-6 ? [1, 0, 0] : r.map((v) => v / rl); const u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
    Z.fill(-Infinity); WHO.fill(-1); TRI.fill(-1);
    parts.forEach((p, pi) => { const P = p.P, I = p.I, pr = (v) => { const x = P[v * 3] - cen[0], y = P[v * 3 + 1] - cen[1], z = P[v * 3 + 2] - cen[2]; return [((x * r[0] + y * r[1] + z * r[2]) / half * 0.5 + 0.5) * res, ((x * u[0] + y * u[1] + z * u[2]) / half * 0.5 + 0.5) * res, x * d[0] + y * d[1] + z * d[2]]; };
      for (let t = 0; t < I.length; t += 3) { const A = pr(I[t]), B = pr(I[t + 1]), C = pr(I[t + 2]), ar = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]); if (Math.abs(ar) < 1e-12) continue;
        const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), x1 = Math.min(res - 1, Math.ceil(Math.max(A[0], B[0], C[0]))), y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), y1 = Math.min(res - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) { const qx = px + 0.5, qy = py + 0.5, w0 = ((B[0] - qx) * (C[1] - qy) - (C[0] - qx) * (B[1] - qy)) / ar, w1 = ((C[0] - qx) * (A[1] - qy) - (A[0] - qx) * (C[1] - qy)) / ar, w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue; const z = w0 * A[2] + w1 * B[2] + w2 * C[2], k = py * res + px; if (z > Z[k]) { Z[k] = z; WHO[k] = pi; TRI[k] = t / 3; } } } });
    for (let k = 0; k < res * res; k++) { if (WHO[k] < 0) continue; const f = out.get(parts[WHO[k]].name); if (f) f[TRI[k]] = 1; } }
  return out;
}

/** every mesh of an identity document as { name, P, I } in identity space (node transforms applied) */
export function identityParts(doc) {
  const out = [];
  for (const node of doc.getRoot().listNodes()) { const mesh = node.getMesh(); if (!mesh) continue; const M = node.getWorldMatrix();
    for (const pr of mesh.listPrimitives()) { const S = pr.getAttribute("POSITION").getArray(), P = new Float32Array(S.length);
      for (let i = 0; i < S.length; i += 3) { const x = S[i], y = S[i + 1], z = S[i + 2]; P[i] = M[0] * x + M[4] * y + M[8] * z + M[12]; P[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; P[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14]; }
      out.push({ name: mesh.getName(), P, I: pr.getIndices()?.getArray() ?? Uint32Array.from({ length: S.length / 3 }, (_, i) => i), prim: pr }); } }
  return out;
}
