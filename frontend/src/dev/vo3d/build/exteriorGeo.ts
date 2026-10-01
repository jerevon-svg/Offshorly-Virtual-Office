// vo3d build — VERTEX-COLOURED GEOMETRY FOR THE EXTERIOR. The one idiom the polish pass uses to put DETAIL
// on screen without new draw calls: every small piece (a kerb stone, a scaffold tube, a plank, a bark
// groove) is painted with its colour as a vertex attribute and merged into ONE geometry per material, so a
// whole construction yard or a whole kerb line is a single submission whatever it holds.
//
// Every geometry this file hands out has exactly position + normal + color (and, where asked, `wind`), so
// any two of them merge, and any of them can join a BatchedMesh beside the others.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** a small deterministic PRNG. The exterior's LCG stream (world/campus scatterStep) is shared with the
 *  ground model and must never be consumed by new decoration, so everything added by the polish pass draws
 *  from its own seeded stream instead. */
export function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = new THREE.Color();
/** an sRGB hex as linear rgb (what a vertex colour attribute holds) */
export const lin = (hex: number): THREE.Color => new THREE.Color().setHex(hex);

/** Prepare any three geometry for merging: non-indexed, transformed, painted, attributes reduced to the
 *  shared layout. `colour` paints every vertex; omitted, the geometry must already carry a colour. */
export function painted(src: THREE.BufferGeometry, m: THREE.Matrix4 | null, colour?: THREE.Color | number, wind?: number): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "color" && k !== "wind") g.deleteAttribute(k);
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  if (m) g.applyMatrix4(m);
  const n = g.getAttribute("position").count;
  if (colour !== undefined || !g.getAttribute("color")) {
    const c = colour === undefined ? C.setHex(0xffffff) : typeof colour === "number" ? C.setHex(colour) : colour;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  }
  if (wind !== undefined) g.setAttribute("wind", new THREE.BufferAttribute(new Float32Array(n).fill(wind), 1));
  return g;
}

const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
/** a placement matrix: translate, then yaw (about +y), pitch (about local x), roll (about local z), scale */
export function place(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return M4.compose(P.set(x, y, z), Q.setFromEuler(E.set(pitch, yaw, roll, "YXZ")), S.set(sx, sy, sz)).clone();
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const cylCache = new Map<number, THREE.CylinderGeometry>();
const unitCyl = (seg: number) => {
  let g = cylCache.get(seg);
  if (!g) cylCache.set(seg, (g = new THREE.CylinderGeometry(1, 1, 1, seg, 1)));
  return g;
};

/** COLLECTS PAINTED PIECES and merges them into one geometry. */
export class ColorBaker {
  private readonly parts: THREE.BufferGeometry[] = [];
  get empty(): boolean { return this.parts.length === 0; }
  add(g: THREE.BufferGeometry, m: THREE.Matrix4 | null, colour?: THREE.Color | number, wind?: number): this {
    this.parts.push(painted(g, m, colour, wind));
    return this;
  }
  /** a box standing on y0 (its base), centred on x/z, yawed */
  box(w: number, h: number, d: number, x: number, y0: number, z: number, colour: number | THREE.Color, yaw = 0, pitch = 0, roll = 0): this {
    return this.add(unitBox, place(x, y0 + h / 2, z, yaw, pitch, roll, w, h, d), colour);
  }
  /** a box centred at (x, y, z) — for pieces that are tilted, where "standing on" means nothing */
  boxAt(w: number, h: number, d: number, x: number, y: number, z: number, colour: number | THREE.Color, yaw = 0, pitch = 0, roll = 0): this {
    return this.add(unitBox, place(x, y, z, yaw, pitch, roll, w, h, d), colour);
  }
  /** an upright cylinder standing on y0 */
  cyl(r: number, h: number, x: number, y0: number, z: number, colour: number | THREE.Color, seg = 8, rTop = r): this {
    const g = rTop === r ? unitCyl(seg) : new THREE.CylinderGeometry(rTop / r, 1, 1, seg, 1);
    return this.add(g, place(x, y0 + h / 2, z, 0, 0, 0, r, h, r), colour);
  }
  /** a tube between two points (scaffold, rails, rebar): a cylinder of radius r from a to b */
  tube(a: THREE.Vector3Like, b: THREE.Vector3Like, r: number, colour: number | THREE.Color, seg = 5): this {
    const va = new THREE.Vector3(a.x, a.y, a.z), vb = new THREE.Vector3(b.x, b.y, b.z);
    const len = va.distanceTo(vb);
    if (len < 1e-4) return this;
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    return this.add(unitCyl(seg), new THREE.Matrix4().compose(mid, q, new THREE.Vector3(r, len, r)), colour);
  }
  /** the merged geometry (null when nothing was added) */
  geometry(): THREE.BufferGeometry | null {
    if (!this.parts.length) return null;
    const hasWind = this.parts.some((p) => p.getAttribute("wind"));
    if (hasWind) for (const p of this.parts) if (!p.getAttribute("wind")) p.setAttribute("wind", new THREE.BufferAttribute(new Float32Array(p.getAttribute("position").count), 1));
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    return g;
  }
}

/** An INDEXED part under construction (smooth tubes, clumps): vertices with colour and a wind weight, then
 *  normals computed across shared vertices, then un-indexed for merging. */
export class Part {
  readonly p: number[] = [];
  readonly c: number[] = [];
  readonly w: number[] = [];
  readonly i: number[] = [];
  v(x: number, y: number, z: number, col: THREE.Color, wind = 0): number {
    this.p.push(x, y, z);
    this.c.push(col.r, col.g, col.b);
    this.w.push(wind);
    return this.p.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void { this.i.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.i.push(a, b, c, a, c, d); }
  geometry(withWind: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    if (withWind) g.setAttribute("wind", new THREE.Float32BufferAttribute(this.w, 1));
    g.setIndex(this.i);
    g.computeVertexNormals();
    const out = g.toNonIndexed();
    g.dispose();
    return out;
  }
}

/** merge already-painted geometries of one layout (all with or all without `wind`) */
export function mergePainted(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const hasWind = geos.some((p) => p.getAttribute("wind"));
  if (hasWind) for (const p of geos) if (!p.getAttribute("wind")) p.setAttribute("wind", new THREE.BufferAttribute(new Float32Array(p.getAttribute("position").count), 1));
  const g = mergeGeometries(geos, false);
  if (!g) throw new Error("exteriorGeo: merge failed");
  return g;
}

export const triCount = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute("position").count) / 3;
