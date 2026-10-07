// vo3d build — THE AI LAB'S HERO TREE: trunk, buttress roots, traversal limbs, crown limbs and a layered canopy.
//
// THE CAMPUS'S OWN LANGUAGE, AT HERO SCALE. Bark tubes and leaf masses are build/exteriorFoliage's primitives —
// grooved, parallel-transported limbs and jittered, crown-lit icosphere masses — so this tree belongs to the same
// world as every tree on the lawn, just grown enormous. The trunk alone is lofted here, because it has to do two
// jobs no stock tube can: spread into BUTTRESSES that run down into each structural root, and stay a clean 27-unit
// column on the climb face (70°), where a MonkeyAgent's hands and feet meet the bark (world/ailabV2 CLIMB).
//
// EVERY TRAVERSAL LIMB IS BUILT ON ITS WALK LINE. The west limb, the south-west branch and the Toucan's branch are
// tubes whose TOP is exactly the line the agents walk (world/ailabV2), at a radius ≥ the 4.5 the locomotion needs.
//
// THE CANOPY lives inside the CANOPY envelopes the sightline tests read: ~250 leaf clusters, each three or four
// masses round a twig end, denser and smaller at the crown's skin, with a few large core masses so it never reads
// hollow. Wind weights scale with height, so the crown sways and the trunk stays planted.
//
// THREE CUTS on the shared vegetation ladder (build/vegetation): NEAR (full hierarchy: twigs, collars, leaf
// clusters at every twig tip and over the crown's skin, readable single leaves), MID (major + secondary limbs,
// fewer, larger leaf cards over a dark inner volume) and FAR (the silhouette in a few smooth masses).
import * as THREE from "three";
import { Part, prng, lin } from "./exteriorGeo";
import { BARK, mass, tube, type Leaf } from "./exteriorFoliage";
import { CardBuilder, LEAF_CELL, leafCluster, type LeafTone } from "./vegetation";
import { CANOPY, CLIMB, RESIDENCE, ROOTS, ROOT_H, SW_BRANCH, TOUCAN_LIMB, TREE, TRUNK, WEST_LIMB } from "../world/ailabV2";
import type { V3 } from "../world/monkeyTraversal";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const tv = (p: V3) => V(p.x, p.y, p.z);
const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));
const DEG = Math.PI / 180;
const LEAF: Leaf = { base: lin(0x5c8d3f), dark: lin(0x2b4f24), light: lin(0x9cc463) };
const LEAF_B: Leaf = { base: lin(0x6a9845), dark: lin(0x325a28), light: lin(0xb0cf6e) };
const MOSS = lin(0x6c8a3a), MOSS_DARK = lin(0x4a6a2c);

/** the trunk's spine: a vertical climbable column to the climb top, then leaning north into the crown */
const SPINE: readonly [number, number, number, number][] = [
  // y, x, z, radius
  [-3, 740, -735, 41], [4, 740, -735, 34], [12, 740, -735, 30], [22, 740, -735, 28], [34, 740, -735, 27.2],
  [48, 740, -735, 27], [62, 740, -735, 27], [TRUNK.climbTop, 740, -735, 27], [92, 741, -739, 25.5],
  [TRUNK.midY, 742, -745, TRUNK.rMid], [132, 743, -756, 20.5], [154, 744, -770, 18], [TRUNK.topY, 745, -786, TRUNK.rTop], [196, 745, -800, 11],
];

/** THE TRUNK LOFT: rings round the spine whose radius carries buttresses into every root, bark furrows, a smooth
 *  climb face, and moss on the shaded north side and low down. */
