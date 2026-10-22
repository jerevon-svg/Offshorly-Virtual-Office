// vo3d world — SHARED E-SCOOTERS: the two stations and the scooter's rider-facing proportions. Pure data;
// no THREE. build/exterior draws the racks, player/ScooterMotion moves the rider, app/world.ts mounts and
// dismounts.
//
// WHERE A SCOOTER MAY GO (Phase 4) is no longer authored here: the old Reception→Lab corridor of rects is
// retired, and a rider goes wherever world/exteriorGround's RIDE profile allows — the same ground model a
// walker uses, at a speed set by the surface.
//
// THE STATIONS. A four-dock rack against the façade planting east of the Reception door — out of the
// walking line, on the way to the Lab — and a two-dock rack beside the rear path where the walk turns in
// to the Lab. Dismounting anywhere returns the scooter to its home dock (V1).
import type { Rect, Vec2 } from "../core/coords";
import { PATH_W, PATH_IN } from "./ailab";

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
  // LAB: parallel to the rear path along its north edge, just east of the turn in to the Lab. The rack's
  // row runs ALONG the path (base yaw 0), its rail and totem on the path's north edge, a charging post
  // beside each scooter; the scooters lie end to end along the path, clear of the rail.
  const lz = PATH_W.z + 12, lx0 = PATH_IN.x + PATH_IN.w + 34;
  const lab: ScooterDock[] = [0, 1].map((i) => ({ id: `scooter-l${i + 1}`, station: "lab" as const, x: lx0 + i * 46, z: lz, yaw: Math.PI / 2, mount: { x: lx0 + i * 46, z: lz + 16 } }));
  return [
    { id: "reception", docks: reception, base: { x: rx0 + (1.5 * DOCK_PITCH), z: rz, yaw: 0, count: 4, spacing: DOCK_PITCH } },
    // the rail sits 20 north of the base (build/vehicles scooterDockGeos), so this puts it 2 inside the path's edge
    { id: "lab", docks: lab, base: { x: lx0 + 23, z: PATH_W.z + 22, yaw: 0, count: 2, spacing: 46 } },
  ];
}

/** where the avatar's feet stand above the ground while riding — the deck top */
export const DECK_TOP = 6.2;

/** THE SCOOTER'S RIDER-FACING PROPORTIONS — one authority. build/vehicles draws the scooter from these,
 *  avatar/riderPose reaches for its grips, and app/world places the ridden one under the rider's feet.
 *
 *  Sized to the chibi cast, not to a human: measured over all ten roster rigs, a shoulder stands 15–17.6
 *  above the feet and an arm reaches only 6.4–8 to the wrist (+1.9–3.1 to the palm), so the bar sits 12.5
 *  above the deck, the grips at ±5.6, the stem raked back ~15° towards the rider, and the wheelbase is 22
 *  (a shared e-scooter is about two thirds of its rider's height). Scooter frame: nose toward −z. */
export const SCOOTER_GEOMETRY = {
  wheelR: 4.4,
  frontZ: -11.5,
  rearZ: 10.5,
  /** where the stem leaves the fork */
  stemBase: { y: 11, z: -11.1 },
  /** the handlebar's centre */
  bar: { y: 18.7, z: -9 },
  /** each grip's centre, either side of the bar */
  gripX: 5.6,
  /** where a rider's feet stand along the deck (the ridden scooter is placed so this is under them) */
  footZ: -0.3,
} as const;

/** a point in the scooter's frame, in the RIDER's frame: feet at the origin on the deck, facing +z. The rider
 *  is the scooter turned half a revolution about y (their yaw is π − h to the scooter's −h). */
export const scooterToRider = (p: { x: number; y: number; z: number }): { x: number; y: number; z: number } =>
  ({ x: -p.x, y: p.y - DECK_TOP, z: SCOOTER_GEOMETRY.footZ - p.z });

/** THE RIDER'S VIEW OF THE SCOOTER: both grip centres (left/right as the rider sees them — the rider's left is
 *  +x in their own frame) and the pivot the deck leans about (the scooter's origin, on the ground). */
