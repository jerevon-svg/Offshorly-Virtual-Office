import { describe, expect, it } from "vitest";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import { AI_ROOM, aiRoomEntities } from "./rooms/ai";
import * as THREE from "three";
import { PlayerBody, type StandTest } from "./player/PlayerBody";
import { PlayerCamera } from "./player/PlayerCamera";
import { PlayerInput } from "./player/PlayerInput";
import { collectCandidates, pickTarget, REACH, type Candidate } from "./player/PlayerTargeting";
import { makeStandTest } from "./player/standTest";
import { CAMERA_MODES, CameraModes, OFFICE_VIEW } from "./render/CameraModes";
import { ControllerStack } from "./avatar/Controller";
import { WorldState } from "./world/WorldState";
import { DerivedNav } from "./nav/derived";
import { Walkability, composeStatic } from "./nav/Walkability";
import { clearanceLayer, worldClearances, NAV_RADIUS } from "./nav/clearance";
import { openedLayer, v2Static } from "./nav/v2Open";
import { v1Static } from "./adapters/v1Grid";
import { registerGroundFloor } from "./rooms/ground-floor";
import { DESIGN_ROOM, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities, DOOR as GAMING_DOOR, WEST_OUTER_X, WEST_X } from "./rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "./rooms/central-hub";
import type { Rect, Vec2 } from "./core/coords";

// ---- a world, exactly as the app builds it ---------------------------------------------------------
function rig() {
  const world = new WorldState();
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(), ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities()]) world.addEntity(e);
  registerGroundFloor(world);
  const bands = [...HUB_BANDS];
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer(bands)), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: new Set([DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB.id, EXECUTIVE_ROOM.id, CMS_ROOM.id, AI_ROOM.id]) });
  walkability.attachDerived(derived, world);
  const canStand = makeStandTest({ world, walkability, derived, radius: NAV_RADIUS });
  return { world, walkability, derived, canStand };
}

describe("vo3d player — collision reuses the world V2 already owns", () => {
  it("never authors a second collision map: every verdict comes from regions, derived clearance or V1", () => {
    const { world, derived, canStand } = rig();
    // sweep the Design Room floor: every point the player may stand on is a point the DERIVED CLEARANCE
    // FIELD independently calls clear at the same radius. That agreement, over the whole room rather than
    // at one lucky sample, is the proof there is no parallel collision authority — the player is asking
    // navigation's own question and getting navigation's own answer.
    const fr = DESIGN_ROOM.floorRect;
    let open = 0;
    for (let z = fr.z + 4; z < fr.z + fr.d - 4; z += 7)
      for (let x = fr.x + 4; x < fr.x + fr.w - 4; x += 7) {
        const p = { x, z };
        if (!canStand(p)) continue;
        open++;
        expect(derived.clearanceAtPoint(p), `${x},${z}`).toBeGreaterThanOrEqual(NAV_RADIUS);
      }
    expect(open).toBeGreaterThan(50); // and the room is genuinely walkable, not trivially empty of hits
    // outside the modelled world entirely
    expect(canStand({ x: -500, z: -500 })).toBe(false);
    // an UNRECONSTRUCTED room footprint is a registered non-walkable region, so the player is kept out.
    // Phase 7 reconstructed the Executive room, so the example moved to the Dev room.
    const unbuilt = world.regions.find((r) => r.id === "footprint:dev-room")!;
    expect(canStand({ x: unbuilt.rect.x + unbuilt.rect.w / 2, z: unbuilt.rect.z + unbuilt.rect.d / 2 })).toBe(false);
  });

  it("is INTERIOR ONLY in V0: the sidewalk is walkable for routing and refused for the player", () => {
    const { world, walkability, derived } = rig();
    const sidewalk = world.regions.find((r) => r.kind === "exterior")!;
    const p = { x: sidewalk.rect.x + sidewalk.rect.w / 2, z: sidewalk.rect.z + sidewalk.rect.d / 2 };
    expect(world.walkableAt(p)).toBe(true); // navigation may still route out there
    expect(makeStandTest({ world, walkability, derived, radius: NAV_RADIUS })(p)).toBe(false);
    // and the flag that will open it later actually does
    expect(makeStandTest({ world, walkability, derived, radius: NAV_RADIUS, allowExterior: true })(p)).toBe(true);
  });

  it("refuses to stand inside solid furniture and inside a wall", () => {
    const { world, canStand } = rig();
    const solid = [...world.entities.values()].filter((e) => e.footprint && e.footprint.solid !== false && e.roomId === CENTRAL_HUB.id);
    expect(solid.length).toBeGreaterThan(10);
    for (const e of solid.slice(0, 25)) expect(canStand(e.transform.pos), e.id).toBe(false);
    const wall = DESIGN_ROOM.wallSolids![0];
    expect(canStand({ x: wall.x + wall.w / 2, z: wall.z + wall.d / 2 })).toBe(false);
  });
});