function trunk(P: Part, seg: number, detail: boolean): void {
  const bark = lin(BARK.base), dark = lin(BARK.dark), light = lin(BARK.light);
  const rings: number[][] = [];
  const rnd = prng(4242);
  const knots = Array.from({ length: detail ? 16 : 6 }, () => ({ th: rnd() * Math.PI * 2, y: 16 + rnd() * 165, s: 0.05 + rnd() * 0.07 }));
  // the spine resampled smoothly (Catmull-Rom through SPINE) so the taper and the lean are continuous
  const sub = detail ? 4 : 1;
  const steps: [number, number, number, number][] = [];
  for (let i = 0; i < SPINE.length - 1; i++) for (let k = 0; k < sub; k++) {
    const t = k / sub, p0 = SPINE[Math.max(0, i - 1)], p1 = SPINE[i], p2 = SPINE[i + 1], p3 = SPINE[Math.min(SPINE.length - 1, i + 2)];
    const cr = (j: number) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t * t * t);
    steps.push([cr(0), cr(1), cr(2), cr(3)]);
  }
  steps.push([...SPINE[SPINE.length - 1]]);
  for (const [y, cx, cz, R] of steps) {
    const ring: number[] = [];
    for (let k = 0; k < seg; k++) {
      const th = (k / seg) * Math.PI * 2; // 0 = +x, increasing toward +z (south), like world/ailabV2 polar
      // the climb face stays a clean column: buttresses and furrows fade out within ±32° of it
      const dc = Math.abs(Math.atan2(Math.sin(th - CLIMB.deg * DEG), Math.cos(th - CLIMB.deg * DEG)));
      const face = 1 - Math.max(0, 1 - dc / (32 * DEG));
      // BUTTRESSES: a lobe toward each root, strong at the foot, gone by ~24 up
      let flare = 0;
      for (const [a] of ROOTS) {
        const d = Math.abs(Math.atan2(Math.sin(th - a * DEG), Math.cos(th - a * DEG)));
        flare += Math.pow(Math.max(0, Math.cos(Math.min(Math.PI / 2, d * 2.4))), 3) * 0.62;
      }
      flare *= Math.pow(Math.max(0, 1 - (y + 3) / 26), 1.5);
      // FURROWS: a twisting ridge pattern, and a few KNOTS (bulges) up the trunk
      const g = detail ? Math.pow(0.5 + 0.5 * Math.cos(13 * th + y * 0.045 + Math.sin(y * 0.11) * 0.8), 3) : 0;
      let knot = 0;
      for (const kn of knots) { const dth = Math.atan2(Math.sin(th - kn.th), Math.cos(th - kn.th)); knot += kn.s * Math.exp(-(dth * dth) / 0.03 - ((y - kn.y) ** 2) / 40); }
      // close-range BARK: a second, finer ridge set and small irregular plates (none on the climb face)
      const g2 = detail ? Math.pow(0.5 + 0.5 * Math.cos(31 * th - y * 0.09 + Math.sin(y * 0.31 + th * 3) * 0.9), 4) : 0;
      const plate = detail ? (Math.sin(th * 23 + y * 0.53) * Math.sin(th * 7 - y * 0.21)) * 0.012 : 0;
      const r = R * (1 + (flare + knot + plate) * face - (0.07 * g + 0.025 * g2) * (0.4 + 0.6 * face));
      const p = V(cx + Math.cos(th) * r, y, cz + Math.sin(th) * r);
      // colour: furrows dark, ridges lighter up high, MOSS on the north (−z) side and on the buttresses' foot
      let col = mix(bark, dark, g * 0.7 + (detail ? 0.25 * Math.max(0, Math.sin(th * 23 + y * 0.53)) * 0.6 : 0));
      col = mix(col, light, (1 - g) * 0.22 * Math.min(1, y / 120));
      const north = Math.max(0, -Math.sin(th));
      const moss = Math.min(1, north * 0.85 * Math.max(0, 1 - y / 90) + flare * 0.6);
      col = mix(col, mix(MOSS_DARK, MOSS, rnd()), moss * 0.75);
      ring.push(P.v(p.x, p.y, p.z, col));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; P.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]); } // outward-facing
}

/** a limb along a list of points with radii (exteriorFoliage tube, grooved) */
const branch = (P: Part, pts: THREE.Vector3[], radii: number[], seg: number, grooves = 4) => tube(P, pts, radii, seg, { grooves, depth: 0.12, twist: 0.3 });

/** a TRAVERSAL limb: its TOP is the walk line, so the axis runs a radius below each point */
function walkLimb(P: Part, line: readonly V3[], radii: number[], seg: number): void {
  branch(P, line.map((p, i) => tv(p).add(V(0, -radii[i] * 0.93, 0))), radii, seg, 5);
}

