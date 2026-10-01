// vo3d build — THE EXTERIOR'S PLANTING, MODELLED. Procedural, deterministic, low-poly-but-built trees,
// shrubs and ground cover, replacing the stacked icosahedron "blobs" the campus started with.
//
// WHAT A TREE IS HERE. A real trunk (tapered, slightly leaning, carved with spiralling bark grooves) that
// FLARES into its root plate and pushes visible roots into the lawn; primary branches leaving it at their
// own heights and angles, secondaries off those; and a crown built as LAYERED LEAF MASSES clustered on the
// branch ends — each mass faceted, jittered and shaded darker underneath and inside, so the canopy reads as
// depth rather than as one moulded shape. Two seeds per species, so no two neighbours are clones.
//
// LEVEL OF DETAIL. Every species/seed comes in two cuts that share a silhouette: NEAR (grooved bark, roots,
// secondaries, ~10 leaf masses) and FAR (a plain tapered trunk, two branch stubs, ~5 masses). build/exterior
// keeps both in one BatchedMesh per material and swaps an instance between them by camera distance, so the
// detail is spent only where a camera is actually close to a tree.
//
// WIND. Foliage carries a per-vertex `wind` weight (world units of travel at full wind) instead of the old
// height rule, so a crown sways, a grass blade's tip flutters and a pebble beside it never moves — all in
// one material and one batch.
import * as THREE from "three";
import { Part, lin, mergePainted, prng } from "./exteriorGeo";
import type { TreeKind } from "../world/campus";

// ---- palette (sRGB hex; the bark and leaf tones the old flat materials used, now with a range) --------
const BARK = { base: 0x7d5e43, dark: 0x4c3626, light: 0x9a7856, root: 0x5e4532 };
const LEAF: Record<TreeKind, { base: number; dark: number; light: number }> = {
  round: { base: 0x5a913e, dark: 0x2f5a2c, light: 0x8fbf55 },
  tall: { base: 0x6aa548, dark: 0x356432, light: 0x9ccc62 },
  broad: { base: 0x4c8139, dark: 0x274c27, light: 0x7eb04e },
  conifer: { base: 0x3e6b4a, dark: 0x213f2f, light: 0x5f8f5c },
};

/** how far the TOP of a 100-unit crown travels at full wind — the old CANOPY_FLEX, as a vertex weight */
export const CANOPY_FLEX = 0.042;
export const SHRUB_FLEX = 0.009;

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));

// ---- the trunk and its limbs --------------------------------------------------------------------------
type TubeOpts = { grooves?: number; depth?: number; twist?: number; flare?: { n: number; amp: number; phase: number }; cap?: boolean };
/** A TAPERED LIMB along a polyline, one ring per point, carried by parallel-transported frames so it can
 *  bend without twisting. Grooves are a cosine ridge pattern spiralled up the limb, darker in the valleys. */
function tube(P: Part, pts: THREE.Vector3[], radii: number[], seg: number, o: TubeOpts = {}): void {
  const bark = lin(BARK.base), dark = lin(BARK.dark), light = lin(BARK.light), root = lin(BARK.root);
  let N = new THREE.Vector3();
  const rings: number[][] = [];
  for (let i = 0; i < pts.length; i++) {
    const T = (i === 0 ? pts[1].clone().sub(pts[0]) : i === pts.length - 1 ? pts[i].clone().sub(pts[i - 1]) : pts[i + 1].clone().sub(pts[i - 1])).normalize();
    if (i === 0) N = Math.abs(T.y) < 0.9 ? V(0, 1, 0).cross(T).normalize() : V(1, 0, 0).cross(T).normalize();
    else N.sub(T.clone().multiplyScalar(N.dot(T))).normalize();
    const B = T.clone().cross(N).normalize();
    const ring: number[] = [];
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const g = o.grooves ? Math.pow(0.5 + 0.5 * Math.cos(o.grooves * th + (o.twist ?? 0) * i), 3) : 0;
      let r = radii[i] * (1 - (o.depth ?? 0) * g);
      if (o.flare && i < 2) {
        const lobe = Math.pow(Math.max(0, Math.cos(o.flare.n * th + o.flare.phase)), 2);
        r *= 1 + o.flare.amp * (i === 0 ? 1 : 0.35) * lobe + (i === 0 ? 0.18 : 0.05);
      }
      const d = N.clone().multiplyScalar(Math.cos(th)).add(B.clone().multiplyScalar(Math.sin(th)));
      const p = pts[i].clone().addScaledVector(d, r);
      // valleys darker; the root plate darker still; a little light on the ridges near the top
      let col = mix(bark, dark, g * 0.75);
      if (i === 0) col = mix(col, root, 0.5);
      else if (g < 0.2) col = mix(col, light, 0.25 * (i / pts.length));
      ring.push(P.v(p.x, p.y, p.z, col));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < seg; k++) {
      const k2 = (k + 1) % seg;
      P.quad(rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]);
    }
  if (o.cap !== false) {
    const top = pts[pts.length - 1], last = rings[rings.length - 1];
    const c = P.v(top.x, top.y, top.z, lin(BARK.light));
    for (let k = 0; k < seg; k++) P.tri(last[k], last[(k + 1) % seg], c);
  }
}