describe("vo3d player — swept movement", () => {
  /** a world that is open except for a wall band at x >= 100 */
  const wallAt100: StandTest = (p) => p.x < 100;
  /** open except for a THIN 2-unit solid at x in [100, 102] — thinner than one frame of travel */
  const thinWall: StandTest = (p) => p.x < 100 || p.x > 102;

  it("stops at a wall instead of passing through it", () => {
    const b = new PlayerBody({ x: 0, z: 0 }, 8, wallAt100);
    const r = b.move(400, 0);
    expect(r.blocked).toBe(true);
    expect(b.pos.x).toBeLessThan(100);
    expect(b.pos.x).toBeGreaterThan(96); // and it got right up to it, not stopped a cell short
  });

  it("cannot TUNNEL through a solid thinner than a single step, however long the frame", () => {
    // 250 ms at 30 u/s is the app's dt clamp; 4000 units is an absurd teleport. Neither may pass.
    for (const d of [7.5, 50, 400, 4000]) {
      const b = new PlayerBody({ x: 0, z: 0 }, 8, thinWall);
      b.move(d, 0);
      expect(b.pos.x, `delta ${d}`).toBeLessThan(100);
    }
  });

  it("slides along a wall rather than sticking to it", () => {
    const b = new PlayerBody({ x: 90, z: 0 }, 8, wallAt100);
    const r = b.move(30, 30); // pushed diagonally into the wall
    expect(r.blocked).toBe(true);
    expect(b.pos.z).toBeGreaterThan(25); // the z component survived
    expect(b.pos.x).toBeLessThan(100);
    expect(r.travelled).toBeGreaterThan(25);
  });

  it("reports travel honestly so a pinned player does not moonwalk", () => {
    const b = new PlayerBody({ x: 99.9, z: 0 }, 8, wallAt100);
    const r = b.move(30, 0);
    expect(r.travelled).toBeLessThan(0.2);
  });

  it("places the body on legal floor when entering from wherever an interaction left it", () => {
    const { canStand } = rig();
    const b = new PlayerBody({ x: 0, z: 0 }, NAV_RADIUS, canStand);
    // the hub monument's centre is solid; entering PLAYER there must find floor, not refuse
    const monument = { x: 720, z: 560 };
    expect(b.placeNear(monument)).toBe(true);
    expect(canStand(b.pos)).toBe(true);
    // nowhere legal at all → refused, and the caller falls back
    const nothing = new PlayerBody({ x: 0, z: 0 }, 8, () => false);
    expect(nothing.placeNear({ x: 10, z: 10 })).toBe(false);
  });

  it("walks the real Reception → Central Hub → Design Room route without leaving the floor", () => {
    const { canStand } = rig();
    const legs: Vec2[] = [{ x: 600, z: 1096 }, { x: 720, z: 700 }, { x: 300, z: 430 }, { x: 170, z: 180 }];
    const b = new PlayerBody(legs[0], NAV_RADIUS, canStand);
    expect(b.grounded).toBe(true);
    for (let i = 1; i < legs.length; i++) {
      // 600 frames of 30 u/s steering straight at the next waypoint: a body, not a router
      for (let f = 0; f < 600; f++) {
        const dx = legs[i].x - b.pos.x, dz = legs[i].z - b.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 6) break;
        b.move((dx / d) * 0.5, (dz / d) * 0.5);
        expect(canStand(b.pos), `leg ${i} frame ${f} at ${b.pos.x.toFixed(0)},${b.pos.z.toFixed(0)}`).toBe(true);
      }
    }
  });
});

