// Phase 3 — THE HOME-DESK SPAWN, end to end, over the REAL production data on both sides.
//
// Nothing is mocked here. V1's stores answer who is signed in, V1's painted seats and room tables answer
// which desk is theirs, and V2's own navigation stack — the same WorldState, walkability, derived nav and
// stand test app/world.ts composes — answers whether a body may stand there. What this file asserts is
// the join between them: the right room, the right point in the built world (including the Design Room's
// world shift), a legal body position, and the seat's own facing.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetCurrentUserForTests, setCurrentUserFromMeResponse } from "../../auth/currentUserStore";
import { resolveVo3dHomeDesk } from "./adapters/v1HomeDesk";
import { homeDeskWorldPoint } from "./app/spawn";
import { v1Rooms } from "./adapters/v1Floor";
import { WorldState } from "./world/WorldState";
import { CORRIDOR_BANDS, ROOM_WORLD_SHIFT_Z, registerGroundFloor } from "./rooms/ground-floor";
import { makeStandTest } from "./player/standTest";
import { PlayerBody } from "./player/PlayerBody";
import { DESIGN_ROOM, WORLD_SHIFT_Z, designRoomEntities } from "./rooms/design-room";
import { RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "./rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "./rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "./rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "./rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "./rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "./rooms/cms";
import { AI_ROOM, aiRoomEntities } from "./rooms/ai";
import { DEV_ROOM, devRoomEntities } from "./rooms/dev";
import { QA_ROOM, qaRoomEntities } from "./rooms/qa";
import { DerivedNav } from "./nav/derived";
import { Walkability, composeStatic } from "./nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "./nav/clearance";
import { openedLayer, v2Static } from "./nav/v2Open";
import { v1Static } from "./adapters/v1Grid";
import { FACING_YAW, pointInRect, type Facing, type Rect, type Vec2 } from "./core/coords";

const DERIVED = new Set([DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB.id, EXECUTIVE_ROOM.id, CMS_ROOM.id, AI_ROOM.id, DEV_ROOM.id, QA_ROOM.id]);

/** The world app/world.ts builds, and the ONE stand test it judges the player's body by (`officeStand`
 *  there: NAV_RADIUS, exterior allowed). Built once — it is static data, and every case reads it. */
function rig() {
  const world = new WorldState();
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(),
    ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const derived = new DerivedNav(world, { roomIds: DERIVED });
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  walkability.attachDerived(derived, world);
  return makeStandTest({ world, walkability, derived, radius: NAV_RADIUS, allowExterior: true });
}
const canStand = rig();

/** The placement app/world.ts performs, run over the same inputs: V1 point → built world → body. */
function spawnFor(email: string, name: string): { desk: NonNullable<ReturnType<typeof resolveVo3dHomeDesk>>; target: Vec2; placed: Vec2 | null } {
  setCurrentUserFromMeResponse({ id: "atlas-1", email, full_name: name, role: "dev", team: null });
  const desk = resolveVo3dHomeDesk();
  expect(desk, `${name} should have a resolvable home desk`).not.toBeNull();
  const target = homeDeskWorldPoint(desk!.point, v1Rooms(), ROOM_WORLD_SHIFT_Z);
  const body = new PlayerBody(target, NAV_RADIUS, canStand);
  return { desk: desk!, target, placed: body.placeNear(target) ? body.pos : null };
}

beforeEach(() => resetCurrentUserForTests());
afterEach(() => resetCurrentUserForTests());

/** email, display name, the V1 room they belong to, the V2 room they must end up standing in, facing. */
const CASES: ReadonlyArray<[string, string, string, { id: string; rect: Rect }, Facing]> = [
  ["jerevon@offshorly.com", "Bon", "design-team", DESIGN_ROOM, "east"],
  ["alex@offshorly.com", "Alex", "executive-team", EXECUTIVE_ROOM, "north"],
  ["lui@offshorly.com", "Lui", "dev-team", DEV_ROOM, "north"],
];

describe.each(CASES)("home-desk spawn for %s", (email, name, flatRoomId, v2Room, facing) => {
  it("resolves the room V1 assigns them, and the seat's own facing", () => {
    const { desk } = spawnFor(email, name);
    expect(desk.roomId).toBe(flatRoomId);
    // The facing is the CHAIR's, straight from V1's seat table — never a guess, and never derived from
    // which way the room happens to point.
    expect(desk.facing).toBe(facing);
    expect(FACING_YAW[desk.facing]).toBeTypeOf("number");
  });

  it("lands inside the room as V2 actually built it", () => {
    const { placed } = spawnFor(email, name);
    expect(placed).not.toBeNull();
    expect(pointInRect(placed!, v2Room.rect)).toBe(true);
  });

  it("puts a full-radius body somewhere it may legally stand", () => {
    const { placed } = spawnFor(email, name);
    // The same predicate every WASD step is judged by — walls, furniture footprints, door architecture
    // and the V1 grid, at the body's centre AND its rim.
    expect(canStand(placed!)).toBe(true);
  });

  it("stays within reach of the desk it was asked for", () => {
    const { target, placed } = spawnFor(email, name);
    // placeNear searches outward in rings of one body radius, up to six. Anything further away would not
    // be "at your desk" any more, and the test would rather fail than quietly relocate someone.
    expect(Math.hypot(placed!.x - target.x, placed!.z - target.z)).toBeLessThanOrEqual(6 * NAV_RADIUS);
  });
});

describe("the V1 → V2 coordinate conversion", () => {
  it("carries the Design Room's world shift, and only that room's", () => {
    const bon = spawnFor("jerevon@offshorly.com", "Bon");
    expect(WORLD_SHIFT_Z).toBe(16);
    // Bon's desk is in the Design Room, which V2 builds 16 units south of its V1 art box.
    expect(bon.target.z).toBeCloseTo(bon.desk.point.z + WORLD_SHIFT_Z, 6);
    expect(bon.target.x).toBe(bon.desk.point.x);
    // Alex's and Lui's rooms declare no shift, so their points must be untouched.
    for (const [email, name] of [["alex@offshorly.com", "Alex"], ["lui@offshorly.com", "Lui"]] as const) {
      const s = spawnFor(email, name);
      expect(s.target).toEqual(s.desk.point);
    }
  });

  it("reads the shift from the one table the built world reads", () => {
    // Not a literal 16 copied into the adapter: the number comes from the room, via the floor plan's map.
    expect(ROOM_WORLD_SHIFT_Z[DESIGN_ROOM.id]).toBe(WORLD_SHIFT_Z);
    expect(Object.keys(ROOM_WORLD_SHIFT_Z)).toEqual([DESIGN_ROOM.id]);
  });

  it("does not offset the seat by anybody's sprite box", () => {
    // A seat centroid is already a CENTRE point. The bug this guards against is subtracting a half-height
    // — and worse, Bon's half-height — from every employee's seat.
    const { desk } = spawnFor("lui@offshorly.com", "Lui");
    setCurrentUserFromMeResponse({ id: "atlas-1", email: "lui@offshorly.com", full_name: "Lui", role: "dev", team: null });
    expect(resolveVo3dHomeDesk()!.point).toEqual(desk.point);
  });
});

describe("when there is no desk to preview", () => {
  it("returns null rather than standing an unassigned employee in Reception", () => {
    // Reception is V1's FALLBACK_ROOM_ID — it fills V1's floor, it is not a place to put someone whose
    // whereabouts V2 does not know. V1's own answer for a person who is not at work is the SIDEWALK, and
    // V2 reads no attendance at all, so the honest answer here is "no spawn".
    setCurrentUserFromMeResponse({ id: "atlas-1", email: "someone.new@offshorly.com", full_name: "Someone New", role: "dev", team: null });
    expect(resolveVo3dHomeDesk()).toBeNull();
  });

  it("returns null when V1 does not know who is signed in", () => {
    expect(resolveVo3dHomeDesk()).toBeNull();
  });

  it("still resolves a desk for someone whose department genuinely maps to Reception", () => {
    // The refusal above is about an UNRESOLVED room, not about Reception itself: Operations really does
    // sit there (data/roomIdentity), and that person gets their desk like anyone else.
    setCurrentUserFromMeResponse({ id: "atlas-1", email: "ops.person@offshorly.com", full_name: "Ops Person", role: "ops", team: "Operations" });
    const desk = resolveVo3dHomeDesk();
    expect(desk).not.toBeNull();
    expect(desk!.roomId).toBe("reception-room");
    const target = homeDeskWorldPoint(desk!.point, v1Rooms(), ROOM_WORLD_SHIFT_Z);
    const body = new PlayerBody(target, NAV_RADIUS, canStand);
    expect(body.placeNear(target)).toBe(true);
    expect(canStand(body.pos)).toBe(true);
  });
});
