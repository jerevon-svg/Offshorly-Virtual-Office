import { describe, expect, it } from "vitest";
import devBuildSource from "./build/dev.ts?raw";
// Vite `?raw` import — loads bootstrap.ts's own source text as a string, the same trick executive.test.ts,
// cms.test.ts and ai.test.ts use to guard app wiring.
import bootstrapSource from "./app/world.ts?raw";
import manifest from "../../data/office-assets-manifest.json";
import { SEAT_DIRECTIONS } from "../../data/seatDirections";
import { WorldState, isSolid } from "./world/WorldState";
import { CORRIDOR_BANDS, PLACEHOLDER_SOUTH_CLAMP, registerGroundFloor } from "./rooms/ground-floor";
import { makeStandTest } from "./player/standTest";
import { DESIGN_ROOM, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "./rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities, NORTH_OUTER_Z as CMS_NORTH_OUTER } from "./rooms/cms";
import { AI_ROOM, aiRoomEntities } from "./rooms/ai";
import {
  AISLES, BAY_D, BAY_DESKS, BAY_ROW1_CHAIRS, BAY_ROW1_Z, BAY_ROW2_CHAIRS, BAY_ROW2_Z, BAY_W, BAY_Z,
  BOOKCASE, DEV_APPROACH_IDS, DEV_LOUNGE_IDS, DEV_ROOM, DEV_ROOM_ID, DEV_SEAT_IDS, DEV_SOLIDS, DEV_WALLS,
  DOOR, DOOR_LEAF_ID, DOOR_STANDS, EAST_X, ENTRY_DOOR, FLOOR_RECT, LEAD_CHAIRS, LEAD_DESKS, LEAD_DESK_D,
  LEAD_DESK_W, LEAD_DESK_Z0, MIDDLE_LANE_Z, NORTH_LANE_Z, NORTH_Z, PANTRY, RUN_FRONT, SIDE_DESK,
  SOFA_ID, SOFA_X, SOFA_Z, SOUTH_LANE_Z, SOUTH_OUTER_Z, SOUTH_Z, TEA_SHELF, TOOL_WALL, VISITOR_CHAIRS,
  WEST_X, devRoomEntities, sofaSlots, BAY_H, LEAD_DESK_H,
} from "./rooms/dev";
import { QA_ROOM, qaRoomEntities } from "./rooms/qa";
import * as THREE from "three";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack, NavigationController } from "./avatar/Controller";
import { SeatInteraction } from "./interact/Seat";
import { LoungeSeatInteraction } from "./interact/LoungeSeat";
import { ApproachInteraction } from "./interact/Approach";
import { PlayerBody } from "./player/PlayerBody";
import { BON_STANDING_HEIGHT } from "./adapters/v1Avatar";
import { STRUCT } from "./rooms/reception";
import { DEV_DESK_TOP } from "./build/dev-furniture";
import { PALETTE } from "./render/Materials";
import { SlidingDoor } from "./interact/Door";
import { DerivedNav } from "./nav/derived";
import { Walkability, composeStatic } from "./nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "./nav/clearance";
import { openedLayer, v2Static } from "./nav/v2Open";
import { CELL, v1Static } from "./adapters/v1Grid";
import { planWalk } from "./nav/planner";
import { FACING_YAW, pointInRect, type Rect, type Vec2 } from "./core/coords";

/** the same wiring bootstrap.ts uses, minus THREE */
function rig() {
  const world = new WorldState();
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(),
    ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(),
    ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  const plan = registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, {
    roomIds: new Set([DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB.id, EXECUTIVE_ROOM.id, CMS_ROOM.id, AI_ROOM.id, DEV_ROOM.id, QA_ROOM.id]),
  });
  walkability.attachDerived(derived, world);
  const stand = makeStandTest({ world, walkability, derived, radius: NAV_RADIUS });
  return { world, plan, inBounds, walkability, derived, stand };
}
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
/** the Dev solids a standing body actually has to clear, as world rects + circles */
type Obstacle = { id: string; rect?: Rect; c?: Vec2; r?: number };
function devObstacles(world: WorldState): Obstacle[] {
  const out: Obstacle[] = [];
  for (const e of world.inRoom(DEV_ROOM_ID)) {
    if (!e.footprint || !isSolid(e.footprint)) continue;
    if (e.footprint.shape === "circle") out.push({ id: e.id, c: { ...e.transform.pos }, r: e.footprint.r });
    else if (e.footprint.shape === "rect")
      out.push({ id: e.id, rect: { x: e.transform.pos.x - e.footprint.w / 2, z: e.transform.pos.z - e.footprint.d / 2, w: e.footprint.w, d: e.footprint.d } });
  }
  return out;
}
function clearOf(p: Vec2, obs: Obstacle[], r: number): { id: string; gap: number } | null {
  for (const o of obs) {
    if (o.rect) {
      const nx = Math.max(o.rect.x, Math.min(p.x, o.rect.x + o.rect.w));
      const nz = Math.max(o.rect.z, Math.min(p.z, o.rect.z + o.rect.d));
      const g = Math.hypot(p.x - nx, p.z - nz);
      if (g < r) return { id: o.id, gap: g };
    } else if (o.c && o.r !== undefined) {
      const g = dist(p, o.c) - o.r;
      if (g < r) return { id: o.id, gap: g };
    }
  }
  return null;
}