/** a limb leaving `from` along `dir` for `len`, bending by `bend` (added to its direction per segment) */
function limb(P: Part, from: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, segs: number, seg: number, bend: THREE.Vector3, o: TubeOpts = {}): THREE.Vector3[] {
  const pts = [from.clone()], radii = [r0];
  const d = dir.clone().normalize();
  for (let i = 1; i <= segs; i++) {
    d.add(bend).normalize();
    pts.push(pts[i - 1].clone().addScaledVector(d, len / segs));
    radii.push(r0 * (1 - 0.72 * (i / segs)));
  }
  tube(P, pts, radii, seg, o);
  return pts;
}

/** A ROOT: a short limb leaving the flare sideways and diving into the lawn. */
function root(P: Part, at: THREE.Vector3, a: number, len: number, r: number): void {
  const d = V(Math.cos(a), -0.22, Math.sin(a));
  limb(P, at, d, len, r, 2, 4, V(0, -0.18, 0), { cap: true });
}

// ---- leaf masses --------------------------------------------------------------------------------------
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(([x, y, z]) => V(x, y, z).normalize());
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { v, f };
})();
/** the icosphere at detail 0 (12 verts, 20 faces) or 1 (42, 80), indexed, unit radius */
const icoSphere = (() => {
  const cache = new Map<number, { v: THREE.Vector3[]; f: number[][] }>();
  return (detail: 0 | 1) => {
    let s = cache.get(detail);
    if (s) return s;
    if (detail === 0) s = { v: ICO.v.map((x) => x.clone()), f: ICO.f.map((x) => [...x]) };
    else {
      const v = ICO.v.map((x) => x.clone()), f: number[][] = [], mid = new Map<string, number>();
      const m = (a: number, b: number) => {
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        let i = mid.get(k);
        if (i === undefined) { i = v.length; v.push(v[a].clone().add(v[b]).normalize()); mid.set(k, i); }
        return i;
      };
      for (const [a, b, c] of ICO.f) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); f.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      s = { v, f };
    }
    cache.set(detail, s);
    return s;
  };
})();

type Leaf = { base: THREE.Color; dark: THREE.Color; light: THREE.Color };
/** ONE LEAF MASS: a jittered, squashed icosphere, darker underneath and toward the crown's core, lit on top.
 *  `core` is the crown's centre — faces turned toward it are the inside of the canopy and go darkest. */
