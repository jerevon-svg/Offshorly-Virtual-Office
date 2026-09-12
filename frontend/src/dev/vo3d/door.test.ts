import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WorldState } from "./world/WorldState";
import { DESIGN_ROOM, DESIGN_DOOR, DOOR_ID, CHAIR_4_ID, designRoomEntities, RECT, SHELL } from "./rooms/design-room";
import { registerGroundFloor } from "./rooms/ground-floor";
import { MEETING_ROOM } from "./rooms/meeting";
import { PROJECT_ROOM } from "./rooms/project";
import { GAMING_ROOM } from "./rooms/gaming";
import { RECEPTION_ROOM } from "./rooms/reception";
import { Walkability, composeStatic } from "./nav/Walkability";
import { clearanceLayer, worldClearances } from "./nav/clearance";
import { planWalk } from "./nav/planner";
import { v1Static, worldToCell } from "./adapters/v1Grid";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack, NavigationController } from "./avatar/Controller";
import { SlidingDoor, segmentHitsRect, type DoorState } from "./interact/Door";
import { SeatInteraction } from "./interact/Seat";
import { circleOverlapsRect, type Rect, type Vec2 } from "./core/coords";

const APPROACH: Vec2 = { x: RECT.x + 174.5, z: RECT.z + 187.8 };
const HALL: Vec2 = { x: 728, z: 312 }; // outside stand in front of the Executive door
const HALL_NEAR: Vec2 = { x: 408, z: 424 }; // hall, 90 units east of the door, level with the passage
const DT = 1 / 60;
const R = DESIGN_DOOR.clearance.bodyRadius;
const LEAF_W = SHELL.glass.doorZ1 - SHELL.glass.z0 - 2;

function rig() {
  const world = new WorldState();
  world.addRoom(DESIGN_ROOM);
  world.addRoom(RECEPTION_ROOM);
  for (const e of designRoomEntities()) world.addEntity(e);
  world.addRoom(MEETING_ROOM);
  world.addRoom(PROJECT_ROOM);
  world.addRoom(GAMING_ROOM);
  registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const wk = new Walkability(composeStatic(v1Static, inBounds, clearanceLayer(worldClearances(world))));
  wk.syncFromWorld(world);
  const av = new Avatar({ height: 36, lit: true });
  const stack = new ControllerStack();
  const nav = new NavigationController(av, stack);
  const scene = new THREE.Object3D(); scene.add(av.root);
  const closed = world.get(DOOR_ID).transform.pos;
  const view = new THREE.Object3D(); view.position.set(closed.x, 0, closed.z); scene.add(view);
  const door = new SlidingDoor(view, DESIGN_DOOR, closed);
  const walk = (to: Vec2) => { const r = planWalk(av.position, to, wk, inBounds); expect(r.ok, `${to.x},${to.z}`).toBe(true); if (r.ok) nav.setPath(r.path); return r; };
  /** the leaf's current footprint as a world rect (1 unit thick in x) */
  const leafRect = (): Rect => ({ x: view.position.x - 0.5, z: view.position.z - LEAF_W / 2, w: 1, d: LEAF_W });
  const bodyHitsLeaf = () => circleOverlapsRect(av.position, R, leafRect());
  /** step until navigation stops AND the door is closed; asserts every frame that the leaf never touches Bon */
  const run = (maxFrames = 6000, onFrame?: (i: number) => void): DoorState[] => {
    const seen: DoorState[] = [door.state];
    for (let i = 0; i < maxFrames; i++) {
      nav.update(DT); door.update(DT, av.position, nav.path);
      if (door.state !== seen[seen.length - 1]) seen.push(door.state);
      expect(bodyHitsLeaf(), `leaf touches Bon at frame ${i} (${av.position.x.toFixed(1)},${av.position.z.toFixed(1)}) door ${door.state} t=${door.t.toFixed(2)}`).toBe(false);
      onFrame?.(i);
      if (!nav.moving && door.state === "closed" && i > 2) break;
    }
    return seen;
  };
  return { world, wk, inBounds, av, stack, nav, scene, view, closed, door, walk, run, leafRect, bodyHitsLeaf };
}
const distToSolids = (p: Vec2): number => Math.min(...DESIGN_DOOR.clearance.solids.map((s) => { const nx = Math.max(s.x, Math.min(p.x, s.x + s.w)), nz = Math.max(s.z, Math.min(p.z, s.z + s.d)); return Math.hypot(p.x - nx, p.z - nz); }));