describe("vo3d player — doorway traversal", () => {
  /** Walk a body from `from` toward `to` in 0.5-unit steps, asserting every frame is legal. */
  function drive(canStand: StandTest, from: Vec2, to: Vec2, radius = NAV_RADIUS): { arrived: boolean; stuckAt: Vec2 } {
    const b = new PlayerBody(from, radius, canStand);
    for (let f = 0; f < 2000; f++) {
      const dx = to.x - b.pos.x, dz = to.z - b.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 4) return { arrived: true, stuckAt: b.pos };
      const before = { ...b.pos };
      b.move((dx / d) * 0.5, (dz / d) * 0.5);
      if (Math.hypot(b.pos.x - before.x, b.pos.z - before.z) < 1e-6) return { arrived: false, stuckAt: b.pos };
    }
    return { arrived: false, stuckAt: b.pos };
  }
  const HALL: Vec2 = { x: 1080, z: 736 };
  const INSIDE: Vec2 = { x: 1180, z: 736 };

  it("leaves no unowned strip across a declared doorway", () => {
    // THE BUG: the shared floor's hole (rect - half a cell) and the room's floorRect disagreed, so a
    // 4.72-unit strip across the whole Gaming doorway belonged to no region at all — regionAt() returned
    // null and direct movement was refused there, while A* sailed through because it only samples cell
    // centres, which fall either side of the strip.
    const { world } = rig();
    for (let x = WEST_OUTER_X - 24; x <= WEST_X + 24; x += 1)
      for (let z = GAMING_DOOR.z0 + 2; z <= GAMING_DOOR.z1 - 2; z += 1)
        expect(world.regionAt({ x, z }), `${x},${z} owned by no region`).not.toBeNull();
  });

  it("lets a body walk the hall -> Gaming Room doorway, and back out", () => {
    const { canStand } = rig();
    expect(canStand(HALL)).toBe(true);
    expect(canStand(INSIDE)).toBe(true);
    const inward = drive(canStand, HALL, INSIDE);
    expect(inward.arrived, `stuck entering at ${inward.stuckAt.x.toFixed(1)},${inward.stuckAt.z.toFixed(1)}`).toBe(true);
    const outward = drive(canStand, INSIDE, HALL);
    expect(outward.arrived, `stuck leaving at ${outward.stuckAt.x.toFixed(1)},${outward.stuckAt.z.toFixed(1)}`).toBe(true);
  });

  it("is enterable from off-centre and angled approaches, not just dead-on", () => {
    const { canStand } = rig();
    // every start the hall actually offers around the door mouth, aimed at the room interior
    const starts: Vec2[] = [
      { x: 1080, z: 700 }, { x: 1080, z: 720 }, { x: 1080, z: 736 }, { x: 1080, z: 752 }, { x: 1080, z: 772 },
      { x: 1060, z: 736 }, { x: 1096, z: 704 }, { x: 1096, z: 768 },
    ];
    for (const s of starts) {
      if (!canStand(s)) continue; // not every sample is open hall; only judge the ones that are
      const r = drive(canStand, s, INSIDE);
      expect(r.arrived, `from ${s.x},${s.z} stuck at ${r.stuckAt.x.toFixed(1)},${r.stuckAt.z.toFixed(1)}`).toBe(true);
    }
  });

  it("threads the doorway at SPRINT speed without clipping a jamb", () => {
    const { canStand } = rig();
    const step = (30 * 1.8) / 60;
    const b = new PlayerBody(HALL, NAV_RADIUS, canStand);
    for (let f = 0; f < 400; f++) {
      const dx = INSIDE.x - b.pos.x, dz = INSIDE.z - b.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 4) break;
      b.move((dx / d) * step, (dz / d) * step);
      expect(canStand(b.pos), `sprint frame ${f} at ${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)}`).toBe(true);
    }
    expect(b.pos.x).toBeGreaterThan(WEST_X); // actually got inside the room
  });

  it("still refuses the wall either side of the opening", () => {
    const { canStand } = rig();
    // the doorway is the ONE gap: a body may not walk through the jamb walls north or south of it
    for (const z of [GAMING_DOOR.z0 - 30, GAMING_DOOR.z1 + 30]) {
      const r = drive(canStand, { x: 1080, z }, { x: 1180, z });
      expect(r.arrived, `wall at z=${z} was passable`).toBe(false);
      expect(r.stuckAt.x).toBeLessThan(WEST_X);
    }
  });

  it("does not change what A* routes: the same doorway still plans hall -> Gaming Room", async () => {
    const { world, walkability } = rig();
    const { planWalk } = await import("./nav/planner");
    const inBounds = (p: Vec2) => world.walkableAt(p);
    const route = planWalk(HALL, INSIDE, walkability, inBounds);
    if (!route.ok) throw new Error(`A* regressed: ${route.reason}`);
    // and the route really crosses the door band rather than going the long way round
    expect(route.path.some((p: Vec2) => p.x > WEST_X)).toBe(true);
  });
});