function mass(P: Part, rnd: () => number, c: THREE.Vector3, rx: number, ry: number, rz: number, detail: 0 | 1, leaf: Leaf, core: THREE.Vector3, windPerY: number, jitter = 0.32): void {
  const s = icoSphere(detail);
  const yaw = rnd() * Math.PI * 2, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const hue = (rnd() - 0.5) * 0.06, val = 0.92 + rnd() * 0.16;
  const ids = s.v.map((u) => {
    const j = 1 + (rnd() - 0.5) * jitter;
    const lx = u.x * rx * j, ly = u.y * ry * j * (u.y < 0 ? 0.7 : 1), lz = u.z * rz * j; // flattened underside
    const x = c.x + lx * cy - lz * sy, y = c.y + ly, z = c.z + lx * sy + lz * cy;
    const up = u.y * 0.5 + 0.5;
    const outward = V(x - core.x, (y - core.y) * 0.6, z - core.z).normalize().dot(V(u.x * cy - u.z * sy, u.y, u.x * sy + u.z * cy));
    let col = mix(leaf.dark, leaf.base, up * 1.25);
    col = mix(col, leaf.light, Math.max(0, up - 0.62) * 2.2 + Math.max(0, outward) * 0.18);
    col = mix(col, leaf.dark, Math.max(0, -outward) * 0.45);
    col.offsetHSL(hue, 0, 0).multiplyScalar(val);
    return P.v(x, y, z, col, Math.max(0, y) * windPerY);
  });
  for (const [a, b, d] of s.f) P.tri(ids[a], ids[b], ids[d]); // outward faces CCW
}

// ---- the species ------------------------------------------------------------------------------------
export type TreeGeo = { trunk: THREE.BufferGeometry; canopy: THREE.BufferGeometry };
export type TreeLod = { near: TreeGeo; far: TreeGeo };

