// vo3d app — GO TOGETHER: WHERE THE OTHER PARTY MEMBERS STAND IN THIS BROWSER'S LIFT CAR.
//
// The elevator is local to every browser (interact/FloorTransition): one car, one rider — the viewer. A party
// that departs together therefore shares a RIDE MANIFEST instead of a car: `party_depart` names who left
// together, and every one of those browsers stands the OTHER members in its own car, in their own
// characters (world/Coworkers riders). Nothing about the car is networked; these are local slots.
//
// THE SLOTS ARE RELATIVE TO THE RIDER'S MARK, and that is the whole trick of the exit: the car's front bay is
// an exact copy of every floor's lift vestibule (rooms/elevator.ts), and the local body crosses between them
// by a pure translation (toCabin). A rider standing at mark + rel in the car stands at mark + rel in the
// destination vestibule after the same translation — so the group that rode together is still standing
// together when the doors open. Only the slots INSIDE the bay exist in a vestibule; the deeper car slots are
// retired at the alight, with the doors shut.
//
// Geometry (rooms/elevator.ts): the bay is 60 deep along x (doors at +x) and 74 wide along z; the mark sits
// MARK_SETBACK = 28 in from the doors and MARK_OFFSET = 12 off-centre, so relative to the mark the bay spans
// x ∈ [-32, +28] and z ∈ [-25, +49]; the car proper extends x to -112 and z to [-53, +77]. The ride's
// third-person camera sits on the mark's own line (z = 0) behind the body, so no slot is placed on that line.
import type { Vec2 } from "../core/coords";

export interface LiftRiderSlot {
  rel: Vec2;
  /** inside the front bay — i.e. it also exists in a floor's vestibule, and survives the alight */
  inBay: boolean;
}

/** In fill order: beside the rider, then behind to either side, then the deeper car. Every centre is at
 *  least 24 from the mark and from every other (two body radii plus room), and 8 clear of a wall. */
export const LIFT_RIDER_SLOTS: readonly LiftRiderSlot[] = [
  { rel: { x: 0, z: 24 }, inBay: true },
  { rel: { x: -20, z: -16 }, inBay: true },
  { rel: { x: -18, z: 41 }, inBay: true },
  { rel: { x: -48, z: 28 }, inBay: false },
  { rel: { x: -48, z: -30 }, inBay: false },
  { rel: { x: -48, z: 56 }, inBay: false },
  { rel: { x: -74, z: 28 }, inBay: false },
  { rel: { x: -74, z: -30 }, inBay: false },
  { rel: { x: -74, z: 56 }, inBay: false },
];

/** Facing the doors (+x), in the avatar's own yaw convention (world facePlayer: atan2(look.x, look.z)). */
export const LIFT_RIDER_YAW = Math.atan2(1, 0);

export const slotPoint = (mark: Vec2, slot: LiftRiderSlot): Vec2 => ({ x: mark.x + slot.rel.x, z: mark.z + slot.rel.z });

/** The walk out of a vestibule for a rider in `slot`: to the doorway's centre line, through it, then out to
 *  a spot beside the lift's own boarding point — fanned by the slot's side so nobody lands on anybody. */
export function exitPath(slot: LiftRiderSlot, doorway: { x: number; z: number; w: number; d: number }, boarding: Vec2): Vec2[] {
  const cz = doorway.z + doorway.d / 2;
  const lane = Math.max(-10, Math.min(10, slot.rel.z * 0.3));
  return [
    { x: doorway.x - 6, z: cz + lane },
    { x: doorway.x + doorway.w + 10, z: cz + lane },
    { x: boarding.x + 16, z: boarding.z + slot.rel.z },
  ];
}

export function pathLength(from: Vec2, path: readonly Vec2[]): number {
  let d = 0;
  let a = from;
  for (const b of path) {
    d += Math.hypot(b.x - a.x, b.z - a.z);
    a = b;
  }
  return d;
}
