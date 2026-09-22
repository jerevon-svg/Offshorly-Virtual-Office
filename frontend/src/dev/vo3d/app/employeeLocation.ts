// vo3d app — WHERE IS THIS PERSON RIGHT NOW, as a pure function.
//
// Search, the coworker menu and the nameplates all knew a person's STATUS ("Available", "Busy") and none
// of them knew their LOCATION. This answers the second question, and ONLY from facts the movement feed
// already publishes — no new presence service, no new socket, no backend field.
//
// THE TWO RULES THAT SHAPE EVERYTHING HERE:
//
//  1. A DESK IS NOT A LOCATION. `posSource` is the feed's own distinction (app/coworkers.ts): "live" is
//     V1's last-arrived persisted position, "desk" is the roster seating everybody starts on and anybody
//     V1 has never seen move STAYS on forever. Reporting a desk as "where they are" would state a guess
//     as a fact for every disconnected employee in the building, so "desk" resolves to `unknown` and the
//     label says so out loud.
//  2. LOCATABLE IS NOT THE SAME QUESTION AS LABELLED. The Cave is a sealed volume: its occupants are
//     deliberately not drawn for anybody outside it (app/coworkers.ts coworkersInSameVolume, and the
//     rendering isolation that depends on it). They can still be NAMED — "In Championship Cave" is true
//     and useful — but there is no body to fly the camera to, so Locate must be refused rather than
//     silently doing nothing.
import { CAVE_PLACE_ID } from "./coworkers";
import type { Zone } from "./access";

/** The place id the self-movement feed publishes on stepping out to the Lab (app/world.ts's
 *  setDepartureDestination). Kept beside the Cave's so the two names this module keys on sit together. */
export const AI_LAB_PLACE_ID = "ai-lab";

export type EmployeeLocationKind = "room" | "aiLab" | "cave" | "outside" | "office" | "unknown";

export interface EmployeeLocation {
  /** Compact, human, and never a guess. */
  label: string;
  kind: EmployeeLocationKind;
  /** May the viewer's Locate actually reach this person? False when they are in a volume the viewer is
   *  not in, or when there is no live position to reach. */
  locatable: boolean;
}

/** The one honest answer when the feed has not seen this person move. */
export const UNKNOWN_LOCATION: EmployeeLocation = {
  label: "Location unavailable",
  kind: "unknown",
  locatable: false,
};

export interface EmployeeLocationInput {
  /** Which fact `point` is — app/coworkers.ts. Only "live" is a location. */
  posSource: "desk" | "live";
  /** The named place or room id riding beside the position on the wire, when there is one. */
  place?: string | null;
  /** Their live position in V1 frame units. Used ONLY to ask the world which zone it falls in. */
  point?: { x: number; z: number } | null;
}

export interface EmployeeLocationDeps {
  /** Is the VIEWER inside the Cave? Decides which side of the sealed volume Locate can reach. */
  viewerInsideCave: boolean;
  /** The world's own zone test, read-only. Absent when the world is not up yet, in which case the
   *  exterior simply cannot be distinguished and this says `office` rather than inventing one. */
  zoneAt?: (x: number, z: number) => Zone;
  /** Manifest id -> display name. Falls back to the raw id, never to an invented room. */
  roomName: (roomId: string) => string;
}

/**
 * Resolve one person's location.
 *
 * ORDER MATTERS. Liveness is asked first because a stale `place` on a desk-sourced row would otherwise
 * name a room the person may have left hours ago. The Cave is asked before the room lookup because its
 * id IS a room id on the wire and would otherwise resolve to an ordinary room name.
 */
export function resolveEmployeeLocation(
  input: EmployeeLocationInput,
  deps: EmployeeLocationDeps,
): EmployeeLocation {
  // RULE 1 — a desk is not a location, and neither is a missing point.
  if (input.posSource !== "live") return UNKNOWN_LOCATION;

  const place = input.place?.trim() || null;

  // RULE 2 — the sealed volume. Named always, reachable only from inside it.
  if (place === CAVE_PLACE_ID) {
    return { label: "In Championship Cave", kind: "cave", locatable: deps.viewerInsideCave };
  }
  // Everything below is in the ordinary world, which a viewer inside the Cave cannot reach either.
  const reachable = !deps.viewerInsideCave;

  if (place === AI_LAB_PLACE_ID) return { label: "In AI Lab", kind: "aiLab", locatable: reachable };

  // THE EXTERIOR, from the world's own zone test and nothing else. `place` cannot answer this: a room id
  // is only rewritten when a boundary is crossed, so somebody who walked out of Reception still carries
  // "reception-room" while standing on the street — which is exactly the stale reading rule 1 exists to
  // prevent. Without the world (not mounted yet) the honest answer is the coarse one, never a guess.
  const point = input.point;
  if (point && deps.zoneAt) {
    const zone = deps.zoneAt(point.x, point.z);
    if (zone === "outside") return { label: "Outside the Office", kind: "outside", locatable: reachable };
  }

  if (place) return { label: deps.roomName(place), kind: "room", locatable: reachable };

  // Live, indoors, and in no room the manifest names — a corridor or the open floor. Deliberately coarse
  // rather than absent: "we do not know" would be false, they are demonstrably in the office.
  return { label: "In the Office", kind: "office", locatable: reachable };
}

/** The same answer for a whole roster, keyed by email. */
export function resolveEmployeeLocations<T extends EmployeeLocationInput & { email: string }>(
  people: readonly T[],
  deps: EmployeeLocationDeps,
): Record<string, EmployeeLocation> {
  const out: Record<string, EmployeeLocation> = {};
  for (const p of people) out[p.email] = resolveEmployeeLocation(p, deps);
  return out;
}