/** a broadleaf: trunk height `th`, base radius `r0`, primaries spreading at `spread` (radians off vertical) */
function broadleaf(kind: TreeKind, seed: number, near: boolean): TreeGeo {
  const rnd = prng(seed);
  const T = new Part(), Cn = new Part();
  const leaf: Leaf = { base: lin(LEAF[kind].base), dark: lin(LEAF[kind].dark), light: lin(LEAF[kind].light) };
  const spec = kind === "round" ? { th: 30, r0: 4.4, prim: 4, spread: 0.85, plen: 24, crownY: 52, crownR: 27 }
    : kind === "tall" ? { th: 52, r0: 3.6, prim: 5, spread: 0.42, plen: 18, crownY: 70, crownR: 15 }
    : { th: 19, r0: 5.2, prim: 4, spread: 1.12, plen: 34, crownY: 40, crownR: 33 };
  const seg = near ? 7 : 5;
  // THE TRUNK: lean and a gentle S, so it is a grown thing and not a turned post
  const lean = V((rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.12).normalize();
  const rings = near ? 5 : 3;
  const tp: THREE.Vector3[] = [], tr: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const wob = Math.sin(t * Math.PI * 1.6 + seed) * 1.2 * t;
    tp.push(V(lean.x * spec.th * t + wob * 0.6, -1.2 + (spec.th + 1.2) * t, lean.z * spec.th * t - wob * 0.4));
    tr.push(spec.r0 * (1 - 0.48 * Math.pow(t, 0.9)));
  }
  tube(T, tp, tr, seg, near ? { grooves: 5 + Math.floor(rnd() * 3), depth: 0.2, twist: 0.35, flare: { n: 4, amp: 0.85, phase: rnd() * 6 } } : { flare: { n: 4, amp: 0.5, phase: 0 } });
  if (near) for (let k = 0; k < 3; k++) root(T, V(0, 0.6, 0), (k / 3) * Math.PI * 2 + rnd() * 0.9, spec.r0 * (1.7 + rnd() * 0.8), spec.r0 * 0.42);
  const core = V(tp[rings].x, spec.crownY, tp[rings].z);
  // PRIMARY BRANCHES, each to a leaf cluster at its end
  const tips: { at: THREE.Vector3; r: number }[] = [];
  const prim = near ? spec.prim : 2;
  for (let b = 0; b < prim; b++) {
    const a = (b / prim) * Math.PI * 2 + rnd() * 0.8;
    const h = 0.62 + 0.3 * (b / prim) + rnd() * 0.06;
    const k = Math.min(rings - 1, Math.floor(h * rings));
    const from = tp[k].clone().lerp(tp[k + 1], h * rings - k);
    const dir = V(Math.cos(a) * Math.sin(spec.spread), Math.cos(spec.spread), Math.sin(a) * Math.sin(spec.spread));
    const len = spec.plen * (0.82 + rnd() * 0.36);
    const pts = limb(T, from, dir, len, spec.r0 * 0.5, near ? 3 : 2, near ? 5 : 4, V(0, 0.08, 0), near ? { grooves: 3, depth: 0.12, twist: 0.4 } : {});
    tips.push({ at: pts[pts.length - 1], r: 1 });
    if (near) {
      // a secondary off the middle of each primary, swinging sideways
      const mid = pts[Math.floor(pts.length / 2)];
      const sa = a + (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * 0.5);
      const sd = V(Math.cos(sa) * 0.8, 0.7, Math.sin(sa) * 0.8);
      const sp = limb(T, mid, sd, len * 0.55, spec.r0 * 0.24, 2, 4, V(0, 0.1, 0));
      tips.push({ at: sp[sp.length - 1], r: 0.7 });
    }
  }
  // THE CROWN: a mass at every tip, a cap over the top and an inner core so it never reads hollow
  const R = spec.crownR, tall = kind === "tall";
  if (near) {
    for (const t of tips) {
      const s = t.r * (tall ? 0.62 : 0.56);
      const flat = tall ? 1.15 : kind === "broad" ? 0.5 : 0.78;
      if (t.r === 1 && !tall) {
        // A LEAF CLUSTER, not one moulded lump: three smaller masses round the branch end, each its own
        // size, height and tilt — the same triangles as one detailed mass, a far more broken silhouette
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + rnd() * 1.2, off = R * s * 0.45;
          const c = t.at.clone().add(V(Math.cos(a) * off, R * (0.06 + rnd() * 0.16), Math.sin(a) * off));
          const ss = R * s * (0.62 + rnd() * 0.18);
          mass(Cn, rnd, c, ss, ss * flat, ss, 0, leaf, core, CANOPY_FLEX, 0.42);
        }
        mass(Cn, rnd, t.at.clone().add(V(0, R * 0.26, 0)), R * s * 0.5, R * s * 0.42 * flat, R * s * 0.5, 0, leaf, core, CANOPY_FLEX, 0.4);
      } else mass(Cn, rnd, t.at.clone().add(V(0, R * 0.12, 0)), R * s, R * s * flat, R * s, 0, leaf, core, CANOPY_FLEX, 0.3);
    }
    const capN = tall ? 4 : 3;
    for (let i = 0; i < capN; i++) {
      const a = (i / capN) * Math.PI * 2 + rnd();
      const y = tall ? core.y + R * (0.4 + i * 0.75) : core.y + R * 0.45;
      const off = tall ? R * 0.25 : R * 0.35;
      mass(Cn, rnd, V(core.x + Math.cos(a) * off, y, core.z + Math.sin(a) * off), R * 0.55, R * (kind === "broad" ? 0.32 : 0.48), R * 0.55, i === 0 ? 1 : 0, leaf, core, CANOPY_FLEX);
    }
    mass(Cn, rnd, core.clone().add(V(0, -R * 0.05, 0)), R * 0.72, R * (kind === "broad" ? 0.38 : 0.6), R * 0.72, 0, leaf, core, CANOPY_FLEX, 0.2);
    // a couple of loose lower sprays under the main mass — the layer that breaks the bottom edge
    for (let i = 0; i < 2; i++) {
      const a = rnd() * Math.PI * 2;
      mass(Cn, rnd, V(core.x + Math.cos(a) * R * 0.75, core.y - R * (tall ? 0.6 : 0.42), core.z + Math.sin(a) * R * 0.75), R * 0.32, R * 0.2, R * 0.32, 0, leaf, core, CANOPY_FLEX);
    }
  } else {
    mass(Cn, rnd, core.clone(), R * 0.95, R * (kind === "broad" ? 0.45 : tall ? 1.6 : 0.72), R * 0.95, 0, leaf, core, CANOPY_FLEX, 0.28);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rnd();
      const y = tall ? core.y + R * (i - 1.2) * 0.75 : core.y + R * (i === 3 ? 0.5 : 0.08);
      mass(Cn, rnd, V(core.x + Math.cos(a) * R * (tall ? 0.3 : 0.6), y, core.z + Math.sin(a) * R * (tall ? 0.3 : 0.6)), R * 0.56, R * (kind === "broad" ? 0.34 : 0.5), R * 0.56, 0, leaf, core, CANOPY_FLEX);
    }
  }
  return { trunk: T.geometry(false), canopy: Cn.geometry(true) };
}

