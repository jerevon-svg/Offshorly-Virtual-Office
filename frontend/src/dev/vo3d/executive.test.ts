import { describe, expect, it } from "vitest";
// Vite `?raw` import — loads bootstrap.ts's own source text as a string, the same trick
// OfficeMap.moveSelfGuard.test.ts and viteOptimizeDeps.test.ts use to guard app wiring.
import bootstrapSource from "./app/world.ts?raw";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack, NavigationController } from "./avatar/Controller";
import { SeatInteraction } from "./interact/Seat";
import * as THREE from "three";
import manifest from "../../data/office-assets-manifest.json";
import { SEAT_DIRECTIONS, seatCellKey } from "../../data/seatDirections";
import { WorldState } from "./world/WorldState";
import { SceneMirror } from "./render/SceneMirror";
import { registerGroundFloor } from "./rooms/ground-floor";
import { DESIGN_ROOM, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "./rooms/central-hub";
import {
  ARMCHAIR_N, ARMCHAIR_S, ARMCHAIR_SEAT_IDS, AXIS, CABINET_L, CABINET_L_APPROACH, CABINET_R,
  CABINET_R_APPROACH, COFFEE_TABLE, CREDENZA_APPROACH, CREDENZA_SW, DESK_L, DESK_R, DESK_SE, DOOR,
  DOOR_EAST_ID, DOOR_LEAF_CLOSED, DOOR_LEAF_W, DOOR_STANDS, DOOR_WEST_ID, EAST_X, ENTRY_DOOR,
  EXECUTIVE_LOUNGE_IDS, EXECUTIVE_ROOM, EXECUTIVE_ROOM_ID, EXECUTIVE_SEAT_IDS, EXEC_CHAIRS,
  EXECUTIVE_WALLS, FLOOR_RECT, MEDIA_APPROACH, MEDIA_CONSOLE, NORTH_Z, RECT, SOFA_DEPTH, SOFA_E_SPEC, SOFA_LEN,
  RETURN_SE, SOFA_SEAT_IDS, SOFA_W_SPEC, SOUTH_Z, THEME, TILE_RECT, VISITORS_L, VISITORS_R,
  VISITOR_Z, WALL_T, WEST_X, executiveRoomEntities, mirrorX,
} from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import { AI_ROOM, aiRoomEntities } from "./rooms/ai";
import { DEV_ROOM, devRoomEntities } from "./rooms/dev";
import { QA_ROOM, qaRoomEntities } from "./rooms/qa";
import { PALETTE } from "./render/Materials";
import { SlidingDoor } from "./interact/Door";
import { DerivedNav } from "./nav/derived";
import { Walkability, composeStatic } from "./nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "./nav/clearance";
import { openedLayer, v2Static } from "./nav/v2Open";
import { v1Static, worldToCell } from "./adapters/v1Grid";
import { planWalk } from "./nav/planner";
import { isSolid } from "./world/WorldState";
import { FACING_YAW, pointInRect, type Rect, type Vec2 } from "./core/coords";

/** the same wiring bootstrap.ts uses, minus THREE */
function rig() {
  const world = new WorldState();
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(),
    ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  const plan = registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, {
    roomIds: new Set([DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB.id, EXECUTIVE_ROOM.id, CMS_ROOM.id, AI_ROOM.id, DEV_ROOM.id, QA_ROOM.id]),
  });
  walkability.attachDerived(derived, world);
  return { world, plan, inBounds, walkability, derived };
}
const rectOf = (r: Rect): Rect => ({ x: r.x, z: r.z, w: r.w, d: r.d });
const overlap = (a: Rect, b: Rect): number =>
  Math.min(Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z));