type Tip = { at: THREE.Vector3; r: number; env: number };
/** FORKING: a limb toward `to`, splitting into `n` children at 60%, `depth` levels — returns the twig ends */
function forkLimb(P: Part, rnd: () => number, from: THREE.Vector3, to: THREE.Vector3, r0: number, depth: number, env: number, seg: number, tips: Tip[]): void {
  const dir = to.clone().sub(from), L = dir.length();
  const mid = from.clone().addScaledVector(dir, 0.6).add(V((rnd() - 0.5) * L * 0.08, L * 0.05, (rnd() - 0.5) * L * 0.08));
  const r1 = r0 * 0.62;
  // the COLLAR: the limb swells where it leaves its parent, so it grows out of it rather than sticking in
  const into = from.clone().addScaledVector(dir.clone().normalize(), -Math.min(4, r0));
  branch(P, [into, from.clone().lerp(mid, 0.5).add(V(0, L * 0.03, 0)), mid], [r0 * 1.35, (r0 + r1) / 2, r1], seg, depth > 1 ? 4 : 0);
  if (depth <= 0) { tips.push({ at: mid, r: r1, env }); return; }
  const n = depth >= 3 ? 3 : depth >= 2 ? 3 : 2;
  const e = CANOPY[env];
  for (let k = 0; k < n; k++) {
    // a child aims at a point inside its envelope, spread round the parent's direction
    const a = rnd() * Math.PI * 2, u = 0.45 + rnd() * 0.5;
    const target = V(e.x + Math.cos(a) * e.r * u, e.y + (rnd() - 0.3) * e.ry * 0.7, e.z + Math.sin(a) * e.r * u);
    const len = mid.distanceTo(target) * (depth >= 3 ? 0.6 : depth >= 2 ? 0.75 : 0.9);
    const end = mid.clone().addScaledVector(target.clone().sub(mid).normalize(), len);
    forkLimb(P, rnd, mid, end, Math.max(0.7, r1 * 0.78), depth - 1, env, Math.max(4, seg - 2), tips);
  }
}

const inBox = (p: THREE.Vector3, b: { x0: number; x1: number; z0: number; z1: number; ridge: number }, pad: number) =>
  p.x > b.x0 - pad && p.x < b.x1 + pad && p.z > b.z0 - pad && p.z < b.z1 + pad && p.y < b.ridge + pad;

/** THE SWAY HIERARCHY (a per-vertex wind weight): the trunk and everything an agent stands on is still; the
 *  crown limbs move a little with height and distance from the spine; the foliage most. */
export const crownWind = (p: THREE.Vector3, k = 1) => Math.max(0, p.y - 95) * 0.0085 * k * Math.min(1, Math.hypot(p.x - 744, p.z + 775) / 45);
function windBark(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute("position"), w = new Float32Array(pos.count), q = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) w[i] = crownWind(q.fromBufferAttribute(pos, i), 0.45);
  g.setAttribute("wind", new THREE.BufferAttribute(w, 1));
  return g;
}
function windCore(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute("position"), w = new Float32Array(pos.count), q = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) w[i] = crownWind(q.fromBufferAttribute(pos, i), 0.85);
  g.setAttribute("wind", new THREE.BufferAttribute(w, 1));
  return g;
}

export type TreeCut = { bark: THREE.BufferGeometry; core: THREE.BufferGeometry; cards: THREE.BufferGeometry | null };
const TONE: LeafTone = { base: lin(0x5f9140), dark: lin(0x2a4f23), light: lin(0x9fc45c) };
const TONE_B: LeafTone = { base: lin(0x6c9c47), dark: lin(0x305927), light: lin(0xabcb66) };

