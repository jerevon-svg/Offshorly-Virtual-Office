// ROOM EDITOR V2 — SLICE 2. Functional-furniture anchors riding the transform, the asset library,
// duplicate / delete with undo, the surface + material registry and LED editing.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, DESIGN_SOLIDS, CHAIR_4_ID, designRoomEntities, SHELL } from "./rooms/design-room";
import { QA_ROOM, QA_SEAT_IDS, QA_LOUNGE_IDS, qaRoomEntities } from "./rooms/qa";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { Walkability } from "./nav/Walkability";
import { v1Static } from "./adapters/v1Grid";
import { SceneMirror } from "./render/SceneMirror";
import { EditSession } from "./editor/EditSession";
import { applyEditablePolicy, deleteBlocked, isEditable } from "./editor/editable";
import { bindAnchors, groundAnchors, retargetAnchors } from "./editor/anchors";
import { ASSET_CATEGORIES, ASSET_LIBRARY, assetEntity, findAsset, itemsIn, assetKey } from "./editor/library";
import { SurfaceRegistry, clampSpec, presetsFor, specFromTag, surfaceTagOf, type SurfaceTag } from "./editor/surfaces";
import { LedRegistry, clampEmissive, ledTagOf, specFromLedTag } from "./editor/emissive";
import { buildEntity } from "./build/registry";
import { EditorGizmo } from "./editor/EditorGizmo";
import { finalizeSucculents, smallPot } from "./build/props";
import { ControllerStack } from "./avatar/Controller";
import type { Vec2 } from "./core/coords";

