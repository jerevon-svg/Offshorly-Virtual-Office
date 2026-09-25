import { describe, expect, it } from "vitest";
import * as THREE from "three";
import qaBuildSource from "./build/qa.ts?raw";
// Vite `?raw` import — loads bootstrap.ts's own source text as a string, the same trick executive.test.ts,
// cms.test.ts, ai.test.ts and dev.test.ts use to guard app wiring.
import bootstrapSource from "./app/world.ts?raw";
import manifest from "../../data/office-assets-manifest.json";
import { SEAT_DIRECTIONS } from "../../data/seatDirections";
import { WorldState, isSolid } from "./world/WorldState";
import { CORRIDOR_BANDS, registerGroundFloor } from "./rooms/ground-floor";
import { makeStandTest } from "./player/standTest";
import { DESIGN_ROOM, designRoomEntities, SHELL as DESIGN_SHELL, RECT as DESIGN_RECT } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities, STRUCT } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "./rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import { AI_ROOM, aiRoomEntities, SOUTH_OUTER_Z as AI_SOUTH_OUTER } from "./rooms/ai";
import { DEV_ROOM, devRoomEntities } from "./rooms/dev";
import {
  BENCHES, BENCH_CHAIRS, BENCH_D, BENCH_W, BENCH_Z, CENTRE_AISLE, CREDENZA, CREDENZA_FRONT,
  DOOR, DOOR_NORTH_ID, DOOR_SOUTH_ID, DOOR_STANDS, EAST_CREDENZA, EAST_LANE, EAST_X, ENTRY_DOOR,
  FLOOR_RECT, LEAD_CHAIR, LEAD_DESK, LOUNGE_SHELF, MIDDLE_LANE_Z, NORTH_LANE_Z, NORTH_OUTER_Z, NORTH_Z,
  POUF, POUF_ID, QA_APPROACH_IDS, QA_LOUNGE_IDS, QA_ROOM, QA_ROOM_ID, QA_SEAT_IDS, QA_SOLIDS, QA_WALLS,
  RUN_D, SOFA_ID, SOFA_X, SOFA_Z, SOUTH_LANE_Z, SOUTH_OUTER_Z, SOUTH_Z, VISITOR_CHAIRS, WEST_LANE,
  WEST_X, BENCH_H, qaRoomEntities, sofaSlots,
} from "./rooms/qa";
import { QA_DESK_TOP } from "./build/qa-furniture";
import { PALETTE } from "./render/Materials";
import { SlidingDoor } from "./interact/Door";
import { Avatar } from "./avatar/Avatar";
import { ControllerStack, NavigationController } from "./avatar/Controller";
import { SeatInteraction } from "./interact/Seat";
import { LoungeSeatInteraction } from "./interact/LoungeSeat";
import { ApproachInteraction } from "./interact/Approach";
import { PlayerBody } from "./player/PlayerBody";
import { BON_STANDING_HEIGHT } from "./adapters/v1Avatar";
import { DerivedNav } from "./nav/derived";
import { Walkability, composeStatic } from "./nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "./nav/clearance";
import { openedLayer, v2Static } from "./nav/v2Open";
import { CELL, v1Static } from "./adapters/v1Grid";
import { planWalk } from "./nav/planner";
import { FACING_YAW, pointInRect, type Rect, type Vec2 } from "./core/coords";
import { buildWorldContents } from "./app/worldContents";

const ALL_ROOMS = [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM];