describe("vo3d executive room — the layout is DERIVED, not invented", () => {
  it("takes its rect from the READ-ONLY V1 manifest", () => {
    const layer = (manifest as { id: string; kind: string; x: number; y: number; width: number; height: number }[])
      .find((l) => l.id === EXECUTIVE_ROOM_ID && l.kind === "room")!;
    expect(RECT).toEqual({ x: layer.x, z: layer.y, w: layer.width, d: layer.height });
  });

  it("builds REAL 12-unit walls inside the art box — no 64-unit baked-perspective mass", () => {
    expect(WALL_T).toBe(12);
    for (const w of EXECUTIVE_WALLS) {
      expect(w.x).toBeGreaterThanOrEqual(RECT.x);
      expect(w.z).toBeGreaterThanOrEqual(RECT.z);
      expect(w.x + w.w).toBeLessThanOrEqual(RECT.x + RECT.w + 1e-6);
      expect(w.z + w.d).toBeLessThanOrEqual(RECT.z + RECT.d + 1e-6);
      expect(Math.min(w.w, w.d)).toBe(WALL_T);
    }
    // V1 blocks rows 0–3 (z 0…64) across the whole north of this room. Only the first 12 of that is wall;
    // the rest is the display wall standing there plus the clearance the painting put around it.
    expect(NORTH_Z - RECT.z).toBe(12);
    expect(MEDIA_CONSOLE.z + MEDIA_CONSOLE.d).toBeLessThan(64);
  });

  it("the walls leave the V1 '+' door band completely open", () => {
    for (const w of EXECUTIVE_WALLS) {
      const band: Rect = { x: DOOR.x0, z: SOUTH_Z, w: DOOR.x1 - DOOR.x0, d: WALL_T };
      expect(overlap(w, band), `wall at ${w.x},${w.z} intrudes on the doorway`).toBeLessThanOrEqual(0);
    }
    expect(DOOR.x1 - DOOR.x0).toBe(80); // the grid's five '+' cells, cols 43–47
  });

  it("floor region sits inside the walls and the tiled plate covers their outer faces", () => {
    expect(FLOOR_RECT).toEqual({ x: WEST_X, z: NORTH_Z, w: EAST_X - WEST_X, d: SOUTH_Z - NORTH_Z });
    expect(TILE_RECT.x).toBeLessThanOrEqual(FLOOR_RECT.x);
    expect(TILE_RECT.z).toBeLessThanOrEqual(FLOOR_RECT.z);
    expect(TILE_RECT.x + TILE_RECT.w).toBeGreaterThanOrEqual(FLOOR_RECT.x + FLOOR_RECT.w);
    expect(TILE_RECT.x).toBeGreaterThanOrEqual(RECT.x); // and never leaks past the art box
    expect(TILE_RECT.z + TILE_RECT.d).toBeLessThanOrEqual(RECT.z + RECT.d);
  });

  it("every seat in the room lands on V1's OWN seat cell", () => {
    const v1: Record<string, string> = SEAT_DIRECTIONS["executive-team"]!.seats as Record<string, string>;
    const seen = new Set<string>();
    const check = (x: number, z: number) => {
      const key = seatCellKey(x, z);
      expect(v1[key], `no V1 seat at ${x},${z}`).toBeDefined();
      seen.add(key);
    };
    for (const c of EXEC_CHAIRS) check(c.x, c.z);
    for (const x of [...VISITORS_L, ...VISITORS_R]) check(x, VISITOR_Z);
    for (const a of [ARMCHAIR_N, ARMCHAIR_S]) check(a.x, a.z);
    check(880.95, 258.18); // the SE workstation
    // the six sofa cushions, derived from the builder's own arithmetic
    for (const spec of [SOFA_W_SPEC, SOFA_E_SPEC])
      for (const dz of [-27.11, 0, 27.11]) check(spec.cushionX, spec.z + dz);
    expect(seen.size).toBe(Object.keys(v1).length); // all nineteen, none invented
  });

  it("preserves the reference's symmetry about the composition axis", () => {
    expect(mirrorX(DESK_L.x)).toBeCloseTo(DESK_R.x + DESK_R.w, 6);
    expect(mirrorX(CABINET_L.x)).toBeCloseTo(CABINET_R.x + CABINET_R.w, 6);
    expect(MEDIA_CONSOLE.x + MEDIA_CONSOLE.w / 2).toBeCloseTo(AXIS, 6);
    expect(COFFEE_TABLE.x + COFFEE_TABLE.w / 2).toBeCloseTo(AXIS, 6);
    expect(ARMCHAIR_N.x).toBe(AXIS);
    expect(ARMCHAIR_S.x).toBe(AXIS);
    // the two executive chairs and the two visitor rows are V1's own mirrored pairs
    expect((EXEC_CHAIRS[0].x + EXEC_CHAIRS[1].x) / 2).toBeCloseTo(AXIS, 0); // V1 itself is symmetric to a fifth of a unit
    expect((VISITORS_L[0] + VISITORS_R[3]) / 2).toBeCloseTo(AXIS, 0);
  });

  it("routes every colour through the room THEME — no builder names a palette key", () => {
    for (const key of Object.values(THEME)) expect(PALETTE[key]).toBeDefined();
    expect(THEME.wood).toBe("execWalnut");
    expect(THEME.accent).toBe("execOlive");
  });
});

