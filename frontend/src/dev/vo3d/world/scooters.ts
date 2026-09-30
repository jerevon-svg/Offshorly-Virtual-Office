// vo3d world — SHARED E-SCOOTERS: the two stations and the one route they may be ridden on. Pure data and
// rules; no THREE. build/exterior draws the racks, player/ScooterMotion moves the rider, app/world.ts
// mounts and dismounts.
//
// THE RIDE AREA (V1) is the office's EXISTING exterior circulation and nothing more: the front pavement
// EAST of the Reception door, the apron round the south-east corner, the east flank (LEG_N), the link and
// the rear path (PATH_LINK, PATH_W), and the walk in to the AI Lab up to — not onto — its porch. All of it
// already stands at the walking level, so there is no ramp, no height change and no new ground. It is an
// INTERSECTION with the normal stand test, never a relaxation of it: a rider can only be where a walker
// could stand AND inside one of these rects. By construction it touches no interior, no room, no lift, no
// floor 2, no Cave and no door threshold: every rect lies outside the V1 frame's walls, and the front one
// starts clear of the Reception door's sensor zone.
//
// THE STATIONS. A four-dock rack against the façade planting east of the Reception door — out of the
// walking line, on the way to the Lab — and a two-dock rack beside the rear path where the walk turns in
// to the Lab. Dismounting anywhere returns the scooter to its home dock (V1).
import { pointInRect, type Rect, type Vec2 } from "../core/coords";
import { APRON, LEG_N, PATH_LINK, PATH_W, PATH_IN, PORCH } from "./ailab";

/** A dock: where its scooter stands, and `mount` — the point a rider on the path reaches for it from (the
 *  scooter's path-side end), close enough that "Ride" is offered whichever way the rider is facing. */
export type ScooterDock = { id: string; station: "reception" | "lab"; x: number; z: number; yaw: number; mount: Vec2 };
export type ScooterStation = { id: "reception" | "lab"; docks: ScooterDock[]; base: { x: number; z: number; yaw: number; count: number; spacing: number } };

/** the shared scooters' one colour (the stem, the fender stripes) — a VO accent, no branding */
export const SCOOTER_COLOUR = 0x19b3a5;
/** how far the rack's docks sit apart */
const DOCK_PITCH = 30;

/** The stations, derived from the front pavement (V1's sidewalk rect, passed in because it is V1 data). */
export function scooterStations(sidewalk: Rect): ScooterStation[] {
  // RECEPTION: stems toward the façade (yaw 0 = nose −z = north), in the planted band between the façade
  // and the walking corridor, well east of the door
  const rz = sidewalk.z + 22, rx0 = 1156;
  const reception: ScooterDock[] = [0, 1, 2, 3].map((i) => ({ id: `scooter-r${i + 1}`, station: "reception" as const, x: rx0 + i * DOCK_PITCH, z: rz, yaw: 0, mount: { x: rx0 + i * DOCK_PITCH, z: rz + 24 } }));
  // LAB: parallel to the rear path along its north edge, just east of the turn in to the Lab
  const lz = PATH_W.z + 9, lx0 = PATH_IN.x + PATH_IN.w + 34;
  const lab: ScooterDock[] = [0, 1].map((i) => ({ id: `scooter-l${i + 1}`, station: "lab" as const, x: lx0 + i * 46, z: lz, yaw: Math.PI / 2, mount: { x: lx0 + i * 46, z: lz + 16 } }));
  return [
    { id: "reception", docks: reception, base: { x: rx0 + (1.5 * DOCK_PITCH), z: rz, yaw: 0, count: 4, spacing: DOCK_PITCH } },
    { id: "lab", docks: lab, base: { x: lx0 + 23, z: lz, yaw: Math.PI / 2, count: 2, spacing: 46 } },
  ];
}

/** THE RIDE AREA — see the header. `doorEdgeX` is the east edge of the Reception door's sensor zone. */
export function rideArea(sidewalk: Rect, doorEdgeX: number): Rect[] {
  const front: Rect = { x: doorEdgeX + 36, z: sidewalk.z, w: sidewalk.x + sidewalk.w - (doorEdgeX + 36), d: sidewalk.d };
  // the walk in to the Lab stops where the porch begins: the porch is the Lab's threshold
  const labWalk: Rect = { x: PATH_IN.x, z: PORCH.z + PORCH.d, w: PATH_IN.w, d: PATH_IN.z + PATH_IN.d - (PORCH.z + PORCH.d) };
  return [front, APRON, LEG_N, PATH_LINK, PATH_W, labWalk];
}

/** Is this point inside the ride area? */
export const inRideArea = (area: readonly Rect[], p: Vec2): boolean => area.some((r) => pointInRect(p, r));

/** THE DOCKS A RIDER MUST STEER ROUND — the Lab rack stands along the edge of the rear path. Each is the
 *  parked scooter's own footprint (long along its yaw, thin across), not a circle, so the path beside the
 *  rack stays as wide as it looks. */
export function dockSolids(stations: readonly ScooterStation[]): Rect[] {
  return stations.filter((s) => s.id === "lab").flatMap((s) => s.docks.map((d) => {
    const along = Math.abs(Math.sin(d.yaw)) > 0.5; // yaw PI/2: the scooter lies along x
    const hl = 22, hw = 7;
    return along ? { x: d.x - hl, z: d.z - hw, w: 2 * hl, d: 2 * hw } : { x: d.x - hw, z: d.z - hl, w: 2 * hw, d: 2 * hl };
  }));
}
/** is a body of `radius` at `p` clear of every dock solid? */
export const clearOfDocks = (solids: readonly Rect[], p: Vec2, radius: number): boolean =>
  solids.every((r) => p.x < r.x - radius || p.x > r.x + r.w + radius || p.z < r.z - radius || p.z > r.z + r.d + radius);

/** where the avatar's feet stand above the ground while riding — the deck top */
export const DECK_TOP = 6.2;
