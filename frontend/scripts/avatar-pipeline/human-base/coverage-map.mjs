// coverage-map.mjs — WHERE THE HEAD IS ACTUALLY OPEN (2026-10-13, EXPERIMENTAL, opt-in). ZERO CREDITS.
//
// The canonical head (Alex identity_head: the surface chibify's cut is defined against, in the shared identity frame) is held against
// the identity's own surfaces: per template triangle, what lies along its own normal —
//   covered    rigid identity (skin / face twin / hair-base cap / face features) within ±band
//   scalp      a hair layer lying ON the template (the scalp layer, roots) within ±band — it covers the skull too
//   offset     rigid identity only further off, within ±depth (a sleeve inside, a lip outside)
//   hair-only  nothing rigid, a hair layer outside within hairReach (scalp missing under hair)
//   open       nothing at all: the head is open there
//   neck       inside the neck tube (the body's)
// Milestone 0 (nine heads): the open underside is 6–15 % of the canonical head below the eye line on every head; hair-only regions
// (22–31 %) only under long hair. The per-angle profile of the OPEN underside (`openArea`, about the neck axis) tells the welded underside
// which angles actually need closing — instead of trusting the lowest rim (a tucked skin sleeve is lowest and bounds nothing).
// Nothing here knows a name; deterministic.

export const COVERAGE = { band: 0.15, depth: 0.5, hairReach: 2.0, bins: 720 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const segHit = (p0, p1, [A, Bv, C]) => { const d = sub(p1, p0), e1 = sub(Bv, A), e2 = sub(C, A), h = cross(d, e2), det = dot(e1, h); if (Math.abs(det) < 1e-18) return -1; const f = 1 / det, s0 = sub(p0, A), u = f * dot(s0, h); if (u < 0 || u > 1) return -1;
  const q = cross(s0, e1), v = f * dot(d, q); if (v < 0 || u + v > 1) return -1; const t = f * dot(e2, q); return t >= 0 && t <= 1 ? t : -1; };
const RIGID = /^identity_(head|face_twin|hair_base)$|^face_/, HAIR = /^identity_hair_(?!base$)/;

/** parts: identity parts [{ name, P, I }]; template: { P, I }; neck: { cx, cz, wall(θ), y1 }; eyeY; U (template eye spacing).
 *  → { cls[], area: { [class]: U² below the eye line }, openArea: Float64Array(bins) — open template area (U²) per angle bin about the
 *    neck axis (θ = atan2(z − cz, x − cx), bin = ⌊(θ + π) / 2π · bins⌋), below the eye line, never the forward-facing face } */
export function coverageMap({ parts, template, neck, eyeY, U, ...opt }) {
  const { band, depth, hairReach, bins } = { ...COVERAGE, ...opt }, B = band * U, D = depth * U, HH = hairReach * U;
  const cell = 0.02, grid = new Map(), T = [], tri = (P, I, t) => [0, 1, 2].map((q) => [P[I[t + q] * 3], P[I[t + q] * 3 + 1], P[I[t + q] * 3 + 2]]);
  for (const p of parts) { const kind = RIGID.test(p.name) ? 1 : HAIR.test(p.name) ? 2 : 0; if (!kind) continue;
    for (let t = 0; t < p.I.length; t += 3) { const V = tri(p.P, p.I, t), id = T.push({ V, kind }) - 1, lo = [0, 1, 2].map((k) => Math.floor(Math.min(V[0][k], V[1][k], V[2][k]) / cell)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(V[0][k], V[1][k], V[2][k]) / cell));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = `${x},${y},${z}`; (grid.get(k) ?? grid.set(k, []).get(k)).push(id); } } }
  /** the hit of a surface kind on c + n·s, s ∈ [lo, hi], nearest to c (signed), or Infinity */
  const nearest = (c, n, lo, hi, kind) => { const p0 = c.map((x, k) => x + n[k] * lo), p1 = c.map((x, k) => x + n[k] * hi), len = hi - lo, seen = new Set(); let best = Infinity;
    for (let s = 0; s <= len + 1e-12; s += cell / 4) { const q = p0.map((x, k) => x + n[k] * s), key = q.map((x) => Math.floor(x / cell)).join(","); for (const id of grid.get(key) ?? []) { if (seen.has(id)) continue; seen.add(id); if (T[id].kind !== kind) continue;
      const f = segHit(p0, p1, T[id].V); if (f >= 0) { const d = lo + f * len; if (Math.abs(d) < Math.abs(best)) best = d; } } }
    return best; };
  const NT = template.I.length / 3, cls = new Array(NT), area = {}, openArea = new Float64Array(bins), TAU = 2 * Math.PI;
  for (let t = 0; t < NT; t++) { const V = tri(template.P, template.I, t * 3), nn = cross(sub(V[1], V[0]), sub(V[2], V[0])), l = Math.hypot(...nn) || 1, n = nn.map((x) => x / l), c = [0, 1, 2].map((k) => (V[0][k] + V[1][k] + V[2][k]) / 3), A = l / 2 / (U * U);
    const th = Math.atan2(c[2] - neck.cz, c[0] - neck.cx);
    if (c[1] < neck.y1 && Math.hypot(c[0] - neck.cx, c[2] - neck.cz) < neck.wall(th) + 0.01) cls[t] = "neck";
    else { const d = nearest(c, n, -D, D, 1); if (Math.abs(d) <= B) cls[t] = "covered"; else if (Math.abs(nearest(c, n, -B, B, 2)) <= B) cls[t] = "scalp"; else if (Math.abs(d) <= D) cls[t] = d < 0 ? "offset-in" : "offset-out"; else cls[t] = nearest(c, n, 0, HH, 2) < Infinity ? "hair-only" : "open"; }
    if (c[1] >= eyeY || n[2] > 0.5) continue; area[cls[t]] = (area[cls[t]] ?? 0) + A;
    if (cls[t] === "open") openArea[Math.floor(((th + Math.PI) / TAU) * bins) % bins] += A; }
  return { cls, area, openArea };
}
