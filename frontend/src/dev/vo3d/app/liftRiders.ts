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

// ---- Phase 3: ONE SLOT PER PERSON, the same on every browser --------------------------------------------
//
// A party ride used to stand the viewer on the mark and fill the OTHERS into LIFT_RIDER_SLOTS in manifest
// order — so every browser had a different arrangement, and (worse) every body walked in to the SAME mark:
// the real, published bodies of the others converged on one spot while the doors were open, which is the
// "Bon and Jan looked like one body" of the live test. Now each person owns the slot of their place in the
// party's order, on every browser: their own body walks to it (FloorTransition's per-journey slot), their
// rider copy stands in it, their lobby spot lines up in front of it, and their exit fans out from it.

/** Slot 0 is the mark itself; then the rider slots, in the same fill order. */
export const PARTY_LIFT_SLOTS: readonly LiftRiderSlot[] = [{ rel: { x: 0, z: 0 }, inBay: true }, ...LIFT_RIDER_SLOTS];

export interface PartyLiftPlan {
  /** where THIS body stands (relative to the mark) */
  self: LiftRiderSlot;
  /** everybody else riding, each in their own slot */
  riders: { email: string; slot: LiftRiderSlot }[];
}

/** `order` is the party's slot order (its participants); `riding` who is on this ride. Each rider keeps the
 *  slot of their place in `order`. Only the front bay survives the alight with the body, so a viewer whose
 *  own slot is a deep one stands on the mark instead and hands their slot to whoever owns the mark. */
export function partyLiftPlan(order: readonly string[], riding: readonly string[], self: string): PartyLiftPlan {
  const index = (e: string) => order.indexOf(e);
  const k = index(self);
  const own = k >= 0 && PARTY_LIFT_SLOTS[k]?.inBay ? k : 0;
  const riders: PartyLiftPlan["riders"] = [];
  for (const email of riding) {
    if (email === self) continue;
    let i = index(email);
    if (i < 0) continue;
    if (i === own && own !== k) i = k;
    const slot = PARTY_LIFT_SLOTS[i];
    if (slot) riders.push({ email, slot });
  }
  return { self: PARTY_LIFT_SLOTS[own], riders };
}

/** THE LOBBY SPOT in front of the doors for a slot: a row across the doors (z), on the apron the lift boards
 *  from (FloorTransition.canBoardFrom), so the ride starts where the body already stands. Slot 0 is the
 *  lift's own boarding point — a solo ride is unchanged. */
const LOBBY_OFFSETS: readonly Vec2[] = [
  { x: 0, z: 0 }, { x: 0, z: 26 }, { x: 0, z: -26 }, { x: -8, z: 13 }, { x: -8, z: -13 },
  { x: 4, z: 39 }, { x: 4, z: -39 }, { x: -8, z: 36 }, { x: -8, z: -36 }, { x: 4, z: 0 },
];
export function lobbyPoint(boarding: Vec2, slotIndex: number): Vec2 {
  const o = LOBBY_OFFSETS[slotIndex] ?? LOBBY_OFFSETS[0];
  return { x: boarding.x + o.x, z: boarding.z + o.z };
}

/** WHERE SOMEBODY ALREADY ON THE FLOOR WAITS for a party coming up in its lift: out of the arrival lane
 *  (the riders walk out due east through the doorway, rooms/elevator), a few steps back and to either side of
 *  it, facing the doors — first north, then south, then a row further back. */
const WAIT_OFFSETS: readonly Vec2[] = [
  { x: 62, z: -54 }, { x: 62, z: 54 }, { x: 90, z: -54 }, { x: 90, z: 54 }, { x: 118, z: -54 }, { x: 118, z: 54 },
];
export function liftWaitPoint(boarding: Vec2, index: number): Vec2 {
  const o = WAIT_OFFSETS[index % WAIT_OFFSETS.length];
  return { x: boarding.x + o.x, z: boarding.z + o.z };
}

/** The lobby spot of the SLOT a body rides in (a slot is found by identity in PARTY_LIFT_SLOTS). */
export const slotIndexOf = (slot: LiftRiderSlot): number => Math.max(0, PARTY_LIFT_SLOTS.indexOf(slot));
