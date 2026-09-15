// vo3d render — STATIC GEOMETRY BATCHING (V2 optimisation slice 3).
//
// WHY. After foliage instancing (0e7f479) and room visibility (248798d) the whole-office framing still
// submits ~5,400 meshes, because in that framing EVERY room is on screen and culling has nothing to drop.
// What is left is per-object submission cost, and it is paid more than once per frame: SSAOPass re-draws
// the whole scene into a normal buffer, and the shadow map re-draws every caster when it is invalidated.
// ~9,900 draw calls per frame for 2.3M scene triangles is a draw-call-bound frame, not a triangle-bound
// one — so the lever is FEWER SUBMISSIONS for exactly the same triangles.
//
// WHAT THIS DOES. Inside one SCOPE (a room's static subtree, the ground-floor skeleton, or ONE entity's
// view group) it merges meshes that already draw identically — same material object, same shadow flags,
// same render order, same layers — into one mesh per bucket, expressed in the scope's own frame. Nothing
// crosses a scope boundary, which is the whole safety story:
//
//   · an ENTITY keeps its own view group, so its transform, its entity id, its raycast picking, its
//     gizmo, its anchors, its persistence and its disposal are all untouched. The editor can still move,
//     turn and delete the piece; only the number of children under it changed.
//   · a room's STATIC subtree keeps its group, so surface/LED registries, ambient channels and room-level
//     visibility all still address the same nodes.
//
// WHAT IT REFUSES TO TOUCH, and why each one matters:
//   · InstancedMesh / SkinnedMesh — already batched, or animated by a skeleton.
//   · anything under a SWAY node — the sway system rotates those pivots every frame, and a merged child
//     would be frozen in its rest pose.
//   · anything tagged `surface` (editor material editing), `led` (emissive editing), `ambient`/`powered`
//     (the idle-animation channels hold material references), `bossSlot`/`placeholder` (the statues are
//     swapped in asynchronously), `windFlex` and `baseOpacity` (per-mesh animated state).
//   · TRANSPARENT materials — three sorts transparent meshes per object, so merging them would change the
//     blend order. The approved look depends on that order; it stays exactly as built.
//   · multi-material meshes, and any mesh whose world matrix has a negative determinant (a mirrored copy
//     would come out inside-out once its transform is baked in).
//   · any geometry whose attribute layout is not exactly position/normal/uv — merging mismatched layouts
//     is how you silently drop a UV set.
//
// This is a build-time bake over a tree that was JUST built and has never been rendered, in the same
// spirit as build/helpers `bake` — but applied per scope rather than per piece, and with the tag and sway
// exclusions that a whole-room pass needs and a single café chair did not.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** A/B switch, and the DEFAULT IS OFF, deliberately.
 *
 *  Every room's build tests assert things about the meshes the BUILDERS produced — "no mesh intrudes on
 *  this gate lane", "nothing floats above the wall head", "this room contributes more than N meshes". A
 *  merged mesh has a room-sized bounding box by construction, so those guards can only be read against
 *  the unbatched tree, which is exactly the tree they are about. Defaulting off keeps every one of them
 *  measuring what it was written to measure; app/bootstrap turns batching ON explicitly (and `?batch=0`
 *  turns it back off for the A/B), and static-batch.test.ts enables it to test this pass itself. */
let enabled = false;
export function setStaticBatching(on: boolean): void {
  enabled = on;
}
export function staticBatchingEnabled(): boolean {
  return enabled;
}

export type BatchStats = {
  /** meshes that were merged away */
  merged: number;
  /** meshes they became */
  batches: number;
  /** candidates left alone because their bucket held only one mesh */
  singletons: number;
  /** meshes refused by one of the rules above */
  skipped: number;
};

const EMPTY: BatchStats = { merged: 0, batches: 0, singletons: 0, skipped: 0 };
export const addStats = (a: BatchStats, b: BatchStats): BatchStats => ({
  merged: a.merged + b.merged, batches: a.batches + b.batches, singletons: a.singletons + b.singletons, skipped: a.skipped + b.skipped,
});

/** userData keys that make a node — and everything under it — individually addressable at runtime. */
function tagged(o: THREE.Object3D): boolean {
  const u = o.userData;
  if (u === undefined) return false;
  return (
    u.surface !== undefined || u.led !== undefined || u.ambient !== undefined || u.powered !== undefined ||
    u.bossSlot !== undefined || u.placeholder !== undefined || u.windFlex !== undefined || u.baseOpacity !== undefined
  );
}

