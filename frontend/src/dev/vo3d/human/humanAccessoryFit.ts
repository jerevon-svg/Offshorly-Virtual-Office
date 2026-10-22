// vo3d human — THE ACCESSORY ATTACHMENT CONTRACT (V1.1): an approved accessory module adapts to whoever wears it.
//
// Accessories never carry per-employee XYZ. Each identity publishes SEMANTIC anchors measured on its own fitted geometry
// (`landmarks.attach`, chibify.mjs): ears (root / outer / top / lobe / back), nose (bridge / tip), crown, forehead and the
// head ENVELOPE — the outer head+hair surface as a radius per direction about the canonical skull centre (plus the same
// map over skin only). A module declares WHERE it attaches (`humanAccessory.attach`) and is authored in that region's
// local frame; the runtime places it on the wearer:
//   region "glasses"   eyes + nose bridge + temples + ears           (fit-space geometry, humanGlasses.ts)
//   region "hair"      a point on the OUTER hair envelope + its normal (clips, flowers, bows)
//   region "ear"       an ear landmark (lobe / top / outer)          (earrings, ear cuffs)
//   region "envelope"  conforming geometry: every vertex = a direction + an offset ABOVE the envelope (hats, caps,
//                      headbands, the band of a headset) — the actual hairstyle, so thick hair never swallows it
//   region "ears2"     both ears (+ envelope) — headphones / headsets cups
// `checkAccessory` is the universal validation: floating, oversized/undersized, inside skin (face/eyes/ears), lost
// inside hair, hovering above hair, disconnected pieces.
import * as THREE from "three";

export type V3 = [number, number, number];
export type EarAnchors = { root: V3; outer: V3 | null; top: V3 | null; lobe: V3 | null; back: V3 | null; measured?: boolean };
export type AttachData = {
  v: 1; centre: V3; ears: { l: EarAnchors; r: EarAnchors }; nose: { bridge: V3 | null; tip: V3 | null };
  crown: V3; forehead: V3 | null;
  envelope: { nt: number; np: number; outer: number[]; skin: number[] };
};
export type AttachSpec =
  | { region: "hair"; dir: V3; standoff: number; scale: number; roll?: number }
  | { region: "ear"; side: "l" | "r" | "both"; site: "lobe" | "top" | "outer"; offset?: V3; scale: number }
  | { region: "envelope"; clearance: number }
  | { region: "ears2"; clearance: number };

/** the envelope radius in a head-local direction (bilinear over the published polar grid) */
export function envelopeRadius(a: AttachData, dir: THREE.Vector3, which: "outer" | "skin" = "outer"): number {
  const E = a.envelope, A = E[which], d = dir.clone().normalize();
  const th = Math.acos(Math.max(-1, Math.min(1, d.y))) / Math.PI * E.nt - 0.5, ph = (Math.atan2(d.z, d.x) + Math.PI) / (2 * Math.PI) * E.np - 0.5;
  const t0 = Math.max(0, Math.min(E.nt - 1, Math.floor(th))), t1 = Math.min(E.nt - 1, t0 + 1), ft = Math.max(0, Math.min(1, th - t0));
  const p0 = ((Math.floor(ph) % E.np) + E.np) % E.np, p1 = (p0 + 1) % E.np, fp = ph - Math.floor(ph);
  const g = (t: number, p: number) => A[t * E.np + p];
  return (g(t0, p0) * (1 - fp) + g(t0, p1) * fp) * (1 - ft) + (g(t1, p0) * (1 - fp) + g(t1, p1) * fp) * ft;
}
/** the point on the (outer) envelope in a direction, and the surface normal there (finite differences) */
export function envelopePoint(a: AttachData, dir: THREE.Vector3, which: "outer" | "skin" = "outer"): { p: THREE.Vector3; n: THREE.Vector3 } {
  const C = new THREE.Vector3(...a.centre), d = dir.clone().normalize(), at = (u: THREE.Vector3) => C.clone().addScaledVector(u, envelopeRadius(a, u, which));
  const p = at(d), t1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize(), t2 = new THREE.Vector3().crossVectors(d, t1);
  const e = 0.06, pa = at(d.clone().addScaledVector(t1, e).normalize()), pb = at(d.clone().addScaledVector(t1, -e).normalize()), pc = at(d.clone().addScaledVector(t2, e).normalize()), pd = at(d.clone().addScaledVector(t2, -e).normalize());
  const n = new THREE.Vector3().crossVectors(pa.sub(pb), pc.sub(pd)).normalize(); if (n.dot(d) < 0) n.negate();
  return { p, n };
}