describe("vo3d executive room — nothing interpenetrates", () => {
  it("no two SOLID footprints in the room overlap", () => {
    const { world } = rig();
    const solids = [...world.entities.values()]
      .filter((e) => e.roomId === EXECUTIVE_ROOM_ID && e.footprint && isSolid(e.footprint))
      .map((e) => {
        const fp = e.footprint!;
        const w = fp.shape === "rect" ? fp.w : fp.shape === "circle" ? fp.r * 2 : 0;
        const d = fp.shape === "rect" ? fp.d : w;
        return { id: e.id, rect: { x: e.transform.pos.x - w / 2, z: e.transform.pos.z - d / 2, w, d } };
      });
    expect(solids.length).toBeGreaterThan(20);
    for (let i = 0; i < solids.length; i++)
      for (let j = i + 1; j < solids.length; j++)
        expect(overlap(solids[i].rect, solids[j].rect), `${solids[i].id} ∩ ${solids[j].id}`).toBeLessThanOrEqual(0.01);
  });

  it("no fit-out piece stands inside a wall, and the sofas frame the coffee table", () => {
    for (const r of [rectOf(DESK_L), rectOf(DESK_R), rectOf(CABINET_L), rectOf(CABINET_R), rectOf(MEDIA_CONSOLE),
      rectOf(CREDENZA_SW), rectOf(DESK_SE), rectOf(RETURN_SE), COFFEE_TABLE]) {
      expect(r.x).toBeGreaterThanOrEqual(WEST_X);
      expect(r.x + r.w).toBeLessThanOrEqual(EAST_X);
      expect(r.z).toBeGreaterThanOrEqual(NORTH_Z);
      expect(r.z + r.d).toBeLessThanOrEqual(SOUTH_Z);
    }
    // both sofa runs are the SAME length, derived from V1's 27.11 cushion pitch
    expect(SOFA_LEN).toBeCloseTo(94.93, 2);
    // and the lanes between each sofa front and the coffee table clear a NAV_RADIUS body
    const westFront = SOFA_W_SPEC.x + SOFA_DEPTH / 2, eastFront = SOFA_E_SPEC.x - SOFA_DEPTH / 2;
    expect((COFFEE_TABLE.x - westFront) / 2).toBeGreaterThan(NAV_RADIUS);
    expect((eastFront - (COFFEE_TABLE.x + COFFEE_TABLE.w)) / 2).toBeGreaterThan(NAV_RADIUS);
  });
});

