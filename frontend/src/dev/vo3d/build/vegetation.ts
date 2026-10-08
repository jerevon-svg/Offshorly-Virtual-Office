// vo3d build — THE VEGETATION QUALITY LADDER: leaf cards, leaf atlas, crown normals, dissolve LOD.
//
// STYLIZED FROM A DISTANCE, LEAVES UP CLOSE. The campus's original crowns are faceted leaf MASSES — right for
// a silhouette, wrong at arm's length, where they read as polygon blobs. This module is the shared answer for
// every tree in VO, so species keep their own shape and differ only in how much detail they are given:
//
//   FAR   masses only — the silhouette, a few hundred triangles, batched with everything else
//   MID   a dark inner volume + layered clusters of large leaf cards over its skin
//   NEAR  the full hierarchy: inner volume, clusters at every twig tip, small sprays, readable single leaves
//
// LEAF CARDS are small alpha-tested quads cut from ONE painted atlas (sprays, dense clusters, small-leaf
// sprays, conifer needles), tinted per vertex by species and per cluster for hue/value variation, and lit with
// CROWN NORMALS (pointing out from the crown's centre, blended with the card's own) so a cluster shades as a
// soft volume instead of as a field of flat flickering planes. Alpha TEST, never blending: no sorting, no
// overdraw blow-up, and every surviving fragment written opaque.
//
// WIND has hierarchy through the per-vertex `wind` weight (exteriorShaders windByVertex): trunks 0, limbs a
// fraction of their height, leaf cards their cluster's height PLUS a per-corner flutter — so the outer foliage
// moves most and the canopy never wobbles as one object.
//
// LOD TRANSITIONS dissolve: each cut's materials take a screen-door `uDissolve` (an ordered-dither discard),
// so a swap fades over a few frames rather than popping, and the controller adds hysteresis.
import * as THREE from "three";
import { windByVertex } from "./exteriorShaders";

// ============================== THE LEAF ATLAS ==================================================================
/** atlas cells (4 × 2 of 256²) */
export const LEAF_CELL = { spray: 0, dense: 1, small: 2, pair: 3, long: 4, needles: 5, sprayB: 6, twig: 7 } as const;
export type LeafCell = (typeof LEAF_CELL)[keyof typeof LEAF_CELL];
const AW = 1024, AH = 512, CS = 256;
let atlas: THREE.CanvasTexture | null = null;

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
/** one leaf: a pointed ellipse with a lit tip, a darker base and edge, a light midrib (drawn in light neutral
 *  greens — the vertex colour carries the species' hue) */