const v1 = (id: string) => manifest.find((l) => l.id === id)!;
const boxCentre = (id: string): Vec2 => { const l = v1(id); return { x: l.x + l.width / 2, z: l.y + l.height / 2 }; };
/** V1's own walk directions, as world yaws */
const YAW_FOR: Record<string, number> = { front: FACING_YAW.south, back: FACING_YAW.north, right: FACING_YAW.east, left: FACING_YAW.west };
/** chairPlanRadius, inlined so the test measures independently of the footprint helper */
const chairR = (w: number, d: number) => Math.min(w, d) * 0.8 * 0.52 * 0.97 + 1;

describe("vo3d Dev Room — Phase 10: the V1 room reconstructed in true 3D", () => {
  it("1. the room sits on its V1 manifest rect; three walls are on the art box and the south is V1's own line", () => {
    const l = v1("dev-room");
    expect(DEV_ROOM.rect).toEqual({ x: l.x, z: l.y, w: l.width, d: l.height });
    // the north, west and east outer faces land on the art box, within the rounding the box itself carries
    expect(Math.abs(NORTH_Z - 12 - l.y)).toBeLessThan(0.2);
    expect(Math.abs(WEST_X - 12 - l.x)).toBeLessThan(0.2);
    expect(Math.abs(EAST_X + 12 - (l.x + l.width))).toBeLessThan(0.2);
    // THE SOUTH CLAMP. The art box runs to 328.86; the wall is built on V1's own south band instead
    // (rows 19–20 start at 304), because a wall on the art box leaves the CMS corridor no legal cell.
    expect(SOUTH_Z).toBe(19 * CELL);
    expect(SOUTH_OUTER_Z).toBe(316);
    expect(l.y + l.height).toBeGreaterThan(SOUTH_OUTER_Z);
    expect(FLOOR_RECT).toEqual({ x: 1123, z: 20, w: 297, d: 284 });
    // THE BAKED-PERSPECTIVE CORRECTION: V1 blocks rows 0–2 (z 0…48) right across the north and cols 69–71
    // down the west. Neither is wall. The wall is 12 and the run in front of it is 24.
    expect(RUN_FRONT).toBe(44);
    expect(BOOKCASE.d).toBe(24);
    for (let cy = 0; cy <= 2; cy++) expect(v1Static(75, cy), `V1 paints row ${cy} as blocked`).toBe(false);
    for (const cx of [69, 70, 71]) expect(v1Static(cx, 8), `V1 paints col ${cx} as blocked`).toBe(false);
    // the five wall runs seal the room except at the door band
    expect(DEV_WALLS).toHaveLength(5);
    for (const w of DEV_WALLS) expect(Math.min(w.w, w.d)).toBe(12);
    const south = DEV_WALLS.filter((w) => w.z === SOUTH_Z).sort((a, b) => a.x - b.x);
    expect(south).toHaveLength(2);
    expect(south[0].x + south[0].w).toBe(DOOR.x0); // the opening is the ONE gap
    expect(south[1].x).toBe(DOOR.x1);
  });

  it("2. every V1 dev-team furniture box is rebuilt, at the manifest's own position", () => {
    const ents = devRoomEntities();
    const at = (kind: string) => ents.filter((e) => e.kind === kind);
    // two lead desks, x verbatim; depth squared from the flat box's 37.961 (the PNG's drop shadow)
    expect(at("dev-lead-desk")).toHaveLength(2);
    ["dev-lead1-desk", "dev-lead2-desk"].forEach((id, i) => {
      const box = v1(id);
      expect(LEAD_DESKS[i].x).toBeCloseTo(box.x, 2);
      expect(LEAD_DESK_W).toBeCloseTo(box.width, 2);
      expect(Math.abs(LEAD_DESK_Z0 - box.y)).toBeLessThan(0.5);
      expect(LEAD_DESK_D).toBeLessThan(box.height);
    });
    // two bay benches, at the manifest's own box centres
    expect(at("dev-bay-desk")).toHaveLength(2);
    ["dev-bay1-desk", "dev-bay2-desk"].forEach((id, i) => {
      const c = boxCentre(id);
      expect(BAY_DESKS[i].x).toBeCloseTo(c.x, 2);
      expect(Math.abs(BAY_Z - c.z)).toBeLessThan(1.2);
    });
    expect(BAY_W).toBe(106); //  the flat box is 106.363
    // DEPTH comes from V1's own grid, not its box: rows 10–13 are z 160…224 exactly, and the box's extra
    // 2.3 is the PNG's drop shadow. At the box depth the row-2 chairs overlap their own bench.
    expect(BAY_D).toBe(64);
    expect(BAY_Z - BAY_D / 2).toBe(10 * CELL);
    expect(BAY_Z + BAY_D / 2).toBe(14 * CELL);
    // twenty-two chairs in two room-specific kinds, one sofa, one side table, one rug
    expect(at("dev-exec-chair")).toHaveLength(10);
    expect(at("dev-task-chair")).toHaveLength(12);
    expect(at("dev-sofa")).toHaveLength(1);
    expect(at("dev-side-desk")).toHaveLength(1);
    expect(at("dev-rug")).toHaveLength(1);
    // the sofa is at the manifest's own box centre
    const sofaBox = boxCentre("dev-side-sofa");
    expect(SOFA_X).toBeCloseTo(sofaBox.x, 2);
    expect(SOFA_Z).toBeCloseTo(sofaBox.z, 2);
    // and NOT another room's furniture: no exec, cms or ai kind appears in here
    for (const e of ents) expect(e.kind.startsWith("cms-") || e.kind.startsWith("exec-") || e.kind.startsWith("ai-"), e.kind).toBe(false);
  });

  it("3. all 25 V1 seat cells are real seats, facing the way V1's seatDirections says", () => {
    const { world } = rig();
    const v1Seats = Object.entries(SEAT_DIRECTIONS["dev-team"]!.seats!);
    expect(v1Seats).toHaveLength(25);
    expect(DEV_SEAT_IDS).toHaveLength(22);
    const chairs = DEV_SEAT_IDS.map((id) => world.get(id));
    // the sofa's three cushions, as world points, stand in for the three V1 sofa cells
    // a cushion is measured at the sofa's OWN body centre in x — V1's three sofa cells sit on that line
    // (1144.47 = the manifest box centre), not on the cushion line 5 units east of it where a sitter lands
    const cushions = sofaSlots().map((s) => ({ id: `${SOFA_ID}#${s.id}`, x: SOFA_X, z: SOFA_Z + s.contactLocal.z, yaw: s.seatedYaw }));
    const seats = [
      ...chairs.map((c) => ({ id: c.id, x: c.transform.pos.x, z: c.transform.pos.z, yaw: c.capabilities.seat!.seatedYaw })),
      ...cushions,
    ];
    expect(seats).toHaveLength(25);
    const claimed = new Set<string>();
    for (const [cellKey, dir] of v1Seats) {
      const [cx, cz] = cellKey.split(",").map(Number);
      const near = seats.map((s) => ({ s, d: dist(s, { x: cx, z: cz }) })).sort((a, b) => a.d - b.d)[0];
      // THE FOUR DOCUMENTED CORRECTIONS, and nothing else:
      //  • lead chairs   5.02 north, out of their own desk
      //  • bay row 1     4.47 north, out of its own bench
      //  • sofa cushions up to 5.1, because the sofa's OWN cushion arithmetic (3 places in 61 units) is
      //    tighter than V1's three painted cells, which straddle 20.8 apart
      //  • everything else is on its V1 centre, to the 0.15 the manifest's two-decimal boxes round to
      const tol = near.s.id.includes("lead-chair") ? 5.1 : near.s.id.includes("bay-chair-n") ? 4.5
        : near.s.id.includes("sofa") ? 5.1 : 0.15;
      expect(near.d, `${cellKey} → ${near.s.id}`).toBeLessThanOrEqual(tol);
      expect(near.s.yaw, `${near.s.id} faces V1 "${dir}"`).toBeCloseTo(YAW_FOR[dir], 5);
      claimed.add(near.s.id);
    }
    expect(claimed.size, "every seat is claimed exactly once").toBe(25);
  });

  it("4. the chair corrections are MINIMAL, stay inside V1's own cells and clear the desk they serve", () => {
    // the lead chairs: 5.02 north, still in grid row 4 (z 64…80), and now clear of their own desk
    for (const c of LEAD_CHAIRS) {
      expect(v1("dev-lead1-chair").y + v1("dev-lead1-chair").height / 2 - c.z).toBeCloseTo(5.02, 2);
      expect(Math.floor(c.z / CELL)).toBe(4);
      expect(LEAD_DESK_Z0 - (c.z + chairR(16, 22))).toBeGreaterThan(0);
    }
    // bay row 1: 4.47 north, still in grid row 9 (z 144…160), and clear of its bench
    expect(156.47 - BAY_ROW1_Z).toBeCloseTo(4.47, 2);
    expect(Math.floor(BAY_ROW1_Z / CELL)).toBe(9);
    expect((BAY_Z - BAY_D / 2) - (BAY_ROW1_Z + chairR(16, 22))).toBeGreaterThan(0);
    // the visitor chairs and bay row 2 needed NO correction — squaring the lead desk's depth bought that
    for (const c of VISITOR_CHAIRS) expect(c.z).toBeCloseTo(118.49, 2);
    expect(BAY_ROW2_Z).toBeCloseTo(232.78, 2);
    expect((LEAD_DESK_Z0 + LEAD_DESK_D) - (VISITOR_CHAIRS[0].z - chairR(18, 20))).toBeLessThan(0);
    expect((BAY_ROW2_Z - chairR(18, 20)) - (BAY_Z + BAY_D / 2)).toBeGreaterThan(0);
    // and every chair x is the manifest box centre, verbatim
    for (const [ids, chairs] of [
      [["dev-lead1-chair", "dev-lead2-chair"], LEAD_CHAIRS],
      [["dev-lead1-visitor1", "dev-lead1-visitor2", "dev-lead2-visitor1", "dev-lead2-visitor2"], VISITOR_CHAIRS],
    ] as const) ids.forEach((id, i) => expect(chairs[i].x).toBeCloseTo(boxCentre(id).x, 2));
    BAY_ROW1_CHAIRS.forEach((c, i) => expect(c.x).toBeCloseTo(boxCentre(i < 4 ? `dev-bay1-chair${i + 1}` : `dev-bay2-chair${i - 3}`).x, 2));
    BAY_ROW2_CHAIRS.forEach((c, i) => expect(c.x).toBeCloseTo(boxCentre(i < 4 ? `dev-bay1-chair${i + 5}` : `dev-bay2-chair${i + 1}`).x, 2));
  });

  it("5. the ONE furniture correction is the side table, and it is what makes the south lane a lane", () => {
    const box = v1("dev-side-desk");
    expect(SIDE_DESK.x).toBeCloseTo(box.x, 2); //   x untouched
    expect(SIDE_DESK.w).toBeCloseTo(box.width, 2);
    expect(SIDE_DESK.d).toBeLessThan(box.height); // squared: the 4.18 is the PNG shadow
    expect(SIDE_DESK.z + SIDE_DESK.d).toBe(SOUTH_Z); // slid south, hard against the new wall
    // at V1's own z the lane behind the bay's row-2 chairs was under a body wide; now it is not
    const chairSouth = BAY_ROW2_Z + chairR(18, 20);
    expect(box.y - chairSouth).toBeLessThan(2 * NAV_RADIUS);
    expect(SIDE_DESK.z - chairSouth).toBeGreaterThanOrEqual(2 * NAV_RADIUS);
  });

  it("6. every seat's approach and preSeat is body-clear, and every one is reachable from the doorway", () => {
    const { world, walkability, inBounds, stand } = rig();
    const obs = devObstacles(world).filter((o) => !o.id.includes("chair")); // a chair rolls: its own cell is not an obstacle
    for (const id of DEV_SEAT_IDS) {
      const s = world.get(id).capabilities.seat!;
      expect(stand(s.approach), `${id}: no body fits at its approach`).toBe(true);
      const hit = clearOf(s.approach, obs, NAV_RADIUS);
      expect(hit, `${id} approach ${JSON.stringify(s.approach)} brushes ${hit?.id} by ${hit?.gap}`).toBeNull();
      for (const [a, b] of [[DOOR_STANDS.inside, s.approach], [s.approach, DOOR_STANDS.inside]] as const)
        expect(planWalk(a, b, walkability, inBounds).ok, `${id}: no route ${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
    }
    // the sofa is FIXED lounge seating: one stand point at the head of its lane, reachable the same way
    expect(DEV_LOUNGE_IDS).toEqual([SOFA_ID]);
    const slots = world.get(SOFA_ID).capabilities.lounge!.slots;
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(stand(s.approach), `sofa ${s.id}: no body fits at its approach`).toBe(true);
      expect(planWalk(DOOR_STANDS.inside, s.approach, walkability, inBounds).ok, `sofa ${s.id} unreachable`).toBe(true);
    }
  });

  it("7. the three aisles and three cross-lanes are real lanes, and the room is a loop", () => {
    const { stand } = rig();
    // the north-south aisles, each over the span it actually serves
    for (const z of [NORTH_LANE_Z, MIDDLE_LANE_Z, 193, 232]) {
      expect(stand({ x: AISLES[1], z }), `centre aisle closed at z ${z}`).toBe(true);
      expect(stand({ x: AISLES[2], z }), `east aisle closed at z ${z}`).toBe(true);
    }
    // the west aisle runs from the north lane down to the lounge's stand point; north of z 54 it is the
    // bookcase's own apron, and south of 232 it is the sofa
    for (let z = 54; z <= 232; z += 6) expect(stand({ x: AISLES[0], z }), `west aisle closed at z ${z}`).toBe(true);
    // the three cross-lanes
    for (let x = 1146; x <= 1397; x += 8) expect(stand({ x, z: MIDDLE_LANE_Z }), `middle lane closed at x ${x}`).toBe(true);
    for (let x = 1170; x <= 1397; x += 8) expect(stand({ x, z: SOUTH_LANE_Z }), `south lane closed at x ${x}`).toBe(true);
    for (const x of [1146, 1184, 1272, 1312, 1397]) expect(stand({ x, z: NORTH_LANE_Z }), `north lane closed at x ${x}`).toBe(true);
    // the room's headline clearances, stated as numbers so a later change cannot quietly close one
    expect(LEAD_CHAIRS[0].z - chairR(16, 22) - RUN_FRONT).toBeGreaterThanOrEqual(2 * NAV_RADIUS); //     north lane
    expect((BAY_ROW1_Z - chairR(16, 22)) - (VISITOR_CHAIRS[0].z + chairR(18, 20))).toBeGreaterThanOrEqual(2 * NAV_RADIUS); // middle lane
    expect(SIDE_DESK.z - (BAY_ROW2_Z + chairR(18, 20))).toBeGreaterThanOrEqual(2 * NAV_RADIUS); //       south lane
    expect((BAY_DESKS[1].x - BAY_W / 2) - (BAY_DESKS[0].x + BAY_W / 2)).toBeGreaterThanOrEqual(2 * NAV_RADIUS); // centre aisle
    expect((BAY_DESKS[0].x - BAY_W / 2) - (WEST_X + TOOL_WALL.w)).toBeGreaterThanOrEqual(2 * NAV_RADIUS); // west aisle
    expect(TEA_SHELF.x - (BAY_DESKS[1].x + BAY_W / 2)).toBeGreaterThanOrEqual(2 * NAV_RADIUS); //          east aisle
  });

  it("8. every walk-up point is a body-clear spot facing something that is actually there", () => {
    const { world, stand } = rig();
    const obs = devObstacles(world);
    expect(DEV_APPROACH_IDS).toHaveLength(7);
    for (const id of DEV_APPROACH_IDS) {
      const a = world.get(id).capabilities.approach!;
      expect(stand(a.point), `${a.label}: no body fits at ${JSON.stringify(a.point)}`).toBe(true);
      const hit = clearOf(a.point, obs, NAV_RADIUS);
      expect(hit, `${a.label} brushes ${hit?.id} by ${hit?.gap}`).toBeNull();
      expect(pointInRect(a.point, FLOOR_RECT), `${a.label} is outside the room`).toBe(true);
      // the pick target it names is a group build/dev.ts actually creates
      expect(devBuildSource, `no pick target "${world.get(id).props.pick}"`).toMatch(new RegExp(`\\w+\\.name = "${world.get(id).props.pick}"`));
    }
  });

  it("9. the entrance is the V1 '+' band, its leaf parks clear of it, and it routes both ways", () => {
    const { world, walkability, inBounds, stand } = rig();
    expect(ENTRY_DOOR.clearance.band).toEqual({ x: DOOR.x0, z: 19 * CELL, w: DOOR.x1 - DOOR.x0, d: 2 * CELL });
    for (const cx of [78, 79, 80]) for (const cy of [19, 20]) {
      expect(v1Static(cx, cy), `V1 '+' cell ${cx},${cy}`).toBe(true);
      const c = { x: cx * CELL + CELL / 2, z: cy * CELL + CELL / 2 };
      expect(pointInRect(c, ENTRY_DOOR.clearance.band), `cell centre ${cx},${cy} outside the band`).toBe(true);
    }
    // the widest opening in the building, and well past the Gaming Room's 32-unit house standard
    expect(DOOR.x1 - DOOR.x0).toBe(48);
    for (const p of [DOOR_STANDS.inside, DOOR_STANDS.outside]) expect(stand(p), `${JSON.stringify(p)}`).toBe(true);
    // a SINGLE leaf that fills the opening and slides entirely out of it
    const e = world.get(DOOR_LEAF_ID);
    expect(ENTRY_DOOR.slideDistance).toBe(DOOR.x1 - DOOR.x0);
    expect(ENTRY_DOOR.leafOpposed).toBeUndefined();
    const door = new SlidingDoor({ position: { x: e.transform.pos.x, y: 0, z: e.transform.pos.z }, quaternion: {} } as never, ENTRY_DOOR, e.transform.pos);
    expect(door.openPosition.x + ENTRY_DOOR.slideDistance / 2).toBeLessThanOrEqual(DOOR.x0);
    for (const [a, b] of [[DOOR_STANDS.outside, DOOR_STANDS.inside], [DOOR_STANDS.inside, DOOR_STANDS.outside]] as const)
      expect(planWalk(a, b, walkability, inBounds).ok, `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
    // and from the wider building: the hall in front of the reception entrance
    const far: Vec2 = { x: 712, z: 824 };
    for (const [a, b] of [[far, DOOR_STANDS.inside], [DOOR_STANDS.inside, far]] as const)
      expect(planWalk(a, b, walkability, inBounds).ok, `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
  });

  it("10. the Dev ↔ CMS corridor is REAL, and the Phase 8 placeholder clamp has retired into it", () => {
    const { stand } = rig();
    // the clamp existed only while the room was a placeholder; the real wall inherits its line
    expect(PLACEHOLDER_SOUTH_CLAMP).toEqual({});
    // the corridor, re-derived from the two rooms' own geometry
    const corridor = CMS_NORTH_OUTER - SOUTH_OUTER_Z;
    expect(corridor).toBeGreaterThanOrEqual(2 * NAV_RADIUS);
    // the band now opens ROW 20 only — row 19 is this room's wall, and declaring it would be a
    // player-only opening straight through masonry
    const band = CORRIDOR_BANDS.find((b) => b.id === "dev-cms-corridor")!;
    expect(band.rect).toEqual({ x: 69 * CELL, z: 20 * CELL, w: 21 * CELL, d: 1 * CELL });
    const centre = 20 * CELL + CELL / 2;
    expect(centre - SOUTH_OUTER_Z, "row 20 is too close to the Dev room").toBeGreaterThanOrEqual(NAV_RADIUS);
    expect(CMS_NORTH_OUTER - centre, "row 20 is too close to the CMS room").toBeGreaterThanOrEqual(NAV_RADIUS);
    const row19 = 19 * CELL + CELL / 2;
    expect(row19).toBeGreaterThan(SOUTH_Z);
    expect(row19).toBeLessThan(SOUTH_OUTER_Z); // inside the wall: correctly NOT declared
    // and a body really can walk the corridor, east and west of the doorway
    for (const x of [1160, 1224, 1320, 1400]) expect(stand({ x, z: centre }), `corridor closed at x ${x}`).toBe(true);
  });

  it("11. nothing in the room stands outside it, and the fixed fit-out is where the art puts it", () => {
    const { world } = rig();
    for (const e of world.inRoom(DEV_ROOM_ID)) {
      if (e.kind === "glass-door-leaf") continue; // the leaf lives IN the wall
      expect(pointInRect(e.transform.pos, FLOOR_RECT), `${e.id} at ${JSON.stringify(e.transform.pos)}`).toBe(true);
    }
    expect(DEV_SOLIDS.map((s) => s.id)).toEqual(["bookcase", "media", "servers", "tool-wall", "tea-shelf", "pantry"]);
    // the north run stands ON the north wall's inner face; the two wall units on their own walls
    for (const id of ["bookcase", "media", "servers"]) expect(DEV_SOLIDS.find((s) => s.id === id)!.z).toBe(NORTH_Z);
    expect(TOOL_WALL.x).toBe(WEST_X);
    expect(TEA_SHELF.x + TEA_SHELF.w).toBe(EAST_X);
    expect(PANTRY.z + PANTRY.d).toBe(SOUTH_Z);
    // the depths are the documented circulation corrections, not the art boxes
    expect(TOOL_WALL.w).toBe(14);
    expect(TEA_SHELF.w).toBe(14);
    expect(PANTRY.d).toBe(24);
  });

  it("12. the room's own palette exists and nothing reuses another room's colours", () => {
    for (const k of ["devWalnut", "devWalnutDark", "devInk", "devInkDeep", "devNeon", "devNeonDeep", "devLeather",
      "devLeatherSeat", "devSofa", "devSofaSeat", "devFrame", "devPlaster", "devFloorTint", "devScreenUi",
      "devMat", "devMatBorder", "devTerminal"] as const)
      expect(PALETTE[k], k).toBeTypeOf("number");
    // the Dev room's builders name NO other room's palette key directly — and NOT the AI Room's, which is
    // the one this room could plausibly have been recoloured out of
    for (const bad of ["aiLed", "aiCarbon", "aiCharcoal", "cmsBlue", "cmsOak", "execWalnut", "gamingViolet", "hubSage"])
      expect(devBuildSource, `build/dev.ts names ${bad}`).not.toContain(bad);
  });

  it("13. the room, its entities, its navigation, its door AND every one of its 22 chairs are wired in", () => {
    const src = bootstrapSource;
    expect(src).toContain("world.addRoom(DEV_ROOM);");
    expect(src).toContain("for (const e of devRoomEntities()) world.addEntity(e);");
    expect(src).toContain("mirror.buildRoom(DEV_ROOM, shellOpts());");
    expect(src).toMatch(/DERIVED_ROOM_IDS = new Set\(\[[^\]]*DEV_ROOM\.id/);
    expect(src).toContain("devDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route, peerBodies);");
    // THE EXECUTIVE-CHAIR BUG GUARD. A movable SeatInteraction that is never ticked animates nothing and
    // locks the avatar. One controller serves all 22 chairs, and it MUST be in the per-frame update.
    expect(src).toContain("devSeat?.update(dt / 1000);");
    expect(src).toContain("const id = DEV_SEAT_IDS[index];");
    // Player mode must be able to activate them, or they are GUI-only
    expect(src).toContain("const dev = DEV_SEAT_IDS.indexOf(id);");
    // …and leaving one must release the avatar, so no interaction can lock
    expect(src).toContain("if (devSeat && devSeat.state !== \"idle\") devSeat.reset();");
    expect(src).toMatch(/engagedSeat[\s\S]{0,200}devSeat/);
    expect(src).toMatch(/\(devSeat\?\.status \?\? "idle"\) !== "idle"/);
    // the sofa joins the ONE shared lounge list, not a new system
    expect(src).toMatch(/loungeSeats = \[[^\]]*DEV_LOUNGE_IDS/);
  });
});

// ================================================================================================
// PLAYER QA. Everything above measures the room as DATA; this drives it the way Bon does — the real
// SeatInteraction, the real LoungeSeatInteraction, the real ApproachInteraction, the real SlidingDoor and
// the real PlayerBody against the real collision test. Static review has missed a timing bug in this
// codebase twice, so the sit/stand cycles below are run frame by frame, not asserted from the spec.
// ================================================================================================
describe("vo3d Dev Room — player QA", () => {
  it("every one of the 22 movable chairs completes Sit → Seated → Stand, and returns to rest with zero drift", () => {
    const { world, walkability, inBounds } = rig();
    for (const id of DEV_SEAT_IDS) {
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

  it("every chair rests AT the desk it serves and still has roll-back room behind it", () => {
    const { world } = rig();
    const back = (z: number) => z; // readability
    const cases: { id: string; deskEdge: number; dir: -1 | 1; r: number; behind: number }[] = [
      ...LEAD_CHAIRS.map((c) => ({ id: c.id, deskEdge: LEAD_DESK_Z0, dir: -1 as const, r: chairR(16, 22), behind: RUN_FRONT })),
      ...VISITOR_CHAIRS.map((c) => ({ id: c.id, deskEdge: LEAD_DESK_Z0 + LEAD_DESK_D, dir: 1 as const, r: chairR(18, 20), behind: BAY_ROW1_Z })),
      ...BAY_ROW1_CHAIRS.map((c) => ({ id: c.id, deskEdge: BAY_Z - BAY_D / 2, dir: -1 as const, r: chairR(16, 22), behind: VISITOR_CHAIRS[0].z })),
      ...BAY_ROW2_CHAIRS.map((c) => ({ id: c.id, deskEdge: BAY_Z + BAY_D / 2, dir: 1 as const, r: chairR(18, 20), behind: SIDE_DESK.z })),
    ];
    for (const c of cases) {
      const e = world.get(`${DEV_ROOM_ID}/${c.id}`);
      const s = e.capabilities.seat!;
      const z = e.transform.pos.z;
      // the resting chair TOUCHES its desk without entering it
      const gap = c.dir === -1 ? c.deskEdge - (z + c.r) : (z - c.r) - c.deskEdge;
      expect(gap, `${c.id} is inside its own desk`).toBeGreaterThanOrEqual(0);
      expect(gap, `${c.id} rests ${gap} from its desk`).toBeLessThanOrEqual(5);
      // the OCCUPIED chair is what the player actually sees: rest + seatedTuck along the pull direction
      const seated = z + s.pullDir.z * s.seatedTuck;
      const seatedGap = c.dir === -1 ? c.deskEdge - (seated + c.r) : (seated - c.r) - c.deskEdge;
      expect(seatedGap, `${c.id} parks ${seatedGap} from its desk while occupied`).toBeLessThanOrEqual(9);
      // …and there is still real roll-back room behind it
      const pulled = back(z + s.pullDir.z * (s.pullDistance + c.r));
      expect(c.dir === -1 ? pulled > c.behind : pulled < c.behind, `${c.id} cannot roll back without hitting what is behind it`).toBe(true);
    }
  });

  it("the sofa's three cushions seat and release the avatar, on the ONE shared lounge controller", () => {
    const { world, walkability, inBounds } = rig();
    const e = world.get(SOFA_ID);
    for (const slot of e.capabilities.lounge!.slots) {
      const scene = new THREE.Object3D();
      const sofa = new THREE.Object3D();
      sofa.position.set(e.transform.pos.x, 0, e.transform.pos.z);
      scene.add(sofa);
      const av = new Avatar({ height: 36, lit: true });
      scene.add(av.root);
      av.setPosition({ ...slot.approach });
      const stack = new ControllerStack();
      const nav = new NavigationController(av, stack);
      const lounge = new LoungeSeatInteraction(av, stack, sofa, slot, (to) => planWalk(slot.approach, to, walkability, inBounds));
      expect(lounge.sit()?.ok, `${slot.id}: the walk to its stand point was rejected`).toBe(true);
      const step = () => { lounge.update(1 / 60); nav.update(1 / 60); scene.updateMatrixWorld(true); };
      for (let t = 0; t < 30 && lounge.state !== "seated"; t += 1 / 60) step();
      expect(lounge.state, `${slot.id} never reached "seated" (stuck in "${lounge.state}")`).toBe("seated");
      // the sitter lands ON the cushion plane the builder actually draws, not inside the sofa's back.
      // (The slot's `sink` is applied by seatContact only once the real avatar CLIPS are loaded, which a
      // headless rig has none of — so the plane, not the compression, is what this can honestly assert.)
      expect(av.root.position.y).toBeCloseTo(slot.contactLocal.y, 3);
      lounge.stand();
      for (let t = 0; t < 30 && lounge.state !== "idle"; t += 1 / 60) step();
      expect(lounge.state, `${slot.id} never returned to idle`).toBe("idle");
      expect(stack.owner, `${slot.id} never released the avatar`).not.toBe("Interaction");
    }
  });

  it("every walk-up point can actually be walked to and completes, then releases the avatar", () => {
    const { world, walkability, inBounds } = rig();
    for (const id of DEV_APPROACH_IDS) {
      const spec = world.get(id).capabilities.approach!;
      const av = new Avatar({ height: 36, lit: true });
      av.setPosition({ ...DOOR_STANDS.inside });
      const stack = new ControllerStack();
      const nav = new NavigationController(av, stack);
      const ctl = new ApproachInteraction(av, stack, (to) => planWalk(av.position, to, walkability, inBounds));
      const r = ctl.begin(spec);
      expect(r.ok, `${spec.label}: no route from the doorway`).toBe(true);
      if (r.ok) nav.setPath(r.path);
      // drive it exactly as bootstrap's frame loop does: navigation walks the route, and the moment it
      // reports arrival the interaction takes the avatar over to turn
      for (let f = 0; f < 3000 && nav.moving; f++) nav.update(1 / 60);
      expect(nav.moving, `${spec.label}: the walk never finished`).toBe(false);
      ctl.onArrived();
      for (let f = 0; f < 600 && ctl.state !== "arrived"; f++) { ctl.update(1 / 60); nav.update(1 / 60); }
      expect(ctl.state, `${spec.label} never finished (stuck in "${ctl.state}")`).toBe("arrived");
      expect(stack.owner, `${spec.label} never released the avatar`).not.toBe("Interaction");
      expect(Math.hypot(av.position.x - spec.point.x, av.position.z - spec.point.z), `${spec.label}: the body did not arrive`).toBeLessThanOrEqual(CELL / 2); // planWalk lands on the cell's own stand point, which is inside the cell rather than on the exact spot
      expect(av.yaw, `${spec.label}: the body is not facing its target`).toBeCloseTo(spec.yaw, 3);
    }
  });

  it("a PLAYER body walks in through the south door, round the room and back out — walking AND sprinting", () => {
    const { world, stand: canStand } = rig();
    /** Walk a body from `from` toward `to` in `step`-unit frames, asserting every frame is legal. */
    function drive(from: Vec2, to: Vec2, step: number): { arrived: boolean; stuckAt: Vec2 } {
      const b = new PlayerBody(from, NAV_RADIUS, canStand);
      for (let f = 0; f < 4000; f++) {
        const dx = to.x - b.pos.x, dz = to.z - b.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 4) return { arrived: true, stuckAt: b.pos };
        const before = { ...b.pos };
        b.move((dx / d) * step, (dz / d) * step);
        expect(canStand(b.pos), `frame ${f} at ${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)} is not legal floor`).toBe(true);
        if (Math.hypot(b.pos.x - before.x, b.pos.z - before.z) < 1e-6) return { arrived: false, stuckAt: b.pos };
      }
      return { arrived: false, stuckAt: b.pos };
    }
    // no unowned strip across the declared doorway — the Gaming Room's own bug, guarded here
    for (let x = DOOR.x0 + 2; x <= DOOR.x1 - 2; x += 1)
      for (let z = SOUTH_Z - 4; z <= SOUTH_OUTER_Z + 4; z += 1)
        expect(world.regionAt({ x, z }), `${x},${z} owned by no region`).not.toBeNull();
    const WALK = 30 / 60, SPRINT = (30 * 1.8) / 60;
    for (const step of [WALK, SPRINT]) {
      // in through the door, then a full circuit: south lane → east aisle → middle lane → west aisle →
      // north lane → centre aisle → back out
      const legs: Vec2[] = [
        DOOR_STANDS.outside, DOOR_STANDS.inside, { x: AISLES[1], z: SOUTH_LANE_Z }, { x: AISLES[2], z: SOUTH_LANE_Z },
        { x: AISLES[2], z: MIDDLE_LANE_Z }, { x: AISLES[0], z: MIDDLE_LANE_Z }, { x: AISLES[0], z: NORTH_LANE_Z },
        { x: AISLES[1], z: NORTH_LANE_Z }, { x: AISLES[1], z: SOUTH_LANE_Z }, DOOR_STANDS.inside, DOOR_STANDS.outside,
      ];
      for (let i = 0; i < legs.length - 1; i++) {
        const r = drive(legs[i], legs[i + 1], step);
        expect(r.arrived, `leg ${i} (${step === WALK ? "walk" : "sprint"}) stuck at ${r.stuckAt.x.toFixed(1)},${r.stuckAt.z.toFixed(1)}`).toBe(true);
      }
    }
    // the south wall is the ONE gap: a body may not walk through the glazed screen either side of it
    for (const x of [DOOR.x0 - 40, DOOR.x1 + 40]) {
      const b = new PlayerBody({ x, z: SOUTH_LANE_Z }, NAV_RADIUS, canStand);
      for (let f = 0; f < 400; f++) b.move(0, 0.5);
      expect(b.pos.z, `the screen at x=${x} was passable`).toBeLessThan(SOUTH_Z);
    }
  });

  it("the south door opens for an arriving body, holds the crossing and closes without drift", () => {
    const { world } = rig();
    const e = world.get(DOOR_LEAF_ID);
    const view = { position: { x: e.transform.pos.x, y: 0, z: e.transform.pos.z } } as unknown as THREE.Object3D;
    const door = new SlidingDoor(view, ENTRY_DOOR, e.transform.pos);
    const route = [DOOR_STANDS.outside, DOOR_STANDS.inside];
    for (let i = 0; i < 200; i++) door.update(1 / 60, DOOR_STANDS.outside, route);
    expect(door.t).toBeCloseTo(1, 3);
    expect(view.position.x).toBeCloseTo(e.transform.pos.x - ENTRY_DOOR.slideDistance, 3); // parks clear, to the west
    // standing IN the crossing must hold it open, however long the player loiters
    for (let i = 0; i < 600; i++) door.update(1 / 60, { x: 1272, z: 310 }, []);
    expect(door.state, "the door closed on a body standing in it").not.toBe("closed");
    // and walking away closes it back onto its exact rest position
    for (let i = 0; i < 600; i++) door.update(1 / 60, { x: 1272, z: 120 }, []);
    expect(door.state).toBe("closed");
    expect(door.driftError()).toBeLessThan(1e-6);
  });

  it("stands at eye level in a room built to human proportions, and its corridor stays clear", () => {
    const { world, stand: canStand } = rig();
    // EYE-LEVEL SCALE. Bon is BON_STANDING_HEIGHT tall; nothing he walks between may be shorter than his
    // waist or taller than the wall, and the desk tops must land at his hip the way a real desk does.
    expect(BAY_H).toBe(DEV_DESK_TOP);
    expect(LEAD_DESK_H).toBe(DEV_DESK_TOP);
    expect(DEV_DESK_TOP / BON_STANDING_HEIGHT).toBeGreaterThan(0.5); // hip height, not knee
    expect(DEV_DESK_TOP / BON_STANDING_HEIGHT).toBeLessThan(0.75); //  …and not chest
    // every FIXED unit stands clear under the wall head, so nothing pokes through the ceiling plane
    for (const s of [BOOKCASE, TOOL_WALL, TEA_SHELF, PANTRY]) expect(s.h).toBeLessThan(STRUCT.wallHeight);
    // FIRST vs THIRD PERSON is one camera over one body: both read the same stand test, so the only
    // room-level question is whether the body fits where the camera will be put — at the room's centre,
    // at each aisle head, and at the doorway.
    for (const p of [{ x: 1271, z: 136 }, { x: AISLES[0], z: NORTH_LANE_Z }, { x: AISLES[2], z: NORTH_LANE_Z },
      { x: AISLES[1], z: SOUTH_LANE_Z }, DOOR_STANDS.inside, DOOR_STANDS.outside])
      expect(canStand(p), `no body fits at ${JSON.stringify(p)}`).toBe(true);
    // SURROUNDING CIRCULATION: the corridor south of the room runs its whole length, and still reaches
    // the CMS room's own entrance stand on the far side of it
    const corridorZ = 20 * CELL + CELL / 2;
    for (let x = 1128; x <= 1416; x += 8) expect(canStand({ x, z: corridorZ }), `corridor closed at x ${x}`).toBe(true);
    expect(world.regionAt({ x: 1272, z: corridorZ })?.walkable).toBe(true);
  });
});
