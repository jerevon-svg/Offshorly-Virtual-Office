// vo3d app — THE FLOOR REGISTRY. Which floors this building has, what each one is called on the
// movement wire, and which camera experiences it supports.
//
// A LEAF, on purpose. It imports one TYPE and nothing else, so it can be read by the world (which must
// stay loadable with no V1 module in its graph — app/world.ts's standing rule), by the React overlay,
// and by a test, without dragging either side's dependencies to the other.
//
// WHY A REGISTRY AND NOT `if (onFloor2)`. The ground floor is the office, the second floor is meetings,
// and the third will be gaming. Nothing below names floor 2 except its own row: the transition, the
// presence filter, the view rules and the HUD all read THIS table, so adding a floor is adding a row
// plus its geometry — not editing a state machine.
//
// THE GROUND FLOOR IS SPECIAL IN EXACTLY ONE WAY, and it is worth being explicit: it is the one floor
// that lives inside V1's own 1440 x 1244 coordinate frame. Every other floor stands in its own world
// space beyond that frame (the same trick rooms/cave.ts explains, for the same reason: V1's walkability
// grid is READ-ONLY and covers the ground floor alone). That is why `placeId` is null for it — V1 can
// hold a real position for a body down here and needs no extra word for it — and a string for every
// floor above, which is the name that rides the movement wire beside the last in-frame point.
import type { Vo3dViewMode } from "./viewMode";

export type Vo3dFloorId = "floor-1" | "floor-2";

export interface Vo3dFloorSpec {
  id: Vo3dFloorId;
  /** The floor's name on V1's movement wire, or null for the ground floor (V1's own frame describes it).
   *  A roomId is any string server-side (socket.py's `_is_room_id`), so this needs no backend change and
   *  collides with no V1 room id — the same terms the Cave and the AI Lab are already carried on. */
  placeId: string | null;
  /** what the building calls it */
  name: string;
  /** the two characters the elevator's floor indicator shows */
  indicator: string;
  /** THE VIEWS THIS FLOOR OFFERS. The ground floor has all three; a floor that stands in its own world
   *  space has no exterior, no campus and no sky around it, so free orbit would show it as a slab
   *  floating in the void — 3D EXPLORE is therefore not offered above the ground floor. */
  viewModes: readonly Vo3dViewMode[];
}

export const GROUND_FLOOR_ID: Vo3dFloorId = "floor-1";

export const FLOORS: Record<Vo3dFloorId, Vo3dFloorSpec> = {
  "floor-1": { id: "floor-1", placeId: null, name: "Office", indicator: "01", viewModes: ["office", "explore", "player"] },
  "floor-2": { id: "floor-2", placeId: "floor-2", name: "Meetings", indicator: "02", viewModes: ["office", "player"] },
};

/** Bottom to top. The elevator reads this to know what it can offer and in which direction it travels. */
export const FLOOR_ORDER: readonly Vo3dFloorId[] = ["floor-1", "floor-2"];

export const floorSpec = (id: Vo3dFloorId): Vo3dFloorSpec => FLOORS[id];

/** Does this floor offer that camera experience at all? */
export const supportsViewMode = (floor: Vo3dFloorId, mode: Vo3dViewMode): boolean => FLOORS[floor].viewModes.includes(mode);

/** THE VIEW A FLOOR FALLS BACK TO when the one you were in is not offered here.
 *
 *  PLAYER, deliberately, and not OFFICE: the views a floor withholds are the LOOKED-AT ones, and the
 *  answer to "you cannot orbit here" is the experience that is closest to what the person was doing —
 *  moving a body through a space — rather than the one that is furthest from it. It is also the view the
 *  employee is already in at that moment, because the ride itself is played in PLAYER framing. */
export const FALLBACK_VIEW_MODE: Vo3dViewMode = "player";

/** WHICH VIEW TO RESTORE ON ARRIVAL: the one you were in, if the destination offers it, else the
 *  fallback. Ground OFFICE -> Floor 2 OFFICE, ground PLAYER -> Floor 2 PLAYER, ground 3D -> Floor 2
 *  PLAYER, and the same rule unchanged in the other direction. */
export function arrivalViewMode(previous: Vo3dViewMode, destination: Vo3dFloorId): Vo3dViewMode {
  return supportsViewMode(destination, previous) ? previous : FALLBACK_VIEW_MODE;
}

/** WHICH FLOOR A `place` NAME MEANS. Anything this table does not name — no place at all, the
 *  Championship Cave, the AI Lab — is on the GROUND floor, which is the truth: both of those are reached
 *  from it and both of them are already filtered by their own rules (app/coworkers.ts). */
export function floorOfPlace(place?: string | null): Vo3dFloorId {
  const p = place?.trim();
  if (!p) return GROUND_FLOOR_ID;
  for (const id of FLOOR_ORDER) if (FLOORS[id].placeId === p) return id;
  return GROUND_FLOOR_ID;
}

/** WHO IS ON THE FLOOR THE VIEWER IS ON — the roster the world should actually draw.
 *
 *  The same rule, and the same signal, as app/coworkers.ts's `coworkersInSameVolume`: draw the people
 *  who are in the volume you are in, off the `place` the movement feed already publishes. Nothing new is
 *  computed, carried or networked, and nothing about presence is redesigned — a floor is simply one more
 *  named place, exactly as the Cave is.
 *
 *  This is what stops somebody being drawn standing on the ground floor while they are upstairs. */
export function coworkersOnFloor<T extends { place?: string }>(list: readonly T[], floor: Vo3dFloorId): T[] {
  return list.filter((c) => floorOfPlace(c.place) === floor);
}
