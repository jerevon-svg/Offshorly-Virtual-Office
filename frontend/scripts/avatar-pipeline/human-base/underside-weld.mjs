// underside-weld.mjs — ONE WELDED UNDERSIDE (2026-10-12, EXPERIMENTAL, opt-in: chibify --repairs=weldedUnderside:1). ZERO CREDITS.
//
// Today the head's underside is closed by unwelded proxies at different depths — the skin's cut rim, the per-triangle Alex
// skull-base filler, the interior shell set ~1 cm back, hole fills — seen from low angles as patchwork, ledges and a bowl (audit
// 2026-10-12: closure is 5–16 % of the area below the eye line on every head, the approved five included; 74–98 % of it faces
// down; nothing is welded to the skin's rim). The withdrawn napeSkin (a shell laid OVER the skin = max(canonical, skin + 2.5 mm),
// tucked into it) grew panels, ear→jaw stretching, nape seams and fins.
//
// Here the opening round the neck is closed by ONE surface that ends ON the HumanBase neck tube and, round the outside:
//   - is WELDED to the skin's own cut rim (or the rigid hair base cap's edge) wherever they bound the opening — the rim's very vertices,
//     copied exactly with their own joints / weights, so the weld holds in every pose;
//   - where only hair bounds it (a nape haircut reaching the neck) it ends just inside the hair as a free edge — never welded to
//     hair, which moves at runtime;
//   - inside: rings at even angles about the neck axis; radius straight from just inside the rim to the tube wall; height = the
//     canonical underside sheet + a harmonic correction between the rim's height and the wall's (never above the rim, never below
//     the sheet / neck range — no panels, no fins, no bowl). It only fills the opening: never over skin, never tucked into it.
// It NEVER assumes a clean contour. Per angle round the neck the LOWEST open skin rim below the eye line owns that angle; every
// owning rim must be a plain chain (no junctions), own one contiguous range of angles, not fold back by more than one ring step
// and stay outside the neck tube, and the built surface must cross no other surface and face outward. Anything else returns
// { part: null, info.reason } and the caller keeps the existing construction untouched.

import { ShapeUtils, Vector2 } from "three";
import { bridgeRims, findSlotPair } from "./rim-bridge.mjs";

// ring edge = eye spacing / 40; a rim may run backward round the neck by ≤ `fold` ring steps (the envelope takes such a hook as a notch
// fill or a tab; a wider one than the collar itself — three ring steps — could not be bridged); the collar (rings 1..bendRings−1) bends
// from the skin's outgoing direction into the surface
export const WELD = { ringEdgeIod: 1 / 40, fold: 4, bendRings: 3 };

/** the neck tube's wall as a function of angle: the ray from (cx, cz) at θ against the closed polygon `pts` ([[x, z], …] round the axis) */
export function tubeWall(pts, cx, cz) {
  const seg = pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
  return (t) => { const d = [Math.cos(t), Math.sin(t)]; let best = Infinity;
    for (const [a, b] of seg) { const e1 = [b[0] - a[0], b[1] - a[1]], w = [a[0] - cx, a[1] - cz], den = d[0] * e1[1] - d[1] * e1[0]; if (Math.abs(den) < 1e-14) continue;
      const r = (w[0] * e1[1] - w[1] * e1[0]) / den, u = (w[0] * d[1] - w[1] * d[0]) / den; if (r > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, r); }
    return best; };
}

// weldable = rigid on the head by construction: the skin, the face twin and the hair base cap (100 % Head) — never a moving hair layer
const SURFACE = /^identity_/, SKIN = /^identity_(head|face_twin|hair_base)$/, CAP = /^identity_hair_base$/, OBSTACLE = /^identity_|^face_/;

/** parts: [{ name, P, N, I }] (identity space); neck: { cx, cz, wall(θ) → tube radius, y0, y1 } (θ = atan2(z − cz, x − cx));
 *  sheet(x, z) → canonical underside height (NaN where none); eyeY, iod; headJoint; colourOf(x, y, z) → skin [r, g, b] (0..1);
 *  hairColour: [r, g, b] for the free edge under hair; clear: the layers' surface clearance. Returns { part | null, info }. */