describe("vo3d executive room — derived navigation", () => {
  it("gives the room a walkable interior the V1 painting never had", () => {
    const { derived } = rig();
    let open = 0;
    for (let z = FLOOR_RECT.z + 6; z < FLOOR_RECT.z + FLOOR_RECT.d - 6; z += 8)
      for (let x = FLOOR_RECT.x + 6; x < FLOOR_RECT.x + FLOOR_RECT.w - 6; x += 8)
        if (derived.clearanceAtPoint({ x, z }) >= NAV_RADIUS) open++;
    expect(open).toBeGreaterThan(400);
  });

  it("every interaction anchor is reachable from the hall outside the door", () => {
    const { walkability, inBounds, world } = rig();
    const from = DOOR_STANDS.outside;
    const anchors: [string, Vec2][] = [
      ["inside stand", DOOR_STANDS.inside],
      ["cabinet west", CABINET_L_APPROACH.point],
      ["cabinet east", CABINET_R_APPROACH.point],
      ["media wall", MEDIA_APPROACH.point],
      ["credenza", CREDENZA_APPROACH.point],
    ];
    for (const id of EXECUTIVE_SEAT_IDS) anchors.push([id, world.get(id).capabilities.seat!.approach]);
    for (const id of EXECUTIVE_LOUNGE_IDS)
      for (const slot of world.get(id).capabilities.lounge!.slots) anchors.push([slot.id, slot.approach]);
    for (const [label, to] of anchors) {
      const r = planWalk(from, to, walkability, inBounds);
      expect(r.ok, `${label} (${to.x},${to.z}) unreachable: ${r.ok ? "" : r.reason}`).toBe(true);
    }
  });

  it("every interaction anchor clears a NAV_RADIUS body", () => {
    const { world, derived } = rig();
    const pts: [string, Vec2][] = [["inside stand", DOOR_STANDS.inside]];
    for (const e of world.entities.values()) {
      if (e.roomId !== EXECUTIVE_ROOM_ID) continue;
      if (e.capabilities.approach) pts.push([e.id, e.capabilities.approach.point]);
      if (e.capabilities.seat) pts.push([e.id, e.capabilities.seat.approach]);
      for (const s of e.capabilities.lounge?.slots ?? []) pts.push([s.id, s.approach]);
    }
    for (const [label, p] of pts)
      expect(derived.clearanceAtPoint(p), `${label} at ${p.x},${p.z}`).toBeGreaterThanOrEqual(NAV_RADIUS);
  });

  it("circulates: both desk groups, the lounge loop and the south lane are one connected space", () => {
    const { walkability, inBounds } = rig();
    const loop: Vec2[] = [
      DOOR_STANDS.outside,
      { x: 560, z: 240 }, //         SW quadrant
      { x: 540, z: 84 }, //          north lane, west desk
      { x: AXIS, z: 88 }, //         in front of the display
      { x: mirrorX(540), z: 84 }, // north lane, east desk
      { x: 900, z: 240 }, //         SE quadrant by the workstation
      { x: 698, z: 205 }, //         INSIDE the lounge, west of the coffee table
      { x: 753, z: 205 }, //         INSIDE the lounge, east of the coffee table
      DOOR_STANDS.outside,
    ];
    for (let i = 1; i < loop.length; i++) {
      const r = planWalk(loop[i - 1], loop[i], walkability, inBounds);
      expect(r.ok, `leg ${i} (${loop[i - 1].x},${loop[i - 1].z} → ${loop[i].x},${loop[i].z}) failed`).toBe(true);
    }
  });

  it("the doorway is open and its parked leaves are solid where they park", () => {
    const { derived } = rig();
    const mid: Vec2 = { x: (DOOR.x0 + DOOR.x1) / 2, z: SOUTH_Z + WALL_T / 2 };
    expect(derived.clearanceAtPoint(mid), "the doorway itself is clear").toBeGreaterThanOrEqual(NAV_RADIUS);
    // both leaves park OUTSIDE the opening — nothing of them is left standing in the V1 band
    const parkWest = DOOR_LEAF_CLOSED.west.x - DOOR_LEAF_W;
    const parkEast = DOOR_LEAF_CLOSED.east.x + DOOR_LEAF_W;
    expect(parkWest + DOOR_LEAF_W / 2).toBeLessThanOrEqual(DOOR.x0);
    expect(parkEast - DOOR_LEAF_W / 2).toBeGreaterThanOrEqual(DOOR.x1);
  });

  it("the V1 '+' band is what the threshold region claims, verbatim", () => {
    const { world } = rig();
    const t = world.regions.find((r) => r.id === `threshold:${DOOR_WEST_ID}`)!;
    expect(t.rect).toEqual(ENTRY_DOOR.clearance.band);
    expect(t.walkable).toBe(true);
    const c0 = worldToCell({ x: t.rect.x + 1, z: t.rect.z + 1 });
    expect(c0).toEqual({ cx: 43, cy: 18 });
  });
});

