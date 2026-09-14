import { describe, expect, it } from "vitest";
import cmsBuildSource from "./build/cms.ts?raw";
import * as THREE from "three";
// Vite `?raw` import — loads bootstrap.ts's own source text as a string, the same trick
// executive.test.ts uses to guard app wiring.
import bootstrapSource from "./app/bootstrap.ts?raw";
import manifest from "../../data/office-assets-manifest.json";
import { SEAT_DIRECTIONS, seatCellKey } from "../../data/seatDirections";
import { WorldState } from "./world/WorldState";
import { CORRIDOR_BANDS, PLACEHOLDER_SOUTH_CLAMP, registerGroundFloor, roomSouthZ } from "./rooms/ground-floor";
import { footprintWallRects } from "./build/floorplan";
import { makeStandTest } from "./player/standTest";
import { SeatInteraction } from "./interact/Seat";
import { ControllerStack, NavigationController } from "./avatar/Controller";
import { Avatar } from "./avatar/Avatar";
import { DESIGN_ROOM, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "./rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import {
  AISLE, CMS_APPROACH_IDS, CMS_LOUNGE_IDS, CMS_ROOM, CMS_ROOM_ID, CMS_SEAT_IDS, CMS_SOLIDS, CMS_WALLS,
  COFFEE_TABLE, CONTENT_CREDENZA, COUNTER, DOOR, DOOR_NORTH_ID, DOOR_SOUTH_ID, DOOR_STANDS, EAST_X,
  ENTRY_DOOR, FLOOR_RECT, LEAD_CHAIRS, LEAD_DESKS, LEAD_DESK_W, LEAD_DESK_Z, LIBRARY,
  LOUNGE_APPROACH, MEMBER_CHAIRS, MEMBER_CHAIR_SIZE, MEMBER_ROWS, NORTH_Z, POUF, PRINT_CREDENZA, RECT,
  RUG, RUN_FRONT, SOFA_CUSHION_X, SOFA_LEN, SOFA_X, SOFA_Z, SOUTH_Z, THEME, TILE_RECT, WALL_T, WEST_X,
  cmsRoomEntities,
} from "./rooms/cms";
import { AI_ROOM, aiRoomEntities } from "./rooms/ai";
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
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(),
    ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities()]) world.addEntity(e);
  const plan = registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, {
    roomIds: new Set([DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB.id, EXECUTIVE_ROOM.id, CMS_ROOM.id, AI_ROOM.id]),
  });
  walkability.attachDerived(derived, world);
  return { world, plan, inBounds, walkability, derived };
}
const overlap = (a: Rect, b: Rect): number =>
  Math.min(Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z));
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
/** the CMS solids a standing body actually has to clear, as world rects + circles */
type Obstacle = { id: string; rect?: Rect; c?: Vec2; r?: number };
function cmsObstacles(world: WorldState): Obstacle[] {
  const out: Obstacle[] = [];
  for (const e of world.inRoom(CMS_ROOM_ID)) {
    if (!e.footprint || !isSolid(e.footprint)) continue;
    if (e.footprint.shape === "circle") out.push({ id: e.id, c: { ...e.transform.pos }, r: e.footprint.r });
    else if (e.footprint.shape === "rect")
      out.push({ id: e.id, rect: { x: e.transform.pos.x - e.footprint.w / 2, z: e.transform.pos.z - e.footprint.d / 2, w: e.footprint.w, d: e.footprint.d } });
  }
  return out;
}
/** does a body of `r` standing on `p` clear every obstacle except those named? */
function bodyClear(obs: Obstacle[], p: Vec2, r: number, except: (id: string) => boolean = () => false): string | null {
  for (const o of obs) {
    if (except(o.id)) continue;
    if (o.rect) {
      const dx = Math.max(o.rect.x - p.x, 0, p.x - (o.rect.x + o.rect.w));
      const dz = Math.max(o.rect.z - p.z, 0, p.z - (o.rect.z + o.rect.d));
      if (Math.hypot(dx, dz) < r) return o.id;
    } else if (o.c && o.r !== undefined && dist(o.c, p) < r + o.r) return o.id;
  }
  return null;
}

