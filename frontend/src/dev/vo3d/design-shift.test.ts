// vo3d — THE V2 GEOMETRY-AUTHORITY INVARIANT, and the Design Room's world shift that exercises it.
//
// WHAT THIS FILE REPLACES. Until Phase 9 several tests asserted that the Design Room's navigation matched
// V1's painted grid at FIXED world coordinates — written when the room's V1 art box and its built position
// were necessarily the same rect, before geometry-derived navigation existed (Phase 7B). That was a
// coordinate-parity assertion, not a behavioural one, and it made a reconstructed room unable to move even
// though its navigation no longer comes from V1 at all.
//
// The rule those tests were reaching for is kept, and restated here in the terms V2 actually works in:
//
//   • inside a RECONSTRUCTED room, its CURRENT geometry decides walkability — walls, footprints, doors
//   • outside one, the V1 painted grid still decides, unchanged and unread-from
//   • a room may therefore be BUILT away from its V1 art box, and when it is, everything about it moves:
//     geometry and logical data together, in one step, from one constant
//
// The V1 production data — office-assets-manifest.json, officeWalkabilityGrid.ts, seatDirections.ts — is
// untouched by all of this, and test 2 below asserts that.
import { describe, expect, it } from "vitest";
import manifest from "../../data/office-assets-manifest.json";
import { WorldState } from "./world/WorldState";
import { CORRIDOR_BANDS, ROOM_WORLD_SHIFT_Z, registerGroundFloor } from "./rooms/ground-floor";
import { makeStandTest } from "./player/standTest";
import {
  CHAIR_4_ID, DESIGN_DOOR, DESIGN_ROOM, DESIGN_SOLIDS, DOOR_ID, HERO_PLANT_ID, SHELL, V1_RECT,
  WORLD_SHIFT_Z, designRoomEntities, RECT,
} from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "./rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import { AI_ROOM, DOOR_STANDS as AI_DOOR_STANDS, SOUTH_OUTER_Z as AI_SOUTH_OUTER, aiRoomEntities } from "./rooms/ai";
import { DEV_ROOM, devRoomEntities } from "./rooms/dev";
import { QA_ROOM, qaRoomEntities } from "./rooms/qa";
import { DerivedNav } from "./nav/derived";
import { roomSolids } from "./nav/solids";
import { Walkability, composeStatic } from "./nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "./nav/clearance";
import { openedLayer, v2Static } from "./nav/v2Open";
import { CELL, v1Static, worldToCell } from "./adapters/v1Grid";
import { planWalk } from "./nav/planner";
import { v1RoomRect } from "./adapters/v1Manifest";
import { type Rect, type Vec2 } from "./core/coords";

const DERIVED = new Set([DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB.id, EXECUTIVE_ROOM.id, CMS_ROOM.id, AI_ROOM.id, DEV_ROOM.id, QA_ROOM.id]);

/** the same composition app/bootstrap builds */
function rig() {
  const world = new WorldState();
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(),
    ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  const plan = registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const derived = new DerivedNav(world, { roomIds: DERIVED });
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  walkability.attachDerived(derived, world);
  const stand = makeStandTest({ world, walkability, derived, radius: NAV_RADIUS });
  return { world, plan, inBounds, walkability, derived, stand };
}
/** the room's own solids as world rects — what a body in or beside the Design Room actually has to clear */
function designSolidRects(world: WorldState): Rect[] {
  return roomSolids(world, new Set([DESIGN_ROOM.id]), () => 0).flatMap((s) => (s.shape.kind === "rect" ? [s.shape.rect] : []));
}
const distToRect = (p: Vec2, r: Rect): number =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.z - p.z, 0, p.z - (r.z + r.d)));
const nearestSolid = (p: Vec2, rects: Rect[]): number => rects.reduce((m, r) => Math.min(m, distToRect(p, r)), Infinity);

/** the room's built extents, derived from its shell — not hard-coded */
const DESIGN_NORTH = RECT.z;
const DESIGN_SOUTH = RECT.z + SHELL.frontWallZ + SHELL.wallThickness;
const QA_NORTH = v1RoomRect("qa-room").z;