/** one room, entities + scene. Two rooms where a test needs a second room's furniture. */
function rig(rooms: { room: typeof DESIGN_ROOM; ents: ReturnType<typeof designRoomEntities> }[] = [{ room: DESIGN_ROOM, ents: designRoomEntities() }]) {
  const world = new WorldState();
  for (const r of rooms) {
    world.addRoom(r.room);
    for (const e of r.ents) world.addEntity(e);
    world.addRegion({ id: `floor:${r.room.id}`, kind: "room-floor", rect: r.room.floorRect, walkable: true, roomId: r.room.id });
  }
  if (rooms[0].room.id === DESIGN_ROOM.id)
    DESIGN_SOLIDS.forEach((r, i) => world.addEntity({ id: `s${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {} }));
  const ids = applyEditablePolicy(world);
  const scene = new THREE.Scene();
  const mirror = new SceneMirror(world, scene);
  const surfaces = new SurfaceRegistry();
  const leds = new LedRegistry();
  for (const r of rooms) {
    mirror.buildRoom(r.room, { wallHeight: SHELL.wallHeight, frontWall: "low" });
    const g = mirror.roomGroup(r.room.id)!;
    surfaces.collect(r.room.id, g);
    leds.collect(r.room.id, g);
  }
  const wk = new Walkability(v1Static);
  wk.syncFromWorld(world);
  const edit = new EditSession(world, mirror, wk, new ControllerStack(), { surfaces, leds });
  edit.setEditMode(true);
  return { world, mirror, wk, edit, ids, surfaces, leds, scene };
}
const qaRig = () => rig([{ room: QA_ROOM, ents: qaRoomEntities() }]);

/** Place `item` on the first square of Design Room floor where the editor says it actually fits. A new
 *  piece gets no contact baseline, so "somewhere near the middle" genuinely is refused where the room
 *  already has furniture — the search is the honest way to ask for an empty spot. */
function placeSomewhereFree(edit: EditSession, item = ASSET_LIBRARY[0]) {
  const f = DESIGN_ROOM.floorRect;
  for (let gx = 20; gx < f.w - 20; gx += 14)
    for (let gz = 20; gz < f.d - 20; gz += 14) {
      const r = edit.placeAsset(item, { x: f.x + gx, z: f.z + gz });
      if (r.id && r.check.ok) return r;
      if (r.id) edit.cancel();
    }
  throw new Error("no free floor for the probe asset");
}

// ---- 1. functional furniture transforms ------------------------------------------------------------
describe("slice 2 — gameplay anchors ride the transform", () => {
  it("a moved seat takes its approach, pre-seat, waypoints and seated facing with it", () => {
    const world = new WorldState();
    world.addRoom(DESIGN_ROOM);
    for (const e of designRoomEntities()) world.addEntity(e);
    const chair = world.get(CHAIR_4_ID);
    const before = chair.capabilities.seat!;
    const binding = bindAnchors(chair);
    const moved = retargetAnchors(binding, { pos: { x: chair.transform.pos.x + 40, z: chair.transform.pos.z - 25 }, yaw: chair.transform.yaw });
    expect(moved.seat!.approach.x).toBeCloseTo(before.approach.x + 40, 6);
    expect(moved.seat!.approach.z).toBeCloseTo(before.approach.z - 25, 6);
    expect(moved.seat!.preSeat.x).toBeCloseTo(before.preSeat.x + 40, 6);
    expect(moved.seat!.approachToSeat).toHaveLength(before.approachToSeat.length);
    moved.seat!.approachToSeat.forEach((p, i) => expect(p.x).toBeCloseTo(before.approachToSeat[i].x + 40, 6));
    expect(moved.seat!.seatedYaw).toBeCloseTo(before.seatedYaw, 6); // pure translation turns nothing
  });
  it("a rotated seat turns its anchors about the piece, not about the world origin", () => {
    const world = new WorldState();
    world.addRoom(DESIGN_ROOM);
    for (const e of designRoomEntities()) world.addEntity(e);
    const chair = world.get(CHAIR_4_ID);
    const before = chair.capabilities.seat!;
    const pivot = chair.transform.pos;
    const moved = retargetAnchors(bindAnchors(chair), { pos: pivot, yaw: chair.transform.yaw + Math.PI / 2 });
    // the distance from the piece is invariant under a rotation about the piece — that IS the test
    const d = (p: Vec2) => Math.hypot(p.x - pivot.x, p.z - pivot.z);
    expect(d(moved.seat!.approach)).toBeCloseTo(d(before.approach), 6);
    expect(d(moved.seat!.preSeat)).toBeCloseTo(d(before.preSeat), 6);
    expect(moved.seat!.seatedYaw).toBeCloseTo(before.seatedYaw + Math.PI / 2, 6);
    // the pull direction is a DIRECTION: it turns and keeps its length
    expect(Math.hypot(moved.seat!.pullDir.x, moved.seat!.pullDir.z)).toBeCloseTo(Math.hypot(before.pullDir.x, before.pullDir.z), 6);
    // local offsets are untouched
    expect(moved.seat!.cushionLocal).toEqual(before.cushionLocal);
    expect(moved.seat!.sitDepth).toBe(before.sitDepth);
  });
  it("retargeting is computed from the AUTHORED frame, so repeated moves never drift", () => {
    const world = new WorldState();
    world.addRoom(DESIGN_ROOM);
    for (const e of designRoomEntities()) world.addEntity(e);
    const chair = world.get(CHAIR_4_ID);
    const binding = bindAnchors(chair);
    const t = chair.transform;
    for (let i = 0; i < 50; i++) retargetAnchors(binding, { pos: { x: t.pos.x + i, z: t.pos.z + i }, yaw: t.yaw + i * 0.1 });
    const back = retargetAnchors(binding, { pos: { ...t.pos }, yaw: t.yaw });
    expect(back.seat!.approach).toEqual(chair.capabilities.seat!.approach);
    expect(back.seat!.seatedYaw).toBe(chair.capabilities.seat!.seatedYaw);
  });
  it("a lounge slot's approach moves and its LOCAL cushion contact does not", () => {
    const world = new WorldState();
    world.addRoom(QA_ROOM);
    for (const e of qaRoomEntities()) world.addEntity(e);
    const sofa = world.get(QA_LOUNGE_IDS[0]);
    const before = sofa.capabilities.lounge!.slots;
    const moved = retargetAnchors(bindAnchors(sofa), { pos: { x: sofa.transform.pos.x + 12, z: sofa.transform.pos.z }, yaw: sofa.transform.yaw });
    moved.lounge!.slots.forEach((s, i) => {
      expect(s.approach.x).toBeCloseTo(before[i].approach.x + 12, 6);
      expect(s.contactLocal).toEqual(before[i].contactLocal);
      expect(s.id).toBe(before[i].id);
    });
  });
  it("a confirmed move commits transform AND anchors in ONE world transaction", () => {
    const { world, edit } = qaRig();
    const id = QA_SEAT_IDS[0];
    const before = world.get(id).capabilities.seat!.approach;
    let versions = 0;
    world.changes.on(() => versions++);
    edit.select(id);
    edit.setAxis("x", world.get(id).transform.pos.x + 8);
    const v = edit.confirm();
    expect(v.ok, `confirm rejected: ${v.ok ? "" : v.reason}`).toBe(true);
    expect(versions).toBe(1); // one event — never a transform visible without its anchors
    expect(world.get(id).capabilities.seat!.approach.x).toBeCloseTo(before.x + 8, 6);
    expect(world.get(id).transform.pos.x).toBeCloseTo(edit.currentPos()!.x, 6);
  });
  it("undo restores the anchors exactly, not approximately", () => {
    const { world, edit } = qaRig();
    const id = QA_SEAT_IDS[0];
    const before = JSON.parse(JSON.stringify(world.get(id).capabilities.seat));
    edit.select(id);
    edit.setAxis("x", world.get(id).transform.pos.x + 8);
    edit.confirm();
    edit.undo();
    expect(world.get(id).capabilities.seat).toEqual(before);
  });
  it("refuses a move that would strand a stand-here anchor outside the walkable world", () => {
    const { world, edit } = qaRig();
    const id = QA_SEAT_IDS[0];
    edit.select(id);
    // push the chair hard into the room's north-west corner: the piece may fit where its approach cell
    // does not, and that is exactly the failure Slice 1 could not see
    const f = QA_ROOM.floorRect;
    const check = edit.preview({ x: f.x + 12, z: f.z + 12 });
    if (check.ok) {
      // if it genuinely fits, every anchor must genuinely be on floor — the rule, either way
      for (const p of groundAnchors(edit.anchorsAt(id, edit.currentTransform()!))) expect(world.walkableAt(p)).toBe(true);
    } else {
      expect(["anchor-blocked", "outside-room", "overlaps-furniture"]).toContain(check.reason);
    }
  });
});

// ---- 2. asset library ------------------------------------------------------------------------------
describe("slice 2 — asset library", () => {
  it("every catalogue item is an EXISTING production builder and every category is populated", () => {
    for (const item of ASSET_LIBRARY) {
      const e = assetEntity(item, `design-room/probe`, DESIGN_ROOM.id, { x: 0, z: 0 });
      expect(() => buildEntity(e), `${item.kind} has no builder`).not.toThrow();
    }
    for (const c of ASSET_CATEGORIES) expect(itemsIn(c).length, `${c} is empty`).toBeGreaterThan(0);
  });
  it("a NEW piece gets no contact baseline: dropping it onto existing furniture is refused", () => {
    const { world, edit } = rig();
    const desk = [...world.entities.values()].find((e) => e.kind === "member-desk")!;
    const r = edit.placeAsset(ASSET_LIBRARY[0], { ...desk.transform.pos });
    expect(r.id).toBeTruthy();
    expect(r.check.ok).toBe(false);
    expect(edit.confirm().ok).toBe(false); // the returned check and the confirm agree
    edit.cancel();
  });
  it("a placed asset is a real entity: it exists, it is built, and it blocks navigation once confirmed", () => {
    const { world, mirror, edit, wk } = rig();
    const item = findAsset(assetKey(itemsIn("Plants")[0]))!;
    const before = world.entities.size;
    const r = placeSomewhereFree(edit, item);
    expect(r.id).toBeTruthy();
    expect(world.entities.size).toBe(before + 1);
    expect(mirror.hasView(r.id!)).toBe(true);
    expect(edit.pending).toBe(r.id);
    const v = edit.confirm();
    expect(v.ok, `confirm rejected: ${v.ok ? "" : v.reason}`).toBe(true);
    expect(edit.pending).toBeNull();
    expect(wk.dynamicBlockedKeys.length).toBeGreaterThan(0);
  });
  it("cancel removes a placed asset without a trace, and leaves no history", () => {
    const { world, mirror, edit } = rig();
    const before = world.entities.size;
    const r = placeSomewhereFree(edit, findAsset(assetKey(itemsIn("Tables")[0]))!);
    expect(r.id).toBeTruthy();
    edit.cancel();
    expect(world.entities.size).toBe(before);
    expect(mirror.hasView(r.id!)).toBe(false);
    expect(edit.canUndo).toBe(false);
  });
  it("refuses to place outside the modelled world", () => {
    const { edit } = rig();
    const r = edit.placeAsset(ASSET_LIBRARY[0], { x: -9999, z: -9999 });
    expect(r.id).toBeNull();
    expect(r.check.ok).toBe(false);
  });
  it("a placed asset is editable and deletable by construction", () => {
    const { world, edit } = rig();
    const r = placeSomewhereFree(edit, findAsset(assetKey(itemsIn("Plants")[2]))!);
    expect(edit.confirm().ok).toBe(true);
    const e = world.get(r.id!);
    expect(isEditable(e)).toBe(true);
    expect(deleteBlocked(e)).toBeNull();
  });
});

// ---- 3. duplicate + delete -------------------------------------------------------------------------
describe("slice 2 — duplicate, delete, undo/redo", () => {
  it("duplicate makes a new independent entity offset from the original, and drops gameplay wiring", () => {
    const { world, edit } = qaRig();
    edit.select(QA_SEAT_IDS[0]);
    const src = world.get(QA_SEAT_IDS[0]);
    const r = edit.duplicate();
    expect(r.id).toBeTruthy();
    const copy = world.get(r.id!);
    expect(copy.kind).toBe(src.kind);
    expect(copy.transform.pos).not.toEqual(src.transform.pos);
    expect(copy.capabilities.seat).toBeUndefined(); // a copy is a prop, never a second seat
    expect(copy.capabilities.editable).toBe(true);
  });
  it("delete removes a plain piece and undo brings back the same object", () => {
    const { world, mirror, edit } = rig();
    const plant = [...world.entities.values()].find((e) => e.kind === "plant" && isEditable(e))!;
    const snapshot = JSON.parse(JSON.stringify(plant));
    edit.select(plant.id);
    expect(edit.remove().ok).toBe(true);
    expect(world.entities.has(plant.id)).toBe(false);
    expect(mirror.hasView(plant.id)).toBe(false);
    edit.undo();
    expect(world.entities.has(plant.id)).toBe(true);
    expect(JSON.parse(JSON.stringify(world.get(plant.id)))).toEqual(snapshot);
    expect(mirror.hasView(plant.id)).toBe(true);
    edit.redo();
    expect(world.entities.has(plant.id)).toBe(false);
  });
  it("undo of a placement removes the piece; redo puts it back", () => {
    const { world, mirror, edit } = rig();
    const r = placeSomewhereFree(edit, findAsset(assetKey(itemsIn("Chairs")[0]))!);
    expect(edit.confirm().ok).toBe(true);
    expect(world.entities.has(r.id!)).toBe(true);
    edit.undo();
    expect(world.entities.has(r.id!)).toBe(false);
    expect(mirror.hasView(r.id!)).toBe(false);
    edit.redo();
    expect(world.entities.has(r.id!)).toBe(true);
    expect(mirror.hasView(r.id!)).toBe(true);
  });
  it("PROTECTION: a gameplay piece may be moved but never deleted, and architecture is neither", () => {
    const { world, edit } = qaRig();
    edit.select(QA_SEAT_IDS[0]);
    expect(edit.remove()).toEqual({ ok: false, reason: "protected" });
    expect(world.entities.has(QA_SEAT_IDS[0])).toBe(true);
    for (const e of world.entities.values()) {
      if (e.capabilities.door || e.capabilities.clearance || e.source?.baked) expect(deleteBlocked(e)).not.toBeNull();
      // a gameplay piece is never deletable: "system" when it is otherwise editable, "locked" when the
      // edit policy already refuses it for another reason (no footprint, baked geometry)
      if (e.capabilities.seat || e.capabilities.lounge || e.capabilities.approach) expect(deleteBlocked(e)).not.toBeNull();
    }
  });
});

// ---- 4 + 5. surfaces, materials and colour ----------------------------------------------------------
describe("slice 2 — surface / material registry", () => {
  it("floors and walls are addressable, and a surface tag is found through the mesh hierarchy", () => {
    const { surfaces, mirror } = rig();
    expect(surfaces.size).toBeGreaterThan(0);
    const kinds = new Set(surfaces.all().map((e) => e.tag.kind));
    expect(kinds.has("floor")).toBe(true);
    expect(kinds.has("wall")).toBe(true);
    const tagged = surfaces.all()[0].meshes[0].mesh;
    expect(surfaceTagOf(tagged)?.id).toBe(surfaces.all()[0].id);
    expect(surfaceTagOf(mirror.root)).toBeNull();
  });
  it("editing a surface is COPY-ON-WRITE: the shared material cache is never mutated", () => {
    const { surfaces, edit } = rig();
    const entry = surfaces.all().find((e) => e.tag.kind === "floor")!;
    const shared = entry.meshes[0].original as THREE.MeshStandardMaterial;
    const sharedColor = shared.color.getHex();
    const sharedRough = shared.roughness;
    edit.selectSurface(entry.id);
    edit.previewSurface({ ...entry.base, color: 0x112233, roughness: 0.2, brightness: 1, detail: 0.5 });
    expect((entry.meshes[0].mesh.material as THREE.Material).uuid).not.toBe(shared.uuid);
    expect(shared.color.getHex()).toBe(sharedColor);
    expect(shared.roughness).toBe(sharedRough);
  });
  it("apply / cancel / reset: cancel returns to the last applied, reset returns the room's own material", () => {
    const { surfaces, edit } = rig();
    const entry = surfaces.all().find((e) => e.tag.kind === "floor")!;
    const original = entry.meshes[0].original;
    edit.selectSurface(entry.id);
    edit.previewSurface({ ...entry.base, color: 0x445566 });
    expect(entry.pending).toBe(true);
    edit.confirm();
    expect(entry.pending).toBe(false);
    expect(entry.committed.color).toBe(0x445566);
    edit.previewSurface({ ...entry.committed, color: 0x998877 });
    edit.cancel();
    expect((entry.meshes[0].mesh.material as THREE.MeshStandardMaterial).color.getHex()).not.toBe(0x998877);
    edit.reset();
    expect(entry.meshes[0].mesh.material).toBe(original);
    expect(entry.committed).toEqual(entry.base);
  });
  it("a surface change is undoable through the same history as a transform", () => {
    const { surfaces, edit } = rig();
    const entry = surfaces.all().find((e) => e.tag.kind === "wall")!;
    edit.selectSurface(entry.id);
    edit.previewSurface({ ...entry.base, preset: "wood", color: 0x886644 });
    edit.confirm();
    expect(entry.committed.preset).toBe("wood");
    edit.undo();
    expect(surfaces.get(entry.id)!.committed).toEqual(entry.base);
    edit.redo();
    expect(surfaces.get(entry.id)!.committed.preset).toBe("wood");
  });
  it("the spec is bounded: nothing a designer can type makes a surface invisible or unbounded", () => {
    const wild = clampSpec({ preset: "nope" as never, color: 0xffffff * 9, brightness: 99, roughness: -5, detail: 4 });
    expect(wild.preset).toBe("stone");
    expect(wild.color).toBeLessThanOrEqual(0xffffff);
    expect(wild.brightness).toBe(1.5);
    expect(wild.roughness).toBe(0.04);
    expect(wild.detail).toBe(1);
  });
  it("floor treatments include the approved ones, and a wall is not offered a floor-only treatment", () => {
    for (const id of ["tile", "terrazzo", "stone", "wood", "concrete", "carpet"] as const) expect(presetsFor("floor")).toContain(id);
    expect(presetsFor("wall")).toContain("plaster");
    expect(presetsFor("wall")).not.toContain("terrazzo");
    expect(presetsFor("wall")).not.toContain("carpet");
  });
  it("a surface's starting spec is the treatment its room was BUILT with", () => {
    const tag: SurfaceTag = { id: "x/floor", kind: "floor", roomId: "x", label: "x", preset: "terrazzo", size: { u: 100, v: 100 } };
    expect(specFromTag(tag).preset).toBe("terrazzo");
    expect(specFromTag(tag).detail).toBe(1);
  });
});

// ---- 6. LED / emissive ------------------------------------------------------------------------------
describe("slice 2 — LED / emissive editing", () => {
  const gamingRig = () => rig([{ room: GAMING_ROOM, ents: gamingRoomEntities() }]);

  it("the Gaming Room's LED channels are addressable", () => {
    const { leds } = gamingRig();
    expect(leds.size).toBeGreaterThan(0);
    expect(leds.inRoom(GAMING_ROOM.id).length).toBe(leds.size);
    const e = leds.all()[0];
    expect(ledTagOf(e.meshes[0].mesh)?.id).toBe(e.id);
  });
  it("editing an LED is copy-on-write and adds NO real-time lights", () => {
    const { leds, edit, scene } = gamingRig();
    const before = countLights(scene);
    const entry = leds.all()[0];
    const shared = entry.meshes[0].original as THREE.MeshStandardMaterial;
    const sharedHex = shared.color.getHex();
    edit.selectLed(entry.id);
    edit.previewLed({ ...entry.base, color: 0x00ff88, intensity: 2.4, glow: 0.4 });
    expect((entry.meshes[0].mesh.material as THREE.Material).uuid).not.toBe(shared.uuid);
    expect(shared.color.getHex()).toBe(sharedHex);
    expect(countLights(scene)).toBe(before);
  });
  it("the emitter takes colour + intensity and the spill takes colour + opacity", () => {
    const { leds, edit } = gamingRig();
    const entry = leds.all().find((e) => e.meshes.some((m) => m.role === "wash")) ?? leds.all()[0];
    edit.selectLed(entry.id);
    edit.previewLed({ color: 0x00ff88, intensity: 2.4, glow: 0.4 });
    for (const m of entry.meshes) {
      const mat = m.mesh.material as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
      expect(mat.color.getHex()).toBe(0x00ff88);
      if (m.role === "emitter") expect(mat.emissiveIntensity).toBeCloseTo(2.4, 6);
      else { expect(mat.opacity).toBeCloseTo(0.4, 6); expect(mat.userData.baseOpacity).toBeCloseTo(0.4, 6); }
    }
  });
  it("apply / cancel / reset and undo behave exactly as a surface's do", () => {
    const { leds, edit } = gamingRig();
    const entry = leds.all()[0];
    const original = entry.meshes[0].original;
    edit.selectLed(entry.id);
    edit.previewLed({ ...entry.base, intensity: 2.2 });
    edit.confirm();
    expect(entry.committed.intensity).toBeCloseTo(2.2, 6);
    edit.undo();
    expect(leds.get(entry.id)!.committed).toEqual(entry.base);
    expect(entry.meshes[0].mesh.material).toBe(original);
    edit.redo();
    expect(leds.get(entry.id)!.committed.intensity).toBeCloseTo(2.2, 6);
    edit.reset();
    expect(entry.meshes[0].mesh.material).toBe(original);
  });
  it("the emissive spec is bounded", () => {
    const wild = clampEmissive({ color: -5, intensity: 40, glow: 9 });
    expect(wild.color).toBe(0);
    expect(wild.intensity).toBe(3);
    expect(wild.glow).toBe(1);
    expect(specFromLedTag({ id: "a", roomId: "r", label: "l", color: "cyan", intensity: 1.4, glow: 0.2 }).intensity).toBe(1.4);
  });
});

function countLights(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => { if ((c as THREE.Light).isLight) n++; });
  return n;
}

// ---- gizmo bounds ----------------------------------------------------------------------------------
describe("slice 2 — the rotation ring describes the OBJECT", () => {
  it("finalizeSucculents bakes ROOT-LOCAL instance matrices, so a translated root is not double-counted", () => {
    // the entity-view case: a group already standing at its world position, finalized on its own
    const view = new THREE.Group();
    view.position.set(500, 0, 400);
    view.add(smallPot(4, 24, 2)); // the builders author a prop LOCAL to its piece
    const { plants, meshes } = finalizeSucculents(view);
    expect(plants).toBe(1);
    const at = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(meshes[0].instanceMatrix.array, 0));
    // 4 units from the piece — not 504, which is what baking the WORLD matrix into a child of an
    // already-positioned group produced, and what dragged the ring back toward the world origin
    expect(at.x).toBeCloseTo(4, 3);
    expect(at.z).toBeCloseTo(2, 3);
  });
  it("a room group at the origin is unaffected — every authored room measures exactly as before", () => {
    const root = new THREE.Group(); // rooms are finalized at identity
    root.add(smallPot(504, 24, 402));
    const { meshes } = finalizeSucculents(root);
    const at = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(meshes[0].instanceMatrix.array, 0));
    expect(at.x).toBeCloseTo(504, 3);
    expect(at.z).toBeCloseTo(402, 3);
  });
  it("the ring is measured in the view's own frame: moving a piece across the office never changes it", () => {
    const scene = new THREE.Scene();
    const gizmo = new EditorGizmo(scene);
    const view = new THREE.Group();
    view.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 30)));
    scene.add(view);
    gizmo.attach(view);
    const near = gizmo.ringRadius;
    view.position.set(900, 0, 1400);
    gizmo.attach(view);
    expect(gizmo.ringRadius).toBeCloseTo(near, 6);
    gizmo.dispose();
  });
  it("the radius is CLAMPED, so a malformed world-sized bound can never swallow the room", () => {
    const scene = new THREE.Scene();
    const gizmo = new EditorGizmo(scene);
    const view = new THREE.Group();
    view.position.set(400, 0, 700);
    view.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 30)));
    // a child left in WORLD coordinates inside an already-positioned group — the failure class itself
    const rogue = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    rogue.position.set(400, 0, 700);
    view.add(rogue);
    scene.add(view);
    gizmo.attach(view);
    expect(gizmo.ringRadius).toBeLessThanOrEqual(140);
    expect(gizmo.ringRadius).toBeGreaterThanOrEqual(12);
    gizmo.dispose();
  });
  it("an empty view still gets a usable ring rather than a zero one", () => {
    const scene = new THREE.Scene();
    const gizmo = new EditorGizmo(scene);
    gizmo.attach(new THREE.Group());
    expect(gizmo.ringRadius).toBeGreaterThanOrEqual(12);
    gizmo.dispose();
  });
  it("every library item builds to FINITE geometry — a missing prop must never hand a builder NaN", () => {
    for (const item of ASSET_LIBRARY) {
      const { group } = buildEntity(assetEntity(item, "design-room/probe", DESIGN_ROOM.id, { x: 500, z: 400 }));
      group.updateWorldMatrix(false, true);
      group.traverse((o) => {
        for (const v of o.matrixWorld.elements) expect(Number.isFinite(v), `${item.label}: NaN in world matrix`).toBe(true);
      });
    }
  });
  it("every library asset gets a ring that fits the piece, small through large", () => {
    const scene = new THREE.Scene();
    const gizmo = new EditorGizmo(scene);
    for (const item of ASSET_LIBRARY) {
      const { group } = buildEntity(assetEntity(item, "design-room/probe", DESIGN_ROOM.id, { x: 500, z: 400 }));
      scene.add(group);
      gizmo.attach(group);
      expect(gizmo.ringRadius, `${item.label} ring`).toBeGreaterThanOrEqual(12);
      expect(gizmo.ringRadius, `${item.label} ring`).toBeLessThanOrEqual(140);
      // and it is a MEASUREMENT, not the floor: every catalogue piece is bigger than the minimum
      expect(gizmo.ringRadius, `${item.label} fell back to the minimum radius`).toBeGreaterThan(12);
      scene.remove(group);
    }
    gizmo.dispose();
  });
});

// ---- 7. mode discipline -----------------------------------------------------------------------------
describe("slice 2 — one focused mode at a time", () => {
  it("selecting a surface clears an entity selection and vice versa", () => {
    const { surfaces, edit, world } = rig();
    const plant = [...world.entities.values()].find((e) => isEditable(e))!;
    edit.select(plant.id);
    edit.selectSurface(surfaces.all()[0].id);
    expect(edit.selected).toBeNull();
    edit.select(plant.id);
    expect(edit.selectedSurface).toBeNull();
    expect(edit.selectedLed).toBeNull();
  });
  it("leaving edit mode clears every selection and every pending preview", () => {
    const { surfaces, edit } = rig();
    edit.selectSurface(surfaces.all()[0].id);
    edit.setEditMode(false);
    expect(edit.selectedSurface).toBeNull();
    expect(edit.hasPending).toBe(false);
  });
});