export function weldUnderside({ parts, neck, sheet, eyeY, iod, headJoint, colourOf, hairColour = null, clear = 0.005, ...opt }) {
  const { ringEdgeIod, fold, bendRings } = { ...WELD, ...opt }, e = ringEdgeIod * iod; let bridgeInfo; const fail = (reason, extra = {}) => ({ part: null, info: { welded: false, reason, ...extra, ...(bridgeInfo ? { bridge: bridgeInfo } : {}) } });
  const TAU = 2 * Math.PI, wrap = (d) => (d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d);
  // ---- 1. the whole head surface welded by position; its boundary edges (used by exactly one triangle), skin or not ----
  const qk = (P, v) => ((Math.round(P[v * 3] * 2e4) + 65536) * 131072 + (Math.round(P[v * 3 + 1] * 2e4) + 65536)) * 131072 + (Math.round(P[v * 3 + 2] * 2e4) + 65536);   // 0.05 mm weld, exact integer
  const key = new Map(), pos = [], nrm = [], jw = [], cap = [], gid = (P, v) => { const k = qk(P, v); let g = key.get(k); if (g === undefined) { g = pos.length; key.set(k, g); pos.push([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); nrm.push(null); jw.push(null); cap.push(false); } return g; };
  const edges = new Map(), surfTris = [], surfSkin = [];
  for (const p of parts) { if (!SURFACE.test(p.name)) continue; const skin = SKIN.test(p.name), isCap = CAP.test(p.name);
    for (let t = 0; t < p.I.length; t += 3) { const g = [0, 1, 2].map((q) => gid(p.P, p.I[t + q])); surfTris.push(g); surfSkin.push(skin);
      if (skin) for (let q = 0; q < 3; q++) { const v = p.I[t + q], G = g[q]; if (isCap) cap[G] = true; if (!nrm[G] && p.N) nrm[G] = [p.N[v * 3], p.N[v * 3 + 1], p.N[v * 3 + 2]];
        if (!jw[G] && p.J && p.W) jw[G] = [[p.J[v * 4], p.J[v * 4 + 1], p.J[v * 4 + 2], p.J[v * 4 + 3]], [p.W[v * 4], p.W[v * 4 + 1], p.W[v * 4 + 2], p.W[v * 4 + 3]]]; }
      for (let q = 0; q < 3; q++) { const a = g[q], b = g[(q + 1) % 3]; if (a === b) continue; const k = a < b ? a * 8388608 + b : b * 8388608 + a; let r = edges.get(k);
        if (!r) edges.set(k, (r = { n: 0, skin: 0, from: a, to: b })); r.n++; if (skin) { r.skin++; r.from = a; r.to = b; r.opp = g[(q + 2) % 3]; } } } }
  const th = (g) => Math.atan2(pos[g][2] - neck.cz, pos[g][0] - neck.cx), rad = (g) => Math.hypot(pos[g][0] - neck.cx, pos[g][2] - neck.cz);
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // ---- 2. the skin's open rim below the eye line, chain by chain (hair boundaries are never welded) ----
  const sAdj = new Map(), hairB = []; for (const r of edges.values()) { if (r.n !== 1) continue; if (!r.skin) { hairB.push(r.from, r.to); continue; } for (const [a, b] of [[r.from, r.to], [r.to, r.from]]) (sAdj.get(a) ?? sAdj.set(a, []).get(a)).push({ v: b, r }); }
  // a rim that rises above the eye line (round an ear, up a sideburn, a cap's edge round the back) is cut there: only its stretches
  // below the eye line are underside rims (the graph keeps only those vertices and the edges between them)
  for (const [g, L] of [...sAdj]) { if (pos[g][1] >= eyeY) { sAdj.delete(g); continue; } sAdj.set(g, L.filter((x) => pos[x.v][1] < eyeY)); }
  for (const [g, L] of [...sAdj]) if (!L.length) sAdj.delete(g);
  // a rim that TOUCHES ITSELF (a vertex it passes twice — a pinch where a skin hole meets the rim): followed the way the surface runs,
  // each pass through a pinch pairs with its own continuation (the fan of triangles round the vertex); the walk then splits at every
  // repeated vertex — a sub-loop that does not go round the neck is a hole touching the rim (dropped, like any hole), one that does is
  // a rim of its own. Anything the walk cannot follow stays a junction (fallback).
  let heMap = null, selfTouching = 0;
  const traceSelfTouching = (comp) => { if (!heMap) { heMap = new Map(); for (const g of surfTris) for (let q = 0; q < 3; q++) heMap.set(g[q] * 8388608 + g[(q + 1) % 3], g[(q + 2) % 3]); }
    const outE = new Map(); for (const u of comp) for (const { v, r } of sAdj.get(u)) if (r.from === u && r.to === v) (outE.get(u) ?? outE.set(u, []).get(u)).push(v);
    const isE = (u, v) => (outE.get(u) ?? []).includes(v), nextOf = (u, v) => { let c = heMap.get(u * 8388608 + v); for (let n = 0; n < 64 && c !== undefined; n++) { if (!heMap.has(c * 8388608 + v)) return c; c = heMap.get(c * 8388608 + v); } return undefined; };
    const nxt = new Map(), hasPrev = new Set(); for (const [u, vs] of outE) for (const v of vs) { const w = nextOf(u, v); if (w !== undefined && isE(v, w)) { nxt.set(u * 8388608 + v, w); hasPrev.add(v * 8388608 + w); } }
    const used = new Set(), walks = [], all = [...outE].flatMap(([u, vs]) => vs.map((v) => [u, v])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const pass of [0, 1]) for (const [u0, v0] of all) { const k0 = u0 * 8388608 + v0; if (used.has(k0) || (pass === 0 && hasPrev.has(k0))) continue;   // paths from their start first, then loops
      const seq = [u0]; let u = u0, v = v0, closed = false; for (let n = 0; n < 4 * comp.length; n++) { used.add(u * 8388608 + v); seq.push(v); const w = nxt.get(u * 8388608 + v); if (w === undefined) break; if (v * 8388608 + w === k0) { closed = true; seq.pop(); break; } if (used.has(v * 8388608 + w)) break; u = v; v = w; }
      walks.push({ seq, closed }); }
    if (used.size !== all.length) return null;
    const pieces = []; for (const { seq, closed } of walks) { const st = [], at = new Map();
      for (const g of seq) { if (at.has(g)) { const j = at.get(g), sub = st.slice(j); let w = 0; for (let i = 0; i < sub.length; i++) w += wrap(th(sub[(i + 1) % sub.length]) - th(sub[i]));
          for (const x of sub.slice(1)) at.delete(x); st.length = j + 1; if (Math.round(w / TAU) !== 0 && sub.length > 2) pieces.push({ ord: sub, loop: true }); continue; }
        at.set(g, st.length); st.push(g); }
      if (closed) { let w = 0; for (let i = 0; i < st.length; i++) w += wrap(th(st[(i + 1) % st.length]) - th(st[i])); if (Math.round(w / TAU) !== 0 && st.length > 2) pieces.push({ ord: st, loop: true }); }
      else if (st.length > 1) pieces.push({ ord: st, loop: false }); }
    return pieces; };
  const chains = [], seen = new Set();
  for (const s of sAdj.keys()) { if (seen.has(s)) continue; const comp = [s]; seen.add(s); for (let i = 0; i < comp.length; i++) for (const { v } of sAdj.get(comp[i])) if (!seen.has(v)) { seen.add(v); comp.push(v); }
    if (comp.some((g) => sAdj.get(g).length > 2)) { const pieces = traceSelfTouching(comp); if (pieces) { for (const pc of pieces) chains.push({ comp: pc.ord, ord: pc.ord, irregular: false, loop: pc.loop }); selfTouching++; continue; } }
    const irregular = comp.some((g) => sAdj.get(g).length > 2), start = comp.find((g) => sAdj.get(g).length === 1) ?? s, loop = !comp.some((g) => sAdj.get(g).length === 1);
    let ord = [start]; if (!irregular) { let prev = -1, cur = start; for (;;) { const step = sAdj.get(cur).find((x) => x.v !== prev); if (!step || step.v === start) break; prev = cur; cur = step.v; ord.push(cur); if (ord.length > comp.length) break; } }
    if (!irregular && ord.length !== comp.length) ord = comp;   // (never expected: a path that does not cover its component)
    if (loop && !irregular) { let w = 0; for (let i = 0; i < ord.length; i++) w += wrap(th(ord[(i + 1) % ord.length]) - th(ord[i])); if (Math.round(w / TAU) === 0) continue; }   // a HOLE in the skin (does not go round the neck): not a rim
    chains.push({ comp, ord, irregular, loop }); }
  if (!chains.length) return fail("no open skin rim below the eye line");
  if (opt.debugChains) chains.forEach((c, ci) => { const sec = new Map(); for (const g of c.comp) { const k = Math.floor((th(g) * 180) / Math.PI / 20) * 20; const a = sec.get(k) ?? sec.set(k, [0, 0, 0]).get(k); a[0]++; a[1] += rad(g); a[2] += pos[g][1]; }
    const side = []; for (const a of c.comp) for (const { v: b, r } of sAdj.get(a)) { if (b < a || r.opp === undefined) continue; const m = [0, 1, 2].map((k) => (pos[a][k] + pos[b][k]) / 2), o = pos[r.opp]; side.push([o[1] - m[1], Math.hypot(o[0] - neck.cx, o[2] - neck.cz) - Math.hypot(m[0] - neck.cx, m[2] - neck.cz)]); }
    const md = (k) => { const v = side.map((x) => x[k]).sort((x, y) => x - y); return v.length ? v[v.length >> 1].toFixed(4) : "-"; };
    console.log("CHAIN", ci, `verts${c.comp.length} loop${+c.loop} irr${+c.irregular} cap${c.comp.filter((g) => cap[g]).length} skinSide dy${md(0)} dr${md(1)}`, [...sec].sort((x, y) => x[0] - y[0]).map(([k, a]) => `${k}:${a[0]}@r${(a[1] / a[0]).toFixed(3)}y${(a[2] / a[0]).toFixed(3)}`).join(" ")); });
  // ownership on a fixed fine angular grid (half a degree); the rings' own resolution follows the owning rims' radius below
  const Mo = 720, binOf = (t) => ((Math.floor(((t + Math.PI) / TAU) * Mo) % Mo) + Mo) % Mo, binAngle = (j) => -Math.PI + (TAU * (j + 0.5)) / Mo;
  // ---- 3. per angle, the LOWEST skin rim owns it; every owner must be a plain chain owning ONE contiguous range ----
  // except: a skin rim that closes round the neck by itself bounds the opening ALONE (any other rim at those angles lies outside it,
  // behind its surface — e.g. a hair cap hanging lower further out): the innermost such loop then owns every angle
  // MAP-DRIVEN (opt.openArea — coverage-map.mjs): where the head is actually open, per angle. A rim INSIDE the neck tube (a tucked skin
  // sleeve) bounds no opening: it is never the sole loop and, among competing rims, its tucked edges own no angle; angles with no opening
  // get no surface (pinched, below). The sole loop keeps every angle, tucked stretches too: where it is tucked the skin itself passes
  // into the neck — closed there (below) — and its own vertices keep the collapse at the skin's own exit from the tube
  const mapped = !!opt.openArea, tuckedG = (g) => rad(g) < neck.wall(th(g)) + e, tuckedChain = (c) => { const v = c.comp.map((g) => (tuckedG(g) ? 1 : 0)).sort(); return v[v.length >> 1] === 1; };
  const winding = chains.map((c, ci) => (c.loop && !c.irregular && !(mapped && tuckedChain(c)) ? ci : -1)).filter((ci) => ci >= 0), meanR = (ci) => chains[ci].comp.reduce((s2, g) => s2 + rad(g), 0) / chains[ci].comp.length;
  const sole = winding.length ? winding.reduce((a, b) => (meanR(b) < meanR(a) ? b : a)) : -1;
  const lowY = new Float64Array(Mo).fill(Infinity), owner = new Int32Array(Mo).fill(-1);   // by EDGE: a rim edge owns every angle it spans
  // (without such a loop) a rim lying — at its median point — in the UPPER half of the band between the canonical underside and the eye
  // line is the side of the head (a hairline at the temple, an ear root), not the underside: it owns no angle (hair, or the free edge,
  // bounds the opening there). Judged per rim, so one rim is never broken into pieces
  // (beyond the canonical underside's own extent — the temples — its median height just outside the neck tube stands in)
  const shRef = (() => { const v = []; for (let k = 0; k < 36; k++) { const t = (TAU * k) / 36, r = neck.wall(t) + 4 * e, h = sheet(neck.cx + Math.cos(t) * r, neck.cz + Math.sin(t) * r); if (Number.isFinite(h)) v.push(h); } v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : NaN; })();
  const above = (g) => { const q = pos[g], s0 = sheet(q[0], q[2]), sh = Number.isFinite(s0) ? s0 : shRef; return Number.isFinite(sh) ? q[1] - (sh + eyeY) / 2 : -1; };
  const sideRim = chains.map((c) => { const v = c.comp.map(above).sort((x, y) => x - y); return v[v.length >> 1] > 0; }); let sideEdges = 0;
  chains.forEach((c, ci) => { if (sole >= 0 && ci !== sole) return; const cs = new Set(c.comp); for (const a of c.comp) for (const { v: b } of sAdj.get(a)) { if (b < a || !cs.has(b)) continue;
    if (sole < 0 && sideRim[ci]) { sideEdges++; continue; }
    if (mapped && sole < 0 && tuckedG(a) && tuckedG(b)) continue;
    const ta = th(a), d = wrap(th(b) - ta), ja = binOf(ta), n = Math.abs(binOf(th(b)) - ja) > Mo / 2 ? Mo - Math.abs(binOf(th(b)) - ja) : Math.abs(binOf(th(b)) - ja), dir = d >= 0 ? 1 : -1;
    for (let s = 0; s <= n; s++) { const j = (((ja + dir * s) % Mo) + Mo) % Mo, f = n ? s / n : 0, y = pos[a][1] + (pos[b][1] - pos[a][1]) * f; if (y < lowY[j]) { lowY[j] = y; owner[j] = ci; } } } });
  const owned = [...new Set(owner)].filter((ci) => ci >= 0); if (!owned.length) return fail("no skin rim under the head");
  if (opt.debugOwners) { const hY = new Float64Array(Mo).fill(Infinity); for (const g of hairB) { const y = pos[g][1], t = th(g), r = rad(g); if (y >= eyeY || y < neck.y0 || r < neck.wall(t) + 2 * e) continue; const j = binOf(t); if (y < hY[j]) hY[j] = y; }
    console.log("OWNERS", owned.map((ci) => { let n = 0, sy = 0, sh = 0, nh = 0, cap2 = 0; for (let j = 0; j < Mo; j++) if (owner[j] === ci) { n++; sy += lowY[j]; if (hY[j] < Infinity) { sh += hY[j]; nh++; } } cap2 = chains[ci].comp.filter((g) => cap[g]).length;
      return `${ci}:${n}bins y${(sy / n).toFixed(3)} hairBelow${nh ? (sh / nh).toFixed(3) : "-"}(${nh}) verts${chains[ci].comp.length}${cap2 ? " cap" + cap2 : ""}`; }).join("  "), `eyeY ${eyeY.toFixed(3)}`); }
  const bad = owned.filter((ci) => chains[ci].irregular); if (bad.length) return fail("a rim has junctions", { rims: bad.map((ci) => ({ verts: chains[ci].comp.length })) });
  const rOwn = owned.flatMap((ci) => chains[ci].comp.map(rad)).sort((a, b) => a - b), M = Math.max(36, Math.ceil((TAU * rOwn[rOwn.length >> 1]) / e)), freeStep = Math.max(1, Math.round(Mo / M));
  // (map-driven: an angle whose ±5° shows less open canonical underside than one ring step's square has nothing to close — pinched, below)
  const openBin = mapped ? Array.from({ length: Mo }, (_, j) => { let a = 0; for (let d = -10; d <= 10; d++) a += opt.openArea[(j + d + Mo) % Mo]; return a * opt.U * opt.U >= e * e; }) : null;
  // (map-driven, opt-in rimBridge: TWO rims, one inside and below the other over shared angles, bound a SLOT between them — rim-bridge.mjs
  // bridges them rim to rim, or says why not and the weld goes on as without it)
  if (mapped && opt.rimBridge) { const pair = findSlotPair({ chains, th, rad, pos, e }); if (pair) { const br = bridgeRims({ ...(opt.bridgeOpt ?? {}), parts, pos, nrm, jw, cap, chains, sAdj, owned: pair, neck, e, headJoint, colourOf, openBin, binOf, th, rad, qk, clear }); if (br.part) return br; bridgeInfo = br.info; } }
  const runs = []; { let j0 = 0; while (j0 < Mo && owner[j0] === owner[(j0 + Mo - 1) % Mo]) j0++; if (j0 === Mo) j0 = 0;   // start where the owner changes (or anywhere if one owner)
    for (let k = 0; k < Mo;) { const o = owner[(j0 + k) % Mo]; let n = 0; while (k + n < Mo && owner[(j0 + k + n) % Mo] === o) n++; runs.push({ owner: o, j: (j0 + k) % Mo, n }); k += n; } }
  const runsOf = new Map(); for (const r of runs) if (r.owner >= 0) runsOf.set(r.owner, (runsOf.get(r.owner) ?? 0) + 1);
  const desc = (ci) => { const c = chains[ci], ys = c.comp.map((g) => pos[g][1]), rs = c.comp.map(rad), skinShare = c.comp.filter((g) => !cap[g]).length / c.comp.length; return { verts: c.comp.length, y: [Math.min(...ys), Math.max(...ys)].map((v) => +v.toFixed(3)), r: [Math.min(...rs), Math.max(...rs)].map((v) => +v.toFixed(3)), skin: +skinShare.toFixed(2), loop: c.loop }; };
  const split = [...runsOf].filter(([, n]) => n > 1);
  if (split.length) return fail("rims interleave about the neck", { rims: split.map(([ci, n]) => ({ ...desc(ci), ranges: n })), runs: runs.map((r) => `${r.owner}:${r.n}`).join(" "), ...(opt.debugOwners ? { at: runs.map((r) => `${r.owner}@${Math.round((binAngle(r.j) * 180) / Math.PI)}°+${(r.n / 2).toFixed(1)}°`).join(" "),
    open: mapped ? (() => { const ob = Array.from({ length: Mo }, (_, j) => { let a = 0; for (let d = -10; d <= 10; d++) a += opt.openArea[(j + d + Mo) % Mo]; return a; }), out = []; let j = 0; while (j < Mo) { const v = ob[j] * opt.U * opt.U >= e * e; let n = 0; while (j + n < Mo && (ob[j + n] * opt.U * opt.U >= e * e) === v) n++; out.push(`${v ? "OPEN" : "closed"}@${Math.round((binAngle(j) * 180) / Math.PI)}°+${(n / 2).toFixed(1)}°`); j += n; } return out.join(" "); })() : null } : {}) });
  // ---- 4. the outer boundary: each owning chain's own vertices over its range (increasing angle), free points under hair ----
  const outer = [];   // { g } welded rim vertex | { p: [x, y, z] } free point
  // the hair's own lower edge per angle (its lowest open boundary below the eye line, outside the tube and not hanging below the neck
  // junction): where hair bounds the opening, the free edge sits just inside it — no gap between the hair and the surface
  const hairR = new Float64Array(Mo).fill(Infinity), hairY = new Float64Array(Mo).fill(Infinity);
  for (const g of hairB) { const y = pos[g][1], t = th(g), r = rad(g); if (y >= eyeY || y < neck.y0 || r < neck.wall(t) + 2 * e) continue; const j = binOf(t); if (y < hairY[j]) { hairY[j] = y; hairR[j] = r; } }
  const sub = runs.map((r) => { if (r.owner < 0) return null; const c = chains[r.owner], inRun = (g) => { const d = (binOf(th(g)) - r.j + Mo) % Mo; return d < r.n; };
    if (r.n === Mo) { let o = c.ord.slice(); let w = 0; for (let i = 0; i < o.length; i++) w += wrap(th(o[(i + 1) % o.length]) - th(o[i])); if (w < 0) o.reverse(); return o; }   // one rim all the way round
    let ordC = c.ord; if (c.loop) { const s0 = ordC.findIndex((g, i) => inRun(g) && !inRun(ordC[(i + ordC.length - 1) % ordC.length])); if (s0 > 0) ordC = [...ordC.slice(s0), ...ordC.slice(0, s0)]; }   // a loop: start where its range starts
    const idx = ordC.map((g, i) => (inRun(g) ? i : -1)).filter((i) => i >= 0), lo = Math.min(...idx), hi = Math.max(...idx);
    if (hi - lo + 1 !== idx.length) return "gap"; let o = ordC.slice(lo, hi + 1);
    let w = 0; for (let i = 0; i + 1 < o.length; i++) w += wrap(th(o[i + 1]) - th(o[i])); if (w < 0) o.reverse(); return o; });
  if (sub.includes("gap")) return fail("a rim leaves its angle range and comes back");
  // where a rim meets hair, a tail that turns back in angle would make the band cross itself: trimmed (those few vertices, at the
  // hairline junction under the hair, stay unwelded and are counted)
  let trimmed = 0; sub.forEach((o, ri) => { if (!o || runs.length < 2) return; const un = [0]; for (let i = 1; i < o.length; i++) un.push(un[i - 1] + wrap(th(o[i]) - th(o[i - 1])));
    let end = o.length; if (runs[(ri + 1) % runs.length].owner < 0) { let mx = -Infinity; for (let i = 0; i < o.length; i++) mx = Math.max(mx, un[i]); while (end > 1 && un[end - 1] < mx - 1e-12) { mx = Math.max(...un.slice(0, end - 1)); end--; } }
    let beg = 0; if (runs[(ri + runs.length - 1) % runs.length].owner < 0) { let mn = Infinity; for (let i = o.length - 1; i >= 0; i--) mn = Math.min(mn, un[i]); while (beg < end - 1 && un[beg] > mn + 1e-12) { beg++; mn = Math.min(...un.slice(beg, end)); } }
    trimmed += o.length - (end - beg); sub[ri] = o.slice(beg, end); });
  // a JUNCTION between two welded rims (the skin's rim ending where the cap's begins): the bridge between their ends must cross no
  // surface — where it does, the ends are trimmed back one vertex at a time (left unwelded, counted) until it does not
  const cellJ = 2 * e, gridJ = new Map(), ckJ = (q) => q.map((x) => Math.floor(x / cellJ));
    surfTris.forEach((g, ti) => { const lo = [0, 1, 2].map((k) => Math.min(...g.map((v) => pos[v][k]))), hi = [0, 1, 2].map((k) => Math.max(...g.map((v) => pos[v][k]))), a = ckJ(lo), b = ckJ(hi);
      for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) { const k = `${x},${y},${z}`; (gridJ.get(k) ?? gridJ.set(k, []).get(k)).push(ti); } });
    const mt = (p0, p1, A0, B0, C0) => { const d = sub3(p1, p0), e1 = sub3(B0, A0), e2 = sub3(C0, A0), h = cross(d, e2), det = dot(e1, h); if (Math.abs(det) < 1e-18) return false; const f = 1 / det, s0 = sub3(p0, A0), u = f * dot(s0, h); if (u <= 1e-9 || u >= 1 - 1e-9) return false;
      const q = cross(s0, e1), v = f * dot(d, q); if (v <= 1e-9 || u + v >= 1 - 1e-9) return false; const t = f * dot(e2, q); return t > 1e-9 && t < 1 - 1e-9; };
    const bridgeCrosses = (a, b) => { const lo = ckJ([0, 1, 2].map((k) => Math.min(pos[a][k], pos[b][k]))), hi = ckJ([0, 1, 2].map((k) => Math.max(pos[a][k], pos[b][k]))), seen = new Set();
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (const ti of gridJ.get(`${x},${y},${z}`) ?? []) { if (seen.has(ti)) continue; seen.add(ti); const g = surfTris[ti]; if (g.includes(a) || g.includes(b)) continue; if (mt(pos[a], pos[b], pos[g[0]], pos[g[1]], pos[g[2]])) return true; }
      return false; };
  { for (let ri = 0; ri < runs.length; ri++) { const rn = (ri + 1) % runs.length; if (runs[ri].owner < 0 || runs[rn].owner < 0 || rn === ri) continue; const A2 = sub[ri], B2 = sub[rn];
      for (let n = 0; n < 40 && A2.length > 2 && B2.length > 2 && bridgeCrosses(A2[A2.length - 1], B2[0]); n++) { if (n % 2 === 0) A2.pop(); else B2.shift(); trimmed++; } } }
  for (let ri = 0; ri < runs.length; ri++) { const r = runs[ri]; if (r.owner >= 0) { for (const g of sub[ri]) outer.push({ g }); continue; }
    // hair bounds the opening here: free points just inside the hair, between the neighbouring rims' ends (angle-interpolated)
    const prevRun = sub[(ri + runs.length - 1) % runs.length], nextRun = sub[(ri + 1) % runs.length];
    if (!prevRun || !nextRun) return fail("no skin rim either side of a hair range");
    // the free edge hugs the hair's lower edge where the hair has one in range, runs straight between those points (and the rims' ends)
    // elsewhere, and is smoothed along itself — never a zigzag between hair samples and interpolated points
    const a = prevRun[prevRun.length - 1], b = nextRun[0], ks = []; for (let k = Math.floor(freeStep / 2); k < r.n; k += freeStep) ks.push(k);
    const known = ks.map((k) => { const jj = (r.j + k) % Mo; return hairR[jj] < Infinity ? [hairR[jj] - e, hairY[jj] + e] : null; }), at2 = [-1, ...ks, r.n], val = [[rad(a), pos[a][1]], ...known, [rad(b), pos[b][1]]];
    for (let i = 1; i < val.length - 1; i++) if (!val[i]) { let lo = i - 1, hi = i + 1; while (!val[lo]) lo--; while (!val[hi]) hi++; const f = (at2[i] - at2[lo]) / (at2[hi] - at2[lo]); val[i] = [0, 1].map((c) => val[lo][c] + (val[hi][c] - val[lo][c]) * f); }
    for (let pass = 0; pass < 3; pass++) { const nv = val.map((v, i) => (i === 0 || i === val.length - 1 ? v : [0, 1].map((c) => (val[i - 1][c] + 2 * v[c] + val[i + 1][c]) / 4))); val.splice(0, val.length, ...nv); }
    ks.forEach((k, i) => { const t = binAngle((r.j + k) % Mo); let [rr, y] = val[i + 1]; while (rr > neck.wall(t) + 2 * e && !Number.isFinite(sheet(neck.cx + Math.cos(t) * (rr + e), neck.cz + Math.sin(t) * (rr + e)))) rr -= e / 2;   // over the canonical underside
      outer.push({ p: [neck.cx + Math.cos(t) * rr, y, neck.cz + Math.sin(t) * rr] }); }); }
  // a rim TUCKED into the neck tube (rim tuck / own underside: the skin already reaches inside the neck) has no opening to close —
  // there the boundary is a free edge just outside the tube wall (the tucked skin stays inside the neck, unwelded) and the surface
  // narrows to a thin band
  // (the free point sits where the SKIN itself comes out of the tube — found walking the skin from the tucked vertex — so the surface there
  // starts on the skin and pinches away; never at a guessed height inside the head)
  let skinNb = null; const skinOut = (g0, rr) => { if (!skinNb) { skinNb = new Map(); surfTris.forEach((g, ti) => { if (!surfSkin[ti]) return; for (let q = 0; q < 3; q++) for (const d of [1, 2]) (skinNb.get(g[q]) ?? skinNb.set(g[q], new Set()).get(g[q])).add(g[(q + d) % 3]); }); }
    const seen = new Set([g0]); let front = [g0]; for (let depth = 0; depth < 24 && front.length; depth++) { const nx = []; for (const u of front) for (const v of skinNb.get(u) ?? []) { if (seen.has(v)) continue; seen.add(v);
      if (rad(u) < rr && rad(v) >= rr) { const f = (rr - rad(u)) / (rad(v) - rad(u)); return pos[u][1] + (pos[v][1] - pos[u][1]) * f; } nx.push(v); } front = nx.sort((a2, b2) => a2 - b2); } return null; };
  // (map-driven: an angle whose ±5° shows less open canonical underside than one ring step's square has nothing to close — pinched too)
  let closedPinch = 0;
  // (map-driven: where the boundary itself is tucked into the tube the skin passes into the neck — nothing to close there either: closed)
  if (openBin) { const q0 = (o) => (o.g !== undefined ? pos[o.g] : o.p), tq = (q) => Math.hypot(q[0] - neck.cx, q[2] - neck.cz) < neck.wall(Math.atan2(q[2] - neck.cz, q[0] - neck.cx)) + e, bq = (q) => binOf(Math.atan2(q[2] - neck.cz, q[0] - neck.cx));
    for (let i = 0; i < outer.length; i++) { const qa = q0(outer[i]), qb = q0(outer[(i + 1) % outer.length]); if (!tq(qa)) continue; openBin[bq(qa)] = false; if (!tq(qb)) continue;
      const ja = bq(qa), d = (((bq(qb) - ja) % Mo) + Mo) % Mo, n = d > Mo / 2 ? d - Mo : d; for (let s2 = 0; s2 !== n; s2 += Math.sign(n)) openBin[(((ja + s2) % Mo) + Mo) % Mo] = false; } }
  // …and an open run narrower than the band's own taper (eight ring steps) cannot hold a well-formed band: it is left closed (a flicker of
  // tiny open patches would otherwise taper the band in and out within a few degrees — fins)
  if (openBin) { const minOpen = Math.ceil((8 * Mo) / M); let j0 = 0; while (j0 < Mo && openBin[j0] === openBin[(j0 + Mo - 1) % Mo]) j0++;
    if (j0 < Mo) for (let k = 0; k < Mo;) { const v = openBin[(j0 + k) % Mo]; let n = 0; while (k + n < Mo && openBin[(j0 + k + n) % Mo] === v) n++; if (v && n < minOpen) for (let q = 0; q < n; q++) openBin[(j0 + k + q) % Mo] = false; k += n; } }
  let tucked = 0, tuckedOnSkin = 0; for (const o of outer) { const q = o.g !== undefined ? pos[o.g] : o.p, t = Math.atan2(q[2] - neck.cz, q[0] - neck.cx), w = neck.wall(t), closed = mapped && !openBin[binOf(t)];
    if (closed) closedPinch++;
    if (closed || Math.hypot(q[0] - neck.cx, q[2] - neck.cz) < w + e) { tucked++; const ys = o.g !== undefined ? skinOut(o.g, w + 1.5 * e) : null; if (ys !== null) tuckedOnSkin++;
      const rr = closed ? w : w + 1.5 * e; o.p = [neck.cx + Math.cos(t) * rr, ys ?? Math.min(neck.y1, Math.max(neck.y0, q[1])), neck.cz + Math.sin(t) * rr]; o.tucked = true; if (closed) o.closed = true; delete o.g; } }
  if (mapped && tucked === outer.length) return fail("the coverage map finds no opening a rim or hair edge bounds", { closedPinch, openBins: openBin.filter(Boolean).length });
  if (tucked === outer.length) return fail("the rim is tucked into the neck all the way round", { rims: owned.map((ci) => { const c = chains[ci], ys = c.comp.map((g) => pos[g][1]), rs = c.comp.map(rad); return { verts: c.comp.length, y: [Math.min(...ys), Math.max(...ys)].map((v) => +v.toFixed(3)), r: [Math.min(...rs), Math.max(...rs)].map((v) => +v.toFixed(3)) }; }), hairEdgeBins: hairR.filter((r) => r < Infinity).length, of: Mo });
  for (let i = outer.length - 1; i > 0; i--) { const a = outer[i], b = outer[i - 1]; if (a.g === undefined && b.g === undefined && Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]) < 1e-9) outer.splice(i, 1); }
  const OP = (o) => (o.g !== undefined ? pos[o.g] : o.p), N0 = outer.length, T = outer.map((o) => Math.atan2(OP(o)[2] - neck.cz, OP(o)[0] - neck.cx)), R = outer.map((o) => Math.hypot(OP(o)[0] - neck.cx, OP(o)[2] - neck.cz)), Y = outer.map((o) => OP(o)[1]);
  const welded = outer.filter((o) => o.g !== undefined).length;
  // ---- 5. the outer boundary must stay outside the neck tube and turn round the axis without folding back ----
  let run = 0, worst = 0, total = 0, at = null; for (let i = 0; i < N0; i++) { const d = wrap(T[(i + 1) % N0] - T[i]); total += d; if (d < 0) { run += -d; if ((run * R[i]) / e > worst) { worst = (run * R[i]) / e; at = { i, deg: +((T[i] * 180) / Math.PI).toFixed(1), r: +R[i].toFixed(3), y: +Y[i].toFixed(3), welded: outer[i].g !== undefined }; } } else run = 0; }
  if (Math.round(total / TAU) !== 1) return fail("the rim does not go once round the neck", { turns: +(total / TAU).toFixed(2) });
  if (!(worst <= fold)) { if (opt.debugFins && at) console.log("RIMFOLD", outer.slice(Math.max(0, at.i - 12), at.i + 4).map((o, k) => { const q = OP(o), i = Math.max(0, at.i - 12) + k; return `${i}:${((T[i] * 180) / Math.PI).toFixed(1)}°r${R[i].toFixed(3)}y${Y[i].toFixed(3)}${o.g !== undefined ? (cap[o.g] ? "c" : "s") : "f"}`; }).join(" "));
    return fail("the rim folds back about the neck", { foldRingSteps: +worst.toFixed(2), at, runs: runs.map((r) => `${r.owner}:${r.n}`).join(" ") }); }
  // the skin's OWN outgoing direction at every welded rim vertex: across its rim edges, in the owning skin triangle's plane, away from the
  // skin (smoothed along the rim) — the surface leaves the weld along it; a surface turning back over the skin folds a lip at the weld
  const outDir = outer.map((o) => { if (o.g === undefined) return null; const acc = [0, 0, 0];
    for (const { v, r } of sAdj.get(o.g) ?? []) { if (r.opp === undefined) continue; const a = pos[o.g], ab = sub3(pos[v], a), l2 = dot(ab, ab); if (l2 < 1e-18) continue;
      const w = sub3([0, 1, 2].map((k) => (a[k] + pos[v][k]) / 2), pos[r.opp]), f = dot(w, ab) / l2, t = [0, 1, 2].map((k) => w[k] - ab[k] * f), lt = Math.hypot(...t); if (lt > 1e-12) for (let k = 0; k < 3; k++) acc[k] += t[k] / lt; }
    const l = Math.hypot(...acc); return l > 1e-9 ? acc.map((x) => x / l) : null; });
  const outDirRaw = outDir.slice(); for (let pass = 0; pass < 2; pass++) outDir.splice(0, N0, ...outDir.map((d, i) => { if (!d) return null; const a = [0, 0, 0]; for (const [k, wt] of [[-1, 1], [0, 2], [1, 1]]) { const q = outDir[(i + k + N0) % N0]; if (q) for (let c = 0; c < 3; c++) a[c] += q[c] * wt; } const l = Math.hypot(...a); return l > 1e-9 ? a.map((x) => x / l) : d; }));
  // ---- 6. rings at even angles: ring 1 just inside the outer boundary, the last ring on the tube wall ----
  const th0 = T[0], A = (j) => th0 + (TAU * j) / M, near = (t) => ((Math.round((((wrap(t - th0) + TAU) % TAU) / TAU) * M) % M) + M) % M;
  const colOut = outer.map((o) => (o.g !== undefined ? (cap[o.g] && hairColour ? hairColour : colourOf(...pos[o.g])) : hairColour ?? colourOf(...o.p)));
  const binR = new Float64Array(M).fill(Infinity), binY = new Float64Array(M).fill(NaN), binC = Array.from({ length: M }, () => null), binI = new Int32Array(M).fill(-1);
  for (let i = 0; i < N0; i++) { const j = near(T[i]); if (R[i] < binR[j]) { binR[j] = R[i]; binY[j] = Y[i]; binC[j] = colOut[i]; binI[j] = i; } }
  for (let pass = 0; pass < M && binR.some((r) => r === Infinity); pass++) for (let j = 0; j < M; j++) if (binR[j] === Infinity) { const k = binR[(j + M - 1) % M] !== Infinity ? (j + M - 1) % M : binR[(j + 1) % M] !== Infinity ? (j + 1) % M : -1; if (k >= 0) { binR[j] = binR[k]; binY[j] = binY[k]; binC[j] = binC[k]; binI[j] = binI[k]; } }
  const win = (arr, j, f) => { let m = f === "min" ? Infinity : 0; for (let d = -2; d <= 2; d++) { const v = arr[(j + d + M) % M]; m = f === "min" ? Math.min(m, v) : m + v / 5; } return m; };
  // (map-driven: at a closed angle every ring lies on the tube wall — the band collapses to nothing there — and it TAPERS to that over
  //  eight ring steps, so it never jumps from nothing to full width between neighbouring angles)
  const closedM = Array.from({ length: M }, (_, j) => !!outer[binI[j]]?.closed), dC = closedM.map((_, j) => { if (!mapped) return Infinity; for (let d = 0; d <= M / 2; d++) if (closedM[(j + d) % M] || closedM[(j - d + M * 4) % M]) return d; return Infinity; });
  const ramp = (j) => { const t = Math.min(1, dC[j] / 8); return t * t * (3 - 2 * t); };
  const wall = Array.from({ length: M }, (_, j) => neck.wall(A(j))), r1 = Array.from({ length: M }, (_, j) => (closedM[j] ? wall[j] : wall[j] + (Math.max(wall[j] + 0.5 * e, win(binR, j, "min") - e) - wall[j]) * (mapped ? ramp(j) : 1))), y1 = Array.from({ length: M }, (_, j) => win(binY, j, "mean"));
  const K = Math.max(2, Math.ceil(Math.max(...r1.map((r, j) => r - wall[j])) / e) + 1), xz = (k, j) => { const r = r1[j] + ((wall[j] - r1[j]) * (k - 1)) / (K - 1); return [neck.cx + Math.cos(A(j)) * r, neck.cz + Math.sin(A(j)) * r]; };
  const S = Array.from({ length: K + 1 }, (_, k) => (k ? Array.from({ length: M }, (_, j) => sheet(...xz(k, j))) : null)), missing = S.slice(1).flat().filter(Number.isNaN).length;
  if (missing) return fail("the canonical underside is missing under the patch", { points: missing });
  // harmonic height correction φ = y − sheet, Dirichlet at ring 1 (the rim's height) and ring K (the wall: the sheet clamped into the tube)
  // where the skin itself enters the tube (a tucked bin), the surface's inner ring meets the tube at the skin's own exit height — the
  // band there collapses to nothing (smoothed ±2 bins into its neighbours); elsewhere the canonical sheet, clamped into the tube
  const yJoin0 = S[K].map((s, j) => Math.min(neck.y1 - e, Math.max(neck.y0 + e, outer[binI[j]]?.tucked ? binY[j] : s))), yJoin = yJoin0.map((_, j) => { if (!mapped || ramp(j) >= 1) return win(yJoin0, j, "mean"); let a = 0; for (let d = -8; d <= 8; d++) a += yJoin0[(j + d + M * 4) % M]; return a / 17; }), phi = Array.from({ length: K + 1 }, () => new Float64Array(M));
  for (let j = 0; j < M; j++) { phi[1][j] = (mapped ? yJoin[j] + (y1[j] - yJoin[j]) * ramp(j) : y1[j]) - S[1][j]; phi[K][j] = yJoin[j] - S[K][j]; for (let k = 2; k < K; k++) phi[k][j] = phi[1][j] + ((phi[K][j] - phi[1][j]) * (k - 1)) / (K - 1); }
  if (mapped) for (let j = 0; j < M; j++) if (closedM[j]) for (let k = 1; k <= K; k++) phi[k][j] = yJoin[j] - S[k][j];   // a closed angle is held at the neck during the solve
  for (let it = 0; it < 4 * K * K + 200; it++) for (let k = 2; k < K; k++) { const nx = new Float64Array(M); for (let j = 0; j < M; j++) nx[j] = mapped && closedM[j] ? phi[k][j] : (phi[k][(j + M - 1) % M] + phi[k][(j + 1) % M] + phi[k - 1][j] + phi[k + 1][j]) / 4; phi[k].set(nx); }
  if (mapped) for (let j = 0; j < M; j++) if (closedM[j]) for (let k = 1; k <= K; k++) phi[k][j] = yJoin[j] - S[k][j];   // a closed angle: every ring one point on the wall
  const RP = Array.from({ length: K + 1 }, (_, k) => (k ? Array.from({ length: M }, (_, j) => { const [x, z] = xz(k, j); return [x, S[k][j] + phi[k][j], z]; }) : null));
  // ---- 7. the surface. Any triangle made of consecutive points of ONE curve lies in that curve's own bending plane, not in the surface
  // (ear-clipping the rim bridged its notches with such triangles standing on end: every fold-back / fin at the weld). So the turn from
  // the skin into the field is built from quads, and only the near-flat field is ear-clipped:
  //   envelope — the rim's vertices that advance round the neck; a stretch running BACKWARD (a little hook of skin) is welded by a fill
  //        of its own, flat in the hook's own plane;
  //   C1 — one short straight step from each envelope vertex along the skin's OWN outgoing direction (given at least a little inward
  //        lean): rim ↔ C1 quads continue every skin triangle at the weld (tangent-continuous);
  //   C2 — half way along a cubic from C1 (tangent to the skin) to ring kb of the field (tangent to it), at the vertex's own angle;
  //   C1 ↔ C2 quads; C2 ↔ ring kb an annulus seen from below, ear-clipped; rings kb..K quads.
  const kb = Math.max(2, Math.min(bendRings, K - 1)), rOf = (q) => Math.hypot(q[0] - neck.cx, q[2] - neck.cz), MIN_IN = 0.17;   // sin 10°
  const fieldAt = (k, t) => { const jf = (((wrap(t - th0) + TAU) % TAU) / TAU) * M, j0 = Math.floor(jf) % M, j1 = (j0 + 1) % M, f = jf - Math.floor(jf); return [0, 1, 2].map((c) => RP[k][j0][c] * (1 - f) + RP[k][j1][c] * f); };
  const atAngle = (q, t) => { const r = rOf(q); return [neck.cx + Math.cos(t) * r, q[1], neck.cz + Math.sin(t) * r]; }, atRadius = (q, r) => { const r0 = rOf(q); return r0 > 1e-12 ? [neck.cx + ((q[0] - neck.cx) * r) / r0, q[1], neck.cz + ((q[2] - neck.cz) * r) / r0] : q; };
  const Tu = [T[0]]; for (let i = 1; i < N0; i++) Tu.push(Tu[i - 1] + wrap(T[i] - T[i - 1]));
  const keep = new Uint8Array(N0); { let mx = -Infinity; for (let lap = 0; lap < 2; lap++) for (let i = 0; i < N0; i++) { const t = Tu[i] + lap * TAU; if (t > mx + 1e-9) { mx = t; if (lap) keep[i] = 1; } } }
  const KL = []; for (let i = 0; i < N0; i++) if (keep[i]) KL.push(i); let NK = KL.length; if (NK < 3) return fail("the rim does not advance round the neck");
  const kOf = new Int32Array(N0); { let last = KL[NK - 1]; for (let i = 0; i < N0; i++) { if (keep[i]) last = i; kOf[i] = KL.indexOf(last); } }
  // a hook is a NOTCH (the opening reaching out past the envelope: filled) or a TAB (skin reaching in past it: skin already — left as it
  // is, its few edges unwelded and counted), told apart by the hook's turning sense seen from below against the envelope's
  const hooks = [], planA = (idx) => { let a2 = 0; for (let k = 0; k < idx.length; k++) { const p = OP(outer[idx[k]]), q = OP(outer[idx[(k + 1) % idx.length]]); a2 += (p[0] - neck.cx) * (q[2] - neck.cz) - (q[0] - neck.cx) * (p[2] - neck.cz); } return a2; };
  const envSense = Math.sign(planA(KL)); let tabVerts = 0;
  for (let k = 0; k < NK; k++) { const a = KL[k], b = KL[(k + 1) % NK], run = []; for (let i = (a + 1) % N0; i !== b; i = (i + 1) % N0) run.push(i); if (!run.length) continue; const poly = [a, ...run, b];
    if (Math.sign(planA(poly)) === envSense) hooks.push(poly); else tabVerts += run.length; }
  // a SAWTOOTH (the rim zigzagging between two rows: turns sharper than a right angle, seen from below) — the envelope runs through
  // the tips nearest the neck: a notch tip (the opening reaching out past its neighbours) leaves it and its gap is filled flat,
  // repeatedly; a tab tip (skin reaching in) is skin and stays on the envelope
  let notchTips = 0; { const alive = new Uint8Array(NK).fill(1), prv = Array.from({ length: NK }, (_, k) => (k + NK - 1) % NK), nxt = Array.from({ length: NK }, (_, k) => (k + 1) % NK); let left = NK, changed = true;
    while (changed && left > 3) { changed = false; for (let k = 0; k < NK; k++) { if (!alive[k] || left <= 3) continue; const a = OP(outer[KL[prv[k]]]), v = OP(outer[KL[k]]), b = OP(outer[KL[nxt[k]]]), e1 = [v[0] - a[0], v[2] - a[2]], e2 = [b[0] - v[0], b[2] - v[2]];
      if (e1[0] * e2[0] + e1[1] * e2[1] >= 0) continue; const cr = (b[0] - a[0]) * (v[2] - a[2]) - (b[2] - a[2]) * (v[0] - a[0]); if (Math.sign(cr) !== -envSense) continue;
      if (outer[KL[prv[k]]].g !== undefined && outer[KL[nxt[k]]].g !== undefined && bridgeCrosses(outer[KL[prv[k]]].g, outer[KL[nxt[k]]].g)) continue;   // its shortcut would cut through skin: it stays
      hooks.push([KL[prv[k]], KL[k], KL[nxt[k]]]); alive[k] = 0; nxt[prv[k]] = nxt[k]; prv[nxt[k]] = prv[k]; left--; notchTips++; changed = true; } }
    if (left < NK) { const kl2 = KL.filter((_, k) => alive[k]); KL.length = 0; KL.push(...kl2); NK = KL.length; for (let i = 0, last = KL[NK - 1]; i < N0; i++) { if (KL.includes(i)) last = i; kOf[i] = KL.indexOf(last); } } }
  // the step follows the skin's FULL outgoing direction (sideways part included: across a steep stretch of rim the skin's continuation
  // runs sideways — a step straight down there would run along the rim and collapse the strip); only where that would reorder the
  // collar against its neighbours round the neck is the sideways part halved, as often as it takes
  // the outgoing direction of each ENVELOPE edge: a real rim edge — across it, in its own skin triangle's plane, away from the skin; a
  // shortcut (over a hook / notch) or a free edge — level and across it, toward the neck. Each envelope vertex steps along the mean of its
  // two edges' directions: across the envelope by construction
  const edgeOut = KL.map((i, k) => { const j = KL[(k + 1) % NK], a2 = OP(outer[i]), b2 = OP(outer[j]), ab = sub3(b2, a2), l2 = dot(ab, ab); if (l2 < 1e-18) return null;
    const r = (j === (i + 1) % N0 && outer[i].g !== undefined && outer[j].g !== undefined) ? edges.get(outer[i].g < outer[j].g ? outer[i].g * 8388608 + outer[j].g : outer[j].g * 8388608 + outer[i].g) : null;
    if (r && r.n === 1 && r.skin && r.opp !== undefined) { const w = sub3(a2.map((x, c) => (x + b2[c]) / 2), pos[r.opp]), f = dot(w, ab) / l2, t = w.map((x, c) => x - ab[c] * f), lt = Math.hypot(...t); if (lt > 1e-12) return t.map((x) => x / lt); }
    const h = [ab[2], 0, -ab[0]], lh = Math.hypot(...h), m = a2.map((x, c) => (x + b2[c]) / 2), toAxis = [neck.cx - m[0], 0, neck.cz - m[2]]; if (lh < 1e-12) return null; return h.map((x) => (x / lh) * Math.sign(dot(h, toAxis) || 1)); });
  const envOut = KL.map((_, k) => { const p1 = edgeOut[(k + NK - 1) % NK], p2 = edgeOut[k], acc = [0, 0, 0]; for (const q of [p1, p2]) if (q) for (let c = 0; c < 3; c++) acc[c] += q[c]; const l = Math.hypot(...acc); return l > 1e-9 ? acc.map((x) => x / l) : null; });
  const lean = (d, u) => { const inward = -dot(d, u); if (inward >= MIN_IN) return d; const d2 = d.map((x, c) => x - u[c] * (MIN_IN - inward)), l = Math.hypot(...d2); return d2.map((x) => x / l); };
  const stepAt = (k, f) => { const i = KL[k], u = [Math.cos(T[i]), 0, Math.sin(T[i])], tg = [-u[2], 0, u[0]]; let d = envOut[k] ? envOut[k].slice() : [-u[0], 0, -u[2]];
    if (f < 1) { const dt = dot(d, tg), r2 = d.map((x, c) => x - tg[c] * dt * (1 - f)), l2 = Math.hypot(...r2); d = l2 > 0.2 ? r2.map((x) => x / l2) : [-u[0], 0, -u[2]]; } return lean(d, u); };
  const side = new Float64Array(NK).fill(1), dir = KL.map((_, k) => stepAt(k, 1)), c1At = (k) => { const i = KL[k], Q = OP(outer[i]); if (outer[i].closed) return Q.slice(); const q = Q.map((x, c) => x + dir[k][c] * 0.5 * e); return rOf(q) < R[i] - 0.02 * e ? q : atRadius(q, R[i] - 0.02 * e); };
  let C1 = KL.map((_, k) => c1At(k)); const angU = (k) => { const q = C1[k], t = Math.atan2(q[2] - neck.cz, q[0] - neck.cx); return Tu[KL[k]] + wrap(t - T[KL[k]]); };
  for (let pass = 0; pass < 8 * NK; pass++) { let bad = -1; for (let k = 1; k < NK && bad < 0; k++) if (angU(k) <= angU(k - 1) + 1e-9) bad = k; if (bad < 0) break;
    let moved = false; for (const k of [bad - 1, bad]) if (side[k] > 0) { side[k] = side[k] < 0.07 ? 0 : side[k] / 2; dir[k] = stepAt(k, side[k]); C1[k] = c1At(k); moved = true; } if (!moved) break; }
  const tC1 = KL.map((_, k) => angU(k));
  const C2 = KL.map((i, k) => { if (outer[i].closed) return C1[k].slice(); const Q = C1[k], tq = tC1[k], P3 = fieldAt(kb, tq), P4 = fieldAt(Math.min(K, kb + 1), tq), d3v = sub3(P4, P3), l3 = Math.hypot(...d3v) || 1, L = Math.hypot(...sub3(P3, Q));
    const P1 = Q.map((x, c) => x + (dir[k][c] * L) / 3), P2 = P3.map((x, c) => x - (d3v[c] / l3) * (L / 3)), B = atAngle([0, 1, 2].map((c) => 0.125 * Q[c] + 0.375 * P1[c] + 0.375 * P2[c] + 0.125 * P3[c]), tq);
    return atRadius(B, Math.max(rOf(P3) + 0.25 * e, Math.min(rOf(Q) - 0.05 * e, rOf(B)))); });   // inside C1, outside ring kb
  const P = [], C = [], NN = []; outer.forEach((o, i) => { P.push(...OP(o)); C.push(...colOut[i]); NN.push(o.g !== undefined ? nrm[o.g] : null); });
  // tone: the rim's own colours, smoothed along the rim — ±3 bins at the weld, widening to ±M/12 (≈ 30°) four rings in; never a global
  // median (a single tone for the whole head drifted away from the local skin and drew a line along the rim)
  const smoothAt = (half) => { const out = []; for (let j = 0; j < M; j++) { const a = [0, 0, 0]; for (let d = -half; d <= half; d++) { const c = binC[(j + d + M * 8) % M]; for (let q = 0; q < 3; q++) a[q] += c[q]; } out.push(a.map((x) => x / (2 * half + 1))); } return out; };
  const smoothC = smoothAt(3), smoothW = smoothAt(Math.max(3, Math.round(M / 12))), collarStart = (c) => N0 + (c - 1) * NK, ringStart = (k) => N0 + 2 * NK + (k - kb) * M;
  C1.forEach((q, k) => { P.push(...q); C.push(...colOut[KL[k]]); NN.push(null); });
  C2.forEach((q, k) => { P.push(...q); const j = near(tC1[k]); C.push(...[0, 1, 2].map((c) => (colOut[KL[k]][c] + smoothC[j][c]) / 2)); NN.push(null); });
  for (let k = kb; k <= K; k++) for (let j = 0; j < M; j++) { P.push(...RP[k][j]); const f = Math.min(1, (k - 1) / 4); C.push(...[0, 1, 2].map((q) => smoothC[j][q] * (1 - f) + smoothW[j][q] * f)); NN.push(null); }
  // (map-driven: a vertex of the collapse or its taper — a closed point, its collar, or a ring at an angle within the taper's eight bins)
  const collapsedV = (v) => (v < N0 ? !!outer[v].closed : v < ringStart(kb) ? !!outer[KL[(v - N0) % NK]]?.closed : dC[(v - ringStart(kb)) % M] < 8);
  // (…and a triangle whose every vertex lies ON the collapse — a closed point, its collar, a ring at a closed angle — is a strip of the
  // collapse itself: the closed point keeps the skin's own exit height and the rings a smoothed one, so the strip is a hair-thin sliver
  // lying on the tube wall, inside the neck; it emits nothing)
  const onCollapse = (v) => (v < N0 ? !!outer[v].closed : v < ringStart(kb) ? !!outer[KL[(v - N0) % NK]]?.closed : dC[(v - ringStart(kb)) % M] === 0);
  const I = [], tri = (a, b, c) => { const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], u = [P[b * 3] - pa[0], P[b * 3 + 1] - pa[1], P[b * 3 + 2] - pa[2]], w = [P[c * 3] - pa[0], P[c * 3 + 1] - pa[1], P[c * 3 + 2] - pa[2]];
    const ar2 = Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]);
    if (ar2 <= 1e-12 || (mapped && ar2 < 0.02 * e * e && [a, b, c].some(collapsedV)) || (mapped && [a, b, c].every(onCollapse))) return; I.push(a, b, c); };   // collapsed strips emit nothing (map-driven: nor the slivers of the collapse, under 1 % of a ring step's square)
  // a quad a b (outer, advancing) / c d (inner) splits along its flatter diagonal
  const pt = (v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], nOf = (a, b, c) => { const n = cross(sub3(pt(b), pt(a)), sub3(pt(c), pt(a))), l = Math.hypot(...n); return l > 1e-14 ? n.map((x) => x / l) : null; };
  const quad = (a, b, c, d) => { const n1 = nOf(a, b, d), n2 = nOf(a, d, c), m1 = nOf(a, b, c), m2 = nOf(b, d, c), f1 = n1 && n2 ? dot(n1, n2) : -2, f2 = m1 && m2 ? dot(m1, m2) : -2;
    if (f2 > f1 + 1e-9) { tri(a, b, c); tri(b, d, c); } else { tri(a, b, d); tri(a, d, c); } };
  for (let k = 0; k < NK; k++) { const k2 = (k + 1) % NK, a = KL[k], b = KL[k2], c1 = collarStart(1), c2 = collarStart(2); quad(a, b, c1 + k, c1 + k2); quad(c1 + k, c1 + k2, c2 + k, c2 + k2); }   // rim ↔ C1 ↔ C2
  for (let k = kb; k < K; k++) for (let j = 0; j < M; j++) quad(ringStart(k) + j, ringStart(k) + ((j + 1) % M), ringStart(k + 1) + j, ringStart(k + 1) + ((j + 1) % M));
  const nQuads = I.length;
  // C2 ↔ ring kb: both advance round the neck, so they are ZIPPED by angle — every triangle takes points of both (a triangle of one
  // curve alone would lie in that curve's bending plane)
  { const tC = tC1, tR = (j) => th0 + (TAU * j) / M; let p2 = 0, q2 = 0;
    const nextC = () => (p2 + 1 < NK ? tC[p2 + 1] : tC[0] + TAU), nextR = () => (q2 + 1 < M ? tR(q2 + 1) : tR(0) + TAU);
    for (let n = 0; n < NK + M; n++) { const advC = q2 >= M || (p2 < NK && nextC() <= nextR()); if (p2 >= NK && q2 >= M) break;
      if (advC) { tri(collarStart(2) + (p2 % NK), collarStart(2) + ((p2 + 1) % NK), ringStart(kb) + (q2 % M)); p2++; } else { tri(collarStart(2) + (p2 % NK), ringStart(kb) + ((q2 + 1) % M), ringStart(kb) + (q2 % M)); q2++; } } }
  // the hooks: each filled flat in its own plane (Newell normal), ear-clipped there
  const hookFrom = I.length; let hookFails = 0; for (const poly of hooks) { const n = [0, 0, 0]; for (let k = 0; k < poly.length; k++) { const p = OP(outer[poly[k]]), q = OP(outer[poly[(k + 1) % poly.length]]); n[0] += (p[1] - q[1]) * (p[2] + q[2]); n[1] += (p[2] - q[2]) * (p[0] + q[0]); n[2] += (p[0] - q[0]) * (p[1] + q[1]); }
    const ln = Math.hypot(...n); if (ln < 1e-14) { hookFails++; continue; } const nz = n.map((x) => x / ln), ax = Math.abs(nz[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], u0 = cross(nz, ax), lu = Math.hypot(...u0), u = u0.map((x) => x / lu), v = cross(nz, u);
    const faces = ShapeUtils.triangulateShape(poly.map((i) => { const p = OP(outer[i]); return new Vector2(dot(p, u), dot(p, v)); }), []); if (faces.length !== poly.length - 2) hookFails++;
    for (const [a2, b2, c2] of faces) tri(poly[a2], poly[b2], poly[c2]); }
  // a fill that DOUBLES the skin (nearly coplanar with the skin triangle across one of its rim edges, on the skin's side) is skin, not
  // opening, and a fill turning back over the skin (its far corner on the skin's side of the rim edge: ≥ 90° to the skin) would fold:
  // either is dropped, never forced — those few rim edges stay unwelded and are counted
  let doubled = 0; { const keepT = []; for (let t = hookFrom; t < I.length; t += 3) { const v3 = [I[t], I[t + 1], I[t + 2]]; let bad = false;
      for (let q = 0; q < 3 && !bad; q++) { const a = v3[q], b = v3[(q + 1) % 3], c = v3[(q + 2) % 3]; if (a >= N0 || b >= N0 || outer[a].g === undefined || outer[b].g === undefined) continue;
        const r = edges.get(outer[a].g < outer[b].g ? outer[a].g * 8388608 + outer[b].g : outer[b].g * 8388608 + outer[a].g); if (!r || r.n !== 1 || !r.skin || r.opp === undefined) continue;
        // the fill oriented as the skin's continuation (it runs the shared edge opposite to the skin triangle): ≥ 90° to the skin → dropped
        const nS = cross(sub3(pos[r.to], pos[r.from]), sub3(pos[r.opp], pos[r.from])), nF = cross(sub3(pos[r.from], pos[r.to]), sub3(pt(c), pos[r.to])), l = Math.hypot(...nS) * Math.hypot(...nF);
        if (l < 1e-24 || dot(nS, nF) / l <= 0) bad = true; }
      if (bad) doubled++; else keepT.push(...v3); }
    I.length = hookFrom; I.push(...keepT); }
  // orientation: the quads are consistent by construction; every ear-clipped / hook face takes it from its neighbours across shared
  // edges (never from its area seen from below, which vanishes on a face standing on end)
  { const byEdge = new Map(), ek = (a, b) => (a < b ? a * 8388608 + b : b * 8388608 + a); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { const k2 = ek(I[t + q], I[t + (q + 1) % 3]); (byEdge.get(k2) ?? byEdge.set(k2, []).get(k2)).push(t); }
    const fixed = new Uint8Array(I.length / 3), queue = []; for (let t = 0; t < nQuads; t += 3) { fixed[t / 3] = 1; queue.push(t); }
    while (queue.length) { const t = queue.pop(); for (let q = 0; q < 3; q++) { const a = I[t + q], b = I[t + (q + 1) % 3]; for (const w of byEdge.get(ek(a, b))) { if (fixed[w / 3]) continue;
      let same = false; for (let p2 = 0; p2 < 3; p2++) if (I[w + p2] === a && I[w + (p2 + 1) % 3] === b) same = true; if (same) { const s2 = I[w + 1]; I[w + 1] = I[w + 2]; I[w + 2] = s2; } fixed[w / 3] = 1; queue.push(w); } } } }
  // orientation: across the rim the patch runs each welded edge opposite to the skin triangle that owns it
  { const wset = new Map(); outer.forEach((o, i) => { if (o.g !== undefined) wset.set(o.g, i); }); let same = 0, opp = 0;
    for (const r of edges.values()) { if (r.n !== 1 || !r.skin || !wset.has(r.from) || !wset.has(r.to)) continue; const a = wset.get(r.from), b = wset.get(r.to);
      for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { if (I[t + q] === a && I[t + (q + 1) % 3] === b) same++; else if (I[t + q] === b && I[t + (q + 1) % 3] === a) opp++; } if (same + opp > 8) break; }
    if (same > opp) for (let t = 0; t < I.length; t += 3) { const s2 = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s2; } }
  // UNTANGLE: wherever a fin or an upturned face is left (a local knot where the rim is irregular — a step, a junction), the collar
  // vertices round it relax half way to the mean of their neighbours, a few rounds; the rim (the weld) and the field never move
  let untangled = 0; { const nb = new Map(), add = (a, b) => (nb.get(a) ?? nb.set(a, new Set()).get(a)).add(b); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) { add(I[t + q], I[t + (q + 1) % 3]); add(I[t + (q + 1) % 3], I[t + q]); }
    const movable = (v) => v >= N0 && v < collarStart(2) + NK, nP = (t) => { const a = pt(I[t]), n = cross(sub3(pt(I[t + 1]), a), sub3(pt(I[t + 2]), a)), l = Math.hypot(...n); return l > 1e-14 ? n.map((x) => x / l) : null; };
    for (let round = 0; round < 12; round++) { const he = new Map(), bad = new Set(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) he.set(I[t + q] * 8388608 + I[t + (q + 1) % 3], t);
      for (let t = 0; t < I.length; t += 3) { const n = nP(t); if (n && n[1] > 0.5) for (let q = 0; q < 3; q++) bad.add(I[t + q]); }
      for (const [k2, t1] of he) { const a = Math.floor(k2 / 8388608), b = k2 % 8388608; if (a > b) continue; const t2 = he.get(b * 8388608 + a); if (t2 === undefined) continue; const n1 = nP(t1), n2 = nP(t2); if (n1 && n2 && dot(n1, n2) < -0.5) for (const t of [t1, t2]) for (let q = 0; q < 3; q++) bad.add(I[t + q]); }
      const core = [...bad].filter(movable); if (!core.length) break; const set = new Set(core); for (const v of core) for (const w of nb.get(v)) if (movable(w)) set.add(w);
      const moved = [...set].sort((x, y) => x - y).map((v) => { const ns = [...nb.get(v)], m = [0, 0, 0]; for (const w of ns) for (let c = 0; c < 3; c++) m[c] += P[w * 3 + c] / ns.length; return [v, m]; });
      for (const [v, m] of moved) for (let c = 0; c < 3; c++) P[v * 3 + c] = (P[v * 3 + c] + m[c]) / 2; untangled += moved.length; }
    for (let k = 0; k < NK; k++) { C1[k] = pt(collarStart(1) + k); C2[k] = pt(collarStart(2) + k); } }
  // the crossing test — exact, triangle against triangle, against every other surface but the weld's own neighbours
  const cell = 4 * e, cellKey = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`, PT = (Q, v) => [Q[v * 3], Q[v * 3 + 1], Q[v * 3 + 2]];
  const boxCells = (vs, f) => { const lo = [0, 1, 2].map((k) => Math.floor(Math.min(...vs.map((v) => v[k])) / cell)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(...vs.map((v) => v[k])) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) f(`${x},${y},${z}`); };
  const segHits = (p0, p1, [A0, B0, C0]) => { const d = sub3(p1, p0), e1 = sub3(B0, A0), e2 = sub3(C0, A0), h = cross(d, e2), det = dot(e1, h); if (Math.abs(det) < 1e-18) return false;   // Möller–Trumbore, open segment
    const f = 1 / det, s0 = sub3(p0, A0), u = f * dot(s0, h); if (u <= 1e-9 || u >= 1 - 1e-9) return false; const q = cross(s0, e1), v = f * dot(d, q); if (v <= 1e-9 || u + v >= 1 - 1e-9) return false; const t = f * dot(e2, q); return t > 1e-9 && t < 1 - 1e-9; };
  const triHits = (A2, B2) => [[0, 1], [1, 2], [2, 0]].some(([i, j]) => segHits(A2[i], A2[j], B2) || segHits(B2[i], B2[j], A2));
  const rimSet = new Set(outer.filter((o) => o.g !== undefined).map((o) => o.g));
  const crossTest = (Q) => { const grid = new Map(); for (let t = 0; t < I.length; t += 3) boxCells([PT(Q, I[t]), PT(Q, I[t + 1]), PT(Q, I[t + 2])], (k) => (grid.get(k) ?? grid.set(k, []).get(k)).push(t));
    let crossings = 0; const crossedBy = {}, crossAt = [], hit = new Set();
    for (const p of parts) { if (!OBSTACLE.test(p.name)) continue; for (let t = 0; t < p.I.length; t += 3) { const g = [0, 1, 2].map((q) => p.I[t + q]), V = g.map((v) => PT(p.P, v));
      const cand = new Set(); boxCells(V, (k) => { for (const u of grid.get(k) ?? []) cand.add(u); }); if (!cand.size) continue;
      if (SURFACE.test(p.name) && g.some((v) => rimSet.has(key.get(qk(p.P, v))))) continue;   // the weld's own neighbours touch it by design
      for (const u of cand) if (triHits(V, [PT(Q, I[u]), PT(Q, I[u + 1]), PT(Q, I[u + 2])])) { crossings++; crossedBy[p.name] = (crossedBy[p.name] ?? 0) + 1; hit.add(u); if (opt.debugFins && crossAt.length < 2) { const lab = (v) => (v < N0 ? `o${v}${outer[v].g !== undefined ? (cap[outer[v].g] ? "cap" : "skin") : "free"}` : v < collarStart(2) ? `c1_${v - N0}` : v < ringStart(kb) ? `c2_${v - collarStart(2)}` : "r"); console.log("CROSS", [0, 1, 2].map((q) => `${lab(I[u + q])}(${PT(Q, I[u + q]).map((x) => x.toFixed(4)).join(",")})`).join(" "), "x skin", V.map((q) => q.map((x) => x.toFixed(4)).join(",")).join(" | "), "keep", [0, 1, 2].map((q) => (I[u + q] < N0 ? keep[I[u + q]] : "-")).join("")); }
        if (crossAt.length < 4) { const c = [0, 1, 2].map((k) => (V[0][k] + V[1][k] + V[2][k]) / 3), m = Math.max(I[u], I[u + 1], I[u + 2]); crossAt.push(`${p.name.replace("identity_", "")}@${Math.round((Math.atan2(c[2] - neck.cz, c[0] - neck.cx) * 180) / Math.PI)}°y${c[1].toFixed(3)} by ${m < N0 ? "fill" : m < collarStart(2) ? "rim-C1" : m < ringStart(kb) ? "C1-C2" : Math.min(I[u], I[u + 1], I[u + 2]) >= ringStart(kb) ? "rings" : "C2-ring"}`); } break; } } }
    return { crossings, crossedBy, crossAt, hit }; };
  // BACK-OFF: where only the collar crosses another surface (it steps through skin that curls close behind the rim — a junction, a lip),
  // the collar vertices there pull half way back toward their own rim vertex, at most three rounds; anything else is left to validation
  let backedOff = 0; for (let round = 0; round < 3; round++) { const r0 = crossTest(P); if (!r0.crossings) break; const inCollar = (v) => v >= N0 && v < collarStart(2) + NK;
    if ([...r0.hit].some((t) => ![0, 1, 2].some((q) => inCollar(I[t + q])))) break;
    const vs = new Set(); for (const t of r0.hit) for (let q = 0; q < 3; q++) if (inCollar(I[t + q])) vs.add(I[t + q]);
    for (const v of [...vs].sort((x, y) => x - y)) { const k = v < collarStart(2) ? v - collarStart(1) : v - collarStart(2), toward = v < collarStart(2) ? KL[k] : collarStart(1) + k; for (let c = 0; c < 3; c++) P[v * 3 + c] = (P[v * 3 + c] + P[toward * 3 + c]) / 2; backedOff++; } }
  for (let k = 0; k < NK; k++) { C1[k] = pt(collarStart(1) + k); C2[k] = pt(collarStart(2) + k); }
  // ---- 8. validation: faces outward, no fold, crosses no other surface ----
  const Pf = Float32Array.from(P), fn = (t) => { const v = [0, 1, 2].map((q) => [Pf[I[t + q] * 3], Pf[I[t + q] * 3 + 1], Pf[I[t + q] * 3 + 2]]), a = v[1].map((x, q) => x - v[0][q]), b = v[2].map((x, q) => x - v[0][q]); return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; };
  let down = 0; for (let t = 0; t < I.length; t += 3) down += fn(t)[1] < 0 ? 1 : 0;
  if (down * 2 < I.length / 3) return fail("the surface would face into the head", { downFacing: down, tris: I.length / 3 });
  let folded = 0; const foldedAt = []; for (let t = 0; t < I.length; t += 3) { const n = fn(t), l = Math.hypot(...n); if (l < 1e-14 || n[1] / l > 0.5) { folded++;
    if (opt.debugFins && folded <= 2) { const lab = (v) => (v < N0 ? `o${v}${outer[v].closed ? "C" : outer[v].g !== undefined ? "w" : "f"}` : v < collarStart(2) ? `c1_${v - N0}` : v < ringStart(kb) ? `c2_${v - collarStart(2)}` : `r${kb + Math.floor((v - ringStart(kb)) / M)}_${(v - ringStart(kb)) % M}(dC${dC[(v - ringStart(kb)) % M]})`);
      console.log("UPTURNED", [0, 1, 2].map((q) => `${lab(I[t + q])}(${[0, 1, 2].map((k) => Pf[I[t + q] * 3 + k].toFixed(3)).join(",")})`).join(" "), "kb", kb, "K", K); }
    if (foldedAt.length < 6) { const c = [0, 1, 2].map((q) => (Pf[I[t] * 3 + q] + Pf[I[t + 1] * 3 + q] + Pf[I[t + 2] * 3 + q]) / 3); foldedAt.push({ zone: I.slice(t, t + 3).some((v) => v < N0) ? "zipper" : "rings", deg: +((Math.atan2(c[2] - neck.cz, c[0] - neck.cx) * 180) / Math.PI).toFixed(1), r: +Math.hypot(c[0] - neck.cx, c[2] - neck.cz).toFixed(3), y: +c[1].toFixed(3), ny: +(n[1] / l).toFixed(2) }); } } }
  const cxr = crossTest(Pf); const crossings = cxr.crossings, crossedBy = cxr.crossedBy, crossAt = cxr.crossAt;
  // the weld must never FOLD BACK over the skin (skin ↔ surface normals ≥ 90° apart on a welded edge) and the surface must not fold
  // into a FIN anywhere (two of its own triangles > 120° apart): either means a lip / fin that no texture can hide
  const triN = (t) => { const n = fn(t), l = Math.hypot(...n); return l > 1e-14 ? n.map((x) => x / l) : null; }, halfE = new Map(); for (let t = 0; t < I.length; t += 3) for (let q = 0; q < 3; q++) halfE.set(I[t + q] * 8388608 + I[t + (q + 1) % 3], t);
  const crease = [], foldBackAt = [];  for (let i = 0; i < N0; i++) { const o1 = outer[i], i2 = (i + 1) % N0, o2 = outer[i2]; if (o1.g === undefined || o2.g === undefined) continue;
    const r = edges.get(o1.g < o2.g ? o1.g * 8388608 + o2.g : o2.g * 8388608 + o1.g); if (!r || r.n !== 1 || !r.skin || r.opp === undefined) continue; const t = halfE.get(i * 8388608 + i2) ?? halfE.get(i2 * 8388608 + i); if (t === undefined) continue;
    const nS = cross(sub3(pos[r.to], pos[r.from]), sub3(pos[r.opp], pos[r.from])), lS = Math.hypot(...nS), nU = triN(t); if (lS < 1e-14 || !nU) continue;
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot(nS, nU) / lS))) * 180) / Math.PI; crease.push(ang); if (opt.debugFins && ang >= 90) console.log("FOLDBACK", `o${i}${cap[o1.g] ? "cap" : "skin"}→o${i2}${cap[o2.g] ? "cap" : "skin"} ${Math.round(ang)}° at ${((T[i] * 180) / Math.PI).toFixed(1)}° keep ${keep[i]}${keep[i2]} tri ${[0, 1, 2].map((q) => { const v = I[t + q]; return v < N0 ? "o" + v : v < collarStart(2) ? "c1_" + (v - N0) : v < ringStart(kb) ? "c2_" + (v - collarStart(2)) : "r"; }).join(",")}`); if (ang >= 90 && foldBackAt.length < 4) foldBackAt.push({ deg: +((T[i] * 180) / Math.PI).toFixed(1), y: +Y[i].toFixed(3), crease: Math.round(ang) }); }
  let fins = 0; const finsAt = []; for (const [k2, t1] of halfE) { const a = Math.floor(k2 / 8388608), b = k2 % 8388608; if (a > b) continue; const t2 = halfE.get(b * 8388608 + a); if (t2 === undefined) continue; const n1 = triN(t1), n2 = triN(t2); if (n1 && n2 && dot(n1, n2) < -0.5) { if (opt.debugFins) { const ar = (t) => Math.hypot(...fn(t)) / 2; console.log("FINAREA", ar(t1).toExponential(2), ar(t2).toExponential(2), "e²", (e * e).toExponential(2)); } fins++; if (finsAt.length < 6) { const band = (t) => { const m = Math.max(I[t], I[t + 1], I[t + 2]), lo = Math.min(I[t], I[t + 1], I[t + 2]); return m < N0 ? "hook" : m < collarStart(2) ? "rim-C1" : lo >= ringStart(kb) ? "rings" : m < ringStart(kb) ? "C1-C2" : "C2-ring"; }, c = [0, 1, 2].map((q) => (Pf[a * 3 + q] + Pf[b * 3 + q]) / 2); if (opt.debugFins && finsAt.length < 3) { const lab = (v) => (v < N0 ? `o${v}${outer[v].g !== undefined ? "w" : "f"}` : v < collarStart(2) ? `c1_${v - N0}` : v < ringStart(kb) ? `c2_${v - collarStart(2)}` : `r${kb + Math.floor((v - ringStart(kb)) / M)}_${(v - ringStart(kb)) % M}`);
    console.log("FIN", [t1, t2].map((t) => `${[0, 1, 2].map((q) => `${lab(I[t + q])}(${[0, 1, 2].map((k) => Pf[I[t + q] * 3 + k].toFixed(4)).join(",")})`).join(" ")} n(${triN(t).map((x) => x.toFixed(2)).join(",")})`).join("  ||  ")); }
  finsAt.push(`${band(t1)}/${band(t2)}@${Math.round((Math.atan2(c[2] - neck.cz, c[0] - neck.cx) * 180) / Math.PI)}°y${c[1].toFixed(3)}`); } } }
  const cs = crease.slice().sort((x, y) => x - y), cq = (f) => (cs.length ? Math.round(cs[Math.min(cs.length - 1, Math.floor(f * cs.length))]) : null), foldBacks = crease.filter((x) => x >= 90).length;
  const info = { welded: true, rims: owned.length, outerVerts: N0, weldedVerts: welded, freeVerts: N0 - welded, tuckedVerts: tucked, trimmedVerts: trimmed, weldedAngle: +(runs.filter((r) => r.owner >= 0).reduce((s, r) => s + r.n, 0) / Mo).toFixed(2), ringVerts: M, rings: K, tris: I.length / 3, foldRingSteps: +worst.toFixed(2), folded, foldedAt, crossings, crossedBy, crossAt, ringEdge: +e.toFixed(4), weldEdges: crease.length, crease: { median: cq(0.5), p90: cq(0.9), max: cq(1) }, foldBacks, foldBackAt, fins, finsAt, hooks: hooks.length, hookVerts: hooks.reduce((s3, h) => s3 + h.length - 2, 0), hookFails, tabVerts, doubled, notchTips, untangled, backedOff, selfTouching, sideEdges, tuckedOnSkin, mapped, closedPinch, openBins: openBin ? openBin.filter(Boolean).length : null, openRuns: openBin ? (() => { const r = []; let j0 = 0; while (j0 < Mo && openBin[j0] === openBin[(j0 + Mo - 1) % Mo]) j0++; for (let k = 0; k < Mo;) { const v = openBin[(j0 + k) % Mo]; let n = 0; while (k + n < Mo && openBin[(j0 + k + n) % Mo] === v) n++; r.push(`${v ? "O" : "c"}${n}@${Math.round(((j0 + k) % Mo) / 2 - 180)}°`); k += n; } return r.join(" "); })() : null, sideReduced: side.filter((x) => x < 1).length };
  if (crossings) return fail("the surface would cross another surface", info);
  if (folded) return fail("the surface would fold", info);
  if (foldBacks) return fail("the surface would fold back over the skin at the weld", info);
  if (fins) return fail("the surface would fold into a fin", info);
  // normals: the surface's own, except on the weld, which takes the skin's — and the first four rings turn from the skin's normal to
  // their own, so the lighting does not change across one narrow strip at the rim (no shading line along its staircase)
  const N = new Float32Array(Pf.length); for (let t = 0; t < I.length; t += 3) { const n = fn(t); for (let q = 0; q < 3; q++) for (let c = 0; c < 3; c++) N[I[t + q] * 3 + c] += n[c]; }
  for (let v = 0; v < Pf.length / 3; v++) { const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; for (let c = 0; c < 3; c++) N[v * 3 + c] /= l; }
  const binN = Array.from({ length: M }, () => [0, 0, 0]); outer.forEach((o, i) => { const n = NN[i] ?? [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], j = near(T[i]); for (let c = 0; c < 3; c++) binN[j][c] += n[c]; });
  const rimN = Array.from({ length: M }, (_, j) => { const a = [0, 0, 0]; for (let d = -2; d <= 2; d++) for (let c = 0; c < 3; c++) a[c] += binN[(j + d + M) % M][c]; const l = Math.hypot(...a); return l > 1e-9 ? a.map((x) => x / l) : null; });
  for (let v = 0; v < N0; v++) if (NN[v]) N.set(NN[v], v * 3);
  for (let c = 1; c <= 2; c++) for (let k = 0; k < NK; k++) { const i = KL[k], v = collarStart(c) + k, rn = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]], f = c / 5, m = [0, 1, 2].map((q) => rn[q] * (1 - f) + N[v * 3 + q] * f), l = Math.hypot(...m) || 1; for (let q = 0; q < 3; q++) N[v * 3 + q] = m[q] / l; }
  for (let k = kb; k <= Math.min(kb + 1, K); k++) for (let j = 0; j < M; j++) { const v = ringStart(k) + j, rn = rimN[j]; if (!rn) continue; const f = (k - kb + 3) / 5, m = [0, 1, 2].map((c) => rn[c] * (1 - f) + N[v * 3 + c] * f), l = Math.hypot(...m) || 1; for (let c = 0; c < 3; c++) N[v * 3 + c] = m[c] / l; }
  // strip coordinates for a texture: u = angle round the neck from the first rim vertex (0..1), depth = radial distance in from the rim
  const nvS = Pf.length / 3, su = new Float32Array(nvS), sd = new Float32Array(nvS); { let prev = 0; for (let i = 0; i < N0; i++) { let a = (wrap(T[i] - th0) + TAU) % TAU; if (i && a < prev - Math.PI) a += TAU; if (i === 0) a = 0; su[i] = a / TAU; prev = a; } }
  for (let k = 0; k < NK; k++) { const i = KL[k], v1 = collarStart(1) + k, v2 = collarStart(2) + k; su[v1] = su[v2] = su[i]; sd[v1] = Math.hypot(...sub3(C1[k], OP(outer[i]))); sd[v2] = sd[v1] + Math.hypot(...sub3(C2[k], C1[k])); }   // depth = distance along the surface from the rim
  for (let j = 0; j < M; j++) { const k = kOf[binI[j]]; let acc = sd[collarStart(2) + k] + Math.hypot(...sub3(RP[kb][j], C2[k])); for (let r = kb; r <= K; r++) { const v = ringStart(r) + j; if (r > kb) acc += Math.hypot(...sub3(RP[r][j], RP[r - 1][j])); su[v] = j / M; sd[v] = acc; } }
  const strip = { u: su, depth: sd, M, rim: Array.from({ length: M }, (_, j) => OP(outer[binI[j]]).slice()), inward: Array.from({ length: M }, (_, j) => C1[kOf[binI[j]]].slice()),
    hairBin: Array.from({ length: M }, () => false), maxDepth: Math.max(...sd), wallDepth: Array.from({ length: M }, (_, j) => sd[ringStart(K) + j]) };
  outer.forEach((o, i) => { if (o.g === undefined || cap[o.g]) strip.hairBin[near(T[i])] = true; });
  // LIT AS ONE SURFACE (opt.litNormals): beyond the first rings the surface's own normals face down, so under the runtime's lit material
  // the whole underside rendered ~30 % darker than the skin and the neck it joins (a shading band, not paint). Every vertex off the weld
  // now takes a normal turning smoothly (C1 in depth from the rim) from its column's rim normal to the neck wall's outward normal at the
  // inner ring; the rim row keeps its own normal (the skin's on the weld). Geometry, texture and weld are untouched.
  if (opt.litNormals) for (let v = 0; v < nvS; v++) { if (v < N0) continue; const j = Math.round(su[v] * M) % M, rn = rimN[j], wd = strip.wallDepth[j]; if (!rn || !(wd > 1e-9)) continue;
    const s = Math.max(0, Math.min(1, sd[v] / wd)), f = s * s * (3 - 2 * s), q = [Pf[v * 3] - neck.cx, 0, Pf[v * 3 + 2] - neck.cz], ql = Math.hypot(q[0], q[2]); if (ql < 1e-9) continue;
    const m = [0, 1, 2].map((c) => rn[c] * (1 - f) + (q[c] / ql) * f), l = Math.hypot(...m) || 1; for (let c = 0; c < 3; c++) N[v * 3 + c] = m[c] / l; }
  // skinning: the weld copies the rim's own joints / weights (a rim vertex riding a neck or hair chain carries the surface with it — the
  // weld holds in every pose); everything else is rigid on the head, like all closure
  const nv = Pf.length / 3, J = new Uint8Array(nv * 4), Wt = new Float32Array(nv * 4); let notRigid = 0;
  for (let v = 0; v < nv; v++) { const src = v < N0 && outer[v].g !== undefined ? jw[outer[v].g] : null; if (src) { J.set(src[0], v * 4); Wt.set(src[1], v * 4); let h = 0; for (let k = 0; k < 4; k++) if (src[0][k] === headJoint) h += src[1][k]; if (h < 0.999) notRigid++; } else { J[v * 4] = headJoint; Wt[v * 4] = 1; } }
  info.weldNotRigid = notRigid; info.weldedToCap = outer.filter((o) => o.g !== undefined && cap[o.g]).length;
  return { part: { name: "baked_underside", P: Pf, N, I, COLOR: C, J, W: Wt, material: { name: "baked_underside", roughness: 0.9 } }, info, strip };
}

/** REPORT-ONLY, on a SHIPPED head (parts: [{ name, P, I }], e.g. visibility.identityParts): the welded underside's crease against the
 *  skin across the weld (rim edges shared by position — compression moves points by < 0.2 mm-eq) and its own fins. A fold back
 *  (≥ 90° to the skin) or a fin (two of its triangles > 120° apart) is a lip / pleat no texture hides.
 *  → { weldEdges, foldBacks, crease: { median, p90, max } | null, fins } */
export function weldFoldBacks(parts, { tol = 2e-4 } = {}) {
  const und = parts.find((p) => p.name === "baked_underside"); if (!und) return { weldEdges: 0, foldBacks: 0, crease: null, fins: 0 };
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const pt = (P, v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], unit = (n) => { const l = Math.hypot(...n); return l > 1e-14 ? n.map((x) => x / l) : null; }, nrmOf = (P, a, b, c) => unit(cross(sub3(pt(P, b), pt(P, a)), sub3(pt(P, c), pt(P, a))));
  // one id per skin POSITION (seams duplicate vertices); underside vertices snap to the nearest skin position within tol
  const ids = [], grid = new Map(), ck = (q) => q.map((x) => Math.floor(x / tol)), idOf = (q, make) => { const c = ck(q); let best = -1, bd = tol;
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) for (const id of grid.get(`${c[0] + x},${c[1] + y},${c[2] + z}`) ?? []) { const d = Math.hypot(...sub3(ids[id], q)); if (d < bd) { bd = d; best = id; } }
    if (best < 0 && make) { best = ids.push(q) - 1; const k = c.join(","); (grid.get(k) ?? grid.set(k, []).get(k)).push(best); } return best; };
  const skinE = new Map(), ek = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const p of parts) { if (!/^identity_(head|face_twin|hair_base)$/.test(p.name)) continue; const sid = new Int32Array(p.P.length / 3); for (let v = 0; v < sid.length; v++) sid[v] = idOf(pt(p.P, v), true);
    for (let t = 0; t < p.I.length; t += 3) { const n = nrmOf(p.P, p.I[t], p.I[t + 1], p.I[t + 2]); for (let q = 0; q < 3; q++) { const k = ek(sid[p.I[t + q]], sid[p.I[t + (q + 1) % 3]]); (skinE.get(k) ?? skinE.set(k, []).get(k)).push(n); } } }
  const uid = new Int32Array(und.P.length / 3); for (let v = 0; v < uid.length; v++) uid[v] = idOf(pt(und.P, v), false);
  const crease = [], own = new Map();
  for (let t = 0; t < und.I.length; t += 3) { const n = nrmOf(und.P, und.I[t], und.I[t + 1], und.I[t + 2]); if (!n) continue;
    for (let q = 0; q < 3; q++) { const a = und.I[t + q], b = und.I[t + (q + 1) % 3], pa = pt(und.P, a), pb = pt(und.P, b), kp = [...pa, ...pb].map((x) => Math.round(x / tol)).join(","), kq = [...pb, ...pa].map((x) => Math.round(x / tol)).join(",");
      own.set(kp, n); const o = own.get(kq); if (o && dot(o, n) < -0.5) own.set("fin|" + kp, true);
      if (uid[a] < 0 || uid[b] < 0) continue; const s = skinE.get(ek(uid[a], uid[b])); if (s?.length === 1 && s[0]) crease.push((Math.acos(Math.max(-1, Math.min(1, dot(s[0], n)))) * 180) / Math.PI); } }
  const cs = crease.slice().sort((x, y) => x - y), cq = (f) => Math.round(cs[Math.min(cs.length - 1, Math.floor(f * cs.length))]);
  return { weldEdges: crease.length, foldBacks: crease.filter((x) => x >= 90).length, crease: cs.length ? { median: cq(0.5), p90: cq(0.9), max: cq(1) } : null, fins: [...own.keys()].filter((k) => k.startsWith("fin|")).length };
}
