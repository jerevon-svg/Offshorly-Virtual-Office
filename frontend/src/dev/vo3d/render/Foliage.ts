// vo3d render — FOLIAGE BATCHING. One InstancedMesh per (built group × foliage material) standing in for
// every blade leaf under that group.
//
// WHY. Profiling the finished ground floor at 011a55e: 9,047 static meshes, of which 3,760 were single
// blade leaves — 45% of every traversal for 1.8% of the triangles. SSAO re-draws the whole scene into a
// normal buffer before it can compute anything (see render/Renderer), and the shadow map re-draws every
// caster when it is invalidated, so each of those 3,760 draw calls was being paid up to three times a
// frame. They already shared ONE geometry and TWO materials, which is the definition of instanceable.
//
// WHAT IS PRESERVED, EXACTLY. The blades are gone from the render list, not from the scene graph: each is
// still a node (build/plants `leaf()` leaves an Object3D anchor where the Mesh was), still a child of its
// own sway pivot, still driven by the same SwaySystem node it always was. This system only reads those
// anchors' world matrices back out and writes them into an instance buffer. Nothing about the motion,
// the placement, the density, the silhouette, the droop or the material is re-derived — which is what a
// vertex-shader sway path would have had to do to a locked visual reference.
//
// WHY THE BATCH IS A CHILD OF THE BUILT GROUP, not of the scene. Instance matrices are stored ROOT-LOCAL
// (the same rule finalizeSucculents follows, and for the same reason). That makes the room editor free:
// moving or turning a plant moves its own batch rigidly with it, so the stored matrices do not change at
// all, the piece stays raycastable through its own view (pickEditable raycasts `mirror.view(id)`), and
// deleting the entity disposes the batch with the view.
import * as THREE from "three";
import { FOLIAGE_KEY, foliage, leafGeometry } from "../build/plants";
import type { SwaySystem } from "./Sway";

type Batch = { root: THREE.Object3D; anchors: THREE.Object3D[]; mesh: THREE.InstancedMesh };

const _toLocal = new THREE.Matrix4();
const _m = new THREE.Matrix4();

/** Re-read every anchor in a batch into its instance matrix, expressed in the batch root's local space. */
function writeMatrices(b: Batch): void {
  _toLocal.copy(b.root.matrixWorld).invert();
  for (let i = 0; i < b.anchors.length; i++) b.mesh.setMatrixAt(i, _m.multiplyMatrices(_toLocal, b.anchors[i].matrixWorld));
  b.mesh.instanceMatrix.needsUpdate = true;
}

export class FoliageSystem {
  private readonly byOwner = new Map<string, Batch[]>();
  private readonly sway: SwaySystem;
  constructor(sway: SwaySystem) {
    this.sway = sway;
  }
  /** Collect every leaf anchor under `root` into one InstancedMesh per material, parented to `root`.
   *  Returns the number of blades batched (0 leaves the group untouched — most entities have none). */
  collect(owner: string, root: THREE.Object3D): number {
    this.clear(owner);
    // One bucket per anchor CODE (material × shadow participation), so a batch can only ever merge
    // blades that already drew identically — see build/plants `foliageCode`.
    const byCode = new Map<number, THREE.Object3D[]>();
    let total = 0;
    root.traverse((o) => {
      const k = o.userData[FOLIAGE_KEY];
      if (typeof k !== "number") return;
      const bucket = byCode.get(k);
      if (bucket) bucket.push(o);
      else byCode.set(k, [o]);
      total++;
    });
    if (total === 0) return 0;
    // Ancestors too: a group being finalised on its own (an entity view the editor just placed) is
    // already translated to its world position, and the anchors under it have to be read relative to it.
    root.updateWorldMatrix(true, true);
    const batches: Batch[] = [];
    for (const [code, anchors] of [...byCode.entries()].sort((a, b) => a[0] - b[0])) {
      const isLight = (code & 1) !== 0;
      const shadows = (code & 2) !== 0;
      const mesh = new THREE.InstancedMesh(leafGeometry(), foliage(isLight), anchors.length);
      mesh.name = `foliage:${owner}:${code}`;
      // Parity with the blades this replaces: a floor plant's canopy cast and received, a planter's
      // trough leaves did neither. One instanced caster now draws a whole canopy into the shadow map in
      // a single call instead of a few hundred.
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      root.add(mesh);
      const b: Batch = { root, anchors, mesh };
      writeMatrices(b);
      // An InstancedMesh is frustum-tested against ITS OWN bounding sphere, which is only computed from
      // the instance matrices on demand — without this it would fall back to the unit blade at the group
      // origin and whole canopies would vanish off-centre. Computed once from the rest pose and padded
      // by a blade length, because sway displaces a tip by far less than that and re-deriving the sphere
      // every frame would hand back the per-object cost this system exists to remove.
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius *= 1.1;
      batches.push(b);
    }
    this.byOwner.set(owner, batches);
    return total;
  }
  /** Drop an owner's batches. Call BEFORE a caller disposes the group: the shared blade geometry must
   *  survive, and a blanket `traverse(dispose)` over the group would take it with everything else. */
  clear(owner: string): void {
    const batches = this.byOwner.get(owner);
    if (!batches) return;
    for (const b of batches) {
      b.mesh.removeFromParent();
      b.mesh.dispose(); // instance buffers only — the blade geometry and the two materials are shared
    }
    this.byOwner.delete(owner);
  }
  /** Follow the pivots. One matrix copy per blade; skipped entirely while sway is off, because a
   *  motionless canopy's matrices cannot have changed and an editor move carries its own batch. */
  update(): void {
    if (!this.sway.enabled) return;
    for (const batches of this.byOwner.values()) for (const b of batches) writeMatrices(b);
  }
  /** blades standing in instance buffers (what used to be one draw call each) */
  get bladeCount(): number {
    let n = 0;
    for (const batches of this.byOwner.values()) for (const b of batches) n += b.anchors.length;
    return n;
  }
  /** draw calls those blades now cost */
  get batchCount(): number {
    let n = 0;
    for (const batches of this.byOwner.values()) n += batches.length;
    return n;
  }
}