describe("vo3d CMS room — the layout is DERIVED, not invented", () => {
  it("takes its rect from the READ-ONLY V1 manifest", () => {
    const l = (manifest as { id: string; kind: string; x: number; y: number; width: number; height: number }[])
      .find((x) => x.id === "cms-room" && x.kind === "room")!;
    expect(RECT).toEqual({ x: l.x, z: l.y, w: l.width, d: l.height });
    expect(CMS_ROOM.rect).toBe(RECT);
    expect(CMS_ROOM.floorRect).toBe(FLOOR_RECT);
  });

  it("the walls sit on the art box and the floor is inside all four of them", () => {
    expect(WEST_X - RECT.x).toBe(WALL_T);
    expect(NORTH_Z - Math.round(RECT.z)).toBe(WALL_T);
    expect(Math.round(RECT.x + RECT.w) - EAST_X).toBe(WALL_T);
    expect(Math.round(RECT.z + RECT.d) - SOUTH_Z).toBe(WALL_T);
    expect(FLOOR_RECT).toEqual({ x: WEST_X, z: NORTH_Z, w: EAST_X - WEST_X, d: SOUTH_Z - NORTH_Z });
    // the tiled plate reaches the walls' OUTER faces, so no void is left under them
    expect(TILE_RECT.x).toBeLessThanOrEqual(RECT.x);
    expect(TILE_RECT.x + TILE_RECT.w).toBeGreaterThanOrEqual(RECT.x + RECT.w - 1);
  });

  it("the entrance is the V1 '+' band verbatim, and nothing is declared inside it", () => {
    // cols 71–72 × rows 27–30 → the door's span along the WEST wall is z 432…496
    expect(DOOR).toEqual({ z0: 27 * 16, z1: 31 * 16 });
    expect(ENTRY_DOOR.clearance.band).toEqual({ x: 71 * 16, z: 432, w: 32, d: 64 });
    expect(ENTRY_DOOR.clearance.solids).toEqual([]);
    // V1's own 's' stands, col 70 outside and col 73 inside
    expect(DOOR_STANDS.outside.x).toBe(70 * 16 + 8);
    expect(DOOR_STANDS.inside.x).toBe(73 * 16 + 8);
    // no wall run crosses the band
    for (const w of CMS_WALLS) {
      const band = { x: RECT.x, z: DOOR.z0, w: WALL_T, d: DOOR.z1 - DOOR.z0 };
      expect(overlap(w, band), `wall ${JSON.stringify(w)} intrudes on the door band`).toBeLessThanOrEqual(0);
    }
  });

  it("every V1 seat cell in seatDirections is represented by real seating, facing the way V1 says", () => {
    const v1 = SEAT_DIRECTIONS["cms-team"].seats!;
    expect(Object.keys(v1)).toHaveLength(11);
    const seatedYawFor: Record<string, number> = { front: FACING_YAW.south, back: FACING_YAW.north, left: FACING_YAW.west, right: FACING_YAW.east };
    const entities = cmsRoomEntities();
    /** every seatable piece with the world point a sitter lands on and the yaw they end at */
    const places: { at: Vec2; yaw: number }[] = [];
    for (const e of entities) {
      if (e.capabilities.seat) places.push({ at: { ...e.transform.pos }, yaw: e.capabilities.seat.seatedYaw });
      for (const s of e.capabilities.lounge?.slots ?? []) {
        // the sofa is authored unrotated, so furniture-local == world for it; the pouf sits on its centre
        const at = e.kind === "cms-sofa"
          ? { x: SOFA_CUSHION_X, z: e.transform.pos.z + s.contactLocal.z }
          : { ...e.transform.pos };
        places.push({ at, yaw: s.seatedYaw });
      }
    }
    for (const [cellKey, dir] of Object.entries(v1)) {
      const [cx, cz] = cellKey.split(",").map(Number);
      const near = places.filter((p) => Math.abs(p.at.x - cx) <= 12 && Math.abs(p.at.z - cz) <= 12);
      expect(near.length, `V1 seat cell ${cellKey} (${dir}) has no seating on it`).toBeGreaterThan(0);
      expect(near.some((p) => Math.abs(p.yaw - seatedYawFor[dir]) < 1e-6), `${cellKey} faces the wrong way`).toBe(true);
    }
    // and the room's seat cell keys round-trip through V1's own helper
    for (const c of [...LEAD_CHAIRS, ...MEMBER_CHAIRS.filter((m) => m.row === 0)])
      expect(typeof seatCellKey(c.x, c.z)).toBe("string");
  });

  it("the lead desks are the manifest's own cms-lead-desk boxes and their chairs are V1's cells", () => {
    const v1Desks = (manifest as { id: string; x: number; y: number; width: number }[]).filter((l) => l.id.startsWith("cms-lead") && l.id.endsWith("-desk"));
    expect(v1Desks).toHaveLength(2);
    expect(LEAD_DESKS.map((d) => d.x)).toEqual(v1Desks.map((l) => l.x));
    expect(LEAD_DESK_W).toBeCloseTo(v1Desks[0].width, 2);
    expect(LEAD_CHAIRS.map((c) => `${c.x},${c.z}`)).toEqual(["1240,408", "1336,408"]);
    // each chair is centred on its desk and stands NORTH of it, as V1 draws them
    for (const [i, c] of LEAD_CHAIRS.entries()) {
      expect(Math.abs(c.x - (LEAD_DESKS[i].x + LEAD_DESK_W / 2))).toBeLessThan(1);
      expect(c.z).toBeLessThan(LEAD_DESK_Z);
    }
  });

  it("the member cluster keeps V1's rows, its aisle and its seat cells", () => {
    expect(MEMBER_ROWS[0].xs).toEqual([1208, 1256, 1320, 1368]);
    expect(MEMBER_ROWS[1].xs).toEqual([1256, 1320, 1368]);
    // the grid keeps col 80 (x 1280…1296) open through every desk row — no desk may cross it
    for (const row of MEMBER_ROWS)
      for (const x of row.xs) {
        const desk = { x: x - 16, z: row.deskZ, w: 32, d: 26 };
        expect(overlap(desk, { x: AISLE.x0, z: row.deskZ, w: AISLE.x1 - AISLE.x0, d: 26 }), `desk ${x} blocks the aisle`).toBeLessThanOrEqual(0);
      }
    // every chair sits SOUTH of its own desk and NORTH of the next row's, with real roll-back room
    for (const c of MEMBER_CHAIRS) {
      const row = MEMBER_ROWS[c.row];
      expect(c.z).toBeGreaterThan(row.deskZ + 26);
      expect(row.xs).toContain(c.x);
    }
    const front = MEMBER_CHAIRS.filter((c) => c.row === 0)[0];
    const pulledSouth = front.z + 9 + MEMBER_CHAIR_SIZE / 2;
    expect(pulledSouth, "a pulled front-row chair must clear the back row's desks").toBeLessThan(MEMBER_ROWS[1].deskZ);
  });

  it("the lounge reproduces the reference: sofa on the rug's west edge, pouf and table east of it", () => {
    const sofa = { x: SOFA_X - 19 / 2, z: SOFA_Z - SOFA_LEN / 2, w: 19, d: SOFA_LEN };
    expect(sofa.z).toBeCloseTo(516, 0);
    expect(SOFA_CUSHION_X).toBeCloseTo(1176.5, 1); // V1's own sofa cells are at x 1176
    expect(overlap(sofa, RUG)).toBeGreaterThan(0); // the sofa stands ON the rug
    expect(POUF.x).toBeGreaterThan(sofa.x + sofa.w); // east of it, as the render draws them
    expect(COFFEE_TABLE.x).toBeGreaterThan(sofa.x + sofa.w);
    expect(dist(POUF, COFFEE_TABLE)).toBeGreaterThan(POUF.r + COFFEE_TABLE.r); // and they do not interpenetrate
  });

  it("the north storage run leaves a body-wide lane between it and the lead chairs", () => {
    for (const unit of [LIBRARY, CONTENT_CREDENZA, COUNTER]) {
      expect(unit.z).toBe(NORTH_Z);
      expect(unit.z + unit.d).toBe(RUN_FRONT);
    }
    const lane = LEAD_CHAIRS[0].z - 18 / 2 - RUN_FRONT;
    expect(lane, "the room's main east–west lane is narrower than a body").toBeGreaterThanOrEqual(2 * NAV_RADIUS);
    // the run's three units never overlap each other, and the east credenza stays clear of the desks
    expect(overlap(LIBRARY, CONTENT_CREDENZA)).toBeLessThanOrEqual(0);
    expect(overlap(CONTENT_CREDENZA, COUNTER)).toBeLessThanOrEqual(0);
    expect(PRINT_CREDENZA.x + PRINT_CREDENZA.w).toBe(EAST_X);
    expect(PRINT_CREDENZA.x - (1368 + 32 / 2), "the east lane is narrower than a body").toBeGreaterThanOrEqual(2 * NAV_RADIUS);
  });

  it("uses ONLY its own theme colours — no other room's identity leaks in", () => {
    for (const k of Object.values(THEME)) expect(PALETTE).toHaveProperty(k);
    // the blues and the oak are this room's, not Gaming's or Executive's
    expect(THEME.blue).toBe("cmsBlue");
    expect(THEME.oak).toBe("cmsOak");
    const entities = cmsRoomEntities();
    for (const e of entities)
      for (const p of ["color", "colorSeat", "accent", "screen", "frame"])
        if (typeof e.props[p] === "string")
          expect(String(e.props[p]).startsWith("cms"), `${e.id}.${p} = ${e.props[p]} is not a CMS colour`).toBe(true);
  });
});

