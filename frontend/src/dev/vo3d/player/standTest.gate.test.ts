// vo3d player — PHASE 7E: THE GATE STOPS THE BODY, NOT JUST THE ROUTER.
//
// THE BUG THIS EXISTS FOR. Reception's gate lanes are closed by a Walkability RESERVATION, and
// `Walkability.walkable` honours it before it consults anything else — so the A* router, click-to-walk and
// every approach refused to cross. The PLAYER's stand test did not: Reception is a DERIVED room, and for a
// derived cell the test delegated straight to the room's geometry (`derived.clearanceAtPoint`) without ever
// asking `walkable`. The lanes are perfectly clear floor geometrically, so the answer was yes, and a
// checked-out employee walked through the shut gates in PLAYER mode.
//
// A reservation is not a statement about geometry, so no geometric layer can answer for it. The fix is one
// question asked first, of the SAME reservation the gate already uses — there is no second access system.
//
// Everything below runs against the REAL rooms, the REAL V1 grid and the REAL derived navigation.
import { describe, expect, it } from "vitest";
import { WorldState } from "../world/WorldState";
import { CORRIDOR_BANDS, registerGroundFloor } from "../rooms/ground-floor";
import { makeStandTest } from "./standTest";
import { DESIGN_ROOM, DESIGN_SOLIDS, designRoomEntities } from "../rooms/design-room";
import { GATE, RECEPTION_ROOM, receptionEntities } from "../rooms/reception";
import { MEETING_ROOM, meetingRoomEntities } from "../rooms/meeting";
import { PROJECT_ROOM, projectRoomEntities } from "../rooms/project";
import { GAMING_ROOM, gamingRoomEntities } from "../rooms/gaming";
import { CENTRAL_HUB, centralHubEntities, OPEN_BANDS as HUB_BANDS } from "../rooms/central-hub";
import { EXECUTIVE_ROOM, executiveRoomEntities } from "../rooms/executive";
import { CMS_ROOM, cmsRoomEntities } from "../rooms/cms";
import { AI_ROOM, aiRoomEntities } from "../rooms/ai";
import { DEV_ROOM, devRoomEntities } from "../rooms/dev";
import { QA_ROOM, qaRoomEntities } from "../rooms/qa";
import { Walkability, composeStatic } from "../nav/Walkability";
import { NAV_RADIUS, clearanceLayer, worldClearances } from "../nav/clearance";
import { DerivedNav } from "../nav/derived";
import { openedLayer, v2Static } from "../nav/v2Open";
import { CELL, v1Static } from "../adapters/v1Grid";
import { gateRects } from "../app/access";
import { planWalk } from "../nav/planner";
import type { Vec2 } from "../core/coords";
import type { Cell } from "../adapters/v1Grid";

const ROOMS = [DESIGN_ROOM, RECEPTION_ROOM, MEETING_ROOM, PROJECT_ROOM, GAMING_ROOM, CENTRAL_HUB, EXECUTIVE_ROOM, CMS_ROOM, AI_ROOM, DEV_ROOM, QA_ROOM];

function rig() {
  const world = new WorldState();
  for (const r of ROOMS) world.addRoom(r);
  for (const e of [...designRoomEntities(), ...receptionEntities(), ...meetingRoomEntities(), ...projectRoomEntities(), ...gamingRoomEntities(), ...centralHubEntities(), ...executiveRoomEntities(), ...cmsRoomEntities(), ...aiRoomEntities(), ...devRoomEntities(), ...qaRoomEntities()]) world.addEntity(e);
  DESIGN_SOLIDS.forEach((r, i) => world.addEntity({ id: `${DESIGN_ROOM.id}/solid-${i}`, kind: "solid", roomId: DESIGN_ROOM.id, transform: { pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, yaw: 0 }, footprint: { shape: "rect", w: r.w, d: r.d }, capabilities: {}, props: {}, source: { baked: true } }));
  registerGroundFloor(world);
  const inBounds = (p: Vec2) => world.walkableAt(p);
  const walkability = new Walkability(composeStatic(v2Static(v1Static, openedLayer([...HUB_BANDS, ...CORRIDOR_BANDS])), inBounds, clearanceLayer(worldClearances(world))));
  const derived = new DerivedNav(world, { roomIds: new Set(ROOMS.map((r) => r.id)) });
  walkability.attachDerived(derived, world);
  return { world, inBounds, walkability, derived, stand: makeStandTest({ world, walkability, derived, radius: NAV_RADIUS, allowExterior: true }) };
}

/** The gate cells, rasterised exactly as app/world.ts does it. */
function gateCells(): Cell[] {
  const out: Cell[] = [];
  for (const r of gateRects(GATE.lanes, { z0: GATE.bandZ0, z1: GATE.bandZ1 }))
    for (let cy = Math.floor(r.z / CELL); cy <= Math.floor((r.z + r.d - 0.001) / CELL); cy++)
      for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w - 0.001) / CELL); cx++) out.push({ cx, cy });
  return out;
}
const GATE_RESERVATION = "office-access-gate";

/** ONE REAL CROSSING POINT PER LANE, found rather than assumed.
 *
 *  A lane's geometric centre is not always standable — the wide accessible lane has a divider post at its
 *  middle, and the body has to use one side of it. So the points are DISCOVERED with the gate open (the
 *  x where a body actually fits), and those same points are what the closed-gate cases then assert are
 *  refused. That is the honest test: the places a person can really walk through are the places that have
 *  to stop working.  */
