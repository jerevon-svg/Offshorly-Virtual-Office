// vo3d build — shared geometry helpers (promoted from designRoom3d/build.ts). Stateless apart from the
// deterministic seed, which callers reset per build so rebuilds are identical.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Facing, Rect } from "../core/coords";

export type BoxSpec = Rect & { h: number };

// ---- shared geometry helpers ------------------------------------------------------------
export const sphereGeo = new THREE.IcosahedronGeometry(1, 1); // chair casters only
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 20);

let seed = 7;
export function rnd(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296; // deterministic LCG: every rebuild is identical
  return seed / 4294967296;
}
export function resetSeed(): void {
  seed = 7;
}

export function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.castShadow = cast;
  o.receiveShadow = receive;
  return o;
}

/** Rounded box with its base at y0, centred on (cx, cz). */
export function rbox(w: number, h: number, d: number, m: THREE.Material, cx: number, y0: number, cz: number, radius = 0.8, segments = 2): THREE.Mesh {
  const r = Math.min(radius, w / 2, h / 2, d / 2);
  const g = r > 0.05 ? new RoundedBoxGeometry(w, h, d, segments, r) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(cx, y0 + h / 2, cz);
  return shadowed(mesh);
}
export function boxFromSpec(b: BoxSpec, m: THREE.Material, radius = 0.8, y0 = 0): THREE.Mesh {
  return rbox(b.w, b.h, b.d, m, b.x + b.w / 2, y0, b.z + b.d / 2, radius);
}
export function cyl(r: number, h: number, m: THREE.Material, cx: number, y0: number, cz: number, rTop = r): THREE.Mesh {
  const mesh = new THREE.Mesh(rTop === r ? unitCyl : new THREE.CylinderGeometry(rTop / r, 1, 1, 20), m);
  mesh.scale.set(r, h, r);
  mesh.position.set(cx, y0 + h / 2, cz);
  return shadowed(mesh);
}
/** Revolved profile (points are [radius, height]); base at y0. */
export function lathe(profile: [number, number][], m: THREE.Material, cx: number, y0: number, cz: number, segments = 24): THREE.Mesh {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, segments), m);
  mesh.position.set(cx, y0, cz);
  return shadowed(mesh);
}
/** Extruded shape lying flat (shape y → world z), thickness `t`, base at y0. */
export function slab(shape: THREE.Shape, t: number, m: THREE.Material, y0: number, bevel = 0.6): THREE.Mesh {
  const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel * 0.7, bevelSegments: 2, curveSegments: 12 });
  const mesh = new THREE.Mesh(g, m);
  mesh.rotation.x = -Math.PI / 2; // shape +y → world -z … flip below so shape +y → world +z
  mesh.scale.z = -1;
  mesh.position.y = y0 + (bevel > 0 ? bevel * 0.7 : 0);
  return shadowed(mesh);
}

// furniture groups: local -z points `facing` (this is the FURNITURE convention, distinct from the avatar's core FACING_YAW)
export const FURNITURE_FACING_Y: Record<Facing, number> = { north: 0, west: Math.PI / 2, south: Math.PI, east: -Math.PI / 2 };

/** Group positioned at a rect's centre, rotated so its local -z points `facing`. */
export function placed(rect: Rect, facing: Facing): THREE.Group {
  const g = new THREE.Group();
  g.position.set(rect.x + rect.w / 2, 0, rect.z + rect.d / 2);
  g.rotation.y = FURNITURE_FACING_Y[facing];
  return g;
}
export function localSize(rect: Rect, facing: Facing): { w: number; d: number } {
  return facing === "east" || facing === "west" ? { w: rect.d, d: rect.w } : { w: rect.w, d: rect.d };
}

/** BAKE a set of same-material meshes into ONE mesh (Phase 6B).
 *
 *  The Central Hub repeats small pieces far more than any earlier room — 24 café chairs alone would cost
 *  ~240 draw calls built the way the Design Room builds one chair. Every part of such a piece is rigid
 *  relative to the piece, so the parts can be baked into a single buffer the moment the piece is finished:
 *  the piece keeps its own Group (and therefore its own transform, its own entity id and its own future
 *  SeatCapability), it just stops costing one draw call per screw.
 *
 *  Deliberately narrow: same material in, one mesh out, world-relative to the meshes' shared parent. It is
 *  a build-time bake, NOT a scene-graph optimiser — nothing here inspects or rewrites an existing tree. */
export function bake(meshes: THREE.Mesh[], m: THREE.Material, name = "baked"): THREE.Mesh | null {
  if (meshes.length === 0) return null;
  const geos = meshes.map((mesh) => {
    mesh.updateMatrix();
    // mergeGeometries needs one uniform attribute layout: every geometry here carries position/normal/uv,
    // but CylinderGeometry/LatheGeometry are indexed while RoundedBoxGeometry is not.
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    return g.applyMatrix4(mesh.matrix);
  });
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (!merged) return null; // never in practice: the layouts above are uniform. Caller falls back to parts.
  const out = new THREE.Mesh(merged, m);
  out.name = name;
  return shadowed(out, meshes.some((x) => x.castShadow), meshes.some((x) => x.receiveShadow));
}

/** Collect into `parts`, then `bake` them: the idiom every Central Hub piece uses.
 *  `add(mesh)` returns the mesh so it can still be tweaked (rotation, userData) before the bake. */
export class Baker {
  private readonly buckets = new Map<THREE.Material, THREE.Mesh[]>();
  add<T extends THREE.Mesh>(mesh: T): T {
    const m = mesh.material as THREE.Material;
    const list = this.buckets.get(m);
    if (list) list.push(mesh);
    else this.buckets.set(m, [mesh]);
    return mesh;
  }
  /** one mesh per material, in insertion order */
  bakeInto(g: THREE.Object3D, name = "baked"): number {
    let n = 0;
    for (const [m, meshes] of this.buckets) {
      const one = bake(meshes, m, `${name}-${n}`);
      if (one) { g.add(one); n++; } else { for (const mesh of meshes) g.add(mesh); n += meshes.length; }
    }
    this.buckets.clear();
    return n;
  }
}
