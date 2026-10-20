// boundary-fairing.mjs — THE SKIN'S BOUNDARY CURVES ARE SMOOTH (2026-10-10, universal construction step; chibify calls it before the
// layer parts are extracted). ZERO CREDITS.
//
// Every cut and every hair / skin split in chibify is a per-vertex decision followed by a whole-triangle one, so the skin layer ends in a
// staircase that follows triangle edges. chibify's own rim measure (a boundary vertex's offset from its two boundary neighbours' midpoint
// ÷ the local edge length; a clean cut ≈ 0.1) reads 0.53–0.82 on the visible ear / side / nape boundaries of EVERY head — the approved
// production five included. Only the jaw / neck rim was ever smoothed (rimTuck).
//
// Fairing (no name, no per-person constant): on the unified mesh, BEFORE the parts are cut apart (the hair and the skin still share their
// interface vertices, so both sides move together and no crack can open), each boundary curve of the skin layer inside the region is
// smoothed along itself — every curve vertex moves toward its two curve neighbours' midpoint, TANGENTIALLY (the normal component is
// removed: the curve slides within the surface, the head's shape is not changed) — and the displacement fades out over a few rings so no
// sliver forms. Curve ends and junctions stay put; NOTHING outside the region the caller marks active ever moves — neither curve vertices
// nor the fade (2026-10-10: a fade leaking past the region's front edge moved hair beside an eye and failed FC-EYE-COVERED).
// A STAIRCASE IS LOCAL (2026-10-10 v2): plain Laplacian smoothing shrinks short / closed curves toward their centre (a hole loop
// collapsed; on the coarse skin under the hair, vertices travelled up to 0.37 — a third of the head — off the surface). So: Taubin
// smoothing (λ / μ pairs — removes the zigzag without shrinking the curve) and every curve vertex's total move is capped at half of
// its own curve edges — exactly one staircase corner; anything larger is not a staircase and is left alone.
// NO TRIANGLE FOLDS (2026-10-10 v3): a curve edge says nothing about the triangles on the OTHER side — a long skin edge under the hair
// shared a vertex with fine scalp triangles, and half a skin edge (0.22) dragged them 45× their own size. So every moved vertex —
// curve or fade — travels TOWARD the opposite edge of any triangle around it (every layer, live or not) at most `cap` × that triangle's
// altitude: it cannot cross an opposite edge, so nothing folds or flips, and a coarse edge never drags fine hair. Sliding along
// an edge folds nothing and stays free.
// THE SURFACE STAYS PUT (2026-10-10 v4): a tangential move of a vertex whose triangles are LARGE (coarse skin under the hair, the
// fringe underlay) leaves the curved surface — 0.15–0.19 along the tangent rose about 0.03 off it, six times the gap the hair layers
// keep above the skin. So a vertex also stays within `clear` (chibify's own layer clearance, rules.layers.clear) of the plane of every
// triangle around it: on fine skin this never binds; on coarse skin the curve stays where it was.
// A STAIRCASE IS AT THE MESH'S OWN SCALE (2026-10-10 v5): a curve vertex on a few long slivers slid 0.13 within their plane, in fine
// skin. The staircase this step removes is made of the mesh's own boundary edges, so no vertex moves more than `cap` × the MEDIAN
// boundary edge of the region (measured on the mesh itself — no length constant): a longer curve is not a staircase.
// LOCAL SCALE (2026-10-13, EXPERIMENTAL, opt-in `localScale`, development only — the default path above is unchanged). The v5 median is
// ONE number for the whole region, and the region's curves are mostly the fine ear-ring skin (≈ 1 mm edges), so the lower hairline,
// whose curve runs over the coarse skin under the hair (≈ 10–17 mm edges), was held to the ear's scale: the diagnostics (`diagnose`) show
// the median-edge cap trimming 80–100 % of its vertices and 7–31 % of the smoothing surviving. With localScale the median is taken over
// the curve's own edges within `window` steps either way along it (ends / junctions stop the walk): still the mesh's own scale, still
// robust to a few long slivers (the median of up to 2 × window edges ignores up to window − 1 of them), but local. The own-edge cap, the
// fold cap and the plane cap are unchanged.
// RESULT (2026-10-13, Lui / Kael / Angelo, isolated builds): NOT FOR INTEGRATION — keep it off. The coarse curves straighten (nape
// jaggedness 0.75 → 0.41 Lui, 0.45 → 0.30 Angelo) but the moves reach 8–18 mm: Angelo's map weld is then refused ("the surface would
// fold into a fin") and the old closure returns, and on Lui the skin texture (hair painted near the old hairline) is dragged into a dark
// smudge. Lui's visible ear staircase is not a skin curve at all (it is the hair base cap's grid edge, hair-layers.mjs hairBaseCap).
export const FAIRING = { iterations: 10, lambda: 0.5, mu: -0.53, rings: 3, cap: 0.5, clear: 0.005, window: 8 };