describe("vo3d executive room — interactions reuse V2's existing systems", () => {
  it("three MOVABLE chairs, eight fixed visitors, two sofas, two armchairs and four walk-ups", () => {
    const { world } = rig();
    const es = [...world.entities.values()].filter((e) => e.roomId === EXECUTIVE_ROOM_ID);
    expect(es.filter((e) => e.capabilities.seat)).toHaveLength(3);
    expect(es.filter((e) => e.capabilities.lounge)).toHaveLength(12);
    expect(es.filter((e) => e.capabilities.approach)).toHaveLength(4);
    expect(es.filter((e) => e.capabilities.door)).toHaveLength(1);
    // a piece never carries both verbs
    for (const e of es) expect(Boolean(e.capabilities.seat && e.capabilities.lounge)).toBe(false);
    expect(SOFA_SEAT_IDS).toHaveLength(2);
    expect(ARMCHAIR_SEAT_IDS).toHaveLength(2);
    expect(world.get(SOFA_SEAT_IDS[0]).capabilities.lounge!.slots).toHaveLength(3);
  });

  it("a pulled executive chair never reaches its desk or the visitor row", () => {
    const { world } = rig();
    for (const id of EXECUTIVE_SEAT_IDS) {
      const s = world.get(id).capabilities.seat!;
      const chair = world.get(id).transform.pos;
      expect(s.pullDir).toEqual({ x: 0, z: -1 }); // every desk in this room is SOUTH of its chair
      expect(s.preSeat.z).toBeGreaterThan(chair.z - s.pullDistance);
      expect(s.seatedYaw).toBe(FACING_YAW.south); // V1 "front" = looking south, at the desk
    }
  });

  it("the entrance drives on the SAME bi-parting SlidingDoor Reception uses", () => {
    const { world } = rig();
    const west = world.get(DOOR_WEST_ID), east = world.get(DOOR_EAST_ID);
    const d = new SlidingDoor({ position: new THREE.Vector3(west.transform.pos.x, 0, west.transform.pos.z) } as never,
      west.capabilities.door!, west.transform.pos,
      { view: { position: new THREE.Vector3(east.transform.pos.x, 0, east.transform.pos.z) } as never, closed: east.transform.pos });
    expect(d.state).toBe("closed");
    expect(d.driftError(), "both leaves rest exactly on their authored closed transform").toBeLessThan(1e-6);
    // walking the doorway on a route that crosses it opens the door and it parks fully
    const route: Vec2[] = [{ x: 728, z: 240 }];
    for (let i = 0; i < 200; i++) d.update(0.05, { x: 728, z: 320 }, route);
    expect(d.state).toBe("open");
    expect(d.t).toBeCloseTo(1, 2);
    // and it comes back to rest with no accumulated drift
    for (let i = 0; i < 400; i++) d.update(0.05, { x: 728, z: 60 }, []);
    expect(d.state).toBe("closed");
    expect(d.driftError()).toBeLessThan(1e-6);
  });
});