describe("vo3d player — interaction targeting", () => {
  const cand = (id: string, x: number, z: number): Candidate => ({ id, kind: "approach", pos: { x, z }, label: id, roomId: "r" });

  it("harvests every interactable the world declares, bucketed by room — once, not per frame", () => {
    const { world } = rig();
    const byRoom = collectCandidates(world);
    for (const id of [DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB.id, EXECUTIVE_ROOM.id, CMS_ROOM.id, AI_ROOM.id])
      expect(byRoom.get(id)?.length, id).toBeGreaterThan(0);
    // every candidate really carries the capability it claims
    for (const list of byRoom.values())
      for (const c of list) {
        const caps = world.get(c.id).capabilities;
        expect(caps.seat || caps.lounge || caps.approach, c.id).toBeTruthy();
      }
    // the hub is the worst case and is still a trivially small per-frame scan
    expect(byRoom.get(CENTRAL_HUB.id)!.length).toBeLessThan(60);
  });

  it("picks what you are facing, ignores what is behind you and what is out of reach", () => {
    const north = { x: 0, z: -1 };
    const list = [cand("ahead", 0, -30), cand("behind", 0, 30), cand("far", 0, -(REACH + 40))];
    const t = pickTarget(list, { x: 0, z: 0 }, north);
    expect(t?.id).toBe("ahead");
    expect(pickTarget([cand("behind", 0, 30)], { x: 0, z: 0 }, north)).toBeNull();
    expect(pickTarget([cand("far", 0, -(REACH + 40))], { x: 0, z: 0 }, north)).toBeNull();
  });

  it("prefers the thing you are aimed most directly at, and breaks ties by distance", () => {
    const north = { x: 0, z: -1 };
    expect(pickTarget([cand("offAxis", 34, -34), cand("dead-on", 0, -50)], { x: 0, z: 0 }, north)?.id).toBe("dead-on");
    expect(pickTarget([cand("near", 0, -20), cand("far", 0, -55)], { x: 0, z: 0 }, north)?.id).toBe("near");
  });

  it("does not require aim at point-blank range — you can sit on the chair you are standing on", () => {
    expect(pickTarget([cand("underfoot", 0, 8)], { x: 0, z: 0 }, { x: 0, z: -1 })?.id).toBe("underfoot");
  });

  it("targets nothing out in the hall: every V2 interactable lives in a room", () => {
    const { world } = rig();
    expect(world.regionAt({ x: 720, z: 760 })?.roomId).toBeUndefined();
  });
});

