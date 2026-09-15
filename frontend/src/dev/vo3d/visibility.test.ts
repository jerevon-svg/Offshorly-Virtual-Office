// vo3d V2 OPTIMISATION SLICE 2 — ROOM-LEVEL VISIBILITY.
//
// The behaviour these pin is the one thing that can go wrong invisibly: a room that is culled when it
// should not be does not throw, it just quietly stops existing in a corner of the frame. So the tests
// drive the real system with a real orthographic camera whose frustum is axis-aligned in world space —
// which makes every margin below a plain distance in world units rather than something to be derived
// from a projection matrix.
//
// The camera used throughout looks down -Z from the origin and sees x,y in [-100, 100], z in [-1000, -1].
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { RoomVisibility, SHOW_MARGIN, HIDE_MARGIN } from "./render/RoomVisibility";
import rendererSrc from "./render/Renderer.ts?raw";
import mirrorSrc from "./render/SceneMirror.ts?raw";
import bootstrapSrc from "./app/bootstrap.ts?raw";

function camera(): THREE.OrthographicCamera {
  const c = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 1000);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

/** A room subtree: one box mesh spanning [x0,x1] on X, 100 deep around z = -500. */
function room(x0: number, x1: number): { group: THREE.Group; rect: { x: number; z: number; w: number; d: number } } {
  const group = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 20, 100));
  m.position.set((x0 + x1) / 2, 0, -500);
  group.add(m);
  return { group, rect: { x: x0, z: -550, w: x1 - x0, d: 100 } };
}

/** A key light aimed at (x, 0, -500) from 400 east and 800 up, with a ±`half` shadow frustum. */
function keyLight(x: number, half: number): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.castShadow = true;
  light.target.position.set(x, 0, -500);
  light.target.updateMatrixWorld(true);
  light.position.set(x + 400, 800, -500);
  const sc = light.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
  sc.near = 200; sc.far = 1600;
  sc.updateProjectionMatrix();
  return light;
}

describe("room visibility — the frustum decides", () => {
  it("hides a room the camera cannot see and keeps the one it can", () => {
    const V = new RoomVisibility();
    const inView = room(-50, 50), far = room(3000, 3100);
    V.register("in", inView.group, inView.rect);
    V.register("far", far.group, far.rect);
    expect(V.update(camera(), {})).toBe(1);
    expect(inView.group.visible).toBe(true);
    expect(far.group.visible).toBe(false);
    expect(V.culled).toBe(1);
    expect(V.hiddenIds()).toEqual(["far"]);
  });

  it("measures bounds from the built geometry, INSTANCED foliage batches included", () => {
    // The batch's own origin sits out of frame; its instances reach back into it. A system that read the
    // single blade geometry instead of the InstancedMesh's object-level box would cull the whole room.
    const V = new RoomVisibility();
    const group = new THREE.Group();
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), 3);
    const m = new THREE.Matrix4();
    [0, 200, 400].forEach((x, i) => inst.setMatrixAt(i, m.makeTranslation(x, 0, -500)));
    inst.instanceMatrix.needsUpdate = true;
    group.position.x = 300;
    group.add(inst);
    V.register("plants", group, { x: 300, z: -550, w: 1, d: 1 });
    V.update(camera(), {});
    const b = V.bounds("plants")!;
    expect(Math.round(b.min.x)).toBe(300); // group origin + first instance
    expect(Math.round(b.max.x)).toBe(701); // group origin + furthest instance, with its half-extent
  });

  it("never hides the room the player is standing in", () => {
    const V = new RoomVisibility();
    const far = room(3000, 3100);
    V.register("far", far.group, far.rect);
    expect(V.update(camera(), { keep: "far" })).toBe(0);
    expect(far.group.visible).toBe(true);
    expect(V.update(camera(), { keep: "somewhere-else" })).toBe(1);
    expect(far.group.visible).toBe(false);
  });

  it("restores every subtree the moment it is disabled, and on unregister", () => {
    const V = new RoomVisibility();
    const far = room(3000, 3100);
    V.register("far", far.group, far.rect);
    V.update(camera(), {});
    expect(far.group.visible).toBe(false);
    V.enabled = false;
    expect(V.update(camera(), {})).toBe(0);
    expect(far.group.visible).toBe(true);
    V.enabled = true;
    V.update(camera(), {});
    expect(far.group.visible).toBe(false);
    V.unregister("far"); // a detached subtree must never be left hidden
    expect(far.group.visible).toBe(true);
  });
});