function leaf(g: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, ang: number, r: () => number, needle = false): void {
  g.save(); g.translate(x, y); g.rotate(ang);
  if (needle) {
    g.strokeStyle = `hsl(${88 + r() * 14}, 32%, ${62 + r() * 16}%)`; g.lineWidth = wid; g.lineCap = "round";
    g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke(); g.restore(); return;
  }
  const grd = g.createLinearGradient(0, 0, len, 0);
  const l0 = 50 + r() * 10, l1 = 74 + r() * 10;
  grd.addColorStop(0, `hsl(${84 + r() * 10}, 38%, ${l0}%)`); grd.addColorStop(1, `hsl(${76 + r() * 12}, 44%, ${l1}%)`);
  g.fillStyle = grd;
  g.beginPath(); g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.38, -wid, len, 0);
  g.quadraticCurveTo(len * 0.38, wid, 0, 0);
  g.fill();
  g.strokeStyle = "rgba(60,80,40,0.35)"; g.lineWidth = 1.2; g.stroke();
  g.strokeStyle = "rgba(240,248,220,0.22)"; g.lineWidth = 1; g.beginPath(); g.moveTo(len * 0.06, 0); g.lineTo(len * 0.8, 0); g.stroke();
  // two pairs of side veins
  g.strokeStyle = "rgba(240,248,220,0.1)";
  for (const t of [0.35, 0.6]) for (const s of [-1, 1]) { g.beginPath(); g.moveTo(len * t, 0); g.lineTo(len * (t + 0.16), s * wid * 0.45); g.stroke(); }
  g.restore();
}
function stem(g: CanvasRenderingContext2D, pts: [number, number][], w: number): void {
  g.strokeStyle = "rgba(92,74,52,1)"; g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
}
function drawLeafCell(g: CanvasRenderingContext2D, cell: number, r: () => number): void {
  const C = CS / 2;
  switch (cell) {
    case LEAF_CELL.spray: case LEAF_CELL.sprayB: {
      // a spray: a curving stem with alternate leaves and a terminal leaf
      stem(g, [[C, 238], [C - 6, 170], [C + 4, 100], [C, 40]], 4);
      for (let k = 0; k < 9; k++) {
        const t = k / 9, y = 226 - t * 180, s = k % 2 ? 1 : -1;
        leaf(g, C + s * 2 - (t < 0.5 ? 4 : 0), y, 58 - t * 14, 19 - t * 3, s > 0 ? -0.5 - r() * 0.35 : Math.PI + 0.5 + r() * 0.35, r);
      }
      leaf(g, C, 52, 46, 15, -Math.PI / 2 + (r() - 0.5) * 0.3, r);
      return;
    }
    case LEAF_CELL.dense: {
      // a dense cluster: leaves radiating from a hidden centre, overlapping
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + r() * 0.4, d = 14 + r() * 26;
        leaf(g, C + Math.cos(a) * d, C + Math.sin(a) * d, 64 + r() * 22, 20 + r() * 6, a + (r() - 0.5) * 0.5, r);
      }
      for (let k = 0; k < 6; k++) { const a = r() * Math.PI * 2; leaf(g, C + Math.cos(a) * 8, C + Math.sin(a) * 8, 56, 18, a, r); }
      return;
    }
    case LEAF_CELL.small: {
      // a small-leaf spray: a branching twig carrying many little leaves
      stem(g, [[C, 240], [C, 120]], 3); stem(g, [[C, 170], [C - 60, 90]], 2.4); stem(g, [[C, 150], [C + 64, 70]], 2.4); stem(g, [[C, 120], [C - 10, 30]], 2.4);
      const tips: [number, number, number][] = [[C - 60, 90, -2.2], [C + 64, 70, -0.9], [C - 10, 30, -1.6]];
      for (const [tx, ty, ta] of tips) for (let k = 0; k < 8; k++) {
        const u = k / 8, x = C + (tx - C) * (0.35 + u * 0.65), y = 170 + (ty - 170) * (0.35 + u * 0.65), s = k % 2 ? 1 : -1;
        leaf(g, x, y, 30 + r() * 8, 10 + r() * 3, ta + s * (0.9 + r() * 0.4), r);
      }
      return;
    }
    case LEAF_CELL.pair: {
      // two big single leaves on a short stalk — the near-camera "you can see the leaf" card
      stem(g, [[C, 246], [C, 180]], 4);
      leaf(g, C, 184, 150, 46, -Math.PI / 2 - 0.35, r);
      leaf(g, C, 196, 120, 38, -Math.PI / 2 + 0.55, r);
      return;
    }
    case LEAF_CELL.long: {
      for (let k = 0; k < 11; k++) { const a = -Math.PI / 2 + (k - 5) * 0.2 + (r() - 0.5) * 0.1; leaf(g, C + (k - 5) * 4, 236, 190 + r() * 30, 13, a, r); }
      return;
    }
    case LEAF_CELL.needles: {
      stem(g, [[C, 248], [C, 20]], 4);
      for (let k = 0; k < 46; k++) { const t = k / 46, y = 236 - t * 210, s = k % 2 ? 1 : -1; leaf(g, C, y, 54 - t * 26, 3, s > 0 ? -0.6 : Math.PI + 0.6, r, true); }
      return;
    }
    case LEAF_CELL.twig: {
      stem(g, [[20, 236], [90, 170], [160, 120], [236, 60]], 5); stem(g, [[120, 146], [128, 60]], 3);
      for (let k = 0; k < 7; k++) { const x = 70 + k * 26, y = 186 - k * 19; leaf(g, x, y, 46, 15, -0.9 - (k % 2) * 1.4, r); }
      leaf(g, 128, 64, 50, 16, -Math.PI / 2, r);
      return;
    }
  }
}
export function leafAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const c = document.createElement("canvas"); c.width = AW; c.height = AH;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) { g.save(); g.translate((i % 4) * CS, Math.floor(i / 4) * CS); g.beginPath(); g.rect(0, 0, CS, CS); g.clip(); drawLeafCell(g, i, rng(i * 131 + 7)); g.restore(); }
  atlas = new THREE.CanvasTexture(c);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.generateMipmaps = true;
  return atlas;
}
const cellRect = (cell: number) => { const x = (cell % 4) * CS, y = Math.floor(cell / 4) * CS; return { u0: (x + 2) / AW, u1: (x + CS - 2) / AW, v0: 1 - (y + CS - 2) / AH, v1: 1 - (y + 2) / AH }; };