describe("vo3d door — physical clearance through the Design Room doorway", () => {
  it("derives the leaf/pocket geometry from the shell: slides south, parks flush with the wall end, passage = rows 25–28", () => {
    expect(DESIGN_DOOR.slide).toEqual({ x: 0, z: 1 });
    expect(DESIGN_DOOR.slideDistance).toBeCloseTo(SHELL.frontWallZ + SHELL.wallThickness - (SHELL.glass.doorZ1 - 1), 6); // 78.25
    expect(DESIGN_DOOR.slideDistance).toBeLessThan(LEAF_W); // the pocket is shorter than the leaf → the leaf cannot fully clear the V1 band
    const { closed, door } = rig();
    const parkedLeadingEdge = door.openPosition.z - LEAF_W / 2;
    expect(parkedLeadingEdge).toBeCloseTo(RECT.z + SHELL.glass.z0 + 1 + DESIGN_DOOR.slideDistance, 6); // 468.07
    expect(door.openPosition.z + LEAF_W / 2).toBeCloseTo(RECT.z + SHELL.frontWallZ + SHELL.wallThickness, 6); // flush with the wall end
    expect(closed.z).toBeCloseTo(RECT.z + (SHELL.glass.z0 + SHELL.glass.doorZ1) / 2, 6);
    expect(DESIGN_DOOR.crossing.z).toBeCloseTo(RECT.z + SHELL.glass.z0, 6);
    expect(DESIGN_DOOR.crossing.z + DESIGN_DOOR.crossing.d).toBeCloseTo(parkedLeadingEdge, 6);
  });
  it("blocks the V1 door cells that would brush the jamb or the parked leaf; routes stay a body radius clear", () => {
    const { wk, walk, nav, av } = rig();
    for (const cy of [25, 26, 27, 28]) expect(wk.staticLayer(19, cy), `19,${cy}`).toBe(true);
    for (const cy of [24, 29, 30]) { expect(v1Static(19, cy)).toBe(true); expect(wk.staticLayer(19, cy), `19,${cy}`).toBe(false); }
    expect(wk.staticLayer(18, 24)).toBe(true); expect(wk.staticLayer(18, 30)).toBe(true); // interior cells next to the wall are untouched
    // walk out and back; every sampled body position keeps ≥ bodyRadius from the jambs / parked leaf
    for (const to of [HALL, APPROACH]) {
      av.setPosition(to === HALL ? APPROACH : HALL); walk(to);
      for (let i = 0; i < 6000 && nav.moving; i++) { nav.update(DT); if (av.position.x <= RECT.x + RECT.w) expect(distToSolids(av.position), `${av.position.x.toFixed(1)},${av.position.z.toFixed(1)}`).toBeGreaterThanOrEqual(R - 1e-6); }
    }
  });
});

