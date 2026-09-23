// Phase 6C — every Design Room desk chair is sittable, not only chair 4 (the "proof scope" seat).
import { describe, expect, it } from "vitest";
import { WorldState } from "./world/WorldState";
import { CORRIDOR_BANDS, registerGroundFloor } from "./rooms/ground-floor";
import { makeStandTest } from "./player/standTest";
import { CHAIR_4_ID, DESIGN_BEANBAG_ID, DESIGN_LOUNGE_IDS, DESIGN_ROOM, DESIGN_SEAT_IDS, DESIGN_SOFA_ID, designRoomEntities } from "./rooms/design-room";
import { DESIGN_SOLIDS } from "./rooms/design-room";
import { collectCandidates, pickTarget } from "./player/PlayerTargeting";
import { groundFloorSeatAnchors, seatAnchorId } from "./app/seats";
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
import { Walkability, composeStatic } from "./nav/Walkability";
import { clearanceLayer, worldClearances } from "./nav/clearance";
import { DerivedNav } from "./nav/derived";
import { openedLayer, v2Static } from "./nav/v2Open";
import { v1Static } from "./adapters/v1Grid";
import { NAV_RADIUS } from "./nav/clearance";
import { planWalk } from "./nav/planner";
import { seatMapping } from "./adapters/v1Seats";
import { seatFacingFor } from "./app/seats";
import type { Vec2 } from "./core/coords";

function rig() {
  const world = new WorldState();
  for (const r of [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM]) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(), ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  // the baked solids the live world registers too (world.ts): without them the floor south of the beanbag reads open
  DESIGN_SOLIDS.forEach((r, i) => world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } }));
  registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: new Set([DESIGN_ROOM.id, RECEPTION_ROOM.id, MEETING_ROOM.id, PROJECT_ROOM.id, GAMING_ROOM.id, CENTRAL_HUB.id, EXECUTIVE_ROOM.id, CMS_ROOM.id, AI_ROOM.id, DEV_ROOM.id, QA_ROOM.id]) });
  walkability.attachDerived(derived, world);
  return { world, inBounds, walkability, stand: makeStandTest({ world, walkability, derived, radius: NAV_RADIUS }) };
}

describe("Design Room seating", () => {
  it("all eight desk chairs carry a seat capability, and chair 4's is byte-for-byte what it was", () => {
    const { world } = rig();
    expect(DESIGN_SEAT_IDS).toHaveLength(8);
    for (const id of DESIGN_SEAT_IDS) expect(world.get(id).capabilities.seat, id).toBeDefined();
    const c4 = world.get(CHAIR_4_ID).capabilities.seat!;
    expect(c4.approach.x).toBeCloseTo(DESIGN_ROOM.rect.x + 174.5, 6);
    expect(c4.pullDistance).toBe(22);
    expect(c4.seatedTuck).toBe(7);
  });

  it("every chair's approach is standable and reachable from chair 4's, and rolls AWAY from the way it faces", () => {
    const { world, inBounds, walkability, stand } = rig();
    const from = world.get(CHAIR_4_ID).capabilities.seat!.approach;
    for (const id of DESIGN_SEAT_IDS) {
      const s = world.get(id).capabilities.seat!;
      expect(stand(s.approach), `${id}: no body fits at approach ${JSON.stringify(s.approach)}`).toBe(true);
      expect(planWalk(from, s.approach, walkability, inBounds).ok, `${id}: unreachable approach ${JSON.stringify(s.approach)}`).toBe(true);
      // the body forward at the authored seatedYaw is the OPPOSITE of the pull direction (it faces the desk)
      expect(Math.round(Math.sin(s.seatedYaw)) + 0).toBe(-s.pullDir.x + 0);
      expect(Math.round(Math.cos(s.seatedYaw)) + 0).toBe(-s.pullDir.z + 0);
    }
  });

  it("every chair is identified as its V1 seat by provenance and has a configured facing matching V1's word", () => {
    const m = seatMapping();
    for (const id of DESIGN_SEAT_IDS) {
      const v1 = m.byAnchor.get(id);
      expect(v1, `${id} should map to a V1 seat`).toBeDefined();
      expect(seatFacingFor(id), id).toBe(v1!.direction);
    }
    // V1's own words for this room: the west pair looks west, the east pair east, the row north, the lead south
    expect(seatFacingFor("design-room/design-member-chair1")).toBe("left");
    expect(seatFacingFor("design-room/design-member-chair6")).toBe("right");
    expect(seatFacingFor("design-room/design-chair-3")).toBe("back");
    expect(seatFacingFor("design-room/design-lead-chair")).toBe("front");
  });

  it("the side sofa (two cushions) and the beanbag are sittable: registered, standable, reachable, targetable, configured", () => {
    const { world, inBounds, walkability, stand } = rig();
    expect(DESIGN_LOUNGE_IDS).toEqual([DESIGN_SOFA_ID, DESIGN_BEANBAG_ID]);
    expect(world.get(DESIGN_SOFA_ID).capabilities.lounge!.slots.map((s) => s.id)).toEqual(["sofa-north", "sofa-south"]);
    expect(world.get(DESIGN_BEANBAG_ID).capabilities.lounge!.slots.map((s) => s.id)).toEqual(["beanbag-seat"]);
    const from = world.get(CHAIR_4_ID).capabilities.seat!.approach;
    const candidates = collectCandidates(world).get(DESIGN_ROOM.id)!;
    const anchors = new Set(groundFloorSeatAnchors().map((a) => a.id));
    const m = seatMapping();
    for (const id of DESIGN_LOUNGE_IDS) for (const s of world.get(id).capabilities.lounge!.slots) {
      expect(stand(s.approach), `${id}#${s.id}: no body fits at ${JSON.stringify(s.approach)}`).toBe(true);
      expect(planWalk(from, s.approach, walkability, inBounds).ok, `${id}#${s.id}: unreachable`).toBe(true);
      const e = world.get(id).transform.pos, d = Math.hypot(e.x - s.approach.x, e.z - s.approach.z) || 1;
      const t = pickTarget(candidates, s.approach, { x: (e.x - s.approach.x) / d, z: (e.z - s.approach.z) / d });
      expect(t?.id, `${id}#${s.id} not E-key targetable from its approach`).toBe(id);
      const anchor = seatAnchorId(id, s.id);
      expect(anchors.has(anchor)).toBe(true);
      // every one is a V1 seat with V1's own word: the sofa's sitters look east ("right"), the beanbag south ("front")
      expect(m.byAnchor.get(anchor), anchor).toBeDefined();
      expect(seatFacingFor(anchor)).toBe(m.byAnchor.get(anchor)!.direction);
    }
    expect(seatFacingFor(`${DESIGN_SOFA_ID}#sofa-north`)).toBe("right");
    expect(seatFacingFor(`${DESIGN_BEANBAG_ID}#beanbag-seat`)).toBe("front");
  });
});