/** P, N: Float32Array (mm×3, edited in place); I: triangle indices; isHeadTri(t), live(t): per triangle; active(v): may this vertex move.
 *  Returns { curves, moved, jaggedBefore, jaggedAfter } (jaggedness over the active curve vertices). */
export function fairSkinBoundaries({ P, N, I, isHeadTri, live = () => true, active = () => true, ...opt }) {
  const { iterations, lambda, mu, rings, cap, clear, window, localScale = false } = { ...FAIRING, ...opt }, n = P.length / 3;
  const key = (v) => `${Math.round(P[v * 3] * 2e4)},${Math.round(P[v * 3 + 1] * 2e4)},${Math.round(P[v * 3 + 2] * 2e4)}`, first = new Map(), rp = new Int32Array(n);
  for (let v = 0; v < n; v++) { const k = key(v); if (!first.has(k)) first.set(k, v); rp[v] = first.get(k); }
  // per welded edge: how many live HEAD triangles use it; per welded vertex: its neighbours
  const headUse = new Map(), allUse = opt.diagnose ? new Map() : null, nb = new Map(), link = (a, b) => { (nb.get(a) ?? nb.set(a, new Set()).get(a)).add(b); }, off = new Int32Array(n + 1);
  for (let t = 0; t < I.length / 3; t++) { for (let q = 0; q < 3; q++) off[rp[I[t * 3 + q]] + 1]++; if (!live(t)) continue; const h = isHeadTri(t);
    for (let q = 0; q < 3; q++) { const a = rp[I[t * 3 + q]], b = rp[I[t * 3 + (q + 1) % 3]]; if (a === b) continue; link(a, b); link(b, a); if (allUse) { const k = a < b ? `${a}_${b}` : `${b}_${a}`; allUse.set(k, (allUse.get(k) ?? 0) + 1); } if (h) { const k = a < b ? `${a}_${b}` : `${b}_${a}`; headUse.set(k, (headUse.get(k) ?? 0) + 1); } } }
  // the limits below see EVERY triangle on a moved point — live or not (a lifted lock welded to a skin curve moves with it)
  for (let v = 0; v < n; v++) off[v + 1] += off[v];
  const vtri = new Int32Array(off[n]), fill = off.slice(0, n); for (let t = 0; t < I.length / 3; t++) for (let q = 0; q < 3; q++) vtri[fill[rp[I[t * 3 + q]]]++] = t;
  const P3 = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const limit = (v, d) => { let s = 1; const A = P3(v);   // the fold cap: per triangle, the move toward its opposite edge ≤ cap × the altitude
    for (let i = off[v]; i < off[v + 1]; i++) { const t = vtri[i], w = [0, 1, 2].map((q) => rp[I[t * 3 + q]]), k = w.indexOf(v); if (k < 0) continue;
      const B = P3(w[(k + 1) % 3]), e = sub(P3(w[(k + 2) % 3]), B), L2 = dot(e, e); if (L2 < 1e-24) continue; const f = dot(sub(A, B), e) / L2, u = sub([B[0] + f * e[0], B[1] + f * e[1], B[2] + f * e[2]], A), h = Math.hypot(...u);
      if (h < 1e-12) continue; const toward = dot(d, u) / h; if (toward > 0) s = Math.min(s, (cap * h) / toward);
      // …and the move stays within `clear` of this triangle's own plane
      const C = P3(w[(k + 2) % 3]), e1 = sub(B, A), e2 = sub(C, A), nt = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], nl = Math.hypot(...nt);
      if (nl > 1e-24) { const off = Math.abs(dot(d, nt)) / nl; if (off > clear) s = Math.min(s, clear / off); } }
    return s < 1 ? d.map((x) => x * s) : d; };
  const limitParts = (v, d) => { let fold = 1, plane = 1; const A = P3(v);   // (diagnostics) limit()'s two scales, apart
    for (let i = off[v]; i < off[v + 1]; i++) { const t = vtri[i], w = [0, 1, 2].map((q) => rp[I[t * 3 + q]]), k = w.indexOf(v); if (k < 0) continue;
      const B = P3(w[(k + 1) % 3]), e = sub(P3(w[(k + 2) % 3]), B), L2 = dot(e, e); if (L2 < 1e-24) continue; const f = dot(sub(A, B), e) / L2, u = sub([B[0] + f * e[0], B[1] + f * e[1], B[2] + f * e[2]], A), h = Math.hypot(...u);
      if (h < 1e-12) continue; const toward = dot(d, u) / h; if (toward > 0) fold = Math.min(fold, (cap * h) / toward);
      const C = P3(w[(k + 2) % 3]), e1 = sub(B, A), e2 = sub(C, A), nt = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], nl = Math.hypot(...nt);
      if (nl > 1e-24) { const o = Math.abs(dot(d, nt)) / nl; if (o > clear) plane = Math.min(plane, clear / o); } }
    return { fold, plane }; };
  const curve = new Map(); for (const [k, c] of headUse) { if (c !== 1) continue; const [a, b] = k.split("_").map(Number); (curve.get(a) ?? curve.set(a, []).get(a)).push(b); (curve.get(b) ?? curve.set(b, []).get(b)).push(a); }
  const free = [...curve.keys()].filter((v) => curve.get(v).length === 2 && active(v));   // ends / junctions stay put
  const pos = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], jag = (get) => { let s = 0, c = 0; for (const v of free) { const [a, b] = curve.get(v), p = get(v), pa = get(a), pb = get(b), el = (Math.hypot(pa[0] - p[0], pa[1] - p[1], pa[2] - p[2]) + Math.hypot(pb[0] - p[0], pb[1] - p[1], pb[2] - p[2])) / 2;
    if (el < 1e-9) continue; s += Math.hypot(p[0] - (pa[0] + pb[0]) / 2, p[1] - (pa[1] + pb[1]) / 2, p[2] - (pa[2] + pb[2]) / 2) / el; c++; } return c ? s / c : 0; };
  const jaggedBefore = jag(pos); if (!free.length) return { curves: 0, moved: 0, jaggedBefore, jaggedAfter: jaggedBefore, movedVerts: [] };
  const cur = new Map([...curve.keys()].map((v) => [v, pos(v)])), get = (v) => cur.get(v) ?? pos(v), tang = (d, v) => { const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2], dn = d[0] * nx + d[1] * ny + d[2] * nz; return [d[0] - dn * nx, d[1] - dn * ny, d[2] - dn * nz]; };
  for (let it = 0; it < 2 * iterations; it++) { const f = it % 2 ? mu : lambda, next = new Map(); for (const v of free) { const [a, b] = curve.get(v), p = get(v), pa = get(a), pb = get(b), d = tang([0, 1, 2].map((k) => f * ((pa[k] + pb[k]) / 2 - p[k])), v); next.set(v, [p[0] + d[0], p[1] + d[1], p[2] + d[2]]); }
    for (const [v, q] of next) cur.set(v, q); }
  // the caps: a curve vertex moves at most `cap` × the mean of its two ORIGINAL curve edges (one staircase corner) — and at most `cap`
  // × the region's median boundary edge — and no triangle around it folds or leaves its plane
  const edgeOf = (v) => { const [a, b] = curve.get(v), p = pos(v); return (Math.hypot(...[0, 1, 2].map((k) => pos(a)[k] - p[k])) + Math.hypot(...[0, 1, 2].map((k) => pos(b)[k] - p[k]))) / 2; };
  const medEdge = free.map(edgeOf).sort((x, y) => x - y)[(free.length - 1) >> 1];
  const localOf = localScale || opt.diagnose ? new Map() : null;   // (localScale) the median of the curve's own edges within `window` steps either way
  if (localOf) for (const v of free) { const L = []; for (const s0 of curve.get(v)) { let a = v, b = s0; for (let s = 0; s < window && b !== v; s++) { L.push(Math.hypot(...sub(pos(b), pos(a)))); const nx = curve.get(b); if (nx.length !== 2) break; const c = nx[0] === a ? nx[1] : nx[0]; a = b; b = c; } }
    L.sort((x, y) => x - y); localOf.set(v, L[(L.length - 1) >> 1]); }
  const scaleOf = (v) => (localScale ? localOf.get(v) : medEdge);
  const why = opt.diagnose ? new Map() : null, jv = (v, g) => { const [a, b] = curve.get(v), p = g(v), pa = g(a), pb = g(b), el = (Math.hypot(...sub(pa, p)) + Math.hypot(...sub(pb, p))) / 2; return el < 1e-9 ? null : Math.hypot(p[0] - (pa[0] + pb[0]) / 2, p[1] - (pa[1] + pb[1]) / 2, p[2] - (pa[2] + pb[2]) / 2) / el; };
  // (diagnostics) BEND: the vertex's distance from the chord through its two curve neighbours ÷ the local edge — what the eye reads as a
  // staircase; unlike the jaggedness above it is blind to uneven spacing along a straight curve
  const bv = (v, g) => { const [a, b] = curve.get(v), p = g(v), pa = g(a), pb = g(b), el = (Math.hypot(...sub(pa, p)) + Math.hypot(...sub(pb, p))) / 2, c = sub(pb, pa), l2 = dot(c, c); if (el < 1e-9 || l2 < 1e-24) return null;
    const ap = sub(p, pa), f = dot(ap, c) / l2; return Math.hypot(ap[0] - f * c[0], ap[1] - f * c[1], ap[2] - f * c[2]) / el; };
  for (const v of free) { const p = pos(v), q = cur.get(v), lim = cap * Math.min(edgeOf(v), scaleOf(v)), d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], m = Math.hypot(...d);
    const c = limit(v, m > lim && m > 0 ? d.map((x) => (x * lim) / m) : d); cur.set(v, [p[0] + c[0], p[1] + c[1], p[2] + c[2]]);
    if (why) { const got = Math.hypot(...c), sLen = m > lim && m > 0 ? lim / m : 1, dl = m > lim && m > 0 ? d.map((x) => (x * lim) / m) : d, sp = limitParts(v, dl);
      const bound = got >= m * 0.999 ? "none" : sLen <= Math.min(sp.fold, sp.plane) ? (edgeOf(v) <= scaleOf(v) ? "ownEdge" : localScale ? "localEdge" : "medianEdge") : sp.fold <= sp.plane ? "fold" : "plane";
      const [a, b] = curve.get(v), t = tang(sub(pos(b), pos(a)), v), tl = Math.hypot(...t), al = tl > 1e-12 ? Math.abs(dot(d, t)) / tl : 0;
      why.set(v, { want: m, got, bound, j0: jv(v, pos), b0: bv(v, pos), own: edgeOf(v), local: localOf.get(v), along: al, across: Math.sqrt(Math.max(0, m * m - al * al)) }); } }
  const jaggedAfter = jag(get);
  // the curve displacement, faded over `rings` rings of neighbours (tangential at each vertex) — no sliver along the faired curve
  const D = new Map(); for (const v of free) { const p = pos(v), q = cur.get(v); D.set(v, [q[0] - p[0], q[1] - p[1], q[2] - p[2]]); }
  let front = [...D.keys()]; const ring = new Map(front.map((v) => [v, 0]));
  for (let r = 1; r <= rings; r++) { const nf = []; for (const v of front) for (const u of nb.get(v) ?? []) if (!ring.has(u) && !curve.has(u)) { ring.set(u, r); nf.push(u); }
    for (const u of nf) { if (!active(u)) continue; const ds = [...nb.get(u)].filter((w) => D.has(w) && ring.get(w) === r - 1).map((w) => D.get(w)); if (!ds.length) continue; const f = 1 - r / (rings + 1), m = [0, 1, 2].map((k) => (f * ds.reduce((s, d) => s + d[k], 0)) / ds.length); D.set(u, limit(u, tang(m, u))); }
    front = nf; }
  const movedVerts = []; let maxMove = 0, maxAt = null; for (let v = 0; v < n; v++) { const d = D.get(rp[v]); if (!d) continue; const m = Math.hypot(d[0], d[1], d[2]); if (m > maxMove) { maxMove = m; maxAt = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]].map((x) => +x.toFixed(3)); }
    P[v * 3] += d[0]; P[v * 3 + 1] += d[1]; P[v * 3 + 2] += d[2]; movedVerts.push(v); }
  let diag; if (why) { diag = {}; const region = opt.region ?? (() => "all"), med = (A) => (A.length ? A.sort((x, y) => x - y)[(A.length - 1) >> 1] : 0);
    for (const v of free) { const R = (diag[region(v)] ??= { verts: 0, interface: 0, openRim: 0, want: 0, got: 0, along: 0, across: 0, bound: { none: 0, ownEdge: 0, medianEdge: 0, localEdge: 0, fold: 0, plane: 0 }, jagBefore: 0, jagAfter: 0, jn: 0, bendBefore: 0, bendAfter: 0, bn: 0, own: [], local: [] }), w = why.get(v), [a, b] = curve.get(v);
      R.verts++; const ka = v < a ? `${v}_${a}` : `${a}_${v}`, kb = v < b ? `${v}_${b}` : `${b}_${v}`; if ((allUse.get(ka) ?? 0) > 1 || (allUse.get(kb) ?? 0) > 1) R.interface++; else R.openRim++;
      R.want += w.want; R.got += w.got; R.along += w.along; R.across += w.across; R.bound[w.bound]++; R.own.push(w.own); R.local.push(w.local); const j1 = jv(v, get); if (w.j0 !== null && j1 !== null) { R.jagBefore += w.j0; R.jagAfter += j1; R.jn++; } const b1 = bv(v, get); if (w.b0 !== null && b1 !== null) { R.bendBefore += w.b0; R.bendAfter += b1; R.bn++; } }
    for (const R of Object.values(diag)) { const nv = Math.max(1, R.verts); R.realized = R.want > 0 ? +(R.got / R.want).toFixed(3) : 1; R.jagBefore = +(R.jagBefore / Math.max(1, R.jn)).toFixed(3); R.jagAfter = +(R.jagAfter / Math.max(1, R.jn)).toFixed(3); R.bendBefore = +(R.bendBefore / Math.max(1, R.bn)).toFixed(3); R.bendAfter = +(R.bendAfter / Math.max(1, R.bn)).toFixed(3);
      R.meanWant = +(R.want / nv).toFixed(5); R.meanGot = +(R.got / nv).toFixed(5); R.meanAlong = +(R.along / nv).toFixed(5); R.meanAcross = +(R.across / nv).toFixed(5); R.ownEdge = +med(R.own).toFixed(5); R.localEdge = +med(R.local).toFixed(5);
      for (const k of ["want", "got", "along", "across", "jn", "bn", "own", "local"]) delete R[k]; }
    diag.medianEdge = +medEdge.toFixed(5); }
  return { curves: free.length, moved: movedVerts.length, maxMove: +maxMove.toFixed(4), maxAt, jaggedBefore: +jaggedBefore.toFixed(3), jaggedAfter: +jaggedAfter.toFixed(3), movedVerts, ...(diag ? { diag } : {}) };
}
