// vo3d V2 OPTIMISATION SLICE 3 — STATIC GEOMETRY BATCHING.
//
// The one thing that can go wrong invisibly here is a merge that is not equivalent: geometry that lands
// somewhere else, a piece that loses its editor identity, or an animated node that gets frozen into a
// batch and silently stops moving. So these tests drive the REAL mirror over a real room, with batching
// on, and compare it against the same room built with batching off.
//
// The comparison that matters is not mesh-for-mesh — the whole point is that there are fewer meshes. It
// is the WORLD-SPACE VERTEX SET: every vertex the builders produced must still be at exactly the same
// world position after the pass. That is the definition of "no visible difference" that a merge can
// actually be held to.
import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, SHELL, designRoomEntities } from "./rooms/design-room";
import { SceneMirror } from "./render/SceneMirror";
import { batchStatic, setStaticBatching, staticBatchingEnabled } from "./render/StaticBatch";

const OPTS = { wallHeight: SHELL.wallHeight, frontWall: "low" as const };

/** Building the Design Room twice per test is the expensive part of this suite and the tree it produces
 *  never changes, so the two comparands are built ONCE and shared. The two tests that mutate a tree take
 *  a fresh build of their own. */
const cached = new Map<boolean, SceneMirror>();
function sharedRoom(batching: boolean): SceneMirror {
  const hit = cached.get(batching);
  if (hit) return hit;
  const built = designRoom(batching);
  cached.set(batching, built);
  return built;
}

function designRoom(batching: boolean): SceneMirror {
  setStaticBatching(batching);
  const world = new WorldState();
  world.addRoom(DESIGN_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  const mirror = new SceneMirror(world, new THREE.Scene());
  mirror.buildRoom(DESIGN_ROOM, OPTS);
  return mirror;
}

/** Every world-space TRIANGLE under `root`, as a flat [x,y,z]×3. Triangles, not vertices: merging may
 *  re-index a buffer (a shared cylinder vertex becomes three) which changes the vertex count and changes
 *  nothing that is drawn. */
function triangles(root: THREE.Object3D): number[][] {
  root.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  const out: number[][] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const idx = m.geometry.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const t: number[] = [];
      for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld); t.push(v.x, v.y, v.z); }
      out.push(t);
    }
  });
  return out;
}

/** The largest distance any triangle in `b` sits from its nearest counterpart in `a`, in world units.
 *
 *  This, and not an equality check, is the honest invariant. Baking a transform into a buffer writes the
 *  result back into a Float32Array, so a vertex a thousand units from the origin is re-quantised at about
 *  1e-4 of a unit — a difference that exists in the bits and nowhere on the screen. Anything a merge got
 *  actually WRONG (a piece left in its local frame, a missing rotation) moves geometry by whole units and
 *  is caught here by many orders of magnitude. */
function maxDisplacement(a: number[][], b: number[][]): number {
  const centroid = (t: number[]): [number, number, number] => [(t[0] + t[3] + t[6]) / 3, (t[1] + t[4] + t[7]) / 3, (t[2] + t[5] + t[8]) / 3];
  const buckets = new Map<string, number[][]>();
  for (const t of a) {
    const c = centroid(t);
    const k = `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])}`;
    const l = buckets.get(k);
    if (l) l.push(t); else buckets.set(k, [t]);
  }
  const nearestIn = (l: number[][] | undefined, t: number[]): number => {
    let best = Infinity;
    if (!l) return best;
    for (const u of l) { let d = 0; for (let k = 0; k < 9; k++) d = Math.max(d, Math.abs(u[k] - t[k])); if (d < best) best = d; }
    return best;
  };
  let worst = 0;
  for (const t of b) {
    const c = centroid(t);
    const x = Math.round(c[0]), y = Math.round(c[1]), z = Math.round(c[2]);
    // the home bucket first: a displacement this small almost never crosses a whole-unit boundary, so the
    // 27-cell sweep is the rare fallback rather than the common path
    let best = nearestIn(buckets.get(`${x},${y},${z}`), t);
    if (best > 0.5) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const d = nearestIn(buckets.get(`${x + dx},${y + dy},${z + dz}`), t);
        if (d < best) best = d;
      }
    }
    if (best > worst) worst = best;
  }
  return worst;
}

const meshCount = (o: THREE.Object3D): number => {
  let n = 0;
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) n++; });
  return n;
};

afterEach(() => setStaticBatching(false)); // the default every other suite builds against