/** A CONIFER: a straight tapering stem under drooping, star-edged tiers — each tier lighter on top and
 *  dark at its underside, which is what gives a fir its banded read. */
function conifer(seed: number, near: boolean): TreeGeo {
  const rnd = prng(seed);
  const T = new Part(), Cn = new Part();
  const leaf = { base: lin(LEAF.conifer.base), dark: lin(LEAF.conifer.dark), light: lin(LEAF.conifer.light) };
  const H = 84 + rnd() * 8;
  tube(T, [V(0, -1.2, 0), V(0, 10, 0), V(0, 30, 0), V(0, H * 0.75, 0)], [3.2, 2.7, 2.1, 0.7], near ? 7 : 5, near ? { grooves: 6, depth: 0.16, twist: 0.2, flare: { n: 5, amp: 0.7, phase: rnd() * 6 } } : {});
  if (near) for (let k = 0; k < 3; k++) root(T, V(0, 0.5, 0), (k / 3) * Math.PI * 2 + rnd(), 6, 1.3);
  const tiers = near ? 6 : 3, pts = near ? 14 : 8;
  for (let t = 0; t < tiers; t++) {
    const u = t / (tiers - 1);
    const y0 = 20 + u * (H - 34), r = 21 * (1 - u * 0.72) * (0.92 + rnd() * 0.16), h = near ? 22 - u * 6 : 30 - u * 8;
    const apex = Cn.v(0, y0 + h, 0, leaf.light.clone().multiplyScalar(1.05), (y0 + h) * CANOPY_FLEX);
    const under = Cn.v(0, y0 + 2, 0, leaf.dark, (y0 + 2) * CANOPY_FLEX);
    const rim: number[] = [];
    const ph = rnd() * 6;
    for (let k = 0; k < pts; k++) {
      const a = (k / pts) * Math.PI * 2 + ph;
      const rr = r * (k % 2 ? 0.74 : 1) * (0.93 + rnd() * 0.14);
      const droop = k % 2 ? 1.5 : -2.4;
      const col = mix(leaf.base, leaf.dark, k % 2 ? 0.5 : 0.1).multiplyScalar(0.94 + rnd() * 0.12);
      rim.push(Cn.v(Math.cos(a) * rr, y0 + droop, Math.sin(a) * rr, col, (y0 + droop) * CANOPY_FLEX));
    }
    for (let k = 0; k < pts; k++) {
      const k2 = (k + 1) % pts;
      Cn.tri(apex, rim[k2], rim[k]);
      Cn.tri(under, rim[k], rim[k2]);
    }
  }
  return { trunk: T.geometry(false), canopy: Cn.geometry(true) };
}

/** ONE SILHOUETTE, TWO CUTS: stretch the far crown onto the near crown's bounds (x, z about the trunk; y
 *  from the crown's foot), so the LOD swap changes the detail inside the silhouette and never its size.
 *  The wind weights follow the new heights. */
function fitCrown(far: THREE.BufferGeometry, near: THREE.BufferGeometry): void {
  const bn = new THREE.Box3().setFromBufferAttribute(near.getAttribute("position") as THREE.BufferAttribute);
  const bf = new THREE.Box3().setFromBufferAttribute(far.getAttribute("position") as THREE.BufferAttribute);
  const p = far.getAttribute("position") as THREE.BufferAttribute, w = far.getAttribute("wind") as THREE.BufferAttribute | undefined;
  const cxn = (bn.min.x + bn.max.x) / 2, czn = (bn.min.z + bn.max.z) / 2, cxf = (bf.min.x + bf.max.x) / 2, czf = (bf.min.z + bf.max.z) / 2;
  const sx = (bn.max.x - bn.min.x) / (bf.max.x - bf.min.x), sz = (bn.max.z - bn.min.z) / (bf.max.z - bf.min.z), sy = (bn.max.y - bn.min.y) / (bf.max.y - bf.min.y);
  for (let i = 0; i < p.count; i++) {
    const y = bn.min.y + (p.getY(i) - bf.min.y) * sy;
    p.setXYZ(i, cxn + (p.getX(i) - cxf) * sx, y, czn + (p.getZ(i) - czf) * sz);
    if (w) w.setX(i, Math.max(0, y) * CANOPY_FLEX);
  }
  p.needsUpdate = true;
  far.computeVertexNormals();
}