describe("vo3d CMS room — interactions reuse the proven systems", () => {
  it("nine MOVABLE chairs, each with a complete SeatCapability", () => {
    expect(CMS_SEAT_IDS).toHaveLength(9);
    const { world } = rig();
    for (const id of CMS_SEAT_IDS) {
      const s = world.get(id).capabilities.seat!;
      expect(s, id).toBeTruthy();
      expect(s.pullDistance).toBeGreaterThan(0);
      expect(s.seatedTuck).toBeLessThan(s.pullDistance); // the chair tucks back IN under the sitter
      expect(s.cushionTopY).toBeGreaterThan(10);
      expect(s.approachToSeat.length).toBeGreaterThan(0);
      // preSeat lies between the chair's home and its desk — the gap the chair vacates
      expect(s.preSeat.x).toBeCloseTo(world.get(id).transform.pos.x, 6);
      expect(Math.sign(s.preSeat.z - world.get(id).transform.pos.z)).toBe(-s.pullDir.z);
    }
  });

  it("every seat approach, lounge stand and walk-up point is body-clear on the derived floor", () => {
    const { world, walkability } = rig();
    const obs = cmsObstacles(world);
    const points: { at: Vec2; id: string }[] = [];
    for (const id of CMS_SEAT_IDS) points.push({ at: world.get(id).capabilities.seat!.approach, id });
    for (const id of CMS_LOUNGE_IDS) for (const s of world.get(id).capabilities.lounge!.slots) points.push({ at: s.approach, id: `${id}/${s.id}` });
    for (const id of CMS_APPROACH_IDS) points.push({ at: world.get(id).capabilities.approach!.point, id });
    for (const p of points) {
      expect(pointInRect(p.at, FLOOR_RECT), `${p.id}: approach is outside the room floor`).toBe(true);
      // the chair/piece being walked up to is allowed to be within reach — everything else is not
      const hit = bodyClear(obs, p.at, NAV_RADIUS, (oid) => oid === p.id || p.id.startsWith(oid));
      expect(hit, `${p.id}: a body at NAV_RADIUS on ${JSON.stringify(p.at)} collides with ${hit}`).toBe(null);
      const c = worldToCell(p.at);
      expect(walkability.walkable(c.cx, c.cy), `${p.id}: its stand cell is not walkable`).toBe(true);
    }
  });

  it("the lounge lane really is a lane: sofa slots and the pouf are reached down it", () => {
    const { world } = rig();
    const obs = cmsObstacles(world);
    const sofa = world.get(CMS_LOUNGE_IDS[0]).capabilities.lounge!;
    expect(sofa.slots).toHaveLength(3);
    for (const s of sofa.slots) {
      expect(s.approach).toEqual(LOUNGE_APPROACH);
      expect(s.approachToSeat).toHaveLength(1);
      // the waypoint is beside the cushion it serves, not on top of the sofa
      expect(s.approachToSeat[0].x).toBeGreaterThan(SOFA_X + 19 / 2);
    }
    // the cushions run north→south down the sofa and are all inside its body
    const zs = sofa.slots.map((s) => SOFA_Z + s.contactLocal.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    for (const z of zs) expect(z).toBeGreaterThan(SOFA_Z - SOFA_LEN / 2);
    expect(bodyClear(obs, LOUNGE_APPROACH, NAV_RADIUS)).toBe(null);
  });

  it("every walk-up point faces something real and names an action", () => {
    const { world } = rig();
    expect(CMS_APPROACH_IDS).toHaveLength(5);
    for (const id of CMS_APPROACH_IDS) {
      const a = world.get(id).capabilities.approach!;
      expect(a.label.length, id).toBeGreaterThan(0);
      expect(a.action.length, id).toBeGreaterThan(0);
      expect(Object.values(FACING_YAW)).toContain(a.yaw);
      expect(typeof world.get(id).props.pick).toBe("string");
    }
  });

  it("the fixed fit-out is registered as solids, so derived navigation sees what the camera does", () => {
    const { world } = rig();
    for (const s of CMS_SOLIDS) {
      const e = world.get(`${CMS_ROOM_ID}/solid-${s.id}`);
      expect(e.footprint).toEqual({ shape: "rect", w: s.w, d: s.d });
      expect(pointInRect(e.transform.pos, FLOOR_RECT), s.id).toBe(true);
    }
  });

  it("no two solid footprints in the room interpenetrate", () => {
    const { world } = rig();
    const obs = cmsObstacles(world).filter((o) => o.rect);
    for (let i = 0; i < obs.length; i++)
      for (let j = i + 1; j < obs.length; j++)
        expect(overlap(obs[i].rect!, obs[j].rect!), `${obs[i].id} overlaps ${obs[j].id}`).toBeLessThanOrEqual(0.001);
  });
});

describe("vo3d CMS room — the entrance and navigation", () => {
  it("the bi-parting leaves are two halves of the V1 band and counter-slide without drift", () => {
    const { world } = rig();
    const n = world.get(DOOR_NORTH_ID), s = world.get(DOOR_SOUTH_ID);
    expect(n.transform.pos.x).toBe(s.transform.pos.x);
    expect(s.transform.pos.z - n.transform.pos.z).toBe(32);
    expect(n.transform.yaw).toBeCloseTo(-Math.PI / 2, 6); // the leaf is turned a quarter for a WEST wall
    expect(s.capabilities.door).toBeUndefined(); // only the driving leaf carries the capability
    const view = { position: { x: n.transform.pos.x, z: n.transform.pos.z } } as unknown as import("three").Object3D;
    const opp = { position: { x: s.transform.pos.x, z: s.transform.pos.z } } as unknown as import("three").Object3D;
    const door = new SlidingDoor(view, ENTRY_DOOR, n.transform.pos, { view: opp, closed: s.transform.pos });
    const route = [DOOR_STANDS.outside, DOOR_STANDS.inside];
    for (let i = 0; i < 200; i++) door.update(1 / 60, DOOR_STANDS.outside, route);
    expect(door.t).toBeCloseTo(1, 3);
    expect(view.position.z).toBeCloseTo(n.transform.pos.z - 32, 3); // north leaf parks north
    expect(opp.position.z).toBeCloseTo(s.transform.pos.z + 32, 3); //  south leaf parks south
    for (let i = 0; i < 400; i++) door.update(1 / 60, { x: 1128, z: 200 }, []);
    expect(door.state).toBe("closed");
    expect(door.driftError()).toBeLessThan(1e-6);
  });

  it("the room is reachable from the hall and its own inside stand, both ways", () => {
    const { walkability, inBounds } = rig();
    const outside = DOOR_STANDS.outside, inside = DOOR_STANDS.inside;
    for (const [from, to] of [[outside, inside], [inside, outside]] as const) {
      const r = planWalk(from, to, walkability, inBounds);
      expect(r.ok, `no route ${JSON.stringify(from)} → ${JSON.stringify(to)}: ${r.ok ? "" : r.reason}`).toBe(true);
    }
  });

  it("every seat and walk-up point in the room can actually be walked to from the doorway", () => {
    const { world, walkability, inBounds } = rig();
    const from = DOOR_STANDS.inside;
    const targets: { at: Vec2; id: string }[] = [];
    for (const id of CMS_SEAT_IDS) targets.push({ at: world.get(id).capabilities.seat!.approach, id });
    for (const id of CMS_LOUNGE_IDS) targets.push({ at: world.get(id).capabilities.lounge!.slots[0].approach, id });
    for (const id of CMS_APPROACH_IDS) targets.push({ at: world.get(id).capabilities.approach!.point, id });
    for (const t of targets) {
      const r = planWalk(from, t.at, walkability, inBounds);
      expect(r.ok, `${t.id} at ${JSON.stringify(t.at)} is unreachable from the doorway`).toBe(true);
    }
  });

  it("the room's floor is a walkable region and its walls are not", () => {
    const { world } = rig();
    expect(world.regionAt({ x: 1290, z: 460 })).toMatchObject({ id: `floor:${CMS_ROOM_ID}`, walkable: true });
    // inside the north wall is not the room's floor
    expect(world.regionAt({ x: 1290, z: 350 })?.id).not.toBe(`floor:${CMS_ROOM_ID}`);
  });
});

describe("vo3d CMS room — app wiring", () => {
  // THE EXECUTIVE ROOM'S BUG, GUARDED FOR THIS ROOM TOO. `execSeat` was constructed, acquired the
  // "Interaction" lock in sit(), and was then never ticked because the frame loop's list of seat
  // controllers was not extended with it — so the sequence stopped dead in "approaching", Player movement
  // stayed locked, and only a page reload recovered. executive.test.ts reads bootstrap.ts for EVERY
  // SeatInteraction holder; this asserts the CMS one exists and is in that list by name.
  it("cmsSeat is declared AND ticked in the per-frame update block", () => {
    const src = bootstrapSource;
    const declared = [...src.matchAll(/let (\w+): SeatInteraction \| null = null;/g)].map((m) => m[1]);
    expect(declared).toContain("cmsSeat");
    expect(src.includes("cmsSeat?.update(dt / 1000);"), "cmsSeat is never updated in the frame loop").toBe(true);
    // and it is reset alongside the others, so switching rooms cannot leave it holding the avatar
    expect(src.includes('if (cmsSeat && cmsSeat.state !== "idle") cmsSeat.reset();')).toBe(true);
  });

  it("the room, its entities, its derived navigation and its door are all registered", () => {
    const src = bootstrapSource;
    expect(src).toContain("world.addRoom(CMS_ROOM);");
    expect(src).toContain("for (const e of cmsRoomEntities()) world.addEntity(e);");
    expect(src).toContain("mirror.buildRoom(CMS_ROOM, shellOpts());");
    expect(src).toMatch(/DERIVED_ROOM_IDS = new Set\(\[[^\]]*CMS_ROOM\.id/);
    expect(src).toContain("cmsDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route);");
    // Player mode must be able to activate the room's chairs, or they are GUI-only
    expect(src).toContain("const cms = CMS_SEAT_IDS.indexOf(id);");
    // and its lounge pieces join the one shared lounge-seat list
    expect(src).toMatch(/EXECUTIVE_LOUNGE_IDS, \.\.\.CMS_LOUNGE_IDS\]/);
  });
});

// ================================================================================================
// PHASE 8 LIVE VISUAL CORRECTIONS. Three faults Bon found driving the room in Player View, each with
// the geometry that proves the fix rather than the screenshot that found it.
// ================================================================================================
describe("vo3d CMS room — live Player View corrections", () => {
  it("1. the west elevation is a PARTITION, not a masonry box: no member is deeper than the wall", () => {
    // The fault: build/frontbar's glazing multipliers (×1.25 shoe, ×1.35 mullion, ×2.6 cap) were applied
    // to the 12-unit WALL depth instead of to a ~3-unit pane, and the jambs were 22.8-deep full-height
    // blocks — the two giant slabs beside the CMS door in Player View. Every member is now sized off
    // STRUCT.wallThickness, so nothing in the elevation can be thicker than the wall it stands in.
    const src = cmsBuildSource;
    const elevation = src.slice(src.indexOf("function westScreen"), src.indexOf("// ---- the content-planning wall"));
    expect(elevation.length).toBeGreaterThan(200);
    // no member may be scaled off the 12-unit wall reveal any more
    expect(elevation).not.toMatch(/t \* (1\.25|1\.35|1\.9|2\.6)/);
    expect(elevation).toContain("const T = STRUCT.wallThickness;");
    // and every surviving multiplier is a small factor of the 6-unit partition plane
    for (const m of elevation.matchAll(/T \* ([\d.]+)/g))
      expect(Number(m[1]) * 6, `a west-elevation member is ${Number(m[1]) * 6} deep`).toBeLessThanOrEqual(WALL_T);
  });

  it("2. every member chair rests AT its desk and stays there while occupied", () => {
    const { world } = rig();
    for (const c of MEMBER_CHAIRS) {
      const row = MEMBER_ROWS[c.row];
      const deskEdge = row.deskZ + 26; // the desk's south face: the edge a sitter works at
      const chairFront = c.z - MEMBER_CHAIR_SIZE / 2;
      expect(chairFront - deskEdge, `${c.id} rests ${chairFront - deskEdge} from its desk`).toBeLessThanOrEqual(5);
      expect(chairFront - deskEdge, `${c.id} is inside its own desk`).toBeGreaterThanOrEqual(0);
      const s = world.get(`${CMS_ROOM_ID}/${c.id}`).capabilities.seat!;
      // the OCCUPIED chair is what the player actually sees: rest + seatedTuck along the pull direction
      const seated = c.z + s.pullDir.z * s.seatedTuck;
      expect(seated - deskEdge, `${c.id} parks ${seated - deskEdge} from its desk while occupied`).toBeLessThanOrEqual(12);
      // …and there is still real roll-back room behind it
      const pulled = c.z + s.pullDir.z * s.pullDistance + MEMBER_CHAIR_SIZE / 2;
      const behind = c.row === 0 ? MEMBER_ROWS[1].deskZ : SOUTH_Z;
      expect(pulled, `${c.id} cannot roll back without hitting what is behind it`).toBeLessThan(behind);
      // every chair is still inside the V1 cell it came from
      const cell = worldToCell({ x: c.x, z: c.z });
      expect(cell.cy, `${c.id} left its V1 seat row`).toBe(c.row === 0 ? 31 : 34);
    }
  });

  it("2b. a full Sit → Seated → Stand cycle returns every chair to rest with zero drift", () => {
    const { world, walkability, inBounds } = rig();
    for (const id of CMS_SEAT_IDS) {
      const e = world.get(id);
      const spec = e.capabilities.seat!;
      const scene = new THREE.Object3D();
      const chair = new THREE.Object3D();
      chair.position.set(e.transform.pos.x, 0, e.transform.pos.z);
      scene.add(chair);
      const rest = chair.position.clone();
      const av = new Avatar({ height: 36, lit: true });
      scene.add(av.root);
      av.setPosition({ x: spec.approach.x, z: spec.approach.z });
      const stack = new ControllerStack();
      const nav = new NavigationController(av, stack);
      const seat = new SeatInteraction(av, stack, chair, spec, (to) => planWalk(spec.approach, to, walkability, inBounds));
      expect(seat.sit()?.ok, `${id}: the walk to its stand point was rejected`).toBe(true);
      expect(stack.owner).toBe("Interaction");
      const step = () => { seat.update(1 / 60); nav.update(1 / 60); scene.updateMatrixWorld(true); };
      for (let t = 0; t < 20 && seat.state !== "seated"; t += 1 / 60) step();
      expect(seat.state, `${id} never reached "seated" (stuck in "${seat.state}")`).toBe("seated");
      // the OCCUPIED chair is where the player sees it: pulled out, then tucked back by seatedTuck
      expect(Math.abs(chair.position.z - (rest.z + spec.pullDir.z * spec.seatedTuck)), id).toBeLessThan(0.01);
      seat.stand();
      for (let t = 0; t < 20 && seat.state !== "idle"; t += 1 / 60) step();
      expect(seat.state, `${id} never returned to idle`).toBe("idle");
      expect(seat.chairRestError(), `${id} left its chair off its rest position`).toBeLessThan(1e-6);
      expect(stack.owner, `${id} never released the avatar`).not.toBe("Interaction");
    }
  });

  it("3. the corridor between CMS and the unbuilt Dev room is walkable geometry, not a player-only gap", () => {
    const { world, plan, walkability, derived } = rig();
    // the placeholder's own geometry moved — this is not a nav-only opening
    const dev = plan.rooms.find((r) => r.id === "dev-room")!;
    expect(dev.reconstructed).toBe(false);
    expect(roomSouthZ(dev, plan)).toBe(PLACEHOLDER_SOUTH_CLAMP["dev-room"]);
    const built = footprintWallRects(dev, plan);
    for (const w of built) expect(w.z + w.d, "a Dev placeholder wall still stands in the corridor").toBeLessThanOrEqual(304);
    // …and its unwalkable REGION moved with it, or the clamp would be cosmetic
    expect(world.regionAt({ x: 1272, z: 328 })?.id).not.toBe("footprint:dev-room");
    expect(world.regionAt({ x: 1272, z: 328 })?.walkable).toBe(true);
    // the corridor's clear width: the clamped placeholder to the CMS north wall's outer face
    expect(Math.round(RECT.z) - 304).toBeGreaterThanOrEqual(2 * NAV_RADIUS);
    // a PLAYER body can actually stand in it, across its whole length and at NAV_RADIUS
    const stand = makeStandTest({ world, walkability, derived, radius: NAV_RADIUS });
    // The legal standing band runs z 312…336 (the clamped placeholder to one body-radius short of the
    // CMS wall). Sampled along its middle, from the north–south hall to the last cell before the frame's
    // own east wall, every point holds a body at NAV_RADIUS.
    const lane: Vec2[] = [];
    for (let x = 1112; x <= 1392; x += 16) lane.push({ x, z: 328 });
    for (const p of lane) expect(stand(p), `a body cannot stand at ${JSON.stringify(p)} in the corridor`).toBe(true);
    for (const z of [312, 320, 328, 336]) expect(stand({ x: 1272, z }), `the corridor is not ${z} deep`).toBe(true);
    // and it is a THROUGH route: hall → past CMS → the corridor's east end, both ways
    const west: Vec2 = { x: 1112, z: 328 }, east: Vec2 = { x: 1392, z: 328 };
    for (const [a, b] of [[west, east], [east, west]] as const) {
      const r = planWalk(a, b, walkability, (p: Vec2) => world.walkableAt(p));
      expect(r.ok, `no corridor route ${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
    }
    // the Dev room's own entrance still opens onto it
    const devDoor = plan.openings.find((o) => o.roomId === "dev-room")!;
    expect(stand({ x: (devDoor.from + devDoor.to) / 2, z: 328 })).toBe(true);
    // CMS is untouched by the fix: its walls and its entrance are exactly where they were
    expect(WEST_X).toBe(1153);
    expect(DOOR).toEqual({ z0: 432, z1: 496 });
  });

  it("3b. the CMS entrance is reachable from the new corridor, and the corridor from the CMS entrance", () => {
    const { world, walkability } = rig();
    const inB = (p: Vec2) => world.walkableAt(p);
    const corridor: Vec2 = { x: 1272, z: 328 };
    for (const [a, b] of [[corridor, DOOR_STANDS.inside], [DOOR_STANDS.inside, corridor]] as const)
      expect(planWalk(a, b, walkability, inB).ok, `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
  });
});