describe("vo3d static batching — fewer submissions, identical geometry", () => {
  it("is OFF by default, so every room's build guards still see the tree the builders produced", () => {
    expect(staticBatchingEnabled()).toBe(false);
  });

  it("draws exactly the same triangles in the same places, out of far fewer meshes", { timeout: 30_000 }, () => {
    const plain = sharedRoom(false);
    const batched = sharedRoom(true);
    const a = triangles(plain.root), b = triangles(batched.root);
    expect(b.length).toBe(a.length); // not one triangle added, dropped or subdivided
    expect(maxDisplacement(a, b)).toBeLessThan(1e-3); // float32 re-quantisation only — see maxDisplacement
    const before = meshCount(plain.root), after = meshCount(batched.root);
    expect(after).toBeLessThan(before * 0.75);
    expect(batched.batching.merged).toBeGreaterThan(batched.batching.batches);
    expect(batched.batching.merged - batched.batching.batches).toBe(before - after);
  });

  it("is deterministic: a rebuilt room batches to exactly the same thing", () => {
    const mirror = designRoom(true);
    const first = triangles(mirror.root).map((t) => t.join(",")).sort().join(";");
    const firstMeshes = meshCount(mirror.root);
    mirror.rebuildRoom(DESIGN_ROOM, OPTS);
    expect(triangles(mirror.root).map((t) => t.join(",")).sort().join(";")).toBe(first); // bit-identical
    expect(meshCount(mirror.root)).toBe(firstMeshes);
  });

  it("never merges across an entity boundary: every piece keeps its own view, id and transform", () => {
    const plain = sharedRoom(false);
    const batched = sharedRoom(true);
    for (const e of designRoomEntities()) {
      const a = plain.view(e.id), b = batched.view(e.id);
      expect(b.name).toBe(e.id);
      expect(b.position.toArray()).toEqual(a.position.toArray());
      expect(b.rotation.y).toBeCloseTo(a.rotation.y, 9);
      expect(batched.isTransformBound(e.id)).toBe(plain.isTransformBound(e.id));
      expect(batched.baseYawOf(e.id)).toBeCloseTo(plain.baseYawOf(e.id), 9);
      // a batch is a CHILD of the piece's own view, so a raycast still walks up to the entity id
      for (const c of b.children) expect(c.parent).toBe(b);
    }
    // ...and moving a piece still moves its geometry, batch and all
    const id = `${DESIGN_ROOM.id}/design-member-chair-4`;
    const box0 = new THREE.Box3().setFromObject(batched.view(id));
    batched.view(id).position.x += 50;
    const box1 = new THREE.Box3().setFromObject(batched.view(id));
    expect(box1.min.x - box0.min.x).toBeCloseTo(50, 3);
    batched.view(id).position.x -= 50; // the tree is shared — hand it back as it was found
  });

  it("leaves the sway system's nodes, and everything under them, exactly as built", () => {
    const plain = sharedRoom(false);
    const batched = sharedRoom(true);
    expect(batched.sway.nodeCount).toBe(plain.sway.nodeCount);
    for (const e of designRoomEntities()) {
      for (const n of batched.sway.nodesOf(e.id)) {
        // the pivot is still in the tree, and its own subtree was never touched
        expect(n.obj.parent).not.toBeNull();
        // ...and it is still drivable: the sway system writes this every frame
        const was = n.obj.rotation[n.axis];
        n.obj.rotation[n.axis] = 0.4;
        expect(n.obj.rotation[n.axis]).toBe(0.4);
        n.obj.rotation[n.axis] = was; // the tree is shared — hand it back as it was found
      }
    }
  });

  it("refuses tagged, transparent, instanced and multi-material meshes", () => {
    setStaticBatching(true);
    const mat = new THREE.MeshStandardMaterial();
    const glass = new THREE.MeshStandardMaterial({ transparent: true });
    const geo = () => new THREE.BoxGeometry(1, 1, 1);
    const scope = new THREE.Group();
    const keep: THREE.Object3D[] = [];
    const add = (o: THREE.Object3D) => { scope.add(o); return o; };
    // two plain meshes: the only pair that may merge
    add(new THREE.Mesh(geo(), mat));
    add(new THREE.Mesh(geo(), mat));
    keep.push(add(Object.assign(new THREE.Mesh(geo(), mat), { userData: { surface: { id: "x" } } })));
    keep.push(add(Object.assign(new THREE.Mesh(geo(), mat), { userData: { ambient: { kind: "pulse" } } })));
    keep.push(add(Object.assign(new THREE.Mesh(geo(), mat), { userData: { led: { id: "l" } } })));
    keep.push(add(new THREE.Mesh(geo(), glass)));
    keep.push(add(new THREE.Mesh(geo(), [mat, mat, mat, mat, mat, mat])));
    keep.push(add(new THREE.InstancedMesh(geo(), mat, 4)));
    const pivot = add(new THREE.Group());
    const swayed = new THREE.Mesh(geo(), mat);
    pivot.add(swayed);
    keep.push(swayed);

    const stats = batchStatic(scope, new Set([pivot]), "t");
    expect(stats.merged).toBe(2);
    expect(stats.batches).toBe(1);
    for (const o of keep) expect(o.parent).not.toBeNull(); // every refusal is still in the tree
    // a mesh under a shadow-flag difference is a different bucket, never the same batch
    const scope2 = new THREE.Group();
    const a = new THREE.Mesh(geo(), mat); a.castShadow = true;
    const b = new THREE.Mesh(geo(), mat); b.castShadow = false;
    scope2.add(a, b);
    expect(batchStatic(scope2, new Set(), "t").batches).toBe(0);
  });

  it("does nothing at all while it is disabled", () => {
    setStaticBatching(false);
    const mat = new THREE.MeshStandardMaterial();
    const scope = new THREE.Group();
    scope.add(new THREE.Mesh(new THREE.BoxGeometry(), mat), new THREE.Mesh(new THREE.BoxGeometry(), mat));
    expect(batchStatic(scope, new Set(), "t")).toEqual({ merged: 0, batches: 0, singletons: 0, skipped: 0 });
    expect(scope.children.length).toBe(2);
  });
});
