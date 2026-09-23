import { describe, expect, it } from "vitest";
import { EXECUTIVE_ROOM } from "./rooms/executive";
import { CMS_ROOM } from "./rooms/cms";
import { AI_ROOM } from "./rooms/ai";
import { DEV_ROOM } from "./rooms/dev";
import { QA_ROOM } from "./rooms/qa";
import { CENTRAL_HUB } from "./rooms/central-hub";
import * as THREE from "three";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack, NavigationController } from "./avatar/Controller";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, CHAIR_4_ID, WORLD_SHIFT_Z, designRoomEntities, RECT, V1_RECT } from "./rooms/design-room";
import { Walkability, composeStatic } from "./nav/Walkability";
import { registerGroundFloor } from "./rooms/ground-floor";
import { MEETING_ROOM } from "./rooms/meeting";
import { PROJECT_ROOM } from "./rooms/project";
import { GAMING_ROOM } from "./rooms/gaming";
import { RECEPTION_ROOM } from "./rooms/reception";
import { clearanceLayer, worldClearances } from "./nav/clearance";
import { planWalk } from "./nav/planner";
import { v1Static } from "./adapters/v1Grid";
import { DerivedNav } from "./nav/derived";
import { SeatInteraction } from "./interact/Seat";
import { pointInRect, type Vec2 } from "./core/coords";

// REGRESSION INVARIANT: forward (model +z rotated by the root) must match actual X/Z displacement on every
// leg — production-static paths, dynamic-obstacle paths, redirects, after re-parenting (chair ride), after sit/stand.
/** WORLD frame: for the cross-world legs, which route over the real registered world. */
const W = (x: number, z: number): Vec2 => ({ x: RECT.x + x, z: RECT.z + z });
/** V1 frame: for the legs walked over the RAW V1 grid (`new Walkability(v1Static)`), which is painted in
 *  the room's V1 art box and is unaffected by where V2 builds the room (design-room WORLD_SHIFT_Z). */
const V = (x: number, z: number): Vec2 => ({ x: V1_RECT.x + x, z: V1_RECT.z + z });
const V1_FLOOR = { ...DESIGN_ROOM.floorRect, z: DESIGN_ROOM.floorRect.z - WORLD_SHIFT_Z };
const inBounds = (p: Vec2) => pointInRect(p, DESIGN_ROOM.floorRect);
const v1InBounds = (p: Vec2) => pointInRect(p, V1_FLOOR);
const fwd = new THREE.Vector3();
function walkAndCheck(av: Avatar, nav: NavigationController, label: string): void {
  let settle = 0;
  for (let i = 0; i < 6000 && nav.moving; i++) {
    const before = av.worldPosition();
    nav.update(1 / 60);
    const after = av.worldPosition();
    const dx = after.x - before.x, dz = after.z - before.z, len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    av.root.updateMatrixWorld(true); av.root.getWorldDirection(fwd);
    const dot = (fwd.x * dx + fwd.z * dz) / len;
    settle = dot > 0.98 ? 0 : settle + 1;
    expect(settle, `${label}: facing away from movement for >0.5s (cos=${dot.toFixed(2)} at ${after.x.toFixed(0)},${after.z.toFixed(0)})`).toBeLessThan(30);
  }
}
/** legs over the RAW V1 grid, in the V1 frame */
const LEGS: [string, Vec2, Vec2][] = [
  ["north", V(270.5, 190), V(270.5, 56)], ["south", V(270.5, 56), V(270.5, 190)],
  ["east", V(40, 56), V(290, 56)], ["west", V(290, 56), V(40, 56)], ["diagonal", V(290, 56), V(200, 125)],
];
/** the same legs over the BUILT room, in the world frame — for the tests that also touch its entities */
const WORLD_LEGS: [string, Vec2, Vec2][] = [
  ["north", W(270.5, 190), W(270.5, 56)], ["south", W(270.5, 56), W(270.5, 190)],
  ["east", W(40, 56), W(290, 56)], ["west", W(290, 56), W(40, 56)], ["diagonal", W(290, 56), W(200, 125)],
];
/** GEOMETRY-AUTHORITATIVE walkability for the built Design Room: the room's own walls, footprints and
 *  doors decide, exactly as app/bootstrap composes it. Used wherever a leg has to agree with the room's
 *  CURRENT geometry rather than with V1's painting of it. */
