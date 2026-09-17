import { describe, expect, it } from "vitest";
import aiBuildSource from "./build/ai.ts?raw";
// Vite `?raw` import — loads bootstrap.ts's own source text as a string, the same trick executive.test.ts
// and cms.test.ts use to guard app wiring.
import bootstrapSource from "./app/world.ts?raw";
import manifest from "../../data/office-assets-manifest.json";
import { SEAT_DIRECTIONS } from "../../data/seatDirections";
import { WorldState, isSolid } from "./world/WorldState";
import { CORRIDOR_BANDS, registerGroundFloor } from "./rooms/ground-floor";
import { makeStandTest } from "./player/standTest";
import { DESIGN_ROOM, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "./rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import {
  AISLES, AI_APPROACH_IDS, AI_ROOM, AI_ROOM_ID, AI_SEAT_IDS, AI_SOLIDS, AI_WALLS, BENCH_D, BENCH_W,
  BENCH_XS, BENCH_Z, COUNTER, DOOR, DOOR_LEAF_ID, DOOR_STANDS, EAST_X, ENTRY_DOOR, FLOOR_RECT,
  LEAD_CHAIR, LEAD_DESK, MEMBER_COLS, MEMBER_ROWS_Z, NORTH_Z, RACKS, RUN_FRONT, SOUTH_Z,
  VISITOR_CHAIRS, WEST_X, aiRoomEntities,
} from "./rooms/ai";
import { DEV_ROOM, devRoomEntities } from "./rooms/dev";
import { QA_ROOM, qaRoomEntities } from "./rooms/qa";
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
    ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
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
/** the AI solids a standing body actually has to clear, as world rects + circles */
type Obstacle = { id: string; rect?: Rect; c?: Vec2; r?: number };
function aiObstacles(world: WorldState): Obstacle[] {
  const out: Obstacle[] = [];
  for (const e of world.inRoom(AI_ROOM_ID)) {
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
/** V1's own walk directions, as world yaws */
const YAW_FOR: Record<string, number> = { front: FACING_YAW.south, back: FACING_YAW.north, right: FACING_YAW.east, left: FACING_YAW.west };

describe("vo3d AI Room — Phase 9: the V1 room reconstructed in true 3D", () => {
  it("1. the room sits on its V1 manifest rect, and every wall is a real 12-unit wall on that box", () => {
    const l = v1("ai-room");
    expect(AI_ROOM.rect).toEqual({ x: l.x, z: l.y, w: l.width, d: l.height });
    // the outer wall faces land on the art box, within the rounding the box itself carries
    expect(Math.abs(8 - l.x)).toBeLessThan(0.2);
    expect(Math.abs(8 - l.y)).toBeLessThan(0.2);
    expect(Math.abs(344 - (l.x + l.width))).toBeLessThan(0.2);
    expect(Math.abs(300 - (l.y + l.height))).toBeLessThan(0.2);
    expect(FLOOR_RECT).toEqual({ x: 20, z: 20, w: 312, d: 268 });
    // THE BAKED-PERSPECTIVE CORRECTION: V1 blocks rows 0–2 (z 0…48) right across the north and cols 0–1
    // (x 0…32) down the west. Neither is wall. The wall is 12 and the rack run in front of it is 24.
    expect(NORTH_Z - 8).toBe(12);
    expect(WEST_X - 8).toBe(12);
    expect(RUN_FRONT).toBe(44);
    expect(RACKS.d).toBe(24);
    for (let cy = 0; cy <= 2; cy++) expect(v1Static(6, cy), `V1 paints ${cy} as blocked`).toBe(false);
    // the four wall runs seal the room except at the door band
    expect(AI_WALLS).toHaveLength(4);
    for (const w of AI_WALLS) expect(Math.min(w.w, w.d)).toBe(12);
    const southRun = AI_WALLS.find((w) => w.z === SOUTH_Z)!;
    expect(southRun.x + southRun.w).toBe(DOOR.x0); // the opening is the ONE gap
  });

  it("2. every V1 ai-team furniture box is rebuilt, at the manifest's own position", () => {
    const ents = aiRoomEntities();
    const at = (kind: string) => ents.filter((e) => e.kind === kind);
    // three bench desks, at the manifest's own box centres
    expect(at("ai-bench-desk")).toHaveLength(3);
    ["ai-member-desk-1", "ai-member-desk-2", "ai-member-desk-3"].forEach((id, i) => {
      const box = v1(id);
      expect(BENCH_XS[i]).toBeCloseTo(box.x + box.width / 2, 2);
      expect(BENCH_Z).toBeCloseTo(box.y + box.height / 2, 2);
    });
    expect(BENCH_W).toBe(30); //  the flat box is 30.204: kept, NOT widened — see rooms/ai.ts
    expect(BENCH_D).toBe(116); // the flat box is 115.623
    // the lead desk, verbatim
    const ld = v1("ai-lead-desk");
    expect(LEAD_DESK.x).toBeCloseTo(ld.x + ld.width / 2, 1);
    expect(LEAD_DESK.w).toBeCloseTo(ld.width, 0);
    expect(at("ai-lead-desk")).toHaveLength(1);
    // twenty-one chairs, in three distinct room-specific kinds
    expect(at("ai-task-chair")).toHaveLength(18);
    expect(at("ai-lead-chair")).toHaveLength(1);
    expect(at("ai-visitor-chair")).toHaveLength(2);
    // and NOT another room's furniture: no exec, cms or shared-catalogue kind appears in here
    for (const e of ents) expect(e.kind.startsWith("cms-") || e.kind.startsWith("exec-"), e.kind).toBe(false);
  });

  it("3. all 21 V1 seat cells are real chairs, facing the way V1's seatDirections says", () => {
    const { world } = rig();
    const v1Seats = Object.entries(SEAT_DIRECTIONS[AI_ROOM_ID]!.seats!);
    expect(v1Seats).toHaveLength(21);
    expect(AI_SEAT_IDS).toHaveLength(21);
    const chairs = AI_SEAT_IDS.map((id) => world.get(id));
    for (const [cellKey, dir] of v1Seats) {
      const [cx, cz] = cellKey.split(",").map(Number);
      // the nearest chair to the V1 cell IS that cell's chair
      const near = chairs.map((c) => ({ c, d: dist(c.transform.pos, { x: cx, z: cz }) })).sort((a, b) => a.d - b.d)[0];
      // ONE documented correction in this room: the two visitor chairs move 3.14 north→south out of the
      // lead desk they overlapped. Every other chair is on its V1 cell centre exactly.
      // the visitor chairs carry the room's ONE documented correction (3.14); everything else is on its
      // V1 centre, to the 0.15 the manifest's own two-decimal boxes are rounded to
      const tol = near.c.id.includes("visitor") ? 3.2 : 0.15;
      expect(near.d, `${cellKey} → ${near.c.id}`).toBeLessThanOrEqual(tol);
      expect(near.c.capabilities.seat!.seatedYaw, `${near.c.id} faces V1 "${dir}"`).toBeCloseTo(YAW_FOR[dir], 5);
    }
    // every chair is claimed exactly once
    expect(new Set(v1Seats.map(([k]) => k)).size).toBe(21);
  });

  it("4. the chair corrections are MINIMAL and stay inside V1's own cells", () => {
    // the visitor chairs: the only piece that moved. 3.14 units, still in grid row 7 (z 112…128).
    for (const c of VISITOR_CHAIRS) {
      expect(c.z - 118.86).toBeCloseTo(3.14, 2);
      expect(Math.floor(c.z / CELL)).toBe(7);
    }
    // …and they now clear the lead desk they overlapped, and leave the bench row behind them a body lane
    const chairR = 7.456; // chairPlanRadius(18, 16)
    const deskSouth = LEAD_DESK.z + LEAD_DESK.d / 2;
    expect(VISITOR_CHAIRS[0].z - chairR).toBeGreaterThan(deskSouth);
    expect((BENCH_Z - BENCH_D / 2) - (VISITOR_CHAIRS[0].z + chairR)).toBeGreaterThanOrEqual(2 * NAV_RADIUS);
    // every member chair is on its V1 manifest centre, to the unit
    MEMBER_COLS.forEach((col, i) => {
      const box = v1(`ai-member-chair-${i * 3 + 1}`);
      expect(col.x).toBeCloseTo(box.x + box.width / 2, 2);
    });
    MEMBER_ROWS_Z.forEach((z, i) => {
      const box = v1(`ai-member-chair-${i + 1}`);
      expect(z).toBeCloseTo(box.y + box.height / 2, 2);
    });
    // the lead chair is unmoved and already clear of its desk
    expect(LEAD_CHAIR.z).toBe(70);
    expect(LEAD_DESK.z - LEAD_DESK.d / 2 - (LEAD_CHAIR.z + 8.26)).toBeGreaterThan(0);
  });

  it("5. every seat's approach and preSeat is body-clear, and every one is reachable from the doorway", () => {
    const { world, walkability, inBounds, stand } = rig();
    const obs = aiObstacles(world).filter((o) => !o.id.includes("chair")); // a chair rolls: its own cell is not an obstacle
    for (const id of AI_SEAT_IDS) {
      const s = world.get(id).capabilities.seat!;
      expect(stand(s.approach), `${id}: no body fits at its approach`).toBe(true);
      const hit = clearOf(s.approach, obs, NAV_RADIUS);
      expect(hit, `${id} approach ${JSON.stringify(s.approach)} brushes ${hit?.id} by ${hit?.gap}`).toBeNull();
      // the route in: from inside the door to the chair's approach, and back out again
      for (const [a, b] of [[DOOR_STANDS.inside, s.approach], [s.approach, DOOR_STANDS.inside]] as const)
        expect(planWalk(a, b, walkability, inBounds).ok, `${id}: no route ${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
    }
  });

  it("6. the four aisles are real lanes: a body stands in each one at every chair row", () => {
    const { stand } = rig();
    for (const x of AISLES) for (const z of MEMBER_ROWS_Z)
      expect(stand({ x, z }), `aisle ${x} closed at row ${z}`).toBe(true);
    // …and each aisle runs clear from the north lane to the south lane, so the room is a loop not a comb
    for (const x of AISLES) for (let z = 60; z <= 276; z += 8)
      expect(stand({ x, z }), `aisle ${x} closed at z ${z}`).toBe(true);
    // the north and south cross-lanes, which is what joins the four aisles together
    for (let x = 40; x <= 300; x += 10) expect(stand({ x, z: 276 }), `south lane closed at x ${x}`).toBe(true);
    // the room's headline clearances, stated as numbers so a later change cannot quietly close one
    expect((BENCH_Z - BENCH_D / 2) - RUN_FRONT).toBeGreaterThanOrEqual(2 * NAV_RADIUS); // north lane
    expect(SOUTH_Z - (BENCH_Z + BENCH_D / 2)).toBeGreaterThanOrEqual(2 * NAV_RADIUS); //  south lane
    expect(COUNTER.x - (MEMBER_COLS[5].x + 7.456)).toBeGreaterThanOrEqual(2 * NAV_RADIUS); // east lane
  });

  it("7. every walk-up point is a body-clear spot facing something that is actually there", () => {
    const { world, stand } = rig();
    const obs = aiObstacles(world);
    expect(AI_APPROACH_IDS).toHaveLength(6);
    for (const id of AI_APPROACH_IDS) {
      const a = world.get(id).capabilities.approach!;
      expect(stand(a.point), `${a.label}: no body fits at ${JSON.stringify(a.point)}`).toBe(true);
      const hit = clearOf(a.point, obs, NAV_RADIUS);
      expect(hit, `${a.label} brushes ${hit?.id} by ${hit?.gap}`).toBeNull();
      expect(pointInRect(a.point, FLOOR_RECT), `${a.label} is outside the room`).toBe(true);
      // the pick target it names is a group build/ai.ts actually creates
      expect(aiBuildSource, `no pick target "${world.get(id).props.pick}"`).toMatch(new RegExp(`\\w+\\.name = "${world.get(id).props.pick}"`));
    }
  });

  it("8. the entrance is the V1 '+' band, its leaf parks clear of it, and it routes both ways", () => {
    const { world, walkability, inBounds, stand } = rig();
    // the clearance band has the shape Gaming's and CMS's have: the door's own span ALONG the wall × the
    // V1 '+' band's two cell rows ACROSS it, and it still contains both V1 '+' cell CENTRES, which is what
    // A* actually crosses on.
    expect(ENTRY_DOOR.clearance.band).toEqual({ x: DOOR.x0, z: 17 * CELL, w: DOOR.x1 - DOOR.x0, d: 2 * CELL });
    for (const [cx, cy] of [[19, 17], [20, 17], [19, 18], [20, 18]] as const) {
      expect(v1Static(cx, cy), `V1 '+' cell ${cx},${cy}`).toBe(true);
      const c = { x: cx * CELL + CELL / 2, z: cy * CELL + CELL / 2 };
      expect(pointInRect(c, ENTRY_DOOR.clearance.band), `cell centre ${cx},${cy} outside the band`).toBe(true);
    }
    // THE DOORWAY IS AT LEAST AS WIDE AS THE HOUSE STANDARD. The Gaming Room's entrance — the narrowest
    // accepted door in V2 — is 32 units, which leaves a body at NAV_RADIUS 16 units of centre freedom.
    expect(DOOR.x1 - DOOR.x0).toBeGreaterThanOrEqual(32);
    // V1's own stand cells either side
    expect(DOOR_STANDS.inside).toEqual({ x: 19 * CELL + 8, z: 16 * CELL + 8 });
    expect(DOOR_STANDS.outside).toEqual({ x: 20 * CELL + 8, z: 19 * CELL + 8 });
    for (const p of [DOOR_STANDS.inside, DOOR_STANDS.outside]) expect(stand(p), `${JSON.stringify(p)}`).toBe(true);
    // a SINGLE leaf that fills the opening and slides entirely out of it
    const e = world.get(DOOR_LEAF_ID);
    expect(ENTRY_DOOR.slideDistance).toBe(DOOR.x1 - DOOR.x0);
    expect(ENTRY_DOOR.leafOpposed).toBeUndefined();
    const door = new SlidingDoor({ position: { x: e.transform.pos.x, y: 0, z: e.transform.pos.z }, quaternion: {} } as never, ENTRY_DOOR, e.transform.pos);
    expect(door.openPosition.x).toBe(DOOR.x0 - ENTRY_DOOR.slideDistance / 2);
    expect(door.openPosition.x + ENTRY_DOOR.slideDistance / 2).toBeLessThanOrEqual(DOOR.x0);
    // through the doorway, both directions
    for (const [a, b] of [[DOOR_STANDS.outside, DOOR_STANDS.inside], [DOOR_STANDS.inside, DOOR_STANDS.outside]] as const)
      expect(planWalk(a, b, walkability, inBounds).ok, `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
    // and from the wider building: the hall outside the Design Room's own door
    const hall: Vec2 = { x: 328, z: 440 };
    for (const [a, b] of [[hall, DOOR_STANDS.inside], [DOOR_STANDS.inside, hall]] as const)
      expect(planWalk(a, b, walkability, inBounds).ok, `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
  });

  it("9. nothing in the room stands outside it, and the fixed fit-out is where the art puts it", () => {
    const { world } = rig();
    for (const e of world.inRoom(AI_ROOM_ID)) {
      if (e.kind === "glass-door-leaf") continue; // the leaf lives IN the wall
      expect(pointInRect(e.transform.pos, FLOOR_RECT), `${e.id} at ${JSON.stringify(e.transform.pos)}`).toBe(true);
    }
    // the three fixed solids: the robot's dock and the racks against the north wall, the counter on the east
    expect(AI_SOLIDS.map((s) => s.id)).toEqual(["robot-dock", "racks", "counter"]);
    for (const s of AI_SOLIDS.slice(0, 2)) expect(s.z).toBe(NORTH_Z);
    expect(COUNTER.x + COUNTER.w).toBe(EAST_X);
    // the counter's depth is the documented circulation correction, not the art box
    expect(COUNTER.w).toBe(22);
  });

  it("10. the room's own palette exists and nothing reuses another room's colours", () => {
    for (const k of ["aiCharcoal", "aiCarbon", "aiCarbonDeep", "aiLed", "aiSeat", "aiSeatLead", "aiSeatVisitor", "aiFrame", "aiCounter", "aiPlaster", "aiFloorTint", "aiScreenUi", "aiRobot"] as const)
      expect(PALETTE[k], k).toBeTypeOf("number");
    // the AI room's builders name NO other room's palette key directly
    for (const bad of ["cmsBlue", "cmsOak", "execWalnut", "gamingViolet", "hubSage"])
      expect(aiBuildSource, `build/ai.ts names ${bad}`).not.toContain(bad);
  });

  it("11. the room, its entities, its navigation, its door AND every one of its 21 chairs are wired in", () => {
    const src = bootstrapSource;
    expect(src).toContain("world.addRoom(AI_ROOM);");
    expect(src).toContain("for (const e of aiRoomEntities()) world.addEntity(e);");
    expect(src).toContain("mirror.buildRoom(AI_ROOM, shellOpts());");
    expect(src).toMatch(/DERIVED_ROOM_IDS = new Set\(\[[^\]]*AI_ROOM\.id/);
    expect(src).toContain("aiDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route);");
    // THE EXECUTIVE-CHAIR BUG GUARD. A movable SeatInteraction that is never ticked animates nothing and
    // locks the avatar. One controller serves all 21 chairs, and it MUST be in the per-frame update.
    expect(src).toContain("aiSeat?.update(dt / 1000);");
    expect(src).toContain("const id = AI_SEAT_IDS[index];");
    // Player mode must be able to activate them, or they are GUI-only
    expect(src).toContain("const ai = AI_SEAT_IDS.indexOf(id);");
    // …and leaving one must release the avatar, so no interaction can lock
    expect(src).toContain("if (aiSeat && aiSeat.state !== \"idle\") aiSeat.reset();");
    expect(src).toMatch(/engagedSeat[\s\S]{0,200}aiSeat/);
    expect(src).toMatch(/\(aiSeat\?\.status \?\? "idle"\) !== "idle"/);
  });

  it("12. the adjacent placeholder geometry does not eat the AI Room's own access route", () => {
    const { plan, stand, walkability, inBounds } = rig();
    // The AI Room's neighbours are the Design Room (south) and the hall. BOTH are reconstructed — there is
    // no unbuilt placeholder touching this room, so nothing needs clamping the way the Dev room did in 8.
    for (const id of ["design-room", "executive-room"]) expect(plan.rooms.find((r) => r.id === id)!.reconstructed, id).toBe(true);
    // V1 itself paints NO corridor along the AI Room's south wall west of the door: rows 19–22 are '#' for
    // every column up to 19, and the route out is col 20 running south. So the 16-unit gap between this
    // room's south wall and the Design Room's north wall is wall-to-wall by V1's own account, not a lane
    // this reconstruction closed.
    for (let cy = 19; cy <= 22; cy++) for (let cx = 0; cx <= 19; cx++)
      expect(v1Static(cx, cy), `V1 opens ${cx},${cy} south of the AI room`).toBe(false);
    // the lane V1 DOES paint — col 20 and east, running south from the door — still holds a body
    for (const z of [312, 328, 344]) expect(stand({ x: 328, z }), `hall lane closed at z ${z}`).toBe(true);
    // …and it reaches the rest of the building both ways
    const far: Vec2 = { x: 712, z: 824 }; // in front of the reception entrance
    for (const [a, b] of [[DOOR_STANDS.inside, far], [far, DOOR_STANDS.inside]] as const)
      expect(planWalk(a, b, walkability, inBounds).ok, `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
  });
});