/** THE TREE LIBRARY: two seeds per species, each in a near and a far cut. Built once per process. */
export const TREE_VARIANTS = 2;
let library: Record<TreeKind, TreeLod[]> | null = null;
export function treeLibrary(): Record<TreeKind, TreeLod[]> {
  if (library) return library;
  const make = (kind: TreeKind, seed: number): TreeLod => {
    const lod = kind === "conifer" ? { near: conifer(seed, true), far: conifer(seed, false) } : { near: broadleaf(kind, seed, true), far: broadleaf(kind, seed, false) };
    fitCrown(lod.far.canopy, lod.near.canopy);
    return lod;
  };
  library = {
    round: [make("round", 11), make("round", 23)],
    tall: [make("tall", 31), make("tall", 47)],
    broad: [make("broad", 53), make("broad", 67)],
    conifer: [make("conifer", 71), make("conifer", 89)],
  };
  return library;
}

/** A SHRUB: four or five leaf masses round a dark heart, knee to waist high, ~26 across at scale 1 — the
 *  footprint world/campus SHRUB_R was measured from. */
export function shrubGeometry(seed: number, tone: { base: number; dark: number; light: number } = { base: 0x557a3e, dark: 0x2f4d27, light: 0x7d9f52 }): THREE.BufferGeometry {
  const rnd = prng(seed);
  const P = new Part();
  const leaf = { base: lin(tone.base), dark: lin(tone.dark), light: lin(tone.light) };
  const core = V(0, 9, 0);
  mass(P, rnd, V(0, 8, 0), 12, 8.5, 12, 0, leaf, core, SHRUB_FLEX, 0.3);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rnd();
    mass(P, rnd, V(Math.cos(a) * 7, 10 + rnd() * 5, Math.sin(a) * 7), 6.5 + rnd() * 2, 5.5, 6.5 + rnd() * 2, 0, leaf, core, SHRUB_FLEX);
  }
  return P.geometry(true);
}

// ---- ground cover -------------------------------------------------------------------------------------
/** A GRASS TUFT: `n` single-triangle blades fanned from a small base, each bent outward, dark at the root
 *  and light at the tip. Normals are bent toward UP so a blade lights like the lawn it grows from rather
 *  than going black on its back face — the standard stylised-grass trick, and why this needs no
 *  double-sided lighting model. */
