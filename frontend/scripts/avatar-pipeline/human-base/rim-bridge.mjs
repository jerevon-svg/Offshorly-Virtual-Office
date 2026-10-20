// rim-bridge.mjs — A TWO-RIM OPENING, BRIDGED RIM TO RIM (2026-10-12, EXPERIMENTAL, opt-in: --repairs=mapWeld:1,rimBridge:1). ZERO CREDITS.
//
// Where two rims take turns being the lowest round the neck (underside-weld.mjs: "rims interleave"), and over their shared angles one lies
// INSIDE and BELOW the other, the opening between them is a slot — the top of the identity's own neck skin below, the bottom of the head
// (skin or the rigid hair-base cap) above. Welding either rim down to the neck ring would cover the other; instead one band runs from rim
// to rim: each rim welded exactly (its own vertices, joints and weights), leaving it along its own skin's outgoing direction (tangent-
// continuous, the collar's rule), rows in between on a Hermite curve, zipped to each rim by angle. The neck closure inside the inner rim
// is left as it is. Never forced: rims that do not face each other across the slot, a crossing of any other surface, an upward fold, a
// fin or a fold back over either skin → no part (the caller falls back). Nothing here knows a name; deterministic.

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const l = Math.hypot(...v); return l > 1e-14 ? v.map((x) => x / l) : null; };
const OBSTACLE = /^identity_|^face_/;

/** the slot pair among the rims: two plain chains (≥ 8 vertices, no loop, no junction) sharing ≥ 10° of angle round the neck, one inside
 *  (median radius ≥ 2 ring steps smaller) and below the other; the pair sharing the most angle → [inner, outer] chain indices, or null */
export function findSlotPair({ chains, th, rad, pos, e }) {
  const TAU = 2 * Math.PI, wrap = (d) => (d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d), med = (v) => v.slice().sort((a, b) => a - b)[v.length >> 1];
  const C = chains.map((c, ci) => { if (c.loop || c.irregular || c.comp.length < 8) return null; let u = th(c.ord[0]), lo2 = u, hi2 = u; for (let i = 1; i < c.ord.length; i++) { u += wrap(th(c.ord[i]) - th(c.ord[i - 1])); lo2 = Math.min(lo2, u); hi2 = Math.max(hi2, u); }
    return { ci, lo: lo2, hi: hi2, r: med(c.comp.map(rad)), y: med(c.comp.map((g) => pos[g][1])) }; }).filter(Boolean);
  let best = null; for (const a of C) for (const b of C) { if (a.ci === b.ci || !(b.r - a.r >= 2 * e && b.y > a.y)) continue;
    let ov = 0; for (const s of [-TAU, 0, TAU]) ov = Math.max(ov, Math.min(a.hi, b.hi + s) - Math.max(a.lo, b.lo + s)); if (ov >= (10 * Math.PI) / 180 && (!best || ov > best.ov)) best = { ov, pair: [a.ci, b.ci] }; }
  return best ? best.pair : null;
}

/** ctx (from weldUnderside, at a two-owner interleave): { parts, pos, nrm, jw, cap, chains, sAdj, owned: [ci, ci], neck, e, headJoint,
 *  colourOf, openBin (Mo bools), binOf, th, rad, qk(P, v) (the weld's position key) }. → { part | null, info, strip } */
