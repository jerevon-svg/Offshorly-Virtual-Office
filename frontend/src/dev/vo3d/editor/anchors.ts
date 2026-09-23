// vo3d editor — THE ANCHOR TRANSFORM MODEL. Slice 2's answer to "why is a chair locked?".
//
// Slice 1 refused every functional piece because its gameplay anchors — the stand-here cell, the pre-seat
// gap point, the walked waypoints, the seated facing — are authored in WORLD coordinates. Move the chair
// and the anchors stay behind, so the interaction silently breaks. The fix is NOT to re-author eleven
// rooms in local space: it is to record, once, the transform those world anchors were authored AGAINST,
// and then carry them with the entity.
//
//   binding = { base: the transform the anchors were authored at, caps: the anchors as authored }
//   moving to `next` ⇒ every anchor POINT is rotated about `base.pos` by (next.yaw − base.yaw) and
//                      translated by (next.pos − base.pos); every anchor DIRECTION is rotated; every
//                      anchor YAW gains the same delta.
//
// Because every retarget is computed from the ORIGINAL authored values rather than from the last result,
// a hundred drags accumulate no float drift, and an undo back to the original transform reproduces the
// original anchors EXACTLY. Local-space offsets the rooms already author (cushionLocal, contactLocal,
// sitDepth, cushionTopY) are untouched — they are relative to the piece and always were.
//
// No THREE here, no gameplay decision here: this is a pure coordinate re-expression of data the rooms
// already wrote. The interaction controllers are unchanged — they read `capabilities` when a sit starts,
// and they now read the retargeted values.
import type { Vec2 } from "../core/coords";
import type {
  ApproachCapability, Capabilities, Entity, LoungeSeatCapability, LoungeSeatSlot, SeatCapability, Transform2,
} from "../world/WorldState";

/** the authored frame an entity's world-space anchors belong to */
export type AnchorBinding = { base: Transform2; caps: Capabilities };

/** Capabilities carrying WORLD-space anchors this module knows how to carry along with a transform. */
export const hasAnchors = (c: Capabilities): boolean => Boolean(c.seat || c.lounge || c.approach);

/** Capabilities carrying world anchors this module does NOT know how to move. A door's slide axis,
 *  crossing band and clearance solids are architecture, not furnishing — they are refused upstream
 *  (editor/editable.ts) and named here so the two rules can never disagree. */
export const hasUnmovableAnchors = (c: Capabilities): boolean => Boolean(c.door || c.clearance);

/** Record the frame an entity's anchors were authored in. Call ONCE per entity, before its first edit. */
export function bindAnchors(e: Entity): AnchorBinding {
  return { base: { pos: { ...e.transform.pos }, yaw: e.transform.yaw }, caps: e.capabilities };
}

const rot = (v: Vec2, s: number, c: number): Vec2 => ({ x: v.x * c + v.z * s, z: -v.x * s + v.z * c });

/** The authored capabilities re-expressed for `next`. Returns the SAME object when nothing moves, so a
 *  no-op commit writes no new capability bag. */
export function retargetAnchors(binding: AnchorBinding, next: Transform2): Capabilities {
  const caps = binding.caps;
  if (!hasAnchors(caps)) return caps;
  const dYaw = next.yaw - binding.base.yaw;
  const dx = next.pos.x - binding.base.pos.x, dz = next.pos.z - binding.base.pos.z;
  if (dYaw === 0 && dx === 0 && dz === 0) return caps;
  // yaw is measured the way core/coords measures facing (model forward +z at yaw 0), so a point turns by
  // the SAME convention the mirror turns the mesh by — otherwise a rotated chair's seat would mirror.
  const s = Math.sin(dYaw), c = Math.cos(dYaw);
  const point = (p: Vec2): Vec2 => {
    const r = rot({ x: p.x - binding.base.pos.x, z: p.z - binding.base.pos.z }, s, c);
    return { x: next.pos.x + r.x, z: next.pos.z + r.z };
  };
  const dir = (v: Vec2): Vec2 => rot(v, s, c);
  const out: Capabilities = { ...caps };
  if (caps.seat) out.seat = retargetSeat(caps.seat, point, dir, dYaw);
  if (caps.lounge) out.lounge = retargetLounge(caps.lounge, point, dYaw);
  if (caps.approach) out.approach = retargetApproach(caps.approach, point, dYaw);
  return out;
}

function retargetSeat(s: SeatCapability, point: (p: Vec2) => Vec2, dir: (v: Vec2) => Vec2, dYaw: number): SeatCapability {
  return {
    ...s,
    approach: point(s.approach),
    preSeat: point(s.preSeat),
    approachToSeat: s.approachToSeat.map(point),
    pullDir: dir(s.pullDir),
    seatedYaw: s.seatedYaw + dYaw,
    // cushionLocal / sitDepth / cushionTopY are CHAIR-LOCAL and ride the mesh; pullDistance, seatedTuck
    // and the timings are scalars. None of them is a world coordinate, so none of them moves.
  };
}
function retargetLounge(l: LoungeSeatCapability, point: (p: Vec2) => Vec2, dYaw: number): LoungeSeatCapability {
  const slots: LoungeSeatSlot[] = l.slots.map((slot) => ({
    ...slot,
    approach: point(slot.approach),
    approachToSeat: slot.approachToSeat.map(point),
    seatedYaw: slot.seatedYaw + dYaw,
    // contactLocal is furniture-local — it is exactly what does NOT move
  }));
  return { slots };
}
function retargetApproach(a: ApproachCapability, point: (p: Vec2) => Vec2, dYaw: number): ApproachCapability {
  return { ...a, point: point(a.point), yaw: a.yaw + dYaw };
}

/** Every world-space GROUND anchor an entity's retargeted capabilities would put a body on. The editor
 *  validates these as floor points, because a chair whose stand-here cell has landed inside a wall is a
 *  chair nobody can sit on — and that failure is invisible until someone tries. */
export function groundAnchors(caps: Capabilities): Vec2[] {
  const out: Vec2[] = [];
  if (caps.seat) out.push(caps.seat.approach, caps.seat.preSeat, ...caps.seat.approachToSeat);
  if (caps.lounge) for (const s of caps.lounge.slots) out.push(s.approach, ...s.approachToSeat);
  if (caps.approach) out.push(caps.approach.point);
  return out;
}