export function grassTuft(seed: number, n: number, h: number, spread: number, tone: { root: number; tip: number }): THREE.BufferGeometry {
  const rnd = prng(seed);
  const pos: number[] = [], col: number[] = [], wind: number[] = [], nrm: number[] = [];
  const rootC = lin(tone.root), tipC = lin(tone.tip);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.8;
    const r = spread * Math.sqrt(rnd());
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const bh = h * (0.6 + rnd() * 0.6), w = 0.9 + rnd() * 0.7;
    const lean = 0.25 + rnd() * 0.45;
    const tx = bx + Math.cos(a) * bh * lean, tz = bz + Math.sin(a) * bh * lean;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w; // across the blade
    const tip = tipC.clone().multiplyScalar(0.88 + rnd() * 0.24);
    for (const [x, y, z, c, wd] of [[bx - px, 0, bz - pz, rootC, 0], [bx + px, 0, bz + pz, rootC, 0], [tx, bh, tz, tip, bh * 0.16]] as const) {
      pos.push(x, y, z); col.push(c.r, c.g, c.b); wind.push(wd); nrm.push(Math.cos(a) * 0.25, 0.95, Math.sin(a) * 0.25);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("wind", new THREE.Float32BufferAttribute(wind, 1));
  return g;
}

/** A FLOWER CLUMP: a few leaves at the base and `n` small heads, each a flat five-point star (its centre
 *  vertex the flower's eye) on a one-triangle stem — ~30 triangles for the clump, so a meadow can afford it. */
export function flowerClump(seed: number, n: number, petal: number, centre: number): THREE.BufferGeometry {
  const rnd = prng(seed);
  const pos: number[] = [], col: number[] = [], wind: number[] = [], nrm: number[] = [];
  const P = lin(petal), E = lin(centre), S = lin(0x4f7f34);
  const vtx = (x: number, y: number, z: number, c: THREE.Color, w: number) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); wind.push(w); nrm.push(0, 1, 0); };
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = 1 + rnd() * 3.2, h = 5 + rnd() * 4;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, w = h * 0.16;
    // the stem: a sliver from the ground to the head
    vtx(x - 0.3, 0, z, S, 0); vtx(x + 0.3, 0, z, S, 0); vtx(x, h, z, S, w);
    // the head: five petals round its eye, tilted a little toward the light
    const rr = 1.5 + rnd() * 0.6, tilt = rnd() * 0.4;
    for (let k = 0; k < 5; k++) {
      const a0 = (k / 5) * Math.PI * 2, a1 = ((k + 1) / 5) * Math.PI * 2;
      vtx(x, h + 0.3, z, E, w);
      vtx(x + Math.cos(a1) * rr, h + Math.sin(a1) * tilt, z + Math.sin(a1) * rr, P, w);
      vtx(x + Math.cos(a0) * rr, h + Math.sin(a0) * tilt, z + Math.sin(a0) * rr, P, w);
    }
  }
  const head = new THREE.BufferGeometry();
  head.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  head.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  head.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  head.setAttribute("wind", new THREE.Float32BufferAttribute(wind, 1));
  return mergePainted([grassTuft(seed + 1, 5, 5, 2.5, { root: 0x3f6b2e, tip: 0x79a94c }), head]);
}

/** A FERN / broadleaf weed: arching fronds, each a narrow two-triangle leaf. */
export function fern(seed: number, n: number, len: number, tone: { root: number; tip: number }): THREE.BufferGeometry {
  const rnd = prng(seed);
  const pos: number[] = [], col: number[] = [], wind: number[] = [], nrm: number[] = [];
  const rootC = lin(tone.root), tipC = lin(tone.tip);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5, L = len * (0.75 + rnd() * 0.5), w = L * 0.16;
    const c = Math.cos(a), s = Math.sin(a);
    const mid = [c * L * 0.5, L * 0.42, s * L * 0.5], tip = [c * L, L * 0.12, s * L];
    const side = [-s * w, 0, c * w];
    const v = [[0, 0.4, 0], [mid[0] + side[0], mid[1], mid[2] + side[2]], tip, [mid[0] - side[0], mid[1], mid[2] - side[2]]];
    const cs = [rootC, tipC.clone().multiplyScalar(0.9), tipC, tipC.clone().multiplyScalar(0.8)];
    for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const k of tri) {
      pos.push(v[k][0], v[k][1], v[k][2]); col.push(cs[k].r, cs[k].g, cs[k].b); wind.push(v[k][1] * 0.18 + (k === 2 ? 0.6 : 0)); nrm.push(c * 0.2, 0.96, s * 0.2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("wind", new THREE.Float32BufferAttribute(wind, 1));
  return g;
}

/** A STONE: a squat jittered icosphere, warm grey, lighter on top. Never moves in wind. */
export function stone(seed: number, w: number, h: number, tone = { base: 0x9d978b, dark: 0x6b665d, light: 0xc4bdb0 }): THREE.BufferGeometry {
  const rnd = prng(seed);
  const P = new Part();
  mass(P, rnd, V(0, h * 0.32, 0), w, h, w * (0.7 + rnd() * 0.3), 0, { base: lin(tone.base), dark: lin(tone.dark), light: lin(tone.light) }, V(0, -10, 0), 0, 0.42);
  return P.geometry(true);
}

/** REEDS for the water's edge: tall thin blades in a tight clump. */
export const reedClump = (seed: number): THREE.BufferGeometry => grassTuft(seed, 9, 15, 2.4, { root: 0x56683a, tip: 0xa7ad6a });