// ============================== MATERIALS =======================================================================
/** add a screen-door DISSOLVE to a material: `uDissolve` 1 = solid; t in (0,1) shows the fraction t of an
 *  ordered 4×4 dither; −t shows its complement (the outgoing level of a crossfade) */
export function dissolvable<T extends THREE.Material>(m: T, u: { value: number }): T {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uDissolve = u;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uDissolve;")
      .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>
      if (uDissolve < 0.999) {
        vec2 q = mod(floor(gl_FragCoord.xy), 4.0);
        float b = mod(q.x * 4.0 + q.y * 7.0 + q.x * q.y * 3.0, 16.0) / 16.0;
        // u ≥ 0: keep the pattern below u (fading IN) · u < 0: keep the complement (fading OUT) — no gaps, no doubling
        if (uDissolve >= 0.0 ? b >= uDissolve : b < -uDissolve) discard;
      }`);
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${key ? key() : ""}|dissolve`;
  return m;
}
/** THE LEAF-CARD MATERIAL: atlas-mapped, alpha-tested, double-sided WITHOUT the back-face normal flip (crown
 *  normals already point outward; flipping them would black out every card seen from behind), wind-driven */
export function leafCardMaterial(gain: { value: number }, time: { value: number }, flutter = 1.5): THREE.MeshStandardMaterial {
  // fully rough with a low environment response: thin cards seen edge-on otherwise pick up a white Fresnel sheen
  const m = new THREE.MeshStandardMaterial({ map: leafAtlas(), vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 1, metalness: 0, envMapIntensity: 0.35 });
  windByVertex(m, gain, time, flutter);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    // a surviving fragment is OPAQUE: alpha-tested cards must not leave partial alpha in the target (the night
    // post chain composites by alpha, which would wash every leaf edge to white)
    sh.fragmentShader = sh.fragmentShader.replace("#include <alphatest_fragment>", "#include <alphatest_fragment>\ndiffuseColor.a = 1.0;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", THREE.ShaderChunk.normal_fragment_begin.replace(/normal\s*\*=\s*faceDirection;/g, "").replace(/geometryNormal\s*\*=\s*faceDirection;/g, ""));
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${key ? key() : ""}|leafcard`;
  return m;
}

// ============================== THE CARD BUILDER ================================================================
export type LeafTone = { base: THREE.Color; dark: THREE.Color; light: THREE.Color };
export class CardBuilder {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly uv: number[] = [];
  private readonly c: number[] = [];
  private readonly w: number[] = [];
  count = 0;
  /** one card: centre, half-size, its own facing, its in-plane up, an atlas cell, colour, crown centre (normals),
   *  and the wind weight at its stem (its outer corners get `flutter` more) */
  card(at: THREE.Vector3, size: number, facing: THREE.Vector3, upHint: THREE.Vector3, cell: number, col: THREE.Color, core: THREE.Vector3, windW: number, flutter: number): void {
    const f = facing.clone().normalize();
    const right = new THREE.Vector3().crossVectors(upHint, f);
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(f, right).normalize();
    const h = size / 2;
    // the stem sits at the card's bottom edge (cells are drawn stem-down), so the card hangs off its twig end
    const base = at.clone().addScaledVector(up, -h * 0.2);
    const P = [base.clone().addScaledVector(right, -h), base.clone().addScaledVector(right, h), base.clone().addScaledVector(right, h).addScaledVector(up, 2 * h), base.clone().addScaledVector(right, -h).addScaledVector(up, 2 * h)];
    const r = cellRect(cell);
    const UV = [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]];
    const W = [windW, windW, windW + flutter, windW + flutter];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const q = P[k];
      const nrm = q.clone().sub(core).normalize().multiplyScalar(0.72).addScaledVector(f, 0.28).normalize();
      this.p.push(q.x, q.y, q.z); this.n.push(nrm.x, nrm.y, nrm.z); this.uv.push(UV[k][0], UV[k][1]);
      // a touch darker toward the crown's inside and underneath, lighter at the top corners
      const shade = k === 2 || k === 3 ? 1.06 : 0.9;
      this.c.push(col.r * shade, col.g * shade, col.b * shade); this.w.push(W[k]);
    }
    this.count++;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("wind", new THREE.Float32BufferAttribute(this.w, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export type ClusterOpts = {
  /** cards in the cluster and their size range */
  n: number; size: [number, number];
  /** which atlas cells, weighted by repetition */
  cells: readonly number[];
  tone: LeafTone;
  /** the crown's centre (normals point away from it) */
  core: THREE.Vector3;
  /** the wind weight at a point (the tree's own sway hierarchy), and the outer-corner flutter on top of it */
  wind: (p: THREE.Vector3) => number; flutter: number;
  /** 0 = random facings, 1 = every card faces straight out of the crown */
  outward?: number;
  /** squash of the cluster's volume (y) */
  flat?: number;
};
/** A LEAF CLUSTER round a point: `n` cards scattered through a small flattened volume, facing mostly outward
 *  and upward, varied in size, cell, hue and value — a cluster reads as leaves, never as one shape */
export function leafCluster(B: CardBuilder, rnd: () => number, at: THREE.Vector3, radius: number, o: ClusterOpts): void {
  const out = at.clone().sub(o.core).normalize();
  const hue = (rnd() - 0.5) * 0.05, val = 0.9 + rnd() * 0.2;
  for (let i = 0; i < o.n; i++) {
    const d = new THREE.Vector3(rnd() * 2 - 1, (rnd() * 2 - 1) * (o.flat ?? 0.7), rnd() * 2 - 1);
    if (d.lengthSq() > 1) d.multiplyScalar(1 / d.length());
    const p = at.clone().addScaledVector(d, radius).addScaledVector(out, radius * 0.25 * rnd());
    const rand = new THREE.Vector3(rnd() * 2 - 1, rnd() * 1.4 - 0.4, rnd() * 2 - 1).normalize();
    const facing = out.clone().multiplyScalar(o.outward ?? 0.55).add(rand.multiplyScalar(1 - (o.outward ?? 0.55))).add(new THREE.Vector3(0, 0.25, 0)).normalize();
    const upHint = d.clone().add(new THREE.Vector3(0, 0.6, 0)).normalize();
    const s = o.size[0] + (o.size[1] - o.size[0]) * rnd();
    const cell = o.cells[Math.floor(rnd() * o.cells.length)];
    // value: darker deeper inside the crown and underneath, lighter on top and outside
    const lift = THREE.MathUtils.clamp(0.5 + 0.5 * d.y, 0, 1) * 0.6 + THREE.MathUtils.clamp(out.y, 0, 1) * 0.4;
    const col = o.tone.dark.clone().lerp(o.tone.base, 0.45 + 0.4 * lift).lerp(o.tone.light, Math.max(0, lift - 0.55) * 0.9);
    col.offsetHSL(hue + (rnd() - 0.5) * 0.02, 0, 0).multiplyScalar(val * (0.92 + rnd() * 0.16));
    B.card(p, s, facing, upHint, cell, col, o.core, o.wind(p), o.flutter * (0.6 + rnd() * 0.8));
  }
}

/** DRESS ANY CANOPY in leaves (the campus rollout path): sample the canopy mesh's surface, area-weighted, and
 *  grow a cluster at each sample just outside it. Works for every species' existing near cut unchanged. */
export function dressCanopy(canopy: THREE.BufferGeometry, rnd: () => number, clusters: number, o: Omit<ClusterOpts, "core">, radius: number): THREE.BufferGeometry {
  const pos = canopy.getAttribute("position") as THREE.BufferAttribute;
  const tris = pos.count / 3, area: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), box = new THREE.Box3().setFromBufferAttribute(pos);
  let total = 0;
  for (let i = 0; i < tris; i++) { a.fromBufferAttribute(pos, i * 3); b.fromBufferAttribute(pos, i * 3 + 1); c.fromBufferAttribute(pos, i * 3 + 2); total += new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length() / 2; area.push(total); }
  const core = box.getCenter(new THREE.Vector3());
  const B = new CardBuilder();
  for (let k = 0; k < clusters; k++) {
    const x = rnd() * total;
    let lo = 0, hi = area.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (area[m] < x) lo = m + 1; else hi = m; }
    a.fromBufferAttribute(pos, lo * 3); b.fromBufferAttribute(pos, lo * 3 + 1); c.fromBufferAttribute(pos, lo * 3 + 2);
    let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const p = a.clone().addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), v);
    const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    if (n.dot(p.clone().sub(core)) < 0) n.negate();
    leafCluster(B, rnd, p.addScaledVector(n, radius * 0.35), radius, { ...o, core });
  }
  return B.geometry();
}

/** pull a canopy's masses in toward its centre (they become the dark inner volume behind the leaf cards) */
export function shrinkToward(g: THREE.BufferGeometry, k: number, darken = 0.78): THREE.BufferGeometry {
  const out = g.clone();
  const pos = out.getAttribute("position") as THREE.BufferAttribute, col = out.getAttribute("color") as THREE.BufferAttribute | undefined;
  const core = new THREE.Box3().setFromBufferAttribute(pos).getCenter(new THREE.Vector3());
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, core.x + (pos.getX(i) - core.x) * k, core.y + (pos.getY(i) - core.y) * k, core.z + (pos.getZ(i) - core.z) * k);
  if (col) for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * darken, col.getY(i) * darken, col.getZ(i) * darken);
  out.computeVertexNormals();
  return out;
}

// ============================== THE LOD CONTROLLER =============================================================
export type VegLevel = "near" | "mid" | "far";
/** picks a level from the object's height in pixels with hysteresis, and dissolves between levels */
export class VegLod {
  level: VegLevel = "far";
  private from: VegLevel | null = null;
  private t = 1;
  private readonly groups: Record<VegLevel, THREE.Object3D>;
  private readonly fades: Record<VegLevel, { value: number }>;
  /** px thresholds to go UP to mid / near (down is 15% lower) */
  private readonly up: { mid: number; near: number };
  private readonly fadeS: number;
  constructor(groups: Record<VegLevel, THREE.Object3D>, fades: Record<VegLevel, { value: number }>, up = { mid: 240, near: 720 }, fadeS = 0.35) {
    this.groups = groups; this.fades = fades; this.up = up; this.fadeS = fadeS;
    for (const l of ["near", "mid", "far"] as const) { groups[l].visible = l === this.level; fades[l].value = 1; }
  }
  private want(px: number): VegLevel {
    const k = 0.85, L = this.level;
    if (L === "far") return px > this.up.near ? "near" : px > this.up.mid ? "mid" : "far";
    if (L === "mid") return px > this.up.near ? "near" : px < this.up.mid * k ? "far" : "mid";
    return px < this.up.mid * k ? "far" : px < this.up.near * k ? "mid" : "near";
  }
  update(px: number, dt: number, force: VegLevel | null = null): void {
    const w = force ?? this.want(px);
    if (w !== this.level && this.t >= 1) { this.from = this.level; this.level = w; this.t = 0; }
    if (this.t < 1) this.t = Math.min(1, this.t + dt / this.fadeS);
    for (const l of ["near", "mid", "far"] as const) {
      const on = l === this.level ? this.t : l === this.from ? 1 - this.t : 0;
      this.groups[l].visible = on > 0.001;
      this.fades[l].value = l === this.level ? (this.t >= 1 ? 1 : Math.max(0.02, this.t)) : -this.t;
    }
    if (this.t >= 1) this.from = null;
  }
}
