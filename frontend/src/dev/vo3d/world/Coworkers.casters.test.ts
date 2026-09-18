// PHASE 4C STAGE 1 — THE DYNAMIC-CASTER CONTRACT, asserted against the scene graph rather than against a
// callback count. Coworkers.sync.test.ts proves the world is TOLD the right thing; this file proves that
// acting on it actually puts a coworker's meshes where the shadow composite can find them.
//
// THE BUG THIS PINS. Renderer.addDynamicCaster(coworkers.group) runs ONCE, at construction, while the
// group is still empty — every body is cloned in afterwards. markDynamicCaster only walks what is there
// at the time, so without a re-mark on each population change not one coworker mesh ever joined
// DYNAMIC_CASTER_LAYER. compositeDynamicShadows() renders with `cam.layers.set(DYNAMIC_CASTER_LAYER)`,
// which draws that layer and nothing else, so every coworker was silently skipped: bodies on the floor
// casting no shadow at all, in both camera modes.
//
// The assertions use the composite's OWN predicate — a camera restricted to the layer, and
// Object3D.layers.test against it — so this cannot drift from what the renderer really draws.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers } from "./Coworkers";
import { DYNAMIC_CASTER_LAYER } from "../render/Renderer";
import type { Vo3dCoworker } from "../app/coworkers";
import type { Vec2 } from "../core/coords";

/** A prototype with REAL meshes in it — the empty Group the sync tests use could not show this bug. */
vi.mock("../avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) => {
    const scene = new THREE.Group();
    // two meshes, nested, because a character GLB is a hierarchy and markDynamicCaster has to recurse
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    torso.add(head);
    scene.add(torso);
    return Promise.resolve({ id, gltf: {} as never, scene, clips: [] as THREE.AnimationClip[], triangles: 100, headY: 36 });
  },
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));

function coworker(email: string, avatarId = "bon", point: Vec2 = { x: 0, z: 0 }): Vo3dCoworker {
  return { email, displayName: email.split("@")[0], avatarId, point,
    box: { width: 26, height: 37 }, posSource: "desk", facing: "south" };
}
const A = coworker("a@x.com");
const B = coworker("b@x.com", "bon", { x: 200, z: 0 });

/** Renderer.markDynamicCaster, verbatim in behaviour: meshes only, recursing through the subtree. */
function markDynamicCaster(root: THREE.Object3D): void {
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.layers.enable(DYNAMIC_CASTER_LAYER); });
}

/** compositeDynamicShadows' own camera: restricted to the caster layer, so it draws that and nothing else. */
const compositeCamera = (): THREE.Camera => {
  const cam = new THREE.OrthographicCamera();
  cam.layers.set(DYNAMIC_CASTER_LAYER);
  return cam;
};

/** every mesh under `root` the composite pass would actually draw */
function meshesTheCompositeDraws(root: THREE.Object3D): THREE.Mesh[] {
  const cam = compositeCamera();
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.layers.test(cam.layers)) out.push(o as THREE.Mesh); });
  return out;
}
function allMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

/** The world's wiring, reproduced: mark once at construction, then re-mark on every population change. */
function wiredWorld() {
  const parent = new THREE.Group();
  const marks: string[] = [];
  const invalidations: string[] = [];
  const cw: Coworkers = new Coworkers({
    parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1,
    onChanged: (change) => {
      if (change === "population") { markDynamicCaster(cw.group); marks.push(change); }
      invalidations.push("dynamic");
    },
  });
  markDynamicCaster(cw.group); // addDynamicCaster, on the still-empty group
  return { cw, marks, invalidations };
}

beforeEach(() => vi.clearAllMocks());

describe("coworkers are reachable by the shadow composite", () => {
  it("marks every mesh of a body that arrives AFTER the group was registered", async () => {
    const { cw } = wiredWorld();
    await cw.sync([A]);
    const meshes = allMeshes(cw.group);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshesTheCompositeDraws(cw.group)).toHaveLength(meshes.length);
  });

  it("marks bodies added in a LATER sync, not just the first batch", async () => {
    const { cw } = wiredWorld();
    await cw.sync([A]);
    await cw.sync([A, B]);
    expect(cw.size).toBe(2);
    expect(meshesTheCompositeDraws(cw.group)).toHaveLength(allMeshes(cw.group).length);
  });

  it("marks a REBUILT body after a character swap", async () => {
    const { cw } = wiredWorld();
    await cw.sync([A]);
    await cw.sync([{ ...A, avatarId: "micah" }]);
    expect(meshesTheCompositeDraws(cw.group)).toHaveLength(allMeshes(cw.group).length);
  });

  it("leaves the survivors marked when somebody else leaves", async () => {
    const { cw } = wiredWorld();
    await cw.sync([A, B]);
    await cw.sync([A]);
    expect(cw.size).toBe(1);
    expect(meshesTheCompositeDraws(cw.group)).toHaveLength(allMeshes(cw.group).length);
  });

  it("keeps every mesh marked across a stream of MOVES", async () => {
    const { cw } = wiredWorld();
    await cw.sync([A, B]);
    for (let x = 100; x <= 400; x += 100) await cw.sync([A, { ...B, point: { x, z: 0 }, posSource: "live" }]);
    expect(meshesTheCompositeDraws(cw.group)).toHaveLength(allMeshes(cw.group).length);
  });

  // THE NAMEPLATE MUST STAY OFF THE LAYER. A Sprite is invisible to three's own shadow pass, but the
  // composite is an ordinary render — put its quad on the caster layer and the plate starts casting a
  // rectangle on the floor under everyone.
  it("never puts a nameplate sprite on the caster layer", async () => {
    const { cw } = wiredWorld();
    await cw.sync([A, B]);
    const cam = compositeCamera();
    const sprites: THREE.Sprite[] = [];
    cw.group.traverse((o) => { if ((o as THREE.Sprite).isSprite) sprites.push(o as THREE.Sprite); });
    expect(sprites.length).toBe(2);
    for (const s of sprites) expect(s.layers.test(cam.layers)).toBe(false);
  });

  // The regression itself, stated as the thing that was actually wrong.
  it("WITHOUT the re-mark, the composite would draw nothing — this is the bug being fixed", async () => {
    const parent = new THREE.Group();
    const cw = new Coworkers({ parent, canStand: () => true, radius: 8, toWorld: (p) => p, lod: 1 });
    markDynamicCaster(cw.group); // the only mark the old wiring ever did: on the empty group
    await cw.sync([A, B]);
    expect(allMeshes(cw.group).length).toBeGreaterThan(0);
    expect(meshesTheCompositeDraws(cw.group)).toHaveLength(0);
  });
});

describe("coworkers never force a full static shadow redraw", () => {
  it("re-marks on population changes only, and invalidates dynamically every time", async () => {
    const { cw, marks, invalidations } = wiredWorld();
    await cw.sync([A, B]);            // population
    await cw.sync([A, { ...B, point: { x: 900, z: 0 }, posSource: "live" }]); // position
    await cw.sync([A]);               // population
    expect(marks).toEqual(["population", "population"]);
    expect(invalidations).toEqual(["dynamic", "dynamic", "dynamic"]);
  });
});