/** a hair accessory sits ON HAIR: if this wearer has no hair in the authored direction (a higher hairline, a tied style),
 *  the nearest direction toward the crown (≤ 30°) where the outer envelope stands off the skin (hair present) */
export function hairDirection(a: AttachData, dir: THREE.Vector3): THREE.Vector3 {
  const d0 = dir.clone().normalize(), hasHair = (d: THREE.Vector3) => envelopeRadius(a, d) - envelopeRadius(a, d, "skin") > 0.012;
  if (hasHair(d0)) return d0;
  const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3().crossVectors(d0, up); if (axis.lengthSq() < 1e-6) return d0; axis.normalize();
  for (let deg = 3; deg <= 30; deg += 3) for (const side of [0, 1, -1]) { const d = d0.clone().applyAxisAngle(axis, (deg * Math.PI) / 180); if (side) d.applyAxisAngle(up, (side * deg * 0.5 * Math.PI) / 180); if (hasHair(d)) return d.normalize(); }
  return d0;
}

/** a rigid accessory's placement on the wearer (module geometry authored in the region's local frame: +Z = out of the
 *  surface, +Y = toward the crown / up, origin = the seat point) */
export function placeAccessory(a: AttachData, spec: AttachSpec, side?: "l" | "r"): THREE.Matrix4 {
  const m = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  const frame = (o: THREE.Vector3, n: THREE.Vector3, scale: number, roll = 0) => { const z = n.clone().normalize(), x = new THREE.Vector3().crossVectors(up, z); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize(); const y = new THREE.Vector3().crossVectors(z, x);
    if (roll) { const q = new THREE.Quaternion().setFromAxisAngle(z, roll); x.applyQuaternion(q); y.applyQuaternion(q); }
    return m.makeBasis(x.multiplyScalar(scale), y.multiplyScalar(scale), z.multiplyScalar(scale)).setPosition(o); };
  if (spec.region === "hair") { const d = hairDirection(a, new THREE.Vector3(...spec.dir)), { p, n } = envelopePoint(a, d); return frame(p.addScaledVector(n, spec.standoff), n, spec.scale, spec.roll); }
  if (spec.region === "ear") { const e = a.ears[side ?? (spec.side === "both" ? "r" : spec.side)], site = e[spec.site] ?? e.outer ?? e.root, sg = (side ?? spec.side) === "l" ? -1 : 1;
    const o = new THREE.Vector3(...site).add(new THREE.Vector3(...(spec.offset ?? [0, 0, 0])).multiply(new THREE.Vector3(sg, 1, 1)));
    return frame(o, new THREE.Vector3(sg, 0, 0), spec.scale); }
  return m.identity();
}

/** conforming geometry (region "envelope"): `afit` = [dx, dy, dz, offset] per vertex — a direction from the skull centre and
 *  an offset above the wearer's OUTER envelope (+ the module's clearance) */
export function fitEnvelopePositions(afit: ArrayLike<number>, a: AttachData, clearance: number): Float32Array {
  const n = afit.length / 4, out = new Float32Array(n * 3), C = new THREE.Vector3(...a.centre), d = new THREE.Vector3();
  for (let i = 0; i < n; i++) { d.set(afit[i * 4], afit[i * 4 + 1], afit[i * 4 + 2]).normalize(); const r = envelopeRadius(a, d) + clearance + afit[i * 4 + 3];
    out[i * 3] = C.x + d.x * r; out[i * 3 + 1] = C.y + d.y * r; out[i * 3 + 2] = C.z + d.z * r; }
  return out;
}

export type AccessoryCheck = { verts: number; insideSkin: number; lostInHair: number; floating: boolean; minGap: number; maxGap: number; pieces: number; detached: number; sizeRatio: number; ok: boolean; issues: string[] };
/** UNIVERSAL accessory validation in head-local space. `expect` = where the accessory may sit:
 *  "face" (glasses: in front of skin, never inside it, never lost in hair), "hair" (on/in the hair surface, not hovering),
 *  "skin" (near skin, never inside it), "ear" (through the lobe, never deep in the head). Sizes are relative to the head envelope's width. */