export const RIDER_GRIPS = (() => {
  const { bar, gripX } = SCOOTER_GEOMETRY;
  return {
    left: scooterToRider({ x: -gripX, y: bar.y, z: bar.z }),
    right: scooterToRider({ x: gripX, y: bar.y, z: bar.z }),
    pivot: scooterToRider({ x: 0, y: 0, z: 0 }),
  };
})();

/** where the ridden scooter's origin goes so its `footZ` stands under a rider at `pos` riding heading `h`
 *  (the camera convention, forward = (sin h, −cos h); the scooter model's yaw is −h) */
export function riddenScooterOrigin(pos: Vec2, h: number): Vec2 {
  const f = SCOOTER_GEOMETRY.footZ;
  return { x: pos.x + f * Math.sin(h), z: pos.z - f * Math.cos(h) };
}

// ============================= WHO HAS WHICH SCOOTER (S1) =======================================
// The server decides (backend app/services/scooter_registry.py, by these same dock ids); the world asks
// through the host and draws what it is told. Types only — no transport lives here.

/** the server's states: in the rack, ridden, standing away from the rack, fallen (reserved) */
export type ScooterServerState = "docked" | "ridden" | "standing" | "fallen";

/** ONE SCOOTER as the world needs it: its state, and whether THIS employee is the rider */
export interface Vo3dScooterState {
  id: string;
  state: ScooterServerState;
  mine: boolean;
  /** S5 — where a fallen (or standing) scooter lies, and the way it points (the ride heading) */
  at?: { x: number; z: number; yaw: number } | null;
  /** S5 — the accident a fallen scooter belongs to */
  accident?: string | null;
}

// ---- S2: the rider's pose on the wire (app/riderStream sends and interpolates it) ----------------------
/** what a rider looks like at one moment: on the ground at (x, z), deck at y, pointing `heading` (the ride
 *  convention: forward = (sin h, -cos h)), at `speed`, rolled by `lean`, pitched by `pitch` */
export interface RiderPose {
  x: number; z: number; y: number;
  heading: number; speed: number; lean: number; pitch: number;
  /** S3 drifting — reserved, passed through */
  fx?: ScooterFx;
}

/** RESERVED FOR S3 DRIFTING: the same keys the server validates (scooter_registry.valid_pose) */
export interface ScooterFx { drift?: -1 | 0 | 1; charge?: number; slip?: number; boost?: boolean }

/** one sample on the wire, as sent (the server adds `rider` and `serverTime` when it relays it) */
export interface ScooterPoseSample extends RiderPose {
  scooterId: string;
  seq: number;
  /** the sender's clock, ms */
  t: number;
}
export interface RelayedScooterPose extends ScooterPoseSample { rider: string }

/** HOW THE WORLD ASKS. `claim` resolves once the server has answered (or the ask timed out); nothing rides
 *  before it says yes. `release` is fire-and-forget: the server broadcasts the result to everybody. */
export interface Vo3dScooterAuthority {
  /** `at` (S7): riding the scooter this rider lifted, from where they stand beside it */
  claim(id: string, at?: { x: number; z: number } | null): Promise<{ ok: boolean; reason?: string }>;
  release(id: string): void;
  /** S2 — this body's ride, ~10 a second, while it holds the scooter (the server relays it to everybody) */
  sendPose?(sample: ScooterPoseSample): void;
  /** S5 — this rider hit a car: the server's verdict (a confirmed one also arrives as the scooter falling) */
  reportAccident?(r: { scooterId: string; loop: string; vehicle: number; x: number; z: number; heading: number; speed: number; t: number; closing: number }): Promise<{ ok: boolean; reason?: string }>;
  /** S6 — how far this rider's world lets their own accident's throws go (world/accidentMotion chooseReach) */
  reportAccidentReach?(id: string, reach: { rider: { k: number; turn: number }; scooter: { k: number; turn: number } }): void;
  /** S7 — E beside this rider's own fallen scooter: lift it (the server's verdict; a granted lift arrives for everybody) */
  liftAccident?(id: string, at: { x: number; z: number }): Promise<{ ok: boolean; reason?: string }>;
}