export function bridgeRims(ctx) {
  const { parts, pos, nrm, jw, cap, chains, sAdj, owned, neck, e, headJoint, colourOf, openBin, binOf, th, rad, qk } = ctx, TAU = 2 * Math.PI;
  const wrap = (d) => (d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d), fail = (reason, extra = {}) => ({ part: null, info: { welded: false, bridge: true, reason, ...extra } });
  if (owned.length !== 2) return fail("not two rims");
  const ch = owned.map((ci) => chains[ci]); if (ch.some((c) => c.irregular || c.loop)) return fail("a slot rim is a loop or has junctions");
  // each rim in increasing angle (unwrapped); its parameter is the running maximum (a small backward hook keeps its own position)
  const lay = ch.map((c) => { let o = c.ord.slice(), u = [th(o[0])]; for (let i = 1; i < o.length; i++) u.push(u[i - 1] + wrap(th(o[i]) - th(o[i - 1])));
    if (u[u.length - 1] < u[0]) { o.reverse(); u = [th(o[0])]; for (let i = 1; i < o.length; i++) u.push(u[i - 1] + wrap(th(o[i]) - th(o[i - 1]))); }
    let back = 0, mx = -Infinity; const s = u.map((x) => { if (x < mx) back = Math.max(back, (mx - x) * rad(o[0])); mx = Math.max(mx, x); return mx; }); return { o, s, back }; });
  // the same angular frame for both, then inner = the smaller median radius
  { const shift = Math.round((lay[0].s[0] + lay[0].s[lay[0].s.length - 1] - lay[1].s[0] - lay[1].s[lay[1].s.length - 1]) / 2 / TAU) * TAU; lay[1].s = lay[1].s.map((x) => x + shift); }
  const medR = (L) => { const v = L.o.map(rad).sort((a, b) => a - b); return v[v.length >> 1]; }; if (medR(lay[0]) > medR(lay[1])) lay.reverse();
  const [A, B] = lay, lo = Math.max(A.s[0], B.s[0]), hi = Math.min(A.s[A.s.length - 1], B.s[B.s.length - 1]);
  if (!(hi > lo)) return fail("the rims share no angle");
  const at = (L, x) => { let i = 0; while (i + 1 < L.s.length && L.s[i + 1] < x) i++; const j = Math.min(i + 1, L.s.length - 1), f = L.s[j] > L.s[i] ? Math.min(1, Math.max(0, (x - L.s[i]) / (L.s[j] - L.s[i]))) : 0; return pos[L.o[i]].map((c, k) => c + (pos[L.o[j]][k] - c) * f); };
  // each rim vertex's outgoing direction: from its own skin into the opening, across the rim, in the skin's tangent plane
  const outOf = (L) => L.o.map((g, i) => { const acc = [0, 0, 0]; for (const { v: b, r } of sAdj.get(g) ?? []) { if (r.opp === undefined) continue; const m = pos[g].map((c, k) => (c + pos[b][k]) / 2), d = sub3(pos[b], pos[g]), w = sub3(m, pos[r.opp]), dd = dot(d, d) || 1, perp = w.map((x, k) => x - (d[k] * dot(w, d)) / dd), u2 = unit(perp); if (u2) for (let k = 0; k < 3; k++) acc[k] += u2[k]; }
    return unit(acc) ?? [0, -1, 0]; });
  A.out = outOf(A); B.out = outOf(B);
  const outAt = (L, x) => { let i = 0; while (i + 1 < L.s.length && L.s[i + 1] < x) i++; return L.out[Math.min(i, L.out.length - 1)]; };
  // the slot: inside AND below, open on the coverage map, and the rims facing each other across it
  const rMid = (medR(A) + medR(B)) / 2, S = Math.max(8, Math.ceil(((hi - lo) * rMid) / e)), phi = Array.from({ length: S + 1 }, (_, k) => lo + ((hi - lo) * k) / S);
  // (the outgoing directions smoothed along the slot over ± SMOOTH samples — a jagged rim's per-vertex directions would twist the rows)
  const SM = ctx.smooth ?? 4, smoothDir = (D) => D.map((_, k) => { const a = [0, 0, 0]; for (let d = -SM; d <= SM; d++) { const q = D[Math.min(D.length - 1, Math.max(0, k + d))]; for (let c = 0; c < 3; c++) a[c] += q[c]; } return unit(a) ?? D[k]; });
  let notNested = 0, notOpen = 0, notFacing = 0; const PA = phi.map((x) => at(A, x)), PB = phi.map((x) => at(B, x)), OA = smoothDir(phi.map((x) => outAt(A, x))), OB = smoothDir(phi.map((x) => outAt(B, x)));
  phi.forEach((x, k) => { const a = PA[k], b = PB[k], ra = Math.hypot(a[0] - neck.cx, a[2] - neck.cz), rb = Math.hypot(b[0] - neck.cx, b[2] - neck.cz); if (!(ra < rb && a[1] < b[1])) notNested++;
    if (!openBin[binOf(((x + Math.PI) % TAU + TAU) % TAU - Math.PI)]) notOpen++; const ab = sub3(b, a); if (dot(OA[k], ab) <= 0 || dot(OB[k], ab) >= 0) notFacing++; });
  const shape = { range: [lo, hi].map((x) => +((((x + Math.PI) % TAU + TAU) % TAU - Math.PI) * 180 / Math.PI).toFixed(1)), samples: S + 1, notNested, notOpen, notFacing, backA: +(A.back / e).toFixed(2), backB: +(B.back / e).toFixed(2) };
  if (notNested > 0.1 * (S + 1)) return fail("the rims are not one inside and below the other", shape);
  if (notOpen > 0.1 * (S + 1)) return fail("the coverage map finds the slot closed", shape);
  if (notFacing > 0.1 * (S + 1)) return fail("the rims do not face each other across the slot", shape);
  // rows: 0 = the inner rim's own vertices, R = the outer rim's; 1..R−1 on the Hermite curve leaving each rim along its outgoing direction
  const L = PA.map((a, k) => Math.hypot(...sub3(PB[k], a))), R = Math.max(3, Math.ceil(L.slice().sort((x, y) => x - y)[L.length >> 1] / e));
  const herm = (k, t) => { const t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2, l = L[k] * (ctx.tangent ?? 1);
    return [0, 1, 2].map((c) => h00 * PA[k][c] + h10 * l * OA[k][c] + h01 * PB[k][c] - h11 * l * OB[k][c]); };
  const tolA = 1e-5, inRange = (Lr) => Lr.o.map((g, i) => [g, Math.min(hi, Math.max(lo, Lr.s[i]))]).filter((_, i) => Lr.s[i] >= lo - tolA && Lr.s[i] <= hi + tolA);   // (float rounding at shared ends)
  const rimA = inRange(A), rimB = inRange(B); if (rimA.length < 2 || rimB.length < 2) return fail("too few rim vertices in the slot", shape);
  const P = [], C = [], NN = [], JW = [], vRim = [];   // JW: [joints, weights] per vertex; vRim: welded rim vertex g or -1
  const add = (q, g, jwv) => { P.push(...q); C.push(...(colourOf(q[0], q[1], q[2]) ?? [0.8, 0.6, 0.5])); NN.push(g >= 0 ? nrm[g] : null); JW.push(jwv); vRim.push(g); return P.length / 3 - 1; };
  const rigid = [[headJoint, 0, 0, 0], [1, 0, 0, 0]], jwOf = (g) => jw[g] ?? rigid;
  const blend = (wa, f) => { const m = new Map(); for (let k = 0; k < 4; k++) if (wa[1][k] > 0) m.set(wa[0][k], (m.get(wa[0][k]) ?? 0) + wa[1][k] * (1 - f)); m.set(headJoint, (m.get(headJoint) ?? 0) + f);
    const top = [...m].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 4), s = top.reduce((a, x) => a + x[1], 0) || 1; while (top.length < 4) top.push([0, 0]); return [top.map((x) => x[0]), top.map((x) => x[1] / s)]; };
  const iA = rimA.map(([g]) => add(pos[g], g, jwOf(g))), iB = rimB.map(([g]) => add(pos[g], g, jwOf(g)));
  const jwA = phi.map((x) => { const near = rimA.reduce((b, r) => (Math.abs(r[1] - x) < Math.abs(b[1] - x) ? r : b)); return jwOf(near[0]); });
  const row = Array.from({ length: R + 1 }, () => null); for (let j = 1; j < R; j++) row[j] = phi.map((_, k) => add(herm(k, j / R), -1, blend(jwA[k], j / R)));
  // BEHIND WHAT IS ALREADY THERE: hair hanging into the slot (or skin closing it at its ends) lies across the curve's path — the rows are
  // relaxed (smoothed along and across the band, rims fixed) and every row vertex lying outside a surface it projects onto, or within the
  // clearance of it, goes back behind it (the surface's own outward normal) — the band passes behind the hair to the outer rim
  if (ctx.conform !== false) { const c0 = (ctx.conformClear ?? 2) * (ctx.clear ?? 0.005), reach = 6 * e, cellC = 3 * e, gridC = new Map(), OT = [];
    for (const p of parts) { if (!OBSTACLE.test(p.name)) continue; for (let t = 0; t < p.I.length; t += 3) { const V = [0, 1, 2].map((q) => [p.P[p.I[t + q] * 3], p.P[p.I[t + q] * 3 + 1], p.P[p.I[t + q] * 3 + 2]]); let n = unit(cross(sub3(V[1], V[0]), sub3(V[2], V[0]))); if (!n) continue;
      if (p.N) { const m = [0, 1, 2].map((k) => p.N[p.I[t] * 3 + k] + p.N[p.I[t + 1] * 3 + k] + p.N[p.I[t + 2] * 3 + k]); if (dot(m, n) < 0) n = n.map((x) => -x); }
      const id = OT.push({ V, n }) - 1, l = [0, 1, 2].map((k) => Math.floor((Math.min(V[0][k], V[1][k], V[2][k]) - reach) / cellC)), h = [0, 1, 2].map((k) => Math.floor((Math.max(V[0][k], V[1][k], V[2][k]) + reach) / cellC));
      if ((h[0] - l[0] + 1) * (h[1] - l[1] + 1) * (h[2] - l[2] + 1) > 512) continue; for (let x = l[0]; x <= h[0]; x++) for (let y = l[1]; y <= h[1]; y++) for (let z = l[2]; z <= h[2]; z++) { const k = `${x},${y},${z}`; (gridC.get(k) ?? gridC.set(k, []).get(k)).push(id); } } }
    const push = (q) => { let moved = false; for (let pass = 0; pass < 3; pass++) { let any = false; for (const id of gridC.get(q.map((x) => Math.floor(x / cellC)).join(",")) ?? []) { const { V, n } = OT[id], s0 = dot(sub3(q, V[0]), n); if (s0 <= -c0 || s0 > reach) continue;
        const pr = q.map((x, k) => x - n[k] * s0), e0 = sub3(V[1], V[0]), e1 = sub3(V[2], V[0]), w = sub3(pr, V[0]), d00 = dot(e0, e0), d01 = dot(e0, e1), d11 = dot(e1, e1), d20 = dot(w, e0), d21 = dot(w, e1), den = d00 * d11 - d01 * d01; if (Math.abs(den) < 1e-18) continue;
        const bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den; if (bv <= 0 || bw <= 0 || bv + bw >= 1) continue; for (let k = 0; k < 3; k++) q[k] -= n[k] * (s0 + c0); any = moved = true; } if (!any) break; } return moved; };
    const G = Array.from({ length: R + 1 }, (_, j) => phi.map((_, k) => (j === 0 ? PA[k].slice() : j === R ? PB[k].slice() : herm(k, j / R))));
    const CR = Math.min(2, Math.floor((R - 1) / 2));   // the collar rows next to each rim stay on the tangent curve (the weld stays tangent-continuous)
    let pushed = 0; for (let it = 0; it < (ctx.conformIters ?? 60); it++) { for (let j = 1 + CR; j < R - CR; j++) for (let k = 0; k <= S; k++) { const a = G[j - 1][k], b = G[j + 1][k], l2 = G[j][Math.max(0, k - 1)], r2 = G[j][Math.min(S, k + 1)]; for (let c = 0; c < 3; c++) G[j][k][c] = 0.5 * G[j][k][c] + 0.5 * (a[c] + b[c] + l2[c] + r2[c]) / 4; }
      pushed = 0; for (let j = 1; j < R; j++) for (let k = 0; k <= S; k++) if (push(G[j][k])) pushed++; }
    for (let j = 1; j < R; j++) for (let k = 0; k <= S; k++) P.splice(row[j][k] * 3, 3, ...G[j][k]); shape.conformPushed = pushed; }
  const I = [], tri = (a, b, c) => { const n = cross(sub3(P.slice(b * 3, b * 3 + 3), P.slice(a * 3, a * 3 + 3)), sub3(P.slice(c * 3, c * 3 + 3), P.slice(a * 3, a * 3 + 3))); if (Math.hypot(...n) > 1e-12) I.push(a, b, c); };
  // a rim (its own vertices at their parameters) zipped to a sample row by angle
  const zip = (rim, ids, rowIds, rimIsLow) => { let i = 0, k = 0; while (i + 1 < rim.length || k + 1 < rowIds.length) { const ni = i + 1 < rim.length ? rim[i + 1][1] : Infinity, nk = k + 1 < rowIds.length ? phi[k + 1] : Infinity;
    if (ni <= nk) { rimIsLow ? tri(ids[i], ids[i + 1], rowIds[k]) : tri(ids[i + 1], ids[i], rowIds[k]); i++; } else { rimIsLow ? tri(ids[i], rowIds[k + 1], rowIds[k]) : tri(rowIds[k], rowIds[k + 1], ids[i]); k++; } } };
  zip(rimA, iA, row[1], true);
  for (let j = 1; j + 1 < R; j++) for (let k = 0; k < S; k++) { const a = row[j][k], b = row[j][k + 1], c = row[j + 1][k + 1], d = row[j + 1][k]; tri(a, b, c); tri(a, c, d); }
  zip(rimB, iB, row[R - 1], false);
  // orientation from each skin: the band must run along each rim edge the opposite way to the skin's own triangle there
  const Pt = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], ek = (a, b) => `${a}|${b}`, dirE = new Map(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) dirE.set(ek(I[t + q], I[t + (q + 1) % 3]), t);
  const vote = (rim, ids) => { let same = 0, opp = 0; for (let i = 0; i + 1 < rim.length; i++) { const g0 = rim[i][0], g1 = rim[i + 1][0], r = (sAdj.get(g0) ?? []).find((x) => x.v === g1)?.r; if (!r) continue;
      const skinDir = r.from === g0 ? 1 : -1, bandDir = dirE.has(ek(ids[i], ids[i + 1])) ? 1 : dirE.has(ek(ids[i + 1], ids[i])) ? -1 : 0; if (!bandDir) continue; if (skinDir === bandDir) same++; else opp++; } return { same, opp }; };
  const vA = vote(rimA, iA), vB = vote(rimB, iB), flipA = vA.same > vA.opp, flipB = vB.same > vB.opp;
  if (flipA !== flipB) return fail("the two skins orient the band opposite ways", { ...shape, voteA: vA, voteB: vB });
  if (flipA) for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; }
  // ---- validation (never forced) ----
  const triN = (t) => unit(cross(sub3(Pt(I[t + 1]), Pt(I[t])), sub3(Pt(I[t + 2]), Pt(I[t]))));
  let folded = 0; for (let t = 0; t < I.length; t += 3) { const n = triN(t); if (!n || n[1] > 0.5) folded++; }
  const he = new Map(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) he.set(ek(I[t + q], I[t + (q + 1) % 3]), t);
  let fins = 0; for (const [k2, t1] of he) { const [a, b] = k2.split("|"); const t2 = he.get(ek(b, a)); if (t2 === undefined || +a > +b) continue; const n1 = triN(t1), n2 = triN(t2); if (n1 && n2 && dot(n1, n2) < -0.5) fins++; }
  // fold back over either skin: the band's triangle on a rim edge against the skin's triangle on it (≥ 90° = folded back)
  const crease = [], fbBy = { inner: 0, outer: 0 }, fbAt = []; for (const [rim, ids, nm] of [[rimA, iA, "inner"], [rimB, iB, "outer"]]) for (let i = 0; i + 1 < rim.length; i++) { const g0 = rim[i][0], g1 = rim[i + 1][0], r = (sAdj.get(g0) ?? []).find((x) => x.v === g1)?.r; if (!r || r.opp === undefined) continue;
    const t = he.get(ek(ids[i], ids[i + 1])) ?? he.get(ek(ids[i + 1], ids[i])); if (t === undefined) continue; const sn = unit(cross(sub3(pos[r.to], pos[r.from]), sub3(pos[r.opp], pos[r.from]))), bn = triN(t); if (sn && bn) { const a = (Math.acos(Math.max(-1, Math.min(1, dot(sn, bn)))) * 180) / Math.PI; crease.push(a); if (a >= 90) { fbBy[nm]++; if (fbAt.length < 8) fbAt.push(`${nm}@${Math.round((th(g0) * 180) / Math.PI)}°r${rad(g0).toFixed(3)}y${pos[g0][1].toFixed(3)}:${Math.round(a)}`); } } }
  const foldBacks = crease.filter((x) => x >= 90).length, cs = crease.slice().sort((x, y) => x - y), cq = (f) => (cs.length ? Math.round(cs[Math.min(cs.length - 1, Math.floor(f * cs.length))]) : null);
  // crossings: exact, triangle against triangle, every other surface but the triangles touching a welded rim vertex
  const cell = 4 * e, ck = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`, grid = new Map();
  const boxCells = (vs, f) => { const l = [0, 1, 2].map((k) => Math.floor(Math.min(...vs.map((v) => v[k])) / cell)), h = [0, 1, 2].map((k) => Math.floor(Math.max(...vs.map((v) => v[k])) / cell)); for (let x = l[0]; x <= h[0]; x++) for (let y = l[1]; y <= h[1]; y++) for (let z = l[2]; z <= h[2]; z++) f(`${x},${y},${z}`); };
  for (let t = 0; t < I.length; t += 3) boxCells([Pt(I[t]), Pt(I[t + 1]), Pt(I[t + 2])], (k) => (grid.get(k) ?? grid.set(k, []).get(k)).push(t)); void ck;
  const segHits = (p0, p1, [A0, B0, C0]) => { const d = sub3(p1, p0), e1 = sub3(B0, A0), e2 = sub3(C0, A0), h = cross(d, e2), det = dot(e1, h); if (Math.abs(det) < 1e-18) return false; const f = 1 / det, s0 = sub3(p0, A0), u = f * dot(s0, h); if (u <= 1e-9 || u >= 1 - 1e-9) return false;
    const q = cross(s0, e1), v = f * dot(d, q); if (v <= 1e-9 || u + v >= 1 - 1e-9) return false; const t = f * dot(e2, q); return t > 1e-9 && t < 1 - 1e-9; };
  const triHits = (X, Y) => [[0, 1], [1, 2], [2, 0]].some(([i, j]) => segHits(X[i], X[j], Y) || segHits(Y[i], Y[j], X));
  const rimKeys = new Set([...rimA, ...rimB].map(([g]) => qk([pos[g][0], pos[g][1], pos[g][2]], 0)));
  let crossings = 0; const crossedBy = {}, crossRows = {}, crossAt = [], rowOf = new Int32Array(P.length / 3); iB.forEach((v) => (rowOf[v] = R)); for (let j = 1; j < R; j++) for (const v of row[j]) rowOf[v] = j;
  for (const p of parts) { if (!OBSTACLE.test(p.name)) continue; for (let t = 0; t < p.I.length; t += 3) { const g = [p.I[t], p.I[t + 1], p.I[t + 2]]; if (g.some((v) => rimKeys.has(qk(p.P, v)))) continue; const V = g.map((v) => [p.P[v * 3], p.P[v * 3 + 1], p.P[v * 3 + 2]]);
    const cand = new Set(); boxCells(V, (k) => { for (const u of grid.get(k) ?? []) cand.add(u); }); for (const u of cand) if (triHits(V, [Pt(I[u]), Pt(I[u + 1]), Pt(I[u + 2])])) { crossings++; crossedBy[p.name] = (crossedBy[p.name] ?? 0) + 1; const rw = Math.max(...[0, 1, 2].map((q) => rowOf[I[u + q]])); crossRows[rw] = (crossRows[rw] ?? 0) + 1; if (crossAt.length < 8) { const c = [0, 1, 2].map((k) => (V[0][k] + V[1][k] + V[2][k]) / 3); crossAt.push(`${p.name.replace("identity_", "")}@${Math.round((Math.atan2(c[2] - neck.cz, c[0] - neck.cx) * 180) / Math.PI)}°r${Math.hypot(c[0] - neck.cx, c[2] - neck.cz).toFixed(3)}y${c[1].toFixed(3)} row${rw}`); } break; } } }
  const info = { welded: true, bridge: true, mapped: true, rims: 2, weldedVerts: rimA.length + rimB.length, innerWelded: rimA.length, outerWelded: rimB.length, innerUnwelded: A.o.length - rimA.length, outerUnwelded: B.o.length - rimB.length,
    outerCap: rimB.filter(([g]) => cap[g]).length, rows: R, ...shape, tris: I.length / 3, folded, fins, foldBacks, crease: { median: cq(0.5), p90: cq(0.9), max: cq(1) }, crossings, crossedBy, ringEdge: +e.toFixed(4), ...(ctx.debug ? { fbBy, fbAt, crossRows, crossAt } : {}) };
  if (crossings) return fail("the bridge would cross another surface", info);
  if (folded) return fail("the bridge would fold", info);
  if (foldBacks) return fail("the bridge would fold back over the skin at a rim", info);
  if (fins) return fail("the bridge would fold into a fin", info);
  // normals: the band's own; on each rim the skin's (the lighting carries across the weld)
  const Pf = Float32Array.from(P), N = new Float32Array(Pf.length); for (let t = 0; t < I.length; t += 3) { const n = cross(sub3(Pt(I[t + 1]), Pt(I[t])), sub3(Pt(I[t + 2]), Pt(I[t]))); for (let q = 0; q < 3; q++) for (let c = 0; c < 3; c++) N[I[t + q] * 3 + c] += n[c]; }
  for (let v = 0; v < Pf.length / 3; v++) { const n = (NN[v] && unit(NN[v])) ?? unit([N[v * 3], N[v * 3 + 1], N[v * 3 + 2]]) ?? [0, -1, 0]; N.set(n, v * 3); }
  const nv = Pf.length / 3, J = new Uint8Array(nv * 4), W = new Float32Array(nv * 4); for (let v = 0; v < nv; v++) { J.set(JW[v][0], v * 4); W.set(JW[v][1], v * 4); }
  // strip coordinates for underside-texture.mjs: columns along the slot (u 0..1), depth from the INNER rim (skin: its own texels mirrored)
  const M = S + 1, su = new Float32Array(nv), sd = new Float32Array(nv), uOf = (x) => ((x - lo) / (hi - lo)) * (S / M);
  const colDepth = phi.map((_, k) => { let acc = 0, prev = PA[k]; for (let j = 1; j < R; j++) { const q = Pt(row[j][k]); acc += Math.hypot(...sub3(q, prev)); su[row[j][k]] = k / M; sd[row[j][k]] = acc; prev = q; } return acc + Math.hypot(...sub3(PB[k], prev)); });
  rimA.forEach(([, x], i) => { su[iA[i]] = uOf(x); sd[iA[i]] = 0; });
  rimB.forEach(([, x], i) => { const f = ((x - lo) / (hi - lo)) * S, k0 = Math.min(S, Math.floor(f)), k1 = Math.min(S, k0 + 1); su[iB[i]] = uOf(x); sd[iB[i]] = colDepth[k0] + (colDepth[k1] - colDepth[k0]) * (f - k0); });
  const strip = { u: su, depth: sd, M, rim: PA.map((q) => q.slice()), inward: phi.map((_, k) => Pt(row[1][k])), hairBin: Array.from({ length: M }, () => false), maxDepth: Math.max(...sd), wallDepth: colDepth };
  return { part: { name: "baked_underside", P: Pf, N, I, COLOR: C, J, W, material: { name: "baked_underside", roughness: 0.9 } }, info, strip };
}