describe("vo3d executive room — the build", () => {
  it("mirrors into a scene with the room's static geometry and every entity", () => {
    const world = new WorldState();
    for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM]) world.addRoom(r);
    for (const e of executiveRoomEntities()) world.addEntity(e);
    registerGroundFloor(world);
    const mirror = new SceneMirror(world, new THREE.Scene());
    mirror.buildRoom(EXECUTIVE_ROOM, { wallHeight: 46, frontWall: "low", exterior: false });
    const names = new Set<string>();
    mirror.root.traverse((o) => o.name && names.add(o.name));
    for (const n of ["static:executive-room", "exec-media-wall", "exec-cabinet-left", "exec-cabinet-right",
      "exec-desk-left", "exec-desk-right", "exec-desk-hr", "exec-credenza-sw", "exec-workstation-se", "exec-south-facade"])
      expect(names.has(n), `missing ${n}`).toBe(true);
    // every `pick` an approach declares must name a group a click can actually hit
    for (const e of world.entities.values())
      if (e.capabilities.approach) expect(names.has(String(e.props.pick)), `pick ${e.props.pick}`).toBe(true);
    let meshes = 0;
    mirror.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBeGreaterThan(150);
    expect(meshes, "instanced/baked, not brute-forced").toBeLessThan(1400);
    // no real-time lights anywhere in this room
    let lights = 0;
    mirror.root.traverse((o) => { if ((o as THREE.Light).isLight) lights++; });
    expect(lights).toBe(0);
  });

  it("keeps the room inside its own footprint", () => {
    const world = new WorldState();
    for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM]) world.addRoom(r);
    for (const e of executiveRoomEntities()) world.addEntity(e);
    registerGroundFloor(world);
    const mirror = new SceneMirror(world, new THREE.Scene());
    mirror.buildRoom(EXECUTIVE_ROOM, { wallHeight: 46, frontWall: "low", exterior: false });
    const box = new THREE.Box3().setFromObject(mirror.root);
    expect(box.min.x).toBeGreaterThanOrEqual(RECT.x - 2);
    expect(box.max.x).toBeLessThanOrEqual(RECT.x + RECT.w + 2);
    expect(box.min.z).toBeGreaterThanOrEqual(RECT.z - 2);
    expect(box.max.z).toBeLessThanOrEqual(RECT.z + RECT.d + 2);
    if (box.max.y > 50) {
      const tall: string[] = [];
      mirror.root.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const b = new THREE.Box3().setFromObject(o);
        if (b.max.y > 50) tall.push(`${o.name || o.parent?.name || "?"} → ${b.max.y.toFixed(1)}`);
      });
      throw new Error(`above the wall head: ${tall.slice(0, 12).join(" | ")}`);
    }
    expect(box.max.y).toBeLessThanOrEqual(50); // nothing punches through the 46-unit wall head
  });

  it("stands every lounge sitter ON the cushion the builder actually draws", () => {
    const { world } = rig();
    for (const id of [...SOFA_SEAT_IDS, ...ARMCHAIR_SEAT_IDS])
      for (const s of world.get(id).capabilities.lounge!.slots) {
        expect(s.contactLocal.y).toBeGreaterThan(10);
        expect(s.contactLocal.y).toBeLessThan(18);
        expect(pointInRect(s.approach, FLOOR_RECT), `${s.id} stand point outside the room`).toBe(true);
      }
  });
});

// ============================= MOVABLE SEATING (regression) =====================================
// The CEO / CTO / HR chairs are the room's three MOVABLE seats. They carry Executive-specific geometry
// but must run the SAME proven SeatCapability sequence every other V2 desk chair runs:
//   approach → pull the chair out → enter the gap → sit → slide in → seated → …and all the way back.

/** the same harness seat.test.ts uses for the Design Room's chair-4, pointed at an Executive chair */
function seatRig(id: string) {
  const world = new WorldState();
  world.addRoom(EXECUTIVE_ROOM);
  for (const e of executiveRoomEntities()) world.addEntity(e);
  const entity = world.get(id);
  const spec = entity.capabilities.seat!;
  const scene = new THREE.Object3D();
  const chair = new THREE.Object3D();
  chair.position.set(entity.transform.pos.x, 0, entity.transform.pos.z);
  scene.add(chair);
  const av = new Avatar({ height: 36, lit: true });
  scene.add(av.root);
  av.setPosition({ x: spec.approach.x + 60, z: spec.approach.z });
  const stack = new ControllerStack();
  const nav = new NavigationController(av, stack);
  const seat = new SeatInteraction(av, stack, chair, spec, (to) => ({ ok: true, destination: to, path: [to], cell: { cx: 0, cy: 0 } }));
  const run = (secs: number) => { for (let t = 0; t < secs; t += 1 / 60) { seat.update(1 / 60); nav.update(1 / 60); scene.updateMatrixWorld(true); } };
  return { world, spec, scene, chair, av, stack, nav, seat, run, rest: chair.position.clone() };
}