describe("vo3d door — automatic sliding door state machine", () => {
  it("leaving: Closed → Opening → Open → Closing → Closed; fully open before Bon's body reaches the leaf; exact closed transform", () => {
    const { av, nav, door, walk, run, closed, view } = rig();
    av.setPosition(APPROACH); walk(HALL);
    let tWhenBodyReachesPlane: number | null = null;
    const seen = run(6000, () => { if (tWhenBodyReachesPlane === null && av.position.x + R >= closed.x - 0.5) tWhenBodyReachesPlane = door.t; });
    expect(seen).toEqual(["closed", "opening", "open", "closing", "closed"]);
    expect(tWhenBodyReachesPlane).toBe(1);
    expect(nav.moving).toBe(false); expect(av.position).toMatchObject({ x: HALL.x, z: HALL.z });
    expect(view.position.x).toBe(closed.x); expect(view.position.z).toBe(closed.z); expect(door.driftError()).toBe(0);
  });
  it("entering: the same cycle from the hall side", () => {
    const { av, door, walk, run, closed, view } = rig();
    av.setPosition(HALL); walk(APPROACH);
    let tWhenBodyReachesPlane: number | null = null;
    const seen = run(6000, () => { if (tWhenBodyReachesPlane === null && av.position.x - R <= closed.x + 0.5) tWhenBodyReachesPlane = door.t; });
    expect(seen).toEqual(["closed", "opening", "open", "closing", "closed"]);
    expect(tWhenBodyReachesPlane).toBe(1);
    expect(worldToCell(av.position)).toEqual({ cx: 11, cy: 31 });
    expect(view.position.z).toBe(closed.z); expect(door.driftError()).toBe(0);
  });
  it("opens with smooth ease-in/out to the exact open transform and closes with no overshoot", () => {
    const { av, door, walk, run } = rig();
    av.setPosition(APPROACH); walk(HALL);
    const offsets: number[] = [];
    run(6000, () => { offsets.push(door.offset); expect(door.offset).toBeGreaterThanOrEqual(0); expect(door.offset).toBeLessThanOrEqual(DESIGN_DOOR.slideDistance + 1e-9); });
    expect(Math.max(...offsets)).toBeCloseTo(DESIGN_DOOR.slideDistance, 9);
    const steps = offsets.slice(1).map((o, i) => o - offsets[i]).filter((d) => d > 0);
    expect(steps[0]).toBeLessThan(Math.max(...steps) * 0.25); // starts gently (ease-in)
    expect(steps[steps.length - 1]).toBeLessThan(Math.max(...steps) * 0.25); // lands gently (ease-out)
  });
  it("repeated crossings: six full cycles return the leaf to the exact closed transform every time (zero drift)", () => {
    const { av, nav, door, walk, run, closed, view } = rig();
    av.setPosition(APPROACH);
    for (let i = 0; i < 6; i++) {
      walk(i % 2 === 0 ? HALL_NEAR : APPROACH);
      expect(run()).toEqual(["closed", "opening", "open", "closing", "closed"]);
      expect(view.position.z).toBe(closed.z); expect(view.position.x).toBe(closed.x); expect(door.t).toBe(0);
    }
    expect(door.cycles).toBe(6);
    expect(nav.moving).toBe(false);
  });
  it("abandoned approach: the door finishes opening, holds briefly, then closes; it never stays open", () => {
    const { av, nav, door, walk, run } = rig();
    av.setPosition(HALL_NEAR); walk(APPROACH);
    for (let i = 0; i < 600 && door.state === "closed"; i++) { nav.update(DT); door.update(DT, av.position, nav.path); }
    for (let i = 0; i < 6; i++) { nav.update(DT); door.update(DT, av.position, nav.path); }
    expect(door.state).toBe("opening"); expect(av.position.x).toBeGreaterThan(RECT.x + RECT.w + R); // still in the hall
    walk({ x: 600, z: 424 }); // turn away: this route never crosses the doorway
    const seen = run();
    expect(seen).toEqual(["opening", "open", "closing", "closed"]);
    expect(nav.moving).toBe(false); expect(door.driftError()).toBe(0);
  });
  it("redirect while approaching and immediately after crossing: one continuous route each time, never struck", () => {
    const { av, nav, door, walk, run, closed } = rig();
    av.setPosition(APPROACH); walk(HALL);
    for (let i = 0; i < 6000 && av.position.x < closed.x - R - 20; i++) { nav.update(DT); door.update(DT, av.position, nav.path); } // approaching, door open
    expect(door.state).toBe("open");
    walk(HALL_NEAR); // redirect while approaching: still crosses
    for (let i = 0; i < 6000 && av.position.x - R < closed.x + 3; i++) { nav.update(DT); door.update(DT, av.position, nav.path); expect(circleOverlapsRect(av.position, R, { x: closed.x - 0.5, z: door.leafPosition.z - LEAF_W / 2, w: 1, d: LEAF_W })).toBe(false); }
    walk(APPROACH); // redirect immediately after crossing: back through the door
    const seen = run();
    expect(seen[seen.length - 1]).toBe("closed"); expect(seen).not.toContain(undefined);
    expect(worldToCell(av.position)).toEqual({ cx: 11, cy: 31 });
    expect(door.driftError()).toBe(0);
  });
  it("a body standing in the sweep band keeps the door open indefinitely; it closes once the body leaves", () => {
    const { av, door } = rig();
    av.setPosition({ x: 312, z: 424 }); // in the doorway, no route
    for (let i = 0; i < 600; i++) door.update(DT, av.position, []); // 10 s
    expect(door.state).toBe("open"); expect(door.t).toBe(1);
    av.setPosition({ x: 250, z: 424 }); // stepped back inside the room
    let frames = 0; while (door.state !== "closed" && frames++ < 600) door.update(DT, av.position, []);
    expect(door.state).toBe("closed"); expect(frames * DT * 1000).toBeLessThan(DESIGN_DOOR.timings.holdMs + DESIGN_DOOR.timings.closeMs + 50);
  });
  it("walking past the door along the hall (route does not cross) leaves it closed", () => {
    const { av, walk, run } = rig();
    av.setPosition({ x: 344, z: 360 }); walk({ x: 344, z: 520 });
    expect(run()).toEqual(["closed"]);
  });
  it("sit → stand → leave through the door, and facing stays aligned with movement on every door leg", () => {
    const { av, stack, nav, door, walk, run, world, wk, inBounds, scene } = rig();
    const chairE = world.get(CHAIR_4_ID); const chair = new THREE.Object3D(); chair.position.set(chairE.transform.pos.x, 0, chairE.transform.pos.z); scene.add(chair);
    av.setPosition({ x: RECT.x + 270, z: RECT.z + 190 });
    const seat = new SeatInteraction(av, stack, chair, chairE.capabilities.seat!, (to) => planWalk(av.position, to, wk, inBounds));
    expect(seat.sit()?.ok).toBe(true);
    for (let t = 0; t < 20 && seat.state !== "seated"; t += DT) { seat.update(DT); nav.update(DT); door.update(DT, av.worldPosition(), nav.path); }
    expect(seat.state).toBe("seated"); expect(door.state).toBe("closed");
    seat.stand();
    for (let t = 0; t < 20 && seat.state !== "idle"; t += DT) { seat.update(DT); nav.update(DT); door.update(DT, av.worldPosition(), nav.path); }
    expect(stack.owner).toBe("Idle");
    walk(HALL);
    const fwd = new THREE.Vector3(); let settle = 0;
    const seen = run(6000, () => {
      // full-yaw invariant: forward matches displacement (allow the <0.5 s turn-in-place)
      const p = av.worldPosition(); av.root.updateMatrixWorld(true); av.root.getWorldDirection(fwd);
      const next = nav.path[0]; if (!next) return;
      const dx = next.x - p.x, dz = next.z - p.z, len = Math.hypot(dx, dz); if (len < 1e-3) return;
      const dot = (fwd.x * dx + fwd.z * dz) / len; settle = dot > 0.98 ? 0 : settle + 1; expect(settle).toBeLessThan(30);
    });
    expect(seen).toEqual(["closed", "opening", "open", "closing", "closed"]);
    expect(stack.owner).toBe("Idle");
  });
  it("segmentHitsRect: slab test covers crossing, containment and misses", () => {
    const r = { x: 10, z: 10, w: 10, d: 10 };
    expect(segmentHitsRect({ x: 0, z: 15 }, { x: 30, z: 15 }, r)).toBe(true);
    expect(segmentHitsRect({ x: 12, z: 12 }, { x: 14, z: 14 }, r)).toBe(true);
    expect(segmentHitsRect({ x: 0, z: 0 }, { x: 30, z: 5 }, r)).toBe(false);
    expect(segmentHitsRect({ x: 0, z: 25 }, { x: 0, z: 0 }, r)).toBe(false);
  });
});