/** the same wiring bootstrap.ts uses, minus THREE. ELEVEN rooms: this is the whole floor. */
function rig() {
  const world = new WorldState();
  for (const r of ALL_ROOMS) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(),
    ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(),
    ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  const plan = registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: new Set(ALL_ROOMS.map((r) => r.id)) });
  walkability.attachDerived(derived, world);
  const stand = makeStandTest({ world, walkability, derived, radius: NAV_RADIUS });
  return { world, plan, inBounds, walkability, derived, stand };
}
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
type Obstacle = { id: string; rect?: Rect; c?: Vec2; r?: number };
function qaObstacles(world: WorldState): Obstacle[] {
  const out: Obstacle[] = [];
  for (const e of world.inRoom(QA_ROOM_ID)) {
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
/** chairPlanRadius, inlined so the test measures independently of the footprint helper */
const chairR = (w: number, d: number) => Math.min(w, d) * 0.8 * 0.52 * 0.97 + 1;

describe("vo3d QA Room — Phase 11: the LAST room, reconstructed from a flat reference alone", () => {
  it("1. the room sits on its V1 manifest rect, and every wall is a real 12-unit wall on that box", () => {
    const l = v1("qa-room");
    expect(QA_ROOM.rect).toEqual({ x: l.x, z: l.y, w: l.width, d: l.height });
    // the outer wall faces land on the art box, within the rounding the box itself carries. The north is
    // the floor's one HALF-unit edge (596.5), rounded down so every number derived from it stays whole.
    expect(Math.abs(WEST_X - 12 - l.x)).toBeLessThan(0.2);
    expect(Math.abs(EAST_X + 12 - (l.x + l.width))).toBeLessThan(0.4);
    expect(Math.abs(NORTH_OUTER_Z - l.y)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(SOUTH_OUTER_Z - (l.y + l.height))).toBeLessThan(0.2);
    expect(NORTH_Z).toBe(38 * CELL); // the wall's inner face lands on V1's own painted floor line
    expect(FLOOR_RECT).toEqual({ x: 20, z: 608, w: 296, d: 235 });
    // THE BAKED-PERSPECTIVE CORRECTION: V1 blocks rows 37–39 (z 592…640) right across the north and
    // cols 0–2 (x 0…48) down the west. Neither is wall. The wall is 12 and the run in front of it is 20.
    expect(NORTH_Z - NORTH_OUTER_Z).toBe(12);
    expect(RUN_D).toBe(20);
    expect(CREDENZA_FRONT).toBe(628);
    for (const cy of [37, 38, 39]) expect(v1Static(10, cy), `V1 paints row ${cy} as blocked`).toBe(false);
    for (const cx of [0, 1, 2]) expect(v1Static(cx, 45), `V1 paints col ${cx} as blocked`).toBe(false);
    // the five wall runs seal the room except at the door band
    expect(QA_WALLS).toHaveLength(5);
    for (const w of QA_WALLS) expect(Math.min(w.w, w.d)).toBe(12);
    const east = QA_WALLS.filter((w) => w.x === EAST_X).sort((a, b) => a.z - b.z);
    expect(east).toHaveLength(2);
    expect(east[0].z + east[0].d).toBe(DOOR.z0); // the opening is the ONE gap
    expect(east[1].z).toBe(DOOR.z1);
  });

  it("2. all 8 V1 seat cells are real seats, facing the way V1's seatDirections says", () => {
    const { world } = rig();
    const v1Seats = Object.entries(SEAT_DIRECTIONS[QA_ROOM_ID]!.seats!);
    expect(v1Seats).toHaveLength(8);
    expect(QA_SEAT_IDS).toHaveLength(7);
    const chairs = QA_SEAT_IDS.map((id) => world.get(id));
    // the lounge: V1 merges nine 'o' cells — sofa, pouf AND coffee table — into ONE seat at their
    // centroid (59.56, 740.44), which is the pocket's centre and not any one cushion. It is claimed here
    // by the sofa, whose own cushion line is what a sitter actually lands on.
    const seats = [
      ...chairs.map((c) => ({ id: c.id, x: c.transform.pos.x, z: c.transform.pos.z, yaw: c.capabilities.seat!.seatedYaw })),
      { id: SOFA_ID, x: SOFA_X, z: SOFA_Z, yaw: sofaSlots()[0].seatedYaw },
    ];
    const claimed = new Set<string>();
    for (const [cellKey, dir] of v1Seats) {
      const [cx, cz] = cellKey.split(",").map(Number);
      const near = seats.map((s) => ({ s, d: dist(s, { x: cx, z: cz }) })).sort((a, b) => a.d - b.d)[0];
      // THE THREE DOCUMENTED CORRECTIONS, and nothing else:
      //  • the lead chair   1 south, because its desk moved 6 south to give it a roll-back
      //  • the two visitor chairs 2 north, out of the bench pods behind them
      //  • the lounge cell  is a nine-cell centroid, not a cushion — 16.2 from the sofa's own body centre
      const tol = near.s.id === SOFA_ID ? 16.3 : near.s.id.includes("visitor") ? 2.1 : near.s.id.includes("lead") ? 1.1 : 0.01;
      expect(near.d, `${cellKey} → ${near.s.id}`).toBeLessThanOrEqual(tol);
      expect(near.s.yaw, `${near.s.id} faces V1 "${dir}"`).toBeCloseTo(YAW_FOR[dir], 5);
      claimed.add(near.s.id);
    }
    expect(claimed.size, "every seat is claimed exactly once").toBe(8);
    // the V1 lounge cell falls inside the lounge pocket the reconstruction actually builds
    expect(pointInRect({ x: 59.56, z: 740.44 }, { x: 33, z: 696, w: 60, d: 100 })).toBe(true);
  });

  it("3. the corrections are MINIMAL, stay inside V1's own cells, and each one buys a measured thing", () => {
    // the four bench chairs are on their V1 cell centres EXACTLY — no correction at all
    for (const c of BENCH_CHAIRS) {
      expect([120, 224]).toContain(c.x);
      expect([720, 768]).toContain(c.z);
    }
    // the lead chair: 1 south of its cell centre, still in grid row 40 (z 640…656)
    expect(648 - LEAD_CHAIR.z).toBe(1);
    expect(Math.floor(LEAD_CHAIR.z / CELL)).toBe(40);
    // …and its desk's 6-unit move is what gives it a roll-back it did not have. At the drawn position
    // (650) the chair's own back is 4.7 from the credenza; built at 656 it is 10.7.
    expect(LEAD_DESK.z).toBe(656);
    const chairBack = LEAD_CHAIR.z - chairR(18, 18);
    expect(chairBack - CREDENZA_FRONT).toBeGreaterThan(10);
    // …and at the DRAWN desk position (650) no chair centre could have done better: the furthest north it
    // could sit without entering its own desk is 650 − r, whose back is 5.5 from the credenza.
    expect((650 - chairR(18, 18)) - chairR(18, 18) - CREDENZA_FRONT).toBeLessThan(NAV_RADIUS);
    // the two visitor chairs: 2 north, still in grid row 43 (z 688…704), and clear of desk AND pods
    for (const c of VISITOR_CHAIRS) {
      expect(696 - c.z).toBe(2);
      expect(Math.floor(c.z / CELL)).toBe(43);
      expect(c.z - chairR(17, 17)).toBeGreaterThan(LEAD_DESK.z + LEAD_DESK.d);
      expect(c.z + chairR(17, 17)).toBeLessThan(BENCH_Z - BENCH_D / 2);
    }
    // the bench pods clear the chairs that flank them, which is why they are 129/183 and not 128/186
    for (const b of BENCHES) {
      const chairs = BENCH_CHAIRS.filter((c) => (b.screen === "east" ? c.x === 120 : c.x === 224));
      for (const c of chairs) {
        const near = b.screen === "east" ? b.x : b.x + BENCH_W;
        expect(Math.abs(near - c.x), `${c.id} overlaps ${b.id}`).toBeGreaterThan(chairR(18, 18));
      }
    }
  });

  it("4. every seat's approach is body-clear and reachable, and the lounge is reached down its own lane", () => {
    const { world, walkability, inBounds, stand } = rig();
    const obs = qaObstacles(world).filter((o) => !o.id.includes("chair")); // a chair rolls: its own cell is not an obstacle
    for (const id of QA_SEAT_IDS) {
      const s = world.get(id).capabilities.seat!;
      expect(stand(s.approach), `${id}: no body fits at its approach`).toBe(true);
      const hit = clearOf(s.approach, obs, NAV_RADIUS);
      expect(hit, `${id} approach ${JSON.stringify(s.approach)} brushes ${hit?.id} by ${hit?.gap}`).toBeNull();
      for (const [a, b] of [[DOOR_STANDS.inside, s.approach], [s.approach, DOOR_STANDS.inside]] as const)
        expect(planWalk(a, b, walkability, inBounds).ok, `${id}: no route ${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
    }
    // FIXED lounge seating: the sofa's three cushions and the pouf, all off one stand point
    expect(QA_LOUNGE_IDS).toEqual([SOFA_ID, POUF_ID]);
    expect(world.get(SOFA_ID).capabilities.lounge!.slots).toHaveLength(3);
    expect(world.get(POUF_ID).capabilities.lounge!.slots).toHaveLength(1);
    for (const id of QA_LOUNGE_IDS) for (const s of world.get(id).capabilities.lounge!.slots) {
      expect(stand(s.approach), `${id}/${s.id}: no body fits at its approach`).toBe(true);
      expect(planWalk(DOOR_STANDS.inside, s.approach, walkability, inBounds).ok, `${id}/${s.id} unreachable`).toBe(true);
    }
  });

  it("5. the lanes are real, and the two interrupted ones are interrupted exactly where the art says", () => {
    const { stand } = rig();
    // the two main north–south aisles, over the span the bench pods occupy
    for (let z = 640; z <= 820; z += 6) {
      expect(stand({ x: WEST_LANE, z }), `west lane closed at z ${z}`).toBe(true);
      expect(stand({ x: EAST_LANE, z }), `east lane closed at z ${z}`).toBe(true);
    }
    // the centre aisle: the slot between the two privacy screens, open to the south lane
    for (let z = 704; z <= 820; z += 6) expect(stand({ x: CENTRE_AISLE, z }), `centre aisle closed at z ${z}`).toBe(true);
    // the room's whole southern half is one open space
    for (let x = 40; x <= 280; x += 8) expect(stand({ x, z: SOUTH_LANE_Z }), `south lane closed at x ${x}`).toBe(true);
    // THE NORTH LANE is open either side of the lead workstation and blocked AT it — the lead chair
    // stands in it exactly as the render draws it tucked under the credenza
    // (its west end starts east of the north-west plant, which stands in the credenza's own gap)
    for (let x = 56; x <= 140; x += 6) expect(stand({ x, z: NORTH_LANE_Z }), `north lane closed at x ${x}`).toBe(true);
    // (and its east end stops short of the north-east plant, which stands in the credenza's other gap —
    //  the corner beyond it is still reachable, just not straight along the lane)
    for (let x = 180; x <= 270; x += 6) expect(stand({ x, z: NORTH_LANE_Z }), `north lane closed at x ${x}`).toBe(true);
    expect(stand({ x: 302, z: NORTH_LANE_Z }), "the north-east corner is a dead pocket").toBe(true);
    expect(stand({ x: LEAD_CHAIR.x, z: NORTH_LANE_Z }), "the north lane passes through the lead chair").toBe(false);
    // THE MIDDLE LANE is open at both ends and blocked at the two visitor chairs, for the same reason
    for (const x of [110, 126, 134]) expect(stand({ x, z: MIDDLE_LANE_Z }), `middle lane closed at x ${x}`).toBe(true);
    for (const x of [202, 220, 240]) expect(stand({ x, z: MIDDLE_LANE_Z }), `middle lane closed at x ${x}`).toBe(true);
    for (const c of VISITOR_CHAIRS) expect(stand({ x: c.x, z: MIDDLE_LANE_Z }), `${c.id} is not in the middle lane`).toBe(false);
    // the room's headline clearances, stated as numbers so a later change cannot quietly close one
    expect(LEAD_DESK.z - CREDENZA_FRONT).toBeGreaterThanOrEqual(2 * NAV_RADIUS); //                north lane
    expect((BENCH_Z - BENCH_D / 2) - (LEAD_DESK.z + LEAD_DESK.d)).toBeGreaterThanOrEqual(2 * NAV_RADIUS); // middle
    expect(SOUTH_Z - (BENCH_Z + BENCH_D / 2)).toBeGreaterThanOrEqual(2 * NAV_RADIUS); //           south lane
    expect(BENCHES[1].x - (BENCHES[0].x + BENCH_W)).toBeGreaterThanOrEqual(2 * NAV_RADIUS); //     centre aisle
    expect(EAST_CREDENZA.x - (BENCHES[1].x + BENCH_W)).toBeGreaterThanOrEqual(2 * NAV_RADIUS); //  east lane
  });

  it("6. every walk-up point is a body-clear spot facing something that is actually there", () => {
    const { world, stand } = rig();
    const obs = qaObstacles(world);
    expect(QA_APPROACH_IDS).toHaveLength(4);
    for (const id of QA_APPROACH_IDS) {
      const a = world.get(id).capabilities.approach!;
      expect(stand(a.point), `${a.label}: no body fits at ${JSON.stringify(a.point)}`).toBe(true);
      const hit = clearOf(a.point, obs, NAV_RADIUS);
      expect(hit, `${a.label} brushes ${hit?.id} by ${hit?.gap}`).toBeNull();
      expect(pointInRect(a.point, FLOOR_RECT), `${a.label} is outside the room`).toBe(true);
      // the pick target it names is a group build/qa.ts actually creates
      expect(qaBuildSource, `no pick target "${world.get(id).props.pick}"`).toMatch(new RegExp(`\\w+\\.name = "${world.get(id).props.pick}"`));
    }
  });

  it("7. the entrance is the V1 '+' band, bi-parting, and it routes both ways", () => {
    const { world, walkability, inBounds, stand } = rig();
    expect(ENTRY_DOOR.clearance.band).toEqual({ x: 19 * CELL, z: DOOR.z0, w: 2 * CELL, d: DOOR.z1 - DOOR.z0 });
    for (const cx of [19, 20]) for (const cy of [41, 42, 43, 44]) {
      expect(v1Static(cx, cy), `V1 '+' cell ${cx},${cy}`).toBe(true);
      const c = { x: cx * CELL + CELL / 2, z: cy * CELL + CELL / 2 };
      expect(pointInRect(c, ENTRY_DOOR.clearance.band), `cell centre ${cx},${cy} outside the band`).toBe(true);
    }
    expect(DOOR.z1 - DOOR.z0).toBe(64);
    expect(DOOR_STANDS.inside).toEqual({ x: 18 * CELL + 8, z: 43 * CELL });
    expect(DOOR_STANDS.outside).toEqual({ x: 21 * CELL + 8, z: 43 * CELL });
    for (const p of [DOOR_STANDS.inside, DOOR_STANDS.outside]) expect(stand(p), `${JSON.stringify(p)}`).toBe(true);
    // two leaves, one controller, counter-sliding out of the opening
    const n = world.get(DOOR_NORTH_ID), s = world.get(DOOR_SOUTH_ID);
    expect(n.transform.pos.x).toBe(s.transform.pos.x);
    expect(s.transform.pos.z - n.transform.pos.z).toBe(32);
    expect(n.transform.yaw).toBeCloseTo(-Math.PI / 2, 6); // the leaf is turned a quarter for an EAST wall
    expect(s.capabilities.door).toBeUndefined(); // only the driving leaf carries the capability
    for (const [a, b] of [[DOOR_STANDS.outside, DOOR_STANDS.inside], [DOOR_STANDS.inside, DOOR_STANDS.outside]] as const)
      expect(planWalk(a, b, walkability, inBounds).ok, `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
    // and from the wider building: the hall in front of the reception entrance
    const far: Vec2 = { x: 712, z: 824 };
    for (const [a, b] of [[far, DOOR_STANDS.inside], [DOOR_STANDS.inside, far]] as const)
      expect(planWalk(a, b, walkability, inBounds).ok, `${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
  });

  it("8. THE APPROVED CIRCULATION IS UNTOUCHED: AI ↔ Design and Design ↔ QA still hold", () => {
    // The Design Room is built 16 SOUTH of its V1 art box (rooms/design-room WORLD_SHIFT_Z), and the two
    // corridors that shift produced are approved geometry. Reconstructing QA must not reopen either — so
    // both are re-derived here from the three rooms' CURRENT walls, not from a remembered number.
    const designNorth = DESIGN_RECT.z;
    const designSouth = DESIGN_RECT.z + DESIGN_SHELL.frontWallZ + DESIGN_SHELL.wallThickness;
    const aiDesign = designNorth - AI_SOUTH_OUTER;
    expect(aiDesign).toBeCloseTo(32.19, 2); //                     approved, and QA does not touch it
    // Design ↔ QA is measured to QA's ART BOX in design-shift.test.ts (20.77). The BUILT wall's outer face
    // is half a unit further south than that box, so the real corridor is 20.27 — still wider than a body,
    // and still narrower than the AI side, which is the relation the shift was approved on.
    const designQaArt = v1("qa-room").y - designSouth;
    const designQaBuilt = NORTH_OUTER_Z - designSouth;
    expect(designQaArt).toBeCloseTo(20.77, 2);
    expect(designQaBuilt).toBeCloseTo(20.27, 2);
    expect(designQaArt - designQaBuilt).toBeCloseTo(0.5, 6); // the art box's own half unit, nothing else
    for (const gap of [aiDesign, designQaBuilt]) expect(gap).toBeGreaterThanOrEqual(2 * NAV_RADIUS);
    expect(aiDesign).toBeGreaterThan(designQaBuilt);
    // the Design Room did not move, and neither did the AI Room
    expect(DESIGN_ROOM.rect.z - v1("design-room").y).toBe(16);
    expect(AI_SOUTH_OUTER).toBe(300);
  });

  it("9. nothing in the room stands outside it, and the fixed fit-out is where the art puts it", () => {
    const { world } = rig();
    for (const e of world.inRoom(QA_ROOM_ID)) {
      if (e.kind === "glass-door-leaf") continue; // the leaf lives IN the wall
      expect(pointInRect(e.transform.pos, FLOOR_RECT), `${e.id} at ${JSON.stringify(e.transform.pos)}`).toBe(true);
    }
    expect(QA_SOLIDS.map((s) => s.id)).toEqual(["credenza", "east-credenza", "lounge-shelf"]);
    expect(CREDENZA.z).toBe(NORTH_Z); //                       the storage run stands on the north wall
    expect(EAST_CREDENZA.x + EAST_CREDENZA.w).toBe(EAST_X); // the supply unit on the east wall
    expect(EAST_CREDENZA.z).toBe(DOOR.z1); //                  …starting where the doorway ends
    // the credenza's depth is the documented circulation correction, not the art box
    expect(CREDENZA.d).toBe(20);
    // THE WALL EAST OF THE STORAGE RUN IS BARE. The flat reference hangs a work-rate board there; it is
    // deliberately not reconstructed, and nothing stands in for it — no solid, no entity, no walk-up, and
    // no geometry in the static builder.
    expect(QA_SOLIDS.some((s) => s.id.includes("board"))).toBe(false);
    expect(qaBuildSource).not.toMatch(/qualityBoard|ALWAYS GIVE|quality-board/);
    for (const e of qaRoomEntities()) expect(e.id).not.toMatch(/board/);
  });

  it("10. the room's own palette exists and nothing reuses another room's colours", () => {
    for (const k of ["qaTeal", "qaTealDeep", "qaOak", "qaOakDark", "qaWhite", "qaLinen", "qaLinenDeep",
      "qaFrame", "qaPlaster", "qaFloorTint", "qaRug", "qaRugBorder", "qaBoard", "qaScreenUi"] as const)
      expect(PALETTE[k], k).toBeTypeOf("number");
    // THE ONE FAILURE MODE THIS ROOM ACTUALLY HAD. With no separated art to inherit, the easy mistake was
    // to recolour another room. build/qa.ts names NO other room's palette key — not Design's, not CMS's
    // oak, not Dev's or AI's.
    for (const bad of ["cmsOak", "cmsBlue", "execWalnut", "devWalnut", "devNeon", "aiLed", "aiCharcoal", "gamingViolet", "hubSage"])
      expect(qaBuildSource, `build/qa.ts names ${bad}`).not.toContain(bad);
  });

  it("11. the room, its entities, its navigation, its door AND every one of its 7 chairs are wired in", () => {
    const src = bootstrapSource;
    // REGISTRATION IS ASSERTED BY RUNNING THE REAL ASSEMBLY, not by grepping for two source lines.
    // app/worldContents.ts is the one authoritative place the world is built (it was split out of
    // app/world.ts after a duplicate lift-core registration stopped the office starting while every
    // source-grep guard stayed green), and this calls the very same function the product calls.
    const built = buildWorldContents().world;
    expect(built.rooms.has(QA_ROOM.id)).toBe(true);
    expect(qaRoomEntities().every((e) => built.entities.has(e.id))).toBe(true);
    expect(src).toContain("mirror.buildRoom(QA_ROOM, shellOpts());");
    expect(src).toMatch(/DERIVED_ROOM_IDS = new Set\(\[[^\]]*QA_ROOM\.id/);
    expect(src).toContain("qaDoor.update(dt / 1000, { x: bp.x, z: bp.z }, route, peerBodies);");
    // THE EXECUTIVE-CHAIR BUG GUARD. A movable SeatInteraction that is never ticked animates nothing and
    // locks the avatar. One controller serves all 7 chairs, and it MUST be in the per-frame update.
    expect(src).toContain("qaSeat?.update(dt / 1000);");
    expect(src).toContain("const id = QA_SEAT_IDS[index];");
    expect(src).toContain("const qa = QA_SEAT_IDS.indexOf(id);");
    expect(src).toContain("if (qaSeat && qaSeat.state !== \"idle\") qaSeat.reset();");
    expect(src).toMatch(/engagedSeat[\s\S]{0,220}qaSeat/);
    expect(src).toMatch(/\(qaSeat\?\.status \?\? "idle"\) !== "idle"/);
    // the sofa and the pouf join the ONE shared lounge list, not a new system
    expect(src).toMatch(/loungeSeats = \[[^\]]*QA_LOUNGE_IDS/);
  });

  it("12. ELEVEN reconstructed rooms: the ground floor has no footprint-only interior left", () => {
    const { plan, world } = rig();
    expect(plan.rooms).toHaveLength(11);
    for (const r of plan.rooms) expect(r.reconstructed, `${r.id} is still a placeholder`).toBe(true);
    expect(plan.rooms.filter((r) => !r.reconstructed)).toHaveLength(0);
    // every room contributes a walkable floor region, and every one has a RoomDef behind it
    for (const r of plan.rooms) {
      expect(world.rooms.get(r.id), `${r.id} has no RoomDef`).toBeDefined();
      expect(world.regions.find((g) => g.id === `floor:${r.id}`)?.walkable, `${r.id} has no walkable floor`).toBe(true);
    }
    // …and the QA interior, which every earlier phase used as its example of unbuilt space, is now floor
    expect(world.regionAt({ x: 168, z: 760 })).toMatchObject({ id: `floor:${QA_ROOM_ID}`, walkable: true });
    expect(v1Static(10, 45), "V1 still paints the QA interior as floor, untouched").toBe(true);
  });
});

// ================================================================================================
// PLAYER QA. Everything above measures the room as DATA; this drives it the way Bon does — the real
// SeatInteraction, LoungeSeatInteraction, ApproachInteraction, SlidingDoor and PlayerBody against the real
// collision test.
// ================================================================================================
describe("vo3d QA Room — player QA", () => {
  it("every one of the 7 movable chairs completes Sit → Seated → Stand, and returns to rest with zero drift", () => {
    const { world, walkability, inBounds } = rig();
    for (const id of QA_SEAT_IDS) {
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
      const axis = spec.pullDir.x !== 0 ? "x" : "z";
      const got = axis === "x" ? chair.position.x : chair.position.z;
      const want = (axis === "x" ? rest.x : rest.z) + (axis === "x" ? spec.pullDir.x : spec.pullDir.z) * spec.seatedTuck;
      expect(Math.abs(got - want), id).toBeLessThan(0.01);
      seat.stand();
      for (let t = 0; t < 20 && seat.state !== "idle"; t += 1 / 60) step();
      expect(seat.state, `${id} never returned to idle`).toBe("idle");
      expect(seat.chairRestError(), `${id} left its chair off its rest position`).toBeLessThan(1e-6);
      expect(stack.owner, `${id} never released the avatar`).not.toBe("Interaction");
    }
  });

  it("the sofa's three cushions and the pouf seat and release the avatar, on the ONE shared controller", () => {
    const { world, walkability, inBounds } = rig();
    for (const id of QA_LOUNGE_IDS) {
      const e = world.get(id);
      for (const slot of e.capabilities.lounge!.slots) {
        const scene = new THREE.Object3D();
        const piece = new THREE.Object3D();
        piece.position.set(e.transform.pos.x, 0, e.transform.pos.z);
        scene.add(piece);
        const av = new Avatar({ height: 36, lit: true });
        scene.add(av.root);
        av.setPosition({ ...slot.approach });
        const stack = new ControllerStack();
        const nav = new NavigationController(av, stack);
        const lounge = new LoungeSeatInteraction(av, stack, piece, slot, (to) => planWalk(slot.approach, to, walkability, inBounds));
        expect(lounge.sit()?.ok, `${slot.id}: the walk to its stand point was rejected`).toBe(true);
        const step = () => { lounge.update(1 / 60); nav.update(1 / 60); scene.updateMatrixWorld(true); };
        for (let t = 0; t < 30 && lounge.state !== "seated"; t += 1 / 60) step();
        expect(lounge.state, `${slot.id} never reached "seated" (stuck in "${lounge.state}")`).toBe("seated");
        // the sitter lands ON the cushion plane the builder actually draws. (The slot's `sink` is applied
        // by seatContact only once the real avatar CLIPS are loaded, which a headless rig has none of —
        // so the plane, not the compression, is what this can honestly assert.)
        expect(av.root.position.y).toBeCloseTo(slot.contactLocal.y, 3);
        lounge.stand();
        for (let t = 0; t < 30 && lounge.state !== "idle"; t += 1 / 60) step();
        expect(lounge.state, `${slot.id} never returned to idle`).toBe("idle");
        expect(stack.owner, `${slot.id} never released the avatar`).not.toBe("Interaction");
      }
    }
  });

  it("every walk-up point can actually be walked to and completes, then releases the avatar", () => {
    const { world, walkability, inBounds } = rig();
    for (const id of QA_APPROACH_IDS) {
      const spec = world.get(id).capabilities.approach!;
      const av = new Avatar({ height: 36, lit: true });
      av.setPosition({ ...DOOR_STANDS.inside });
      const stack = new ControllerStack();
      const nav = new NavigationController(av, stack);
      const ctl = new ApproachInteraction(av, stack, (to) => planWalk(av.position, to, walkability, inBounds));
      const r = ctl.begin(spec);
      expect(r.ok, `${spec.label}: no route from the doorway`).toBe(true);
      if (r.ok) nav.setPath(r.path);
      for (let f = 0; f < 3000 && nav.moving; f++) nav.update(1 / 60);
      expect(nav.moving, `${spec.label}: the walk never finished`).toBe(false);
      ctl.onArrived();
      for (let f = 0; f < 600 && ctl.state !== "arrived"; f++) { ctl.update(1 / 60); nav.update(1 / 60); }
      expect(ctl.state, `${spec.label} never finished (stuck in "${ctl.state}")`).toBe("arrived");
      expect(stack.owner, `${spec.label} never released the avatar`).not.toBe("Interaction");
      expect(Math.hypot(av.position.x - spec.point.x, av.position.z - spec.point.z), `${spec.label}: the body did not arrive`).toBeLessThan(CELL); // A* lands on the cell's own stand point
      expect(av.yaw, `${spec.label}: the body is not facing its target`).toBeCloseTo(spec.yaw, 3);
    }
  });

  it("a PLAYER body walks in through the east door, round the room and back out — walking AND sprinting", () => {
    const { world, stand: canStand } = rig();
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
    for (let x = EAST_X - 4; x <= EAST_X + 16; x += 1)
      for (let z = DOOR.z0 + 2; z <= DOOR.z1 - 2; z += 1)
        expect(world.regionAt({ x, z }), `${x},${z} owned by no region`).not.toBeNull();
    const WALK = 30 / 60, SPRINT = (30 * 1.8) / 60;
    for (const step of [WALK, SPRINT]) {
      // the circuit goes ROUND the lead workstation, not through it — the north lane is interrupted at
      // the lead chair by design (see test 5), so its two segments are walked from their own ends
      const legs: Vec2[] = [
        DOOR_STANDS.outside, DOOR_STANDS.inside, { x: EAST_LANE, z: 688 }, { x: EAST_LANE, z: NORTH_LANE_Z },
        { x: 190, z: NORTH_LANE_Z }, { x: EAST_LANE, z: NORTH_LANE_Z }, { x: EAST_LANE, z: SOUTH_LANE_Z },
        { x: CENTRE_AISLE, z: SOUTH_LANE_Z }, { x: WEST_LANE, z: SOUTH_LANE_Z },
        { x: WEST_LANE, z: NORTH_LANE_Z }, { x: WEST_LANE, z: SOUTH_LANE_Z },
        { x: EAST_LANE, z: SOUTH_LANE_Z }, { x: EAST_LANE, z: 688 }, DOOR_STANDS.inside, DOOR_STANDS.outside,
      ];
      for (let i = 0; i < legs.length - 1; i++) {
        const r = drive(legs[i], legs[i + 1], step);
        expect(r.arrived, `leg ${i} (${step === WALK ? "walk" : "sprint"}) stuck at ${r.stuckAt.x.toFixed(1)},${r.stuckAt.z.toFixed(1)}`).toBe(true);
      }
    }
    // the east wall is the ONE gap: a body may not walk through it north or south of the doorway
    for (const z of [DOOR.z0 - 40, DOOR.z1 + 60]) {
      const b = new PlayerBody({ x: EAST_LANE, z }, NAV_RADIUS, canStand);
      for (let f = 0; f < 400; f++) b.move(0.5, 0);
      expect(b.pos.x, `the east wall at z=${z} was passable`).toBeLessThan(EAST_X);
    }
    // …and neither can it walk through the west window wall
    const w = new PlayerBody({ x: 120, z: 640 }, NAV_RADIUS, canStand);
    for (let f = 0; f < 400; f++) w.move(-0.5, 0);
    expect(w.pos.x, "the window wall was passable").toBeGreaterThan(WEST_X);
  });

  it("the east door bi-parts for an arriving body, holds the crossing and closes without drift", () => {
    const { world } = rig();
    const n = world.get(DOOR_NORTH_ID), s = world.get(DOOR_SOUTH_ID);
    const view = { position: { x: n.transform.pos.x, y: 0, z: n.transform.pos.z } } as unknown as THREE.Object3D;
    const opp = { position: { x: s.transform.pos.x, y: 0, z: s.transform.pos.z } } as unknown as THREE.Object3D;
    const door = new SlidingDoor(view, ENTRY_DOOR, n.transform.pos, { view: opp, closed: s.transform.pos });
    const route = [DOOR_STANDS.outside, DOOR_STANDS.inside];
    for (let i = 0; i < 200; i++) door.update(1 / 60, DOOR_STANDS.outside, route);
    expect(door.t).toBeCloseTo(1, 3);
    expect(view.position.z).toBeCloseTo(n.transform.pos.z - 32, 3); // north leaf parks north
    expect(opp.position.z).toBeCloseTo(s.transform.pos.z + 32, 3); //  south leaf parks south
    // standing IN the crossing must hold it open, however long the player loiters
    for (let i = 0; i < 600; i++) door.update(1 / 60, { x: 322, z: 688 }, []);
    expect(door.state, "the door closed on a body standing in it").not.toBe("closed");
    for (let i = 0; i < 600; i++) door.update(1 / 60, { x: 160, z: 800 }, []);
    expect(door.state).toBe("closed");
    expect(door.driftError()).toBeLessThan(1e-6);
  });

  it("stands at eye level in a room built to human proportions, and Design ↔ QA circulation still walks", () => {
    const { world, stand: canStand, walkability, inBounds } = rig();
    // EYE-LEVEL SCALE: the desk tops land at Bon's hip, and every fixed unit stands under the wall head
    expect(BENCH_H).toBe(QA_DESK_TOP);
    expect(LEAD_DESK.h).toBe(QA_DESK_TOP);
    expect(QA_DESK_TOP / BON_STANDING_HEIGHT).toBeGreaterThan(0.5);
    expect(QA_DESK_TOP / BON_STANDING_HEIGHT).toBeLessThan(0.75);
    for (const s of [CREDENZA, EAST_CREDENZA, LOUNGE_SHELF]) expect(s.h).toBeLessThan(STRUCT.wallHeight);
    // FIRST vs THIRD PERSON is one camera over one body, so the room-level question is whether the body
    // fits where the camera will be put — the room's centre, each lane head, the lounge and the doorway
    for (const p of [{ x: 250, z: 760 }, { x: WEST_LANE, z: NORTH_LANE_Z }, { x: EAST_LANE, z: SOUTH_LANE_Z },
      { x: CENTRE_AISLE, z: 800 }, { x: POUF.x + 20, z: POUF.z }, DOOR_STANDS.inside, DOOR_STANDS.outside])
      expect(canStand(p), `no body fits at ${JSON.stringify(p)}`).toBe(true);
    // DESIGN ↔ QA CIRCULATION, walked rather than measured: the Design Room's own door approach reaches
    // this room's inside stand and back, which is the route the +16 shift was approved to keep open.
    const designApproach: Vec2 = { x: DESIGN_RECT.x + 174.5, z: DESIGN_RECT.z + 187.8 };
    for (const [a, b] of [[designApproach, DOOR_STANDS.inside], [DOOR_STANDS.inside, designApproach]] as const)
      expect(planWalk(a, b, walkability, inBounds).ok, `Design ↔ QA ${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
    expect(world.regionAt({ x: 168, z: 760 })?.roomId).toBe(QA_ROOM_ID);
  });
});
