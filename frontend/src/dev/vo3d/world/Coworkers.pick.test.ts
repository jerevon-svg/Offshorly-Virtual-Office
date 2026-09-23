// Phase 6D — SELECTING A BODY. The three questions app/world.ts asks this module once a coworker becomes
// something you can click: who is under this ray, where is that person's head, and who is standing near
// enough to be targeted in PLAYER mode.
//
// Real Coworkers, real placement, real scene graph; the only stubs are the GLB loader and the label
// texture — the same line every other Coworkers test draws.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Coworkers } from "./Coworkers";
import { BON_STANDING_HEIGHT } from "../adapters/v1Avatar";
import type { Vo3dCoworker } from "../app/coworkers";

vi.mock("../avatar/CastPrototypes", () => ({
  prototypeFor: (id: string) =>
    Promise.resolve({ id, gltf: {} as never, scene: new THREE.Group(), clips: [] as THREE.AnimationClip[], triangles: 100, headY: 36 }),
  castLabelTexture: () => new THREE.CanvasTexture(document.createElement("canvas")),
}));

const BOX = { width: 26, height: 37 };
const ALEX = "alex@offshorly.com";
const MICAH = "micah@offshorly.com";

const row = (email: string, name: string, x: number, z: number): Vo3dCoworker => ({
  email, displayName: name, avatarId: name.toLowerCase(), point: { x, z }, box: BOX, posSource: "live", facing: "south",
});

let cw: Coworkers;
let parent: THREE.Group;

beforeEach(() => {
  parent = new THREE.Group();
  cw = new Coworkers({ parent, canStand: () => true, radius: 8, toWorld: (p) => p });
});
afterEach(() => cw.dispose());

/** A clickable box on a body, so a raycast has real geometry to hit — the stubbed prototype scene is
 *  empty, and an empty Group is not intersectable. Stands in for the skinned mesh a real GLB brings. */
function giveBodiesGeometry(): void {
  for (const body of cw.group.children) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 36, 20), new THREE.MeshBasicMaterial());
    mesh.position.y = 18;
    body.add(mesh);
  }
  cw.group.updateMatrixWorld(true);
}

/** A ray fired straight down the -Z axis at (x, y), the way an orthographic office camera looks.
 *  `camera` is set because the bodies carry a nameplate Sprite and THREE cannot raycast a sprite without
 *  one — in the world the ray always comes from setFromCamera, so this matches production rather than
 *  working around it. */
function rayAt(x: number, y: number): THREE.Raycaster {
  const r = new THREE.Raycaster();
  const camera = new THREE.OrthographicCamera(-500, 500, 500, -500, 0.1, 2000);
  camera.position.set(x, y, 400);
  camera.updateMatrixWorld(true);
  r.camera = camera;
  r.set(new THREE.Vector3(x, y, 400), new THREE.Vector3(0, 0, -1));
  return r;
}

describe("picking a coworker", () => {
  it("answers WHO the ray hit, with the distance the caller weighs it against its own pick", async () => {
    await cw.sync([row(ALEX, "Alex", 100, 100)]);
    giveBodiesGeometry();
    const hit = cw.pick(rayAt(100, 18));
    expect(hit?.email).toBe(ALEX);
    expect(hit?.displayName).toBe("Alex");
    // the ray started at z = 400 and the body stands at z = 100, so the front face is ~290 away
    expect(hit!.distance).toBeGreaterThan(280);
    expect(hit!.distance).toBeLessThan(300);
  });

  it("picks the NEARER of two bodies on the same ray", async () => {
    await cw.sync([row(ALEX, "Alex", 100, 100), row(MICAH, "Micah", 100, 200)]);
    giveBodiesGeometry();
    // Micah stands at z=200, between the camera (z=400) and Alex (z=100).
    expect(cw.pick(rayAt(100, 18))?.email).toBe(MICAH);
  });

  it("hits nobody when the ray misses, and nobody at all while the group is hidden", async () => {
    await cw.sync([row(ALEX, "Alex", 100, 100)]);
    giveBodiesGeometry();
    expect(cw.pick(rayAt(900, 18))).toBeNull();
    cw.group.visible = false;
    expect(cw.pick(rayAt(100, 18))).toBeNull();
  });
});

describe("the anchor a card hangs off", () => {
  it("is the point the nameplate already sits at, over the body's own position", async () => {
    await cw.sync([row(ALEX, "Alex", 140, 260)]);
    const head = cw.headPoint(ALEX)!;
    expect(head.x).toBeCloseTo(140, 5);
    expect(head.z).toBeCloseTo(260, 5);
    expect(head.y).toBeCloseTo(BON_STANDING_HEIGHT + 6, 5);
  });

  it("is null for somebody this world has no body for", async () => {
    await cw.sync([row(ALEX, "Alex", 140, 260)]);
    expect(cw.headPoint(MICAH)).toBeNull();
    expect(cw.pointOf(MICAH)).toBeNull();
  });

  it("follows the body rather than the roster row it was placed from", async () => {
    await cw.sync([row(ALEX, "Alex", 100, 100)]);
    const before = cw.pointOf(ALEX)!;
    await cw.sync([row(ALEX, "Alex", 500, 300)]);
    const after = cw.pointOf(ALEX)!;
    expect(after.x).not.toBeCloseTo(before.x, 1);
    expect(cw.headPoint(ALEX)!.x).toBeCloseTo(after.x, 5);
  });
});

describe("who is near enough to target", () => {
  it("reports everybody within reach and nobody beyond it", async () => {
    await cw.sync([row(ALEX, "Alex", 100, 100), row(MICAH, "Micah", 400, 100)]);
    const near = cw.within({ x: 110, z: 100 }, 62);
    expect(near.map((c) => c.email)).toEqual([ALEX]);
    expect(near[0].displayName).toBe("Alex");
    expect(cw.within({ x: 110, z: 100 }, 1000).map((c) => c.email).sort()).toEqual([ALEX, MICAH]);
    expect(cw.within({ x: 5000, z: 5000 }, 62)).toEqual([]);
  });
});