export function checkAccessory(pos: ArrayLike<number>, index: ArrayLike<number> | null, a: AttachData, expect: "face" | "hair" | "skin" | "ear"): AccessoryCheck {
  const n = pos.length / 3, C = new THREE.Vector3(...a.centre), v = new THREE.Vector3(); let insideSkin = 0, lostInHair = 0, minGap = 9, maxGap = -9;
  let x0 = 9, x1 = -9; for (let i = 0; i < n; i++) { x0 = Math.min(x0, pos[i * 3]); x1 = Math.max(x1, pos[i * 3]); }
  for (let i = 0; i < n; i++) { v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).sub(C); const r = v.length(), rs = envelopeRadius(a, v, "skin"), ro = envelopeRadius(a, v, "outer");
    if (r < rs - (expect === "ear" ? 0.03 : 0.004)) insideSkin++;   // an earring passes THROUGH the lobe (and the radial skin map is coarse at the ears)
    if (expect === "face" && ro > rs + 0.02 && r < ro - 0.012 && r > rs) lostInHair++;
    const gap = r - (expect === "hair" ? ro : rs); minGap = Math.min(minGap, gap); maxGap = Math.max(maxGap, gap); }
  // connected pieces (welded by position)
  let pieces = 0, detached = 0; if (index) { const key = (i: number) => `${Math.round(pos[i * 3] * 2e3)},${Math.round(pos[i * 3 + 1] * 2e3)},${Math.round(pos[i * 3 + 2] * 2e3)}`, rep = new Map<string, number>(), par = new Int32Array(n);
    for (let i = 0; i < n; i++) { const k = key(i); if (!rep.has(k)) rep.set(k, i); par[i] = rep.get(k)!; }
    const f = (i: number): number => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let t = 0; t < index.length; t += 3) { const A = f(index[t]), B = f(index[t + 1]), D = f(index[t + 2]); par[B] = A; par[f(D)] = A; }
    const roots = new Set<number>(); for (let t = 0; t < index.length; t++) roots.add(f(index[t])); pieces = roots.size;
    // a piece is DETACHED when no other piece comes within 2 cm-eq of it (touching / overlapping parts are one accessory)
    if (pieces > 1) { const byRoot = new Map<number, number[]>(); for (let t = 0; t < index.length; t++) { const r = f(index[t]); (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(index[t]); }
      const groups = [...byRoot.values()].map((g) => [...new Set(g)]);
      for (let gi = 0; gi < groups.length; gi++) { let near = false; for (let gj = 0; gj < groups.length && !near; gj++) { if (gi === gj) continue;
          for (const a2 of groups[gi]) { for (const b2 of groups[gj]) if (Math.hypot(pos[a2 * 3] - pos[b2 * 3], pos[a2 * 3 + 1] - pos[b2 * 3 + 1], pos[a2 * 3 + 2] - pos[b2 * 3 + 2]) < 0.02) { near = true; break; } if (near) break; } }
        if (!near) detached++; } } }
  const headW = 2 * envelopeRadius(a, new THREE.Vector3(1, 0, 0)), sizeRatio = (x1 - x0) / headW;
  const issues: string[] = [];
  if (insideSkin > n * 0.002) issues.push(`inside skin ${insideSkin}`);
  if (detached) issues.push(`${detached} detached piece(s)`);
  if (lostInHair > n * 0.05) issues.push(`lost in hair ${lostInHair}`);
  const floating = expect === "hair" ? minGap > 0.03 : minGap > 0.08; if (floating) issues.push(`floating (min gap ${minGap.toFixed(3)})`);
  if (expect === "face" && (sizeRatio > 1.25 || sizeRatio < 0.55)) issues.push(`size ${sizeRatio.toFixed(2)} × head width`);
  return { verts: n, insideSkin, lostInHair, floating, minGap: +minGap.toFixed(4), maxGap: +maxGap.toFixed(4), pieces, detached, sizeRatio: +sizeRatio.toFixed(3), ok: issues.length === 0, issues };
}
