// Phase 6C — Reception's lounge and the Design Room's chairs are DETECTABLE and SITTABLE: every piece a
// person can sit on carries a capability, every approach is standable and reachable, the E-key targeting
// finds each piece from its own approach, and each anchor is identified/configured.
import { describe, expect, it } from "vitest";
import { WorldState } from "./world/WorldState";
import { CORRIDOR_BANDS, registerGroundFloor } from "./rooms/ground-floor";
import { makeStandTest } from "./player/standTest";
import { collectCandidates, pickTarget } from "./player/PlayerTargeting";
import { CHAIR_4_ID, DESIGN_ROOM, DESIGN_SEAT_IDS, designRoomEntities } from "./rooms/design-room";
import { DESIGN_SOLIDS } from "./rooms/design-room";
import { LOUNGE_SEAT_IDS, RECEPTION_LOUNGE_IDS, RECEPTION_ROOM, receptionEntities } from "./rooms/reception";
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
import { anchorForSeatKey, seatMapping, v2SeatKey } from "./adapters/v1Seats";
import { groundFloorSeatAnchors, seatAnchorId, seatFacingFor } from "./app/seats";
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
const unit = (from: Vec2, to: Vec2): Vec2 => { const d = Math.hypot(to.x - from.x, to.z - from.z) || 1; return { x: (to.x - from.x) / d, z: (to.z - from.z) / d }; };

describe("Reception lounge", () => {
  it("both sofas (two cushions each) and all four tub chairs carry lounge slots", () => {
    const { world } = rig();
    expect(RECEPTION_LOUNGE_IDS).toHaveLength(6);
    for (const id of RECEPTION_LOUNGE_IDS) expect(world.get(id).capabilities.lounge, id).toBeDefined();
    expect(world.get(`${RECEPTION_ROOM.id}/sofa-west`).capabilities.lounge!.slots.map((s) => s.id)).toEqual(["sofa-west-north", "sofa-west-south"]);
    expect(world.get(`${RECEPTION_ROOM.id}/sofa-east`).capabilities.lounge!.slots.map((s) => s.id)).toEqual(["sofa-east-north", "sofa-east-south"]);
    // the two north chairs are byte-for-byte what they were
    for (const id of LOUNGE_SEAT_IDS) expect(world.get(id).capabilities.lounge!.slots[0].approach.z).toBe(984);
  });

  it("every slot's approach is standable and reachable from the north chair's stand cell", () => {
    const { world, inBounds, walkability, stand } = rig();
    const from = world.get(LOUNGE_SEAT_IDS[0]).capabilities.lounge!.slots[0].approach;
    for (const id of RECEPTION_LOUNGE_IDS) for (const s of world.get(id).capabilities.lounge!.slots) {
      expect(stand(s.approach), `${id}#${s.id}: no body fits at ${JSON.stringify(s.approach)}`).toBe(true);
      expect(planWalk(from, s.approach, walkability, inBounds).ok, `${id}#${s.id}: unreachable`).toBe(true);
    }
  });

  it("E-key targeting finds each piece from its own approach cell, facing it", () => {
    const { world } = rig();
    const candidates = collectCandidates(world).get(RECEPTION_ROOM.id)!;
    for (const id of RECEPTION_LOUNGE_IDS) for (const s of world.get(id).capabilities.lounge!.slots) {
      const t = pickTarget(candidates, s.approach, unit(s.approach, world.get(id).transform.pos));
      expect(t?.id, `${id}#${s.id} not targeted from its approach`).toBe(id);
      expect(t?.kind).toBe("lounge");
    }
  });

  it("every cushion has an anchor, a wire key and a configured facing; the V1 sofa seat is identified", () => {
    const anchors = new Set(groundFloorSeatAnchors().map((a) => a.id));
    const m = seatMapping();
    for (const id of RECEPTION_LOUNGE_IDS) for (const s of rig().world.get(id).capabilities.lounge!.slots) {
      const anchor = seatAnchorId(id, s.id);
      expect(anchors.has(anchor), anchor).toBe(true);
      expect(seatFacingFor(anchor), `${anchor} facing`).not.toBeNull();
      const key = m.byAnchor.get(anchor)?.key ?? v2SeatKey(anchor);
      expect(anchorForSeatKey(key)?.id).toBe(anchor);
    }
    // V1's one flood-filled sofa seat per side (416/1024, 1056) is one of that sofa's cushions
    expect([...m.byAnchor.entries()].some(([a, v1]) => a.startsWith(`${RECEPTION_ROOM.id}/sofa-west#`) && v1.key === "416,1056")).toBe(true);
    expect([...m.byAnchor.entries()].some(([a, v1]) => a.startsWith(`${RECEPTION_ROOM.id}/sofa-east#`) && v1.key === "1024,1056")).toBe(true);
  });
});

describe("Design Room chairs", () => {
  it("E-key targeting finds every chair (not only chair 4) from its approach, and the click picker has a name for each", () => {
    const { world } = rig();
    const candidates = collectCandidates(world).get(DESIGN_ROOM.id)!;
    for (const id of DESIGN_SEAT_IDS) {
      const s = world.get(id).capabilities.seat!;
      const t = pickTarget(candidates, s.approach, unit(s.approach, world.get(id).transform.pos));
      expect(t?.id, `${id} not targeted from its approach`).toBe(id);
      expect(t?.kind).toBe("seat");
    }
    // the Office View picker maps a seat entity's own id to itself: every chair, not just CHAIR_4_ID
    const pickable = [...world.entities.values()].filter((e) => e.capabilities.seat || e.capabilities.lounge).map((e) => e.id);
    for (const id of DESIGN_SEAT_IDS) expect(pickable).toContain(id);
    expect(pickable).toContain(CHAIR_4_ID);
  });
});
