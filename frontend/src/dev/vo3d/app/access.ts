// vo3d app — THE WORKING-OFFICE BOUNDARY. Phase 5's second contract, beside app/selfMovement.ts, and the
// same split for the same reason: this module is pure and imports nothing but V2's coordinate leaf, so
// app/world.ts stays loadable by the standalone dev page. The V1 half (adapters/v1Attendance.ts) is the
// only thing that knows attendance exists.
//
// THE RULE, AND WHERE IT COMES FROM.
//
// Attendance and world access are SEPARATE. Being checked out does not log anybody out of V2 and does not
// stop them exploring: Reception, the street, the outdoor world and the AI Lab stay open. What requires a
// confirmed V1 check-in is the WORKING OFFICE — everything past Reception's speed gates.
//
// THERE IS NO SECOND ATTENDANCE AUTHORITY, and there must never be one. This module holds no state, reads
// nothing and decides nothing about work sessions; it is handed V1's answer and turns it into geometry.
// V1's `services/attendance` is the authority, `employee_attendance` is the record, and the only things
// that change it are a confirmed check-in and V1's own Log Time → Check Out flow.
//
// WHY THE GEOMETRY IS A PARAMETER. The three numbers this depends on — the V1 frame, the façade plane and
// Reception's gate line — are V1 art facts that adapters/v1Floor and rooms/reception already own. Passing
// them in keeps this testable against known rects and keeps each number with exactly one owner.
//
// WHAT THIS IS NOT. Not the Reception dialog, not the entry-sensor visuals, not the kiosk, not a presence
// or status transition, and not time logging. Those are the later attendance/interaction phase. This is
// only the boundary and who may cross it.
import { pointInRect, type Rect, type Vec2 } from "../core/coords";

/** Which side of the working-office boundary a point is on.
 *
 *  `outside` is everything beyond the façade AND everything beyond the V1 frame — the street, the campus
 *  legs, the AI Lab and the CAVE. It is deliberately one zone: V2 has no attendance opinion about any of
 *  it, and the rules treat all of it the same way.
 *
 *  `reception` is the PUBLIC half of the Reception room: inside its art box, south of the gate line.
 *  Reachable from the street through the entrance door, and open whatever attendance says.
 *
 *  `office` is everything else inside the frame — the hub, the corridors, every team room, and the strip
 *  of Reception NORTH of the gates, which is already past the sensor. */
export type Zone = "office" | "reception" | "outside";

/** V1's answer about this employee's work session, as V2 needs it.
 *
 *  `unknown` is a real and common answer, not an error: V2's world is built before the attendance read
 *  resolves, and a read can fail. It is treated as NOT permitted for crossing the boundary — the gate
 *  stays shut until V1 says otherwise — but it is deliberately weaker than `denied`: an unknown answer
 *  never MOVES anybody, because yanking a checked-in employee out of the office for the half second
 *  before their own check-in is confirmed would be a worse bug than the one this guards against. */
export type OfficeAccess = "permitted" | "denied" | "unknown";

/** May this employee cross into the working office? Only a confirmed check-in says yes. */
export const mayEnterOffice = (access: OfficeAccess): boolean => access === "permitted";

/** The V1 art facts the boundary is measured against. */
export interface AccessGeometry {
  /** the V1 frame — 1440 × 1244. Anything outside it is `outside` by construction. */
  frame: Rect;
  /** the front-row façade plane. South of it is the door threshold and the sidewalk: the street. */
  facadeZ: number;
  /** Reception's own art box. Only THIS room has a public half; Meeting and Project are front-row rooms
   *  too, but they open onto the corridor past the gates, so they are working office at every z. */
  receptionRect: Rect;
  /** the balustrade/gate plane inside Reception. North of it is past the sensor. */
  gateZ: number;
}

/**
 * Which side of the boundary this world point is on.
 *
 * Order is load-bearing. Outside the frame first (the campus and the Lab are not office at any z), then
 * the façade (the street is not office either), and only then Reception's own box — so a point in Meeting
 * or Project at the same z as Reception's public half is still correctly working office.
 */
export function zoneAt(p: Vec2, g: AccessGeometry): Zone {
  if (!pointInRect(p, g.frame)) return "outside";
  if (p.z >= g.facadeZ) return "outside";
  if (p.z >= g.gateZ && pointInRect(p, g.receptionRect)) return "reception";
  return "office";
}

/** Does any point of this route enter the working office? Used to refuse a planned walk, and to drop a
 *  walk already queued when V1's answer changes underneath it. */
export function routeEntersOffice(points: readonly Vec2[], g: AccessGeometry): boolean {
  return points.some((p) => zoneAt(p, g) === "office");
}

/** One walk-through lane of Reception's speed gates, in world x. */
export interface GateLane {
  x0: number;
  x1: number;
}

/**
 * THE GATE LINE AS RECTS — the cells a denied employee may not occupy.
 *
 * This is the whole enforcement of "no walking, pathfinding or Player Mode past the sensor", and it is
 * deliberately the SMALLEST set that achieves it: the three lanes, over the gate band, and nothing else.
 * Every other walkable cell in the building stays walkable, so nobody's movement is globally blocked —
 * a denied employee walks freely in Reception, on the street, along the campus legs and through the Lab.
 *
 * It works because the lanes are the only walkable crossing of the balustrade line: the rest of the band
 * is pedestals and balustrade, blocked in V1's own grid. The connectivity test in access.test.ts asserts
 * exactly that against the real grid, because it is the assumption the whole gate rests on.
 *
 * Expressed as rects rather than cells so this module stays free of the grid adapter; app/world.ts
 * rasterises them and hands them to Walkability's own reservation mechanism, which every mover already
 * consults — the router through `walkable`, the body through the stand test. There is no second path to
 * close, and no new blocking mechanism was invented for this.
 */
export function gateRects(lanes: readonly GateLane[], band: { z0: number; z1: number }): Rect[] {
  return lanes.map((l) => ({ x: l.x0, z: band.z0, w: l.x1 - l.x0, d: band.z1 - band.z0 }));
}