describe("vo3d — V2 geometry authority: the Design Room is BUILT where V2 says, not where V1 painted it", () => {
  it("1. the room translates as ONE unit: every rect, entity, seat, door and footprint is V1 + the shift", () => {
    expect(WORLD_SHIFT_Z).toBe(16);
    expect(RECT).toEqual({ ...V1_RECT, z: V1_RECT.z + WORLD_SHIFT_Z });
    // the room's own bounds and floor
    expect(DESIGN_ROOM.rect.z - V1_RECT.z).toBe(WORLD_SHIFT_Z);
    expect(DESIGN_ROOM.floorRect.z - (V1_RECT.z + SHELL.wallThickness)).toBe(WORLD_SHIFT_Z);
    // every wall run
    for (const w of DESIGN_ROOM.wallSolids!) expect(w.z).toBeGreaterThanOrEqual(RECT.z - 1e-9);
    expect(Math.min(...DESIGN_ROOM.wallSolids!.map((w) => w.z))).toBeCloseTo(RECT.z, 6);
    // every baked decor solid
    for (const s of DESIGN_SOLIDS) expect(s.z).toBeGreaterThanOrEqual(RECT.z);
    // EVERY entity — furniture (absolute manifest boxes), plants (room-local) and the door alike — lands
    // inside the BUILT rect. This is the "no geometry moved while logical coordinates stayed behind" check:
    // the manifest furniture is the one part that does not follow RECT on its own.
    const ents = designRoomEntities();
    expect(ents.length).toBeGreaterThan(30);
    for (const e of ents) {
      expect(e.transform.pos.z, `${e.id} is outside the built room`).toBeGreaterThanOrEqual(RECT.z);
      expect(e.transform.pos.z, `${e.id} is outside the built room`).toBeLessThanOrEqual(RECT.z + RECT.d);
    }
    // …and the furniture specifically is exactly one shift south of its manifest box
    const chairLayer = (manifest as { id: string; y: number; height: number }[]).find((l) => l.id === "design-member-chair-4")!;
    const chair = ents.find((e) => e.id === CHAIR_4_ID)!;
    expect(chair.transform.pos.z - (chairLayer.y + chairLayer.height / 2)).toBeCloseTo(WORLD_SHIFT_Z, 6);
    // the seat's approach / preSeat / waypoints moved with the chair they serve
    const seat = chair.capabilities.seat!;
    expect(seat.approach.z - (V1_RECT.z + 187.8)).toBeCloseTo(WORLD_SHIFT_Z, 6);
    for (const p of [seat.preSeat, ...seat.approachToSeat]) expect(p.z).toBeGreaterThan(RECT.z);
    // the door: transform, crossing, trigger, leaf and clearance band all moved together
    const door = ents.find((e) => e.id === DOOR_ID)!;
    expect(door.transform.pos.z - (V1_RECT.z + (SHELL.glass.z0 + SHELL.glass.doorZ1) / 2)).toBeCloseTo(WORLD_SHIFT_Z, 6);
    expect(DESIGN_DOOR.crossing.z - (V1_RECT.z + SHELL.glass.z0)).toBeCloseTo(WORLD_SHIFT_Z, 6);
    expect(DESIGN_DOOR.clearance.band.z).toBeCloseTo(RECT.z, 6);
    expect(DESIGN_DOOR.leaf!.z).toBeGreaterThan(RECT.z);
    for (const s of DESIGN_DOOR.clearance.solids) expect(s.z).toBeGreaterThanOrEqual(RECT.z - 1e-9);
    // the plant the editor proof moves is a room-local entity and moved too
    const plant = ents.find((e) => e.id === HERO_PLANT_ID)!;
    expect(plant.transform.pos.z).toBeGreaterThan(RECT.z);
  });

  it("2. V1 production data is untouched, and stays the authority OUTSIDE reconstructed rooms", () => {
    // the manifest still paints the room where it always did — the shift is not written back anywhere
    const art = (manifest as { id: string; kind: string; x: number; y: number; width: number; height: number }[])
      .find((l) => l.kind === "room" && l.id === "design-room")!;
    expect(V1_RECT).toEqual({ x: art.x, z: art.y, w: art.width, d: art.height });
    expect(v1RoomRect("design-room")).toEqual(V1_RECT);
    expect(art.y).toBeCloseTo(316.19, 2); // NOT 332.19: the V1 layer never learns about the shift
    // only a GEOMETRY-DERIVED room may declare a shift — an unreconstructed room has no geometry to answer
    // with, so it must stay exactly where V1 paints it
    for (const id of Object.keys(ROOM_WORLD_SHIFT_Z)) expect(DERIVED.has(id), `${id} is shifted but not derived-governed`).toBe(true);
    // and the V1 grid still governs everything no reconstructed room covers. Phase 11 built the LAST of
    // them, so the example that used to live here — the unbuilt QA interior — is now a derived room floor;
    // what is asserted instead is that V1's own paint of it is untouched and simply no longer consulted.
    const { world, walkability } = rig();
    expect(world.regionAt({ x: 168, z: 720 })).toMatchObject({ id: "floor:qa-room", walkable: true });
    expect(v1Static(10, 45), "V1 still paints the QA interior as floor").toBe(true);
    // a V1-blocked hall cell stays blocked, and a V1-open hall cell stays open, through the composition
    expect(v1Static(25, 2)).toBe(false);
    expect(walkability.staticLayer(25, 2), "V1's blocked hall cell was overruled").toBe(false);
    expect(v1Static(20, 27)).toBe(true);
    expect(walkability.staticLayer(20, 27), "V1's open hall cell was closed").toBe(true);
  });

  it("3. OLD SPACE OPENS / NEW SPACE BLOCKS — navigation follows the room's current geometry", () => {
    const { world, derived } = rig();
    const solids = designSolidRects(world);
    const midX = RECT.x + RECT.w / 2;
    // the strip the room VACATED (its old north band, z 316.19…332.19) now carries no Design solid at all
    for (let z = V1_RECT.z + 1; z < RECT.z - 1; z += 2)
      expect(nearestSolid({ x: midX, z }, solids), `vacated z ${z} still blocked`).toBeGreaterThan(0);
    // the strip the room NOW OCCUPIES (its new south band) is inside one
    const newSouthBand = { x: midX, z: DESIGN_SOUTH - SHELL.wallThickness / 2 };
    expect(nearestSolid(newSouthBand, solids), "the new south wall is not solid").toBe(0);
    // the same point one shift NORTH — where the south wall used to stand — is now clear
    expect(nearestSolid({ ...newSouthBand, z: newSouthBand.z - WORLD_SHIFT_Z }, solids)).toBeGreaterThan(0);
    // and the derived field agrees with the geometry, cell by cell, inside the room's NEW floor only
    const insideNew = worldToCell({ x: midX, z: RECT.z + 60 });
    const insideOld = worldToCell({ x: midX, z: V1_RECT.z + 2 });
    expect(derived.governs(insideNew.cx, insideNew.cy), "the built room governs its own floor").toBe(true);
    expect(derived.governs(insideOld.cx, insideOld.cy), "the room still governs floor it left").toBe(false);
  });

  it("4. the movable-plant proof still holds, measured against CURRENT geometry", () => {
    const { world, derived } = rig();
    const plant = world.get(HERO_PLANT_ID);
    const before = { ...plant.transform.pos };
    const cellOf = (p: Vec2) => worldToCell(p);
    const clearAt = (p: Vec2) => derived.clearanceAt(cellOf(p).cx, cellOf(p).cy);
    const startClear = clearAt(before);
    expect(startClear).toBeLessThan(NAV_RADIUS); // the plant blocks where it stands
    // move it, and invalidate exactly the space it left plus the space it took
    const to: Vec2 = { x: RECT.x + 120, z: RECT.z + 100 };
    const vacated = derived.boundsOfEntity(HERO_PLANT_ID);
    world.commit((tx) => tx.setTransform(HERO_PLANT_ID, { pos: to, yaw: 0 }));
    derived.invalidate([...vacated, { x: to.x - 12, z: to.z - 12, w: 24, d: 24 }], NAV_RADIUS);
    expect(clearAt(before), "the space the plant LEFT did not open").toBeGreaterThanOrEqual(NAV_RADIUS);
    expect(clearAt(to), "the space the plant TOOK did not block").toBeLessThan(NAV_RADIUS);
  });

  it("5. both corridors are real clearances, and the apron band is honest about the geometry", () => {
    const aiDesign = DESIGN_NORTH - AI_SOUTH_OUTER;
    const designQa = QA_NORTH - DESIGN_SOUTH;
    expect(aiDesign).toBeCloseTo(32.19, 2);
    expect(designQa).toBeCloseTo(20.77, 2);
    // both hold a body; the AI side gets the comfortable one because it is the side with a door on it
    for (const [label, gap] of [["AI↔Design", aiDesign], ["Design↔QA", designQa]] as const)
      expect(gap, `${label} is narrower than a body`).toBeGreaterThanOrEqual(2 * NAV_RADIUS);
    expect(aiDesign).toBeGreaterThan(designQa);
    // THE APRON BAND'S HONESTY, re-derived from the two rooms' own walls. Every cell it declares open must
    // hold a body; the row below it must NOT, or the band would be a player-only opening.
    const band = CORRIDOR_BANDS.find((b) => b.id === "ai-design-apron")!;
    expect(band.solids).toEqual([]);
    for (let cy = Math.floor(band.rect.z / CELL); cy < (band.rect.z + band.rect.d) / CELL; cy++) {
      const centre = cy * CELL + CELL / 2;
      expect(centre - AI_SOUTH_OUTER, `band row ${cy} is too close to the AI Room`).toBeGreaterThanOrEqual(NAV_RADIUS);
      expect(DESIGN_NORTH - centre, `band row ${cy} is too close to the Design Room`).toBeGreaterThanOrEqual(NAV_RADIUS);
    }
    // the row the band deliberately leaves blocked: V1 is right about it and we do not overrule it
    const nextRow = Math.floor((band.rect.z + band.rect.d) / CELL) * CELL + CELL / 2;
    expect(DESIGN_NORTH - nextRow).toBeLessThan(NAV_RADIUS);
    const overlapsHere = (b: { rect: Rect }) => b.rect.x < RECT.x + RECT.w && b.rect.x + b.rect.w > RECT.x;
    expect(CORRIDOR_BANDS.filter(overlapsHere).some((b) => b.rect.z <= nextRow && nextRow < b.rect.z + b.rect.d)).toBe(false);
  });

  it("6. the AI Room's entrance funnel is a full body wide, and routes still cross both doorways", () => {
    const { stand, walkability, inBounds } = rig();
    // the doorway's legal body-centre window, measured across the AI Room's south wall band
    const windowAt = (z: number): number => { let n = 0; for (let x = 264; x <= 360; x++) if (stand({ x, z })) n++; return n; };
    for (const z of [292, 296, 300]) expect(windowAt(z), `AI doorway pinched at z ${z}`).toBeGreaterThanOrEqual(2 * NAV_RADIUS);
    // …and the route through it, both ways
    for (const [a, b] of [[AI_DOOR_STANDS.inside, AI_DOOR_STANDS.outside], [AI_DOOR_STANDS.outside, AI_DOOR_STANDS.inside]] as const)
      expect(planWalk(a, b, walkability, inBounds).ok, `AI door ${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
    // the Design Room's own entrance still works from the hall, and back
    const designApproach: Vec2 = { x: RECT.x + 174.5, z: RECT.z + 187.8 };
    const hall: Vec2 = { x: 728, z: 312 };
    for (const [a, b] of [[designApproach, hall], [hall, designApproach]] as const)
      expect(planWalk(a, b, walkability, inBounds).ok, `Design door ${JSON.stringify(a)} → ${JSON.stringify(b)}`).toBe(true);
    // and the two rooms reach each other
    expect(planWalk(designApproach, AI_DOOR_STANDS.inside, walkability, inBounds).ok, "Design → AI Room").toBe(true);
    expect(planWalk(AI_DOOR_STANDS.inside, designApproach, walkability, inBounds).ok, "AI Room → Design").toBe(true);
  });
});