function laneCrossings(stand: (p: Vec2) => boolean): Vec2[] {
  const z = (GATE.bandZ0 + GATE.bandZ1) / 2;
  return GATE.lanes.map((l, i) => {
    for (let x = l.x0 + 2; x <= l.x1 - 2; x += 1) if (stand({ x, z })) return { x, z };
    throw new Error(`lane ${i} has no standable crossing point with the gate OPEN`);
  });
}
/** Reception's public half, comfortably south of the band: where a checked-out employee lives. */
const RECEPTION_PUBLIC: Vec2 = { x: 600, z: 1050 };
/** Deep inside the working office. */
const OFFICE_DEEP: Vec2 = { x: 400, z: 400 };

describe("the closed gate stops a body in PLAYER mode, not only the router", () => {
  it("all THREE lanes are crossable while the gate is open — otherwise this test proves nothing", () => {
    const { stand } = rig();
    expect(laneCrossings(stand)).toHaveLength(3);
  });

  it("NO lane is crossable while the gate is reserved", () => {
    const { stand, walkability } = rig();
    const points = laneCrossings(stand);
    walkability.reserve(GATE_RESERVATION, gateCells());
    for (const [i, p] of points.entries()) expect(stand(p), `lane ${i} with the gate shut`).toBe(false);
  });

  it("…and every lane opens again the moment the reservation is released", () => {
    const { stand, walkability } = rig();
    const points = laneCrossings(stand);
    walkability.reserve(GATE_RESERVATION, gateCells());
    walkability.release(GATE_RESERVATION);
    for (const [i, p] of points.entries()) expect(stand(p), `lane ${i} after check-in`).toBe(true);
  });

  it("THE REGRESSION ITSELF: Reception is derived, and a derived cell used to answer for itself", () => {
    const { walkability, derived } = rig();
    const { stand } = rig();
    const lane = laneCrossings(stand)[0];
    const c = { cx: Math.floor(lane.x / CELL), cy: Math.floor(lane.z / CELL) };
    // If this stops being true the bug cannot recur — but the guard should be removed deliberately, not
    // silently, so it is asserted rather than assumed.
    expect(derived.governs(c.cx, c.cy)).toBe(true);
    walkability.reserve(GATE_RESERVATION, gateCells());
    // The geometry still says the lane is clear floor. Only the reservation says otherwise.
    expect(derived.clearanceAtPoint(lane)).toBeGreaterThanOrEqual(NAV_RADIUS);
    expect(walkability.isReserved(c.cx, c.cy)).toBe(true);
    expect(walkability.walkable(c.cx, c.cy)).toBe(false);
  });

  it("a reservation is not a furniture footprint: isReserved reports only the deliberate closure", () => {
    const { walkability, stand } = rig();
    const lane = laneCrossings(stand)[0];
    const c = { cx: Math.floor(lane.x / CELL), cy: Math.floor(lane.z / CELL) };
    expect(walkability.isReserved(c.cx, c.cy)).toBe(false);
    walkability.reserve(GATE_RESERVATION, gateCells());
    expect(walkability.isReserved(c.cx, c.cy)).toBe(true);
    walkability.release(GATE_RESERVATION);
    expect(walkability.isReserved(c.cx, c.cy)).toBe(false);
  });
});

describe("and nothing else about movement changes", () => {
  it("Reception's public half stays freely walkable with the gate shut", () => {
    const { stand, walkability } = rig();
    walkability.reserve(GATE_RESERVATION, gateCells());
    expect(stand(RECEPTION_PUBLIC)).toBe(true);
    // …across the room's open floor, not merely at one lucky point. Only points that are standable with
    // the gate OPEN are compared, so the room's own furniture is not mistaken for the gate's doing.
    const open = rig();
    let compared = 0;
    for (let x = 480; x <= 940; x += 20) {
      const p = { x, z: 1050 };
      if (!open.stand(p)) continue;
      compared++;
      expect(stand(p), `x=${x} must be unaffected by the gate`).toBe(true);
    }
    expect(compared).toBeGreaterThan(8);
  });

  it("the office interior is unaffected — the gate is a boundary, not a global movement block", () => {
    const { stand, walkability } = rig();
    walkability.reserve(GATE_RESERVATION, gateCells());
    expect(stand(OFFICE_DEEP)).toBe(true);
  });

  it("the ROUTER still refuses to cross, exactly as it did before (unchanged path)", () => {
    const { walkability, inBounds } = rig();
    walkability.reserve(GATE_RESERVATION, gateCells());
    const r = planWalk(RECEPTION_PUBLIC, OFFICE_DEEP, walkability, inBounds);
    expect(r.ok).toBe(false);
  });

  it("…and routes through again once V1 confirms the check-in", () => {
    const { walkability, inBounds } = rig();
    walkability.reserve(GATE_RESERVATION, gateCells());
    walkability.release(GATE_RESERVATION);
    const r = planWalk(RECEPTION_PUBLIC, OFFICE_DEEP, walkability, inBounds);
    expect(r.ok).toBe(true);
  });
});