describe("vo3d executive room — the three movable chairs complete the seat sequence", () => {
  for (const id of ["executive-room/exec-chair-left", "executive-room/exec-chair-right", "executive-room/workstation-chair"]) {
    it(`${id.split("/")[1]}: sit → seated → stand → idle, chair restored exactly, ownership released`, () => {
      const { spec, scene, chair, av, stack, seat, run, rest } = seatRig(id);
      expect(seat.sit()?.ok, "the stand point must be walkable").toBe(true);
      expect(stack.owner).toBe("Interaction");
      let maxStep = 0, maxPull = 0, prev = av.worldPosition();
      for (let t = 0; t < 15 && seat.state !== "seated"; t += 1 / 60) {
        seat.update(1 / 60);
        scene.updateMatrixWorld(true);
        const p = av.worldPosition();
        maxStep = Math.max(maxStep, p.distanceTo(prev));
        prev = p;
        maxPull = Math.max(maxPull, chair.position.distanceTo(rest));
      }
      expect(seat.state, `stuck in "${seat.state}"`).toBe("seated");
      expect(maxStep, "no teleport anywhere in the sequence").toBeLessThan(1.6);
      expect(maxPull).toBeCloseTo(spec.pullDistance, 3);
      expect(chair.position.distanceTo(rest)).toBeCloseTo(spec.seatedTuck, 6);
      expect(av.root.parent, "the sitter rides the chair while seated").toBe(chair);
      seat.stand();
      run(15);
      expect(seat.state).toBe("idle");
      expect(stack.owner, "Player gets the avatar back").toBe("Idle");
      expect(av.root.parent).toBe(scene);
      expect(seat.chairRestError(), "zero drift").toBeLessThan(1e-6);
    });
  }

  it("three sit/stand cycles in a row leave no drift and never strand the avatar", () => {
    const { chair, stack, nav, seat, run, rest } = seatRig("executive-room/exec-chair-left");
    for (let i = 0; i < 3; i++) {
      expect(seat.sit()?.ok).toBe(true);
      expect(seat.sit(), "a second sit while busy is refused, not queued").toBeNull();
      run(15);
      expect(seat.state, `cycle ${i} stuck in "${seat.state}"`).toBe("seated");
      expect(nav.setPath([{ x: 0, z: 0 }]), "navigation cannot steal a seated avatar").toBe(false);
      seat.stand();
      run(15);
      expect(seat.state).toBe("idle");
    }
    expect(chair.position.distanceTo(rest)).toBeLessThan(1e-9);
    expect(stack.owner).toBe("Idle");
    expect(nav.setPath([{ x: 0, z: 0 }]), "the avatar is free again").toBe(true);
  });

  it("a cancelled interaction hands the avatar straight back — a failed sit can never trap the Player", () => {
    for (const id of ["executive-room/exec-chair-left", "executive-room/exec-chair-right", "executive-room/workstation-chair"]) {
      const { chair, stack, seat, run, rest } = seatRig(id);
      seat.sit();
      run(3); // mid-sequence
      expect(seat.state).not.toBe("idle");
      seat.reset();
      expect(seat.state).toBe("idle");
      expect(stack.owner, `${id} left the avatar owned after reset`).toBe("Idle");
      expect(chair.position.distanceTo(rest)).toBeLessThan(1e-9);
    }
  });

  // ---- THE ACTUAL ROOT CAUSE ---------------------------------------------------------------------
  // The three chairs' DATA was always correct: the tests above pass against the seat capability alone.
  // What was broken was the app wiring — `execSeat` was constructed, acquired the "Interaction" lock in
  // sit(), and was then never ticked, because the frame loop's list of seat controllers was not extended
  // with it. SeatInteraction only ever advances inside update(), so the sequence stopped dead in
  // "approaching", Player movement stayed locked and only a page reload recovered.
  //
  // No behavioural test of a room can catch that, so this one reads the app entry: every SeatInteraction
  // holder declared in bootstrap.ts must appear in the per-frame update block.
  it("every movable-seat controller in bootstrap.ts is ticked in the frame loop", () => {
    const src = bootstrapSource;
    const declared = [...src.matchAll(/let (\w+): SeatInteraction \| null = null;/g)].map((m) => m[1]);
    expect(declared.length, "no SeatInteraction holders found — has bootstrap.ts been restructured?").toBeGreaterThanOrEqual(4);
    expect(declared).toContain("execSeat");
    for (const name of declared)
      expect(src.includes(`${name}?.update(dt / 1000);`), `${name} is never updated in the frame loop`).toBe(true);
    // and the same for the one non-nullable desk chair the Design Room owns
    expect(src.includes("seat.update(dt / 1000);")).toBe(true);
  });
});