const ATTR_LAYOUT = "normal,position,uv";
const layoutOf = (g: THREE.BufferGeometry): string => Object.keys(g.attributes).sort().join(",");

type Candidate = { mesh: THREE.Mesh; material: THREE.Material };

/** Merge the compatible static meshes inside `scope` in place. `frozen` holds objects whose SUBTREES are
 *  animated (the sway pivots this scope registered) and must be left exactly as built. */
export function batchStatic(scope: THREE.Object3D, frozen: ReadonlySet<THREE.Object3D> = new Set(), label = "batch"): BatchStats {
  if (!enabled) return EMPTY;
  scope.updateWorldMatrix(true, true);
  const toScope = new THREE.Matrix4().copy(scope.matrixWorld).invert();
  const buckets = new Map<string, Candidate[]>();
  let skipped = 0;

  const walk = (o: THREE.Object3D): void => {
    if (frozen.has(o) || tagged(o)) { o.traverse((c) => { if ((c as THREE.Mesh).isMesh) skipped++; }); return; }
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const key = candidateKey(mesh);
      if (key === null) skipped++;
      else {
        const list = buckets.get(key);
        if (list) list.push({ mesh, material: mesh.material as THREE.Material });
        else buckets.set(key, [{ mesh, material: mesh.material as THREE.Material }]);
      }
    }
    // A mesh can carry children (a lamp head on a post); they are walked either way.
    for (const c of [...o.children]) walk(c);
  };
  for (const c of [...scope.children]) walk(c);

  let merged = 0, batches = 0, singletons = 0;
  let n = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) { singletons += list.length; continue; }
    // mergeGeometries needs ONE layout, so a bucket is merged indexed only when every member already is.
    // That distinction is worth making: `toNonIndexed` expands a cylinder's 24 shared vertices into 36
    // unshared ones, and paying that on every indexed family in the office would hand back in vertex
    // shading what the merge saves in submissions. Mixed buckets (a rounded box beside a cylinder) still
    // fall back to non-indexed — the triangles are identical either way.
    const allIndexed = list.every((c) => c.mesh.geometry.index !== null);
    const geos: THREE.BufferGeometry[] = [];
    for (const c of list) {
      const g = allIndexed || !c.mesh.geometry.index ? c.mesh.geometry.clone() : c.mesh.geometry.toNonIndexed();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toScope, c.mesh.matrixWorld));
      geos.push(g);
    }
    const out = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!out) { singletons += list.length; continue; } // never in practice: the layouts were checked above
    const first = list[0].mesh;
    const one = new THREE.Mesh(out, list[0].material);
    one.name = `${label}:${n++}`;
    one.castShadow = first.castShadow;
    one.receiveShadow = first.receiveShadow;
    one.renderOrder = first.renderOrder;
    one.layers.mask = first.layers.mask;
    // The originals are detached and dropped. Their geometries are NOT disposed, deliberately: this runs
    // on a tree that has never been rendered, so nothing of theirs was ever uploaded to the GPU and they
    // are ordinary garbage — while a blanket dispose here would also take out the module-level singletons
    // that build/helpers `cyl` and `sphereGeo` hand to every piece in the building.
    for (const c of list) c.mesh.removeFromParent();
    scope.add(one);
    merged += list.length;
    batches++;
  }
  return { merged, batches, singletons, skipped };
}

/** null = this mesh is not a candidate; otherwise the key of the bucket it may be merged into. */
function candidateKey(mesh: THREE.Mesh): string | null {
  if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return null;
  if ((mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return null;
  const g = mesh.geometry;
  if (!g || layoutOf(g) !== ATTR_LAYOUT) return null;
  if (Array.isArray(mesh.material)) return null;
  const m = mesh.material as THREE.Material | undefined;
  if (!m || m.transparent) return null;
  // A mirrored transform baked into the vertices flips the winding; backface culling would then eat the
  // piece. Nothing in the office mirrors by scale today — this is the guard that keeps that true.
  if (mesh.matrixWorld.determinant() <= 0) return null;
  return `${m.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}|${mesh.renderOrder}|${mesh.layers.mask}`;
}