describe("vo3d player — mouse look", () => {
  const rig = () => new PlayerCamera(new THREE.PerspectiveCamera(), 36, () => true);

  it("turns RIGHT when the mouse goes right, in both views", () => {
    for (const view of ["third", "first"] as const) {
      const c = rig();
      c.setView(view);
      expect(c.forward).toEqual({ x: 0, z: -1 }); // yaw 0 faces north
      c.look(120, 0);
      // north is −z, so screen-right is +x: the heading must swing east
      expect(c.forward.x, view).toBeGreaterThan(0);
      expect(c.yaw, view).toBeGreaterThan(0);
    }
  });

  it("turns LEFT when the mouse goes left, in both views", () => {
    for (const view of ["third", "first"] as const) {
      const c = rig();
      c.setView(view);
      c.look(-120, 0);
      expect(c.forward.x, view).toBeLessThan(0);
      expect(c.yaw, view).toBeLessThan(0);
    }
  });

  it("is symmetric, and leaves the vertical axis exactly as it was", () => {
    const a = rig(), b = rig();
    a.look(90, 0);
    b.look(-90, 0);
    expect(a.yaw).toBeCloseTo(-b.yaw, 12); // same magnitude, opposite sense
    // mouse DOWN (dy > 0) lowers the pitch, and horizontal travel never touches it
    const c = rig();
    const pitch0 = c.pitch;
    c.look(400, 0);
    expect(c.pitch).toBe(pitch0);
    c.look(0, 100);
    expect(c.pitch).toBeLessThan(pitch0);
    c.look(0, -200);
    expect(c.pitch).toBeGreaterThan(pitch0);
  });
});

describe("vo3d player — sprint", () => {
  /** Bon's GLB carries exactly six clips and none of them is a run, so sprint is a SPEED change that the
   *  existing walk clip is played faster against. These tests pin that contract rather than a clip name. */
  function inputRig() {
    const canvas = document.createElement("canvas");
    const input = new PlayerInput(canvas, { onInteract: () => {}, onToggleView: () => {}, onLockChange: () => {} });
    input.enable();
    const key = (type: "keydown" | "keyup", code: string) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    return { input, key, done: () => input.disable() };
  }

  it("is off by default and on while Shift is held", () => {
    const { input, key, done } = inputRig();
    expect(input.sprinting).toBe(false);
    key("keydown", "ShiftLeft");
    expect(input.sprinting).toBe(true);
    key("keyup", "ShiftLeft");
    expect(input.sprinting).toBe(false); // released = walking again on the very next frame, no decay
    key("keydown", "ShiftRight");
    expect(input.sprinting).toBe(true);
    done();
  });

  it("does not disturb movement keys, and Shift+W still reads as forward", () => {
    const { input, key, done } = inputRig();
    key("keydown", "KeyW");
    key("keydown", "ShiftLeft");
    expect(input.axis).toEqual({ x: 0, z: -1 }); // sprint is a modifier, not a direction
    expect(input.sprinting).toBe(true);
    key("keyup", "ShiftLeft");
    expect(input.axis).toEqual({ x: 0, z: -1 }); // and dropping it does not drop the walk
    done();
  });

  it("cannot get stuck on: a tab-out clears it, and so does leaving the mode", () => {
    const { input, key, done } = inputRig();
    key("keydown", "ShiftLeft");
    window.dispatchEvent(new Event("blur"));
    expect(input.sprinting).toBe(false);
    key("keydown", "ShiftLeft");
    done(); // disable() = leaving PLAYER
    expect(input.sprinting).toBe(false);
  });

  it("refuses Shift typed into a form, exactly as it refuses WASD", () => {
    const { input, done } = inputRig();
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.dispatchEvent(new KeyboardEvent("keydown", { code: "ShiftLeft", bubbles: true }));
    expect(input.sprinting).toBe(false);
    field.remove();
    done();
  });

  it("moves further per second than walking, through the SAME collision pipeline", () => {
    const { canStand } = rig();
    const start: Vec2 = { x: 720, z: 760 }; // open hall, north of the Central Hub
    const run = (speed: number) => {
      const b = new PlayerBody(start, NAV_RADIUS, canStand);
      for (let f = 0; f < 30; f++) b.move(0, -speed / 60); // half a second at 60 Hz, straight north
      return Math.hypot(b.pos.x - start.x, b.pos.z - start.z);
    };
    const walked = run(30);
    const sprinted = run(30 * 1.8);
    expect(walked).toBeGreaterThan(10);
    expect(sprinted / walked).toBeCloseTo(1.8, 1);
  });

  it("CANNOT TUNNEL at sprint speed, however thin the obstacle or long the frame", () => {
    // 2 units thick — a quarter of the body radius, and far thinner than one sprint frame at a stalled dt
    const thin: StandTest = (p) => p.x < 100 || p.x > 102;
    for (const dt of [1 / 60, 1 / 15, 0.25]) {
      const b = new PlayerBody({ x: 0, z: 0 }, NAV_RADIUS, thin);
      for (let f = 0; f < 400; f++) b.move(30 * 1.8 * dt, 0);
      expect(b.pos.x, `dt ${dt}`).toBeLessThan(100);
    }
  });

  it("sprinting into real office geometry stays on legal floor in every direction", () => {
    const { canStand } = rig();
    const sprintStep = (30 * 1.8) / 60; // one sprint frame at 60 Hz
    for (const [name, x, z] of [["hub", 726, 589], ["design", 165, 438], ["reception", 707, 1000], ["gaming", 1272, 735]] as const) {
      const b = new PlayerBody({ x, z }, NAV_RADIUS, canStand);
      expect(b.placeNear({ x, z }), name).toBe(true);
      const home = { ...b.pos };
      for (let a = 0; a < 16; a++) {
        const th = (a / 16) * Math.PI * 2;
        for (let f = 0; f < 150; f++) {
          b.move(Math.cos(th) * sprintStep, Math.sin(th) * sprintStep);
          expect(canStand(b.pos), `${name} dir${a} frame${f}`).toBe(true);
        }
        b.pos = { ...home };
      }
    }
  });

  it("has a real run clip to switch to, alongside the walk it replaces", async () => {
    const { CHARACTER_ANIM_STATES } = await import("../../render3d/characterAnimationState");
    const { CLIP_IDLE, CLIP_RUN, CLIP_WALK } = await import("./adapters/v1Avatar");
    // the three locomotion states the player crossfades between, all named by the same contract the
    // consolidated GLB is built against (scripts/avatar-pipeline/lod-policy REQUIRED_CLIP_NAMES)
    for (const clip of [CLIP_IDLE, CLIP_WALK, CLIP_RUN]) expect(CHARACTER_ANIM_STATES).toContain(clip);
    expect(CLIP_RUN).toBe("running");
  });

});