/** THE TREE: near / mid / far cuts on the vegetation ladder. */
export function buildLabTree(): Record<"near" | "mid" | "far", TreeCut> {
  const make = (lvl: "near" | "mid" | "far") => {
    const detail = lvl !== "far", near = lvl === "near";
    const rnd = prng(lvl === "near" ? 9001 : lvl === "mid" ? 9003 : 9002);
    const B = new Part(), L = new Part();
    const seg = near ? 40 : detail ? 28 : 14, lseg = near ? 12 : detail ? 9 : 6;
    trunk(B, seg, detail);
    // ---- the STRUCTURAL ROOTS: out of each buttress, arching, then diving into the soil; secondaries off them
    for (const [a, len] of ROOTS) {
      const th = a * DEG, d = V(Math.cos(th), 0, Math.sin(th));
      const p0 = V(TREE.x, ROOT_H * 0.55, TREE.z).addScaledVector(d, TRUNK.r - 6);
      const p1 = V(TREE.x, ROOT_H * 0.62, TREE.z).addScaledVector(d, TRUNK.r + len * 0.35);
      const p2 = V(TREE.x, ROOT_H * 0.3, TREE.z).addScaledVector(d, TRUNK.r + len * 0.72).add(V(-d.z, 0, d.x).multiplyScalar((rnd() - 0.5) * 10));
      const p3 = V(TREE.x, -3, TREE.z).addScaledVector(d, TRUNK.r + len).add(V(-d.z, 0, d.x).multiplyScalar((rnd() - 0.5) * 14));
      branch(B, [p0, p1, p2, p3], [ROOT_H * 0.62, ROOT_H * 0.5, ROOT_H * 0.32, 1.6], lseg, 3);
      if (detail) for (const side of [-1, 1]) {
        const s0 = p1.clone().lerp(p2, 0.4), sd = d.clone().applyAxisAngle(V(0, 1, 0), side * (0.5 + rnd() * 0.4));
        branch(B, [s0, s0.clone().addScaledVector(sd, len * 0.28).setY(ROOT_H * 0.18), s0.clone().addScaledVector(sd, len * 0.5).setY(-2.5)], [ROOT_H * 0.24, ROOT_H * 0.15, 1], 7, 0);
      }
      if (detail) mass(L, rnd, p1.clone().add(V(0, ROOT_H * 0.45, 0)), 6, 1.6, 6, 0, { base: MOSS, dark: MOSS_DARK, light: lin(0x8aa850) }, p1, 0);
    }
    // ---- the TRAVERSAL LIMBS, built on their walk lines (still: no wind) ----
    walkLimb(B, [v(712, 48, -727), ...WEST_LIMB.path.slice(1)], [9.5, 8, 7, 6.5, 6], lseg);
    walkLimb(B, [v(712, 46, -690), ...SW_BRANCH.path.slice(1, 4), v(608, -2, -630)], [9, 8, 7, 6.6, 5.5], lseg);
    branch(B, [tv(TOUCAN_LIMB.from), tv(TOUCAN_LIMB.mid), tv(TOUCAN_LIMB.tip)], [7.5, 5.8, TOUCAN_LIMB.r], lseg, 4);
    if (detail) for (const [line, n] of [[WEST_LIMB.path, 4], [SW_BRANCH.path.slice(1, 3), 2]] as const) {
      for (let k = 0; k < n; k++) {
        const i = 1 + (k % (line.length - 1)), p = tv(line[Math.min(i, line.length - 1)]).add(V(0, -7, 0));
        const side = k % 2 ? 1 : -1;
        branch(B, [p, p.clone().add(V(side * 5, -4, side * 9)), p.clone().add(V(side * 9, -2, side * 16))], [2.6, 1.6, 0.8], 6, 0);
      }
    }
    // ---- THE CROWN LIMBS: from the upper trunk out to every envelope; NEAR forks three times to twig scale ----
    const tips: Tip[] = [];
    const starts = [[118, 0], [150, 1], [160, 2], [180, 3], [140, 4], [130, 5]];
    CANOPY.forEach((e, i) => {
      const [y] = starts[i];
      const sp = SPINE.reduce((best, s) => (Math.abs(s[0] - y) < Math.abs(best[0] - y) ? s : best));
      const from = V(sp[1], y, sp[2]).add(V(e.x - sp[1], 0, e.z - sp[2]).normalize().multiplyScalar(sp[3] * 0.6));
      const to = V(e.x, e.y - e.ry * 0.35, e.z);
      forkLimb(B, rnd, from, to, Math.min(13, sp[3] * 0.55), near ? 3 : detail ? 2 : 1, i, near ? 12 : detail ? 9 : 6, tips);
    });
    // ---- THE CANOPY ----
    const core = V(TREE.x, 200, -850);
    const clear = (p: THREE.Vector3, s: number) => !inBox(p, RESIDENCE.main, s * 0.6 + 4) && !inBox(p, RESIDENCE.west, s * 0.6 + 4) && !inBox(p, RESIDENCE.east, s * 0.6 + 4);
    const C = detail ? new CardBuilder() : null;
    const wind = (p: THREE.Vector3) => crownWind(p, 1);
    CANOPY.forEach((e, i) => {
      const leaf = i % 2 ? LEAF_B : LEAF, tone = i % 2 ? TONE_B : TONE;
      if (!detail) {
        // FAR: the silhouette — a dozen smooth masses filling the envelope, broken at the rim
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2 + rnd();
          const c = k === 0 ? V(e.x, e.y + e.ry * 0.12, e.z) : V(e.x + Math.cos(a) * e.r * 0.58, e.y + (rnd() - 0.4) * e.ry * 0.55, e.z + Math.sin(a) * e.r * 0.58);
          const rr = k === 0 ? 0.62 : 0.36 + rnd() * 0.1;
          if (clear(c, e.r * rr)) mass(L, rnd, c, e.r * rr, e.ry * (rr + 0.1), e.r * rr, 1, leaf, core, 0, 0.3);
        }
        return;
      }
      // THE INNER VOLUME: a few dark masses well inside the envelope — depth behind the leaves, and no sky
      // through the middle of the crown; the leaves, not these, make the surface
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + rnd();
        const c = k === 0 ? V(e.x, e.y + e.ry * 0.1, e.z) : V(e.x + Math.cos(a) * e.r * 0.36, e.y + (rnd() - 0.45) * e.ry * 0.36, e.z + Math.sin(a) * e.r * 0.36);
        if (clear(c, e.r * 0.36)) mass(L, rnd, c, e.r * 0.33, e.ry * 0.4, e.r * 0.33, 0, { base: leaf.dark.clone().multiplyScalar(0.62), dark: leaf.dark.clone().multiplyScalar(0.42), light: leaf.dark.clone().lerp(leaf.base, 0.3).multiplyScalar(0.8) }, core, 0, 0.28);
      }
      // THE INTERIOR SHELL: shadowed leaves between the inner volume and the skin, so the crown's depth is
      // leaves all the way in rather than a smooth core showing through
      for (let k = 0, m = Math.round(e.r * (near ? 0.6 : 0.3)); k < m; k++) {
        const a = rnd() * Math.PI * 2, vv = Math.acos(1 - 2 * rnd()), u = 0.32 + rnd() * 0.3;
        const c = V(e.x + Math.sin(vv) * Math.cos(a) * e.r * u, e.y + Math.cos(vv) * e.ry * u, e.z + Math.sin(vv) * Math.sin(a) * e.r * u);
        if (!clear(c, 12)) continue;
        const shade = { base: tone.dark.clone().lerp(tone.base, 0.35), dark: tone.dark.clone().multiplyScalar(0.7), light: tone.base.clone().multiplyScalar(0.8) };
        leafCluster(C!, rnd, c, near ? 11 : 15, { n: near ? 14 : 8, size: near ? [10, 15] : [18, 24], cells: [LEAF_CELL.dense, LEAF_CELL.spray], tone: shade, core, wind, flutter: 0.3, outward: 0.3 });
      }
      // LEAF CLUSTERS over the crown's skin — denser on top and the sides, gaps left between them
      const n = Math.round(e.r * (near ? 1.7 : 0.95));
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2, vv = Math.acos(1 - 2 * Math.pow(rnd(), 0.92)), u = 0.62 + rnd() * 0.34;
        const c = V(e.x + Math.sin(vv) * Math.cos(a) * e.r * u, e.y + Math.cos(vv) * e.ry * u * 0.95, e.z + Math.sin(vv) * Math.sin(a) * e.r * u);
        const r = near ? 9 + rnd() * 7 : 13 + rnd() * 7;
        if (!clear(c, r) || rnd() < 0.08) continue; // ~12% left out: the canopy's natural gaps
        leafCluster(C!, rnd, c, r, near
          ? { n: 18 + Math.floor(rnd() * 8), size: [9, 15], cells: [LEAF_CELL.dense, LEAF_CELL.spray, LEAF_CELL.dense, LEAF_CELL.sprayB, LEAF_CELL.small, LEAF_CELL.dense], tone, core, wind, flutter: 0.55, outward: 0.55 }
          : { n: 13 + Math.floor(rnd() * 5), size: [18, 26], cells: [LEAF_CELL.dense, LEAF_CELL.dense, LEAF_CELL.spray], tone, core, wind, flutter: 0.45, outward: 0.65 });
      }
    });
    // THE TWIG ENDS carry leaves: a cluster on every fork tip (NEAR: with big single leaves for close views)
    for (const t of tips) if (C && clear(t.at, 8)) {
      const tone = t.env % 2 ? TONE_B : TONE;
      leafCluster(C, rnd, t.at.clone().add(V(0, 2, 0)), near ? 7 : 11, near
        ? { n: 18, size: [8, 13], cells: [LEAF_CELL.twig, LEAF_CELL.pair, LEAF_CELL.spray, LEAF_CELL.small], tone, core, wind, flutter: 0.6, outward: 0.4 }
        : { n: 8, size: [16, 22], cells: [LEAF_CELL.dense, LEAF_CELL.spray], tone, core, wind, flutter: 0.5, outward: 0.55 });
    }
    return { bark: windBark(B.geometry(false)), core: windCore(L.geometry(true)), cards: C ? C.geometry() : null };
  };
  return { near: make("near"), mid: make("mid"), far: make("far") };
}
const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