function derivedWk(w: WorldState): Walkability {
  // DerivedNav only governs cells that stand on a registered walkable region, so the room's own floor is
  // declared here — the minimal equivalent of what registerGroundFloor does in the app
  w.bounds = { x: 0, z: 0, w: 1440, d: 1248 };
  w.addRegion({ id: `floor:${DESIGN_ROOM.id}`, kind: "room-floor", rect: DESIGN_ROOM.floorRect, walkable: true, roomId: DESIGN_ROOM.id });
  const wk = new Walkability(composeStatic(v1Static, inBounds, clearanceLayer(worldClearances(w))));
  wk.attachDerived(new DerivedNav(w, { roomIds: new Set([DESIGN_ROOM.id]) }), w);
  wk.syncFromWorld(w);
  return wk;
}
function rig() {
  const av = new Avatar({ height: 36, lit: true });
  const stack = new ControllerStack();
  const nav = new NavigationController(av, stack);
  return { av, stack, nav };
}

describe("vo3d avatar faces its movement direction", () => {
  it("static (production-grid) paths: north/south/east/west/diagonal", () => {
    const { av, nav } = rig(); const wk = new Walkability(v1Static);
    for (const [label, from, to] of LEGS) { av.setPosition(from); const r = planWalk(from, to, wk, v1InBounds); expect(r.ok, label).toBe(true); if (r.ok) { nav.setPath(r.path); walkAndCheck(av, nav, `static ${label}`); } }
  });
  it("dynamic-obstacle paths (plant on column 17) including the forced detour", () => {
    const { av, nav } = rig(); const w = new WorldState(); w.addRoom(DESIGN_ROOM); w.addRoom(RECEPTION_ROOM); for (const e of designRoomEntities()) w.addEntity(e);
    w.commit((tx) => tx.setTransform(`${DESIGN_ROOM.id}/plant-10`, { pos: W(270.5, 125), yaw: 0 }));
    const wk = derivedWk(w); // the moved plant is CURRENT geometry: the room's own nav has to see it
    for (const [label, from, to] of WORLD_LEGS) { av.setPosition(from); const r = planWalk(from, to, wk, inBounds); expect(r.ok, label).toBe(true); if (r.ok) { nav.setPath(r.path); walkAndCheck(av, nav, `dynamic ${label}`); } }
  });
  it("redirect mid-walk keeps facing the new direction", () => {
    const { av, nav } = rig(); const wk = new Walkability(v1Static);
    av.setPosition(V(290, 56));
    const r1 = planWalk(V(290, 56), V(112, 196), wk, v1InBounds); expect(r1.ok).toBe(true); if (r1.ok) nav.setPath(r1.path);
    for (let i = 0; i < 40; i++) nav.update(1 / 60);
    const r2 = planWalk(av.position, V(40, 56), wk, v1InBounds); expect(r2.ok).toBe(true); if (r2.ok) nav.setPath(r2.path);
    walkAndCheck(av, nav, "redirect");
  });
  it("cross-world legs (Design Room ↔ hall through the real doorway, long straights, turns, redirect) keep facing", () => {
    const { av, nav } = rig(); const w = new WorldState(); w.addRoom(DESIGN_ROOM); w.addRoom(RECEPTION_ROOM); for (const e of designRoomEntities()) w.addEntity(e);
    w.addRoom(MEETING_ROOM);
    w.addRoom(PROJECT_ROOM);
    w.addRoom(GAMING_ROOM);
    w.addRoom(CENTRAL_HUB);
    w.addRoom(EXECUTIVE_ROOM);
    w.addRoom(CMS_ROOM);
    w.addRoom(AI_ROOM);
    w.addRoom(DEV_ROOM);
    w.addRoom(QA_ROOM);
    registerGroundFloor(w);
    const worldBounds = (p: Vec2) => w.walkableAt(p);
    const wk = new Walkability(composeStatic(v1Static, worldBounds, clearanceLayer(worldClearances(w)))); wk.syncFromWorld(w);
    const approach = W(174.5, 187.8), hallExec = { x: 728, z: 312 }, hallReception = { x: 712, z: 824 }, hallQa = { x: 344, z: 664 };
    const legs: [string, Vec2, Vec2][] = [["out: approach → exec door", approach, hallExec], ["hall: exec door → reception", hallExec, hallReception], ["hall: reception → QA door", hallReception, hallQa], ["in: QA door → approach", hallQa, approach]];
    for (const [label, from, to] of legs) { av.setPosition(from); const r = planWalk(from, to, wk, worldBounds); expect(r.ok, label).toBe(true); if (r.ok) { nav.setPath(r.path); walkAndCheck(av, nav, label); expect(av.position.x).toBeCloseTo(r.destination.x, 6); expect(av.position.z).toBeCloseTo(r.destination.z, 6); } }
    // redirect while crossing the hall: turn around and come back through the door
    av.setPosition(approach);
    const r1 = planWalk(approach, hallExec, wk, worldBounds); expect(r1.ok).toBe(true); if (r1.ok) nav.setPath(r1.path);
    for (let i = 0; i < 1200 && w.regionAt(av.position)?.id !== "shared:ground-floor"; i++) nav.update(1 / 60);
    for (let i = 0; i < 90; i++) nav.update(1 / 60); // 1.5 s further into the hall
    expect(w.regionAt(av.position)?.id).toBe("shared:ground-floor"); expect(nav.moving).toBe(true);
    const r2 = planWalk(av.position, approach, wk, worldBounds); expect(r2.ok).toBe(true); if (r2.ok) { nav.setPath(r2.path); walkAndCheck(av, nav, "redirect back into the Design Room"); }
    expect(w.regionAt(av.position)?.id).toBe("floor:design-room");
  });
  it("after a chair ride (attach at yaw π → detach) the avatar faces north when walking north", () => {
    const { av, nav } = rig(); const scene = new THREE.Object3D(), chair = new THREE.Object3D(); scene.add(chair); scene.add(av.root);
    av.setPosition(V(270.5, 190)); av.setYaw(Math.PI);
    av.attachTo(chair); av.detachTo(scene);
    expect(Math.abs(av.root.rotation.x)).toBeLessThan(1e-9); expect(Math.abs(av.root.rotation.z)).toBeLessThan(1e-9);
    const wk = new Walkability(v1Static);
    const r = planWalk(V(270.5, 190), V(270.5, 56), wk, v1InBounds); expect(r.ok).toBe(true); if (r.ok) { nav.setPath(r.path); walkAndCheck(av, nav, "post-attach north"); }
  });
  it("after a full sit → stand cycle through SeatInteraction, walking in every direction faces correctly", () => {
    const { av, stack, nav } = rig(); const w = new WorldState(); w.addRoom(DESIGN_ROOM); w.addRoom(RECEPTION_ROOM); for (const e of designRoomEntities()) w.addEntity(e);
    const wk = derivedWk(w); // the chair is a BUILT entity: judge the walk by the room's own geometry
    const scene = new THREE.Object3D(); scene.add(av.root);
    const chairE = w.get(CHAIR_4_ID); const chair = new THREE.Object3D(); chair.position.set(chairE.transform.pos.x, 0, chairE.transform.pos.z); scene.add(chair);
    av.setPosition(W(270, 190));
    const seat = new SeatInteraction(av, stack, chair, chairE.capabilities.seat!, (to) => planWalk(av.position, to, wk, inBounds));
    expect(seat.sit()?.ok).toBe(true);
    for (let t = 0; t < 20 && seat.state !== "seated"; t += 1 / 60) { seat.update(1 / 60); nav.update(1 / 60); }
    expect(seat.state).toBe("seated"); expect(stack.owner).toBe("Interaction");
    seat.stand();
    for (let t = 0; t < 20 && seat.state !== "idle"; t += 1 / 60) { seat.update(1 / 60); nav.update(1 / 60); }
    expect(seat.state).toBe("idle"); expect(stack.owner).toBe("Idle");
    for (const [label, , to] of WORLD_LEGS) { const r = planWalk(av.position, to, wk, inBounds); expect(r.ok, label).toBe(true); if (r.ok) { nav.setPath(r.path); walkAndCheck(av, nav, `post-sit ${label}`); } }
  });
});
