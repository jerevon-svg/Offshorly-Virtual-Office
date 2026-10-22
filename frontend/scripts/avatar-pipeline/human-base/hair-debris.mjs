// hair-debris.mjs — HANGING HAIR MUST BE ATTACHED (2026-10-10, universal construction invariant; chibify calls it after its LAST cut).
//
// chibify's own rule — "hanging hair must be connected to the head" — is enforced on vertices BEFORE the triangle-level neck / jaw
// cuts that follow. A generated collar rim (dark paint labelled hair, hugging the neck just outside the cleared neck-hair column)
// survives those cuts as hair welded to nothing: dark debris lying on the tee collar (2026-10-10: a rejected head, six pieces, 236
// triangles, 0.10–0.19 from the neck axis; the approved heads' hanging hair below the chin is always welded to the hair mass).
//
// Rule (no name, no count, no per-person constant): INSIDE THE COLLAR ZONE — chibify's neck-hair column (up to the skull base:
// in head space the neck rises behind the chin, so a chin-height test misses it) widened by chibify's hanging-hair clearance
// (legitimate hanging hair is pushed outside that band by construction) — a hair-layer piece that is welded to NO other part AND
// does not lie on any other surface (median distance beyond the hair layers' own surface clearance) is removed whole. Hair paint
// lying on the skin (the approved heads' unwelded under-chin / nape bits sit within 0.0025 of it) is not debris; the rejected
// head's collar rim floated 0.012–0.088 off everything. Rooted hanging hair, all hair outside the zone, the base cap and every
// non-hair part stay.
import { surfaceDistance } from "./closure-attachment.mjs";
export const NECK_COLUMN = { cx: 0, cz: -0.013, r: 0.17, yTop: 0.96 };   // chibify neckHairClear's column (FC-NECK-HAIR measures the same)

/** parts: [{ name, P, I }] (identity parts, bind space; edited in place). Returns what was removed. */
export function dropUnattachedHairDebris(parts, { clearance, onSurface, column = NECK_COLUMN }) {
  let dist = null;   // built lazily: most heads have no candidate at all
  const key = (P, v) => `${Math.round(P[v * 3] * 1e5)},${Math.round(P[v * 3 + 1] * 1e5)},${Math.round(P[v * 3 + 2] * 1e5)}`, owners = new Map();
  parts.forEach((p, pi) => { for (let v = 0; v < p.P.length / 3; v++) { const k = key(p.P, v), o = owners.get(k); if (o) o.add(pi); else owners.set(k, new Set([pi])); } });
  const zone = column.r + clearance, out = { pieces: 0, tris: 0 };
  parts.forEach((p, pi) => { if (!/^identity_hair_/.test(p.name) || p.name === "identity_hair_base") return;
    const n = p.P.length / 3, kk = new Map(), wid = new Int32Array(n); for (let i = 0; i < n; i++) { const k = key(p.P, i); if (!kk.has(k)) kk.set(k, i); wid[i] = kk.get(k); }
    const par = Int32Array.from({ length: n }, (_, i) => i), find = (x) => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    for (let t = 0; t < p.I.length; t += 3) { const a = find(wid[p.I[t]]); par[find(wid[p.I[t + 1]])] = a; par[find(wid[p.I[t + 2]])] = a; }
    const comps = new Map(); for (let t = 0; t < p.I.length; t += 3) { const r = find(wid[p.I[t]]); let c = comps.get(r); if (!c) comps.set(r, (c = { tris: [], y: 0, rad: 0, m: 0, attached: false }));
      c.tris.push(t); for (let k = 0; k < 3; k++) { const v = p.I[t + k]; c.y += p.P[v * 3 + 1]; c.rad += Math.hypot(p.P[v * 3] - column.cx, p.P[v * 3 + 2] - column.cz); c.m++; if (!c.attached && owners.get(key(p.P, v)).size > 1) c.attached = true; } }
    const drop = new Set(); for (const c of comps.values()) { if (c.attached || c.y / c.m >= column.yTop || c.rad / c.m > zone) continue;
      dist ??= surfaceDistance(parts); const own = new Set(c.tris), vs = new Set(); for (const t of c.tris) for (let k = 0; k < 3; k++) vs.add(p.I[t + k]);
      const d = [...vs].map((v) => dist([p.P[v * 3], p.P[v * 3 + 1], p.P[v * 3 + 2]], 0.2, (qi, qt) => qi === pi && own.has(qt))).sort((a, b) => a - b);
      if (d[(d.length - 1) >> 1] <= onSurface) continue;   // lies on another surface: paint on the skin, not debris
      out.pieces++; out.tris += c.tris.length; for (const t of c.tris) drop.add(t); }
    if (!drop.size) return; const keep = []; for (let t = 0; t < p.I.length; t += 3) if (!drop.has(t)) keep.push(p.I[t], p.I[t + 1], p.I[t + 2]);
    p.I = Array.isArray(p.I) ? keep : new p.I.constructor(keep); });
  return out;
}