describe("room visibility — hysteresis", () => {
  it("keeps its answer inside the margin band, so a room on the edge cannot flicker", () => {
    expect(SHOW_MARGIN).toBeLessThan(HIDE_MARGIN);
    const V = new RoomVisibility();
    const r = room(600, 700); // 500 clear of the frustum edge at x = 100: hidden under either margin
    V.register("edge", r.group, r.rect);
    const cam = camera();
    V.update(cam, {});
    expect(r.group.visible).toBe(false);

    // THE BAND. At x ∈ [300, 400] the room is 200 clear of the frustum: further than SHOW_MARGIN (120)
    // and nearer than HIDE_MARGIN (280). Whichever state it is in, it keeps it.
    r.group.position.x = -300;
    V.invalidate("edge");
    V.update(cam, {});
    expect(r.group.visible).toBe(false); // was hidden → stays hidden

    r.group.position.x = -450; // x ∈ [150, 250]: inside SHOW_MARGIN, so it comes back
    V.invalidate("edge");
    V.update(cam, {});
    expect(r.group.visible).toBe(true);

    r.group.position.x = -300; // back to the SAME place that was hidden a moment ago
    V.invalidate("edge");
    V.update(cam, {});
    expect(r.group.visible).toBe(true); // now visible → stays visible. That is the hysteresis.
  });
});

describe("room visibility — shadow safety", () => {
  it("keeps an off-camera room that can still cast into the view, and drops it when shadows are off", () => {
    const V = new RoomVisibility();
    const r = room(600, 700);
    V.register("caster", r.group, r.rect);
    const cam = camera(), light = keyLight(650, 300);
    // inside the key light's shadow frustum: it can be drawn into the shadow map, so it stays
    expect(V.update(cam, { light, shadows: true })).toBe(0);
    expect(r.group.visible).toBe(true);
    // the same room, same frame, with the shadow pass off: nothing it could cast, so it goes
    expect(V.update(cam, { light, shadows: false })).toBe(1);
    expect(r.group.visible).toBe(false);
  });

  it("still culls a room that is outside the camera AND the shadow frustum", () => {
    const V = new RoomVisibility();
    const r = room(3000, 3100);
    V.register("far", r.group, r.rect);
    expect(V.update(camera(), { light: keyLight(650, 300), shadows: true })).toBe(1);
    expect(r.group.visible).toBe(false);
  });

  it("reads the light's own transform, not three's on-demand shadow camera", () => {
    // Renderer.shadowMap.autoUpdate is off, so light.shadow.camera.matrixWorld is stale on most frames.
    // Moving the LIGHT (which is what Renderer.updateShadowFrame does) must change the answer anyway.
    const V = new RoomVisibility();
    const r = room(600, 700);
    V.register("caster", r.group, r.rect);
    const cam = camera(), light = keyLight(650, 300);
    expect(V.update(cam, { light, shadows: true })).toBe(0);
    light.target.position.set(-4000, 0, -500); // the shadow frame moved away from the room
    light.target.updateMatrixWorld(true);
    light.position.set(-3600, 800, -500);
    expect(V.update(cam, { light, shadows: true })).toBe(1);
    expect(r.group.visible).toBe(false);
  });
});

describe("room visibility — ownership and wiring", () => {
  it("the renderer culls AFTER settling the shadow frame and BEFORE drawing", () => {
    const body = rendererSrc.slice(rendererSrc.indexOf("  render(): void {"));
    const shadow = body.indexOf("this.updateShadowFrame();");
    const cull = body.indexOf("this.cull?.()");
    const draw = body.indexOf("this.composer.render()");
    expect(shadow).toBeGreaterThan(-1);
    expect(cull).toBeGreaterThan(shadow);
    expect(draw).toBeGreaterThan(cull);
  });

  it("only the mirror registers rooms — it is the one thing that owns a room subtree", () => {
    expect(mirrorSrc).toContain("this.visibility.register(room.id, g, room.rect);");
    expect(bootstrapSrc).not.toContain("visibility.register(");
    // a rebuilt room must drop its stale registration first
    expect(mirrorSrc).toContain("this.visibility.unregister(room.id);");
  });

  it("bootstrap drives it from the ACTIVE camera, with the player's room kept", () => {
    const hook = bootstrapSrc.slice(bootstrapSrc.indexOf("R.cull = () => {"), bootstrapSrc.indexOf("// ---- loop ---"));
    expect(hook).toContain("mirror.visibility.update(R.activeCamera");
    expect(hook).toContain("keep: playerRoomId()");
    expect(hook).toContain("shadows: R.renderer.shadowMap.enabled");
    // camera visibility is authoritative: the hook must not gate anything on where the player IS
    expect(hook).not.toContain("playerMode");
  });

  it("leaves the CAVE alone — it is not a room group and is never registered", () => {
    expect(bootstrapSrc).toContain("R.scene.add(caveBuild.group);");
    expect(mirrorSrc).not.toContain("cave");
  });
});