describe("vo3d player — controller ownership", () => {
  it("outranks Navigation and the Editor, and yields to an Interaction", () => {
    const s = new ControllerStack();
    expect(s.acquire("Player")).toBe(true);
    expect(s.acquire("Navigation")).toBe(false); // a stray click-to-walk cannot steal the avatar
    expect(s.acquire("Editor")).toBe(false);
    expect(s.acquire("Interaction")).toBe(true); // a seat started FROM player mode still gets it
    expect(s.owner).toBe("Interaction");
  });

  it("hands back to Idle so PLAYER can re-acquire when the interaction ends", () => {
    const s = new ControllerStack();
    s.acquire("Player");
    s.release("Player");
    s.acquire("Interaction");
    s.release("Interaction");
    expect(s.owner).toBe("Idle");
    expect(s.acquire("Player")).toBe(true);
  });

  it("leaves the pre-existing order between Idle/Navigation/Editor/Interaction untouched", () => {
    const s = new ControllerStack();
    expect(s.acquire("Navigation")).toBe(true);
    expect(s.acquire("Editor")).toBe(true);
    expect(s.acquire("Navigation")).toBe(false);
    expect(s.acquire("Interaction")).toBe(true);
    expect(s.acquire("Editor")).toBe(false);
  });
});

describe("vo3d player — camera mode ownership", () => {
  const OFFICE: Rect = { x: 0, z: 0, w: 1440, d: 1244 };
  const REF: Rect = { x: 0, z: 0, w: 310, d: 264 };
  function fakeRenderer() {
    const aspect = window.innerWidth / window.innerHeight;
    return {
      focus: REF,
      camParams: { pitch: 0, yaw: 0, zoom: 1 },
      target: { x: 0, y: 8, z: 0 },
      camera: { top: 0, right: 0, zoom: 1, position: { x: 0, y: 0, z: 0 }, updateProjectionMatrix() {} },
      playerCamera: new THREE.PerspectiveCamera(),
      controls: { target: { x: 0, y: 8, z: 0 }, enabled: true, enableRotate: true, enablePan: true, screenSpacePanning: true, minZoom: 0.12, maxZoom: 6 },
      constrain: null as (() => void) | null,
      shadowFocus: null as Vec2 | null,
      shadowRadius: null as number | null,
      activeCamera: null as unknown,
      setActiveCamera(c: unknown) { this.activeCamera = c; },
      focusOn(rect: Rect) { this.camera.zoom = 1; this.target.x = rect.x + rect.w / 2; this.target.y = 8; this.target.z = rect.z + rect.d / 2 - 6; return 1; },
      placeCamera() {
        this.controls.target.x = this.target.x; this.controls.target.y = this.target.y; this.controls.target.z = this.target.z;
        const h = (REF.d * 0.62 + 40) / this.camParams.zoom; this.camera.top = h; this.camera.right = h * aspect;
      },
    };
  }

  it("offers three modes and keeps OFFICE the default", () => {
    expect(CAMERA_MODES).toEqual(["office", "explore", "player"]);
    const R = fakeRenderer();
    expect(new CameraModes(R as never, OFFICE).mode).toBe("office");
  });

  it("PLAYER releases the canvas and the fence, and touches nothing of the ortho rig", () => {
    const R = fakeRenderer();
    const modes = new CameraModes(R as never, OFFICE);
    modes.set("explore");
    // a hand-orbited EXPLORE view
    R.camParams = { pitch: 21, yaw: 137, zoom: 0.4 };
    R.camera.position = { x: 111, y: 222, z: 333 };
    R.controls.target = { x: 400, y: 90, z: 500 };
    const snapshot = { params: { ...R.camParams }, pos: { ...R.camera.position }, target: { ...R.controls.target } };

    modes.set("player");
    expect(modes.mode).toBe("player");
    expect(R.controls.enabled).toBe(false); // OrbitControls cannot write the ortho camera while PLAYER runs
    expect(R.constrain).toBeNull(); // and neither can the OFFICE fence
    // nothing of the orthographic view was read or written
    expect(R.camParams).toEqual(snapshot.params);
    expect(R.camera.position).toEqual(snapshot.pos);
    expect(R.controls.target).toEqual(snapshot.target);
  });

  it("PLAYER → EXPLORE resumes the exact view PLAYER was entered from", () => {
    const R = fakeRenderer();
    const modes = new CameraModes(R as never, OFFICE);
    modes.set("explore");
    R.camParams = { pitch: 21, yaw: 137, zoom: 0.4 };
    R.camera.position = { x: 111, y: 222, z: 333 };
    R.controls.target = { x: 400, y: 90, z: 500 };
    const before = { params: { ...R.camParams }, pos: { ...R.camera.position }, target: { ...R.controls.target } };
    modes.set("player");
    modes.set("explore");
    expect(R.controls.enabled).toBe(true);
    expect(R.controls.enableRotate).toBe(true);
    expect(R.camParams).toEqual(before.params);
    expect(R.camera.position).toEqual(before.pos);
    expect(R.controls.target).toEqual(before.target);
    expect(R.activeCamera).toBe(R.camera); // and the ortho camera is being drawn again
  });

  it("PLAYER → OFFICE re-asserts the approved framing, fence and limits", () => {
    const R = fakeRenderer();
    const modes = new CameraModes(R as never, OFFICE);
    const officeZoom = modes.set("office").zoom;
    modes.set("player");
    R.shadowRadius = 300;
    R.shadowFocus = { x: 500, z: 500 };
    const back = modes.set("office");
    expect(back.pitch).toBe(OFFICE_VIEW.pitch);
    expect(back.yaw).toBe(OFFICE_VIEW.yaw);
    expect(back.zoom).toBeCloseTo(officeZoom, 9);
    expect(R.controls.enabled).toBe(true);
    expect(R.controls.enableRotate).toBe(false); // orbit stays killed in OFFICE
    expect(R.controls.minZoom).toBe(1);
    expect(R.controls.screenSpacePanning).toBe(false);
    expect(R.constrain).not.toBeNull(); // the fence is back
    expect(R.shadowRadius).toBeNull(); // and the player's shadow override was cleared
    expect(R.shadowFocus).toBeNull();
  });
});
