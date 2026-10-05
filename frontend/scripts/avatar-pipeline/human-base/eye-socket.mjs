// eye-socket.mjs — THE EYE-DEPTH CONTRACT (HumanBase V1.1). ZERO CREDITS. Universal: nothing names an employee.
//
// Generated heads sculpt their eyes as BALLS standing out of the face (measured: 0.03–0.15 native in front of the local
// face surface, worst on the sides of the head), and the living-eye shell followed that relief — from ¾ and side views
// the eyes read as separate bulging plates. The contract, per eye, relative to the LOCAL FACE (never the camera):
//   · the SOCKET SURFACE S: the face continued smoothly across the eye — a harmonic fill over the eye zone from the real
//     skin ring around it (brow below the brow line, cheek top, nose side, temple);
//   · the eye and its lids may rise above S only by a small, bounded CORNEA allowance (a dome, largest at the centre,
//     proportional to the eye's width) and may not sink deeper than a bounded recess — a soft knee keeps a little of
//     the person's own relief, so eye shape and spacing are untouched (only depth is normalised);
//   · weights fade out over the zone border: the brow, cheek and nose are never moved.
// The living-eye shell is then baked on this seated surface (chibify), with a small absolute lift.
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function seatEyes(m, rules) {
  const { P, I, movable, lm } = m, R = rules.eyeSocket, out = [];
  for (const sx of [-1, 1]) {
    const cx = sx * Math.abs(lm.eyes.r[0]), cy = (lm.eyes.l[1] + lm.eyes.r[1]) / 2, hw = lm.eyes.halfW, ry = Math.min(0.75 * hw, Math.max(0.45 * hw, lm.eyes.halfH));
    const ax = hw * R.zone, ay = ry * R.zone, c = 0.0025;
    const G = { x0: cx - ax * 1.25, y0: cy - ay * 1.25, nx: Math.ceil(ax * 2.5 / c), ny: Math.ceil(ay * 2.5 / c) };
    const rOf = (x, y) => Math.hypot((x - cx) / hw, (y - cy) / ry);
    // the head's front surface over the patch (head triangles only — the fringe is foreground, not face)
    const Z = new Float32Array(G.nx * G.ny).fill(NaN);
    for (let t = 0; t < I.length; t += 3) { const q = [0, 1, 2].map((k) => { const v = I[t + k]; return [(P[v * 3] - G.x0) / c, (P[v * 3 + 1] - G.y0) / c, P[v * 3 + 2]]; });
      if (q.every((p) => p[0] < 0) || q.every((p) => p[0] > G.nx) || q.every((p) => p[1] < 0) || q.every((p) => p[1] > G.ny)) continue;
      const ar = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); if (Math.abs(ar) < 1e-12) continue;
      for (let y = Math.max(0, Math.ceil(Math.min(q[0][1], q[1][1], q[2][1]))); y <= Math.min(G.ny - 1, Math.floor(Math.max(q[0][1], q[1][1], q[2][1]))); y++)
        for (let x = Math.max(0, Math.ceil(Math.min(q[0][0], q[1][0], q[2][0]))); x <= Math.min(G.nx - 1, Math.floor(Math.max(q[0][0], q[1][0], q[2][0]))); x++) {
          const w0 = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / ar, w1 = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / ar, w2 = 1 - w0 - w1;
          if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) continue; const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], k = y * G.nx + x; if (!(z <= Z[k])) Z[k] = z; } }
    // socket surface: harmonic fill inside r < zone from the ring zone ≤ r < zone + 0.15 (the real skin around the eye);
    // a fill cell with no face at all stays NaN (beyond the silhouette)
    const S = Float32Array.from(Z), free = [];
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { const r = rOf(G.x0 + i * c, G.y0 + j * c), k = j * G.nx + i; if (r < R.zone) { if (!Number.isNaN(Z[k])) free.push(k); } else if (r > R.zone + 0.15) S[k] = NaN; }
    { // seed with a row-wise interpolation from the ring, then relax
      for (const k of free) S[k] = NaN;
      for (const k of free) { const i = k % G.nx, j = (k / G.nx) | 0; let l = i, rr = i; while (l > 0 && Number.isNaN(S[j * G.nx + l])) l--; while (rr < G.nx - 1 && Number.isNaN(S[j * G.nx + rr])) rr++;
        const zl = S[j * G.nx + l], zr = S[j * G.nx + rr]; S[k] = Number.isNaN(zl) ? (Number.isNaN(zr) ? Z[k] : zr) : Number.isNaN(zr) ? zl : zl + (zr - zl) * (i - l) / (rr - l); }
      for (let it = 0; it < 600; it++) for (const k of free) { const i = k % G.nx; let s = 0, n = 0; for (const k2 of [k - 1, k + 1, k - G.nx, k + G.nx]) { if (k2 < 0 || k2 >= S.length || Math.abs((k2 % G.nx) - i) > 1 || Number.isNaN(S[k2])) continue; s += S[k2]; n++; } if (n) S[k] += 1.8 * (s / n - S[k]); } }
    const at = (A, x, y) => { const fx = Math.min(G.nx - 1.001, Math.max(0, (x - G.x0) / c)), fy = Math.min(G.ny - 1.001, Math.max(0, (y - G.y0) / c)), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
      const v = [A[j * G.nx + i], A[j * G.nx + i + 1], A[(j + 1) * G.nx + i], A[(j + 1) * G.nx + i + 1]], w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty]; let s = 0, n = 0; for (let q = 0; q < 4; q++) if (!Number.isNaN(v[q])) { s += v[q] * w[q]; n += w[q]; } return n > 1e-6 ? s / n : NaN; };
    // the contract, per head vertex in the zone
    const bulge = R.cornea * 2 * hw, recess = R.recess * 2 * hw; let moved = 0, before = 0, after = 0;
    for (let v = 0; v < P.length / 3; v++) { if (!movable[v]) continue; const x = P[v * 3], y = P[v * 3 + 1], r = rOf(x, y); if (r >= R.zone) continue;
      const s = at(S, x, y); if (Number.isNaN(s)) continue; const z = P[v * 3 + 2], d = z - s;
      const cap = bulge * Math.max(0, 1 - (r / Math.max(1, R.zone * 0.75)) ** 2) + R.lid * 2 * hw * sm(0.8, 1.2, r), floor = -recess;
      let d2 = d > cap ? cap + (d - cap) * R.knee : d < floor ? floor + (d - floor) * R.knee : d;
      const w = 1 - sm(R.zone - 0.35, R.zone, r); d2 = d + (d2 - d) * w; if (r < 1) { before = Math.max(before, d); after = Math.max(after, d2); }
      if (Math.abs(d2 - d) > 1e-6) { P[v * 3 + 2] = s + d2; moved++; } }
    out.push({ eye: sx < 0 ? "R" : "L", moved, maxOverSocketBefore: +before.toFixed(4), maxOverSocketAfter: +after.toFixed(4) });
  }
  return out;
}
