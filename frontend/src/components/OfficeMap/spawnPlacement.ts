import type { CheckoutState } from "../../data/checkoutState";
import type { Seat } from "../../data/roomSeats";
import type { AttendanceStatus } from "../../services/attendance";
import type { Facing, Pt } from "../../services/presence/movementSync";

// Pure decision for where the viewer's own avatar first appears on load.
// Attendance (server-authoritative work session) gates every interior
// placement: a persisted interior position (employee_positions, delivered via
// movement-sync's positions_snapshot) is only VALID while CHECKED_IN, and only
// when it still passes the same geometry/lock checks a live walk would.
export type AttendanceView = AttendanceStatus | "UNKNOWN";

export interface SelfStableSnapshot {
  pos: Pt; // avatar top-left, as persisted by walk_arrived
  facing: Facing;
  state: string;
  seatKey: string | null;
  roomId: string | null;
}

/** Validators injected by the caller so this module stays pure. `center` is
 * the avatar's center point (pos + half size), the same point every room /
 * grid lookup in OfficeMap uses. */
export interface PlacementContext {
  avatarSize: { w: number; h: number };
  /** Inside any office room layer (incl. the Central Hub) — false on the sidewalk. */
  isInsideOffice(center: Pt): boolean;
  /** The grid cell under `center` is walkable (standing restores only). */
  isWalkable(center: Pt): boolean;
  /** The room at `center` is currently DND-locked against the viewer. */
  isRoomLocked(center: Pt): boolean;
  /** The painted seat in the room at `center` whose centroid key matches. */
  findSeat(center: Pt, seatKey: string): Seat | null;
}

export type SpawnPlacement =
  | { kind: "sidewalk" }
  | { kind: "desk" }
  | { kind: "standing"; pos: Pt; facing: Facing }
  | { kind: "seated"; pos: Pt; seat: Seat };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Builds the `isInsideOffice` validator from the manifest's sidewalk/outside
 * layer: everything on the floor that is NOT on the sidewalk counts as inside,
 * so corridors and shared walking areas restore, not just room rects. With no
 * sidewalk layer known, nothing can be proven outside. */
export function insideOfficeValidator(sidewalk: Rect | null): (center: Pt) => boolean {
  return (center) => {
    if (!sidewalk) return true;
    const onSidewalk =
      center.x >= sidewalk.x &&
      center.x <= sidewalk.x + sidewalk.width &&
      center.y >= sidewalk.y &&
      center.y <= sidewalk.y + sidewalk.height;
    return !onSidewalk;
  };
}

/** Reception may offer Check In only while attendance says CHECKED_OUT. The checkout
 * flow may still sit in CHECKED_OUT from an earlier completed checkout today — that is
 * history, not a lock: a confirmed Check In starts a new session (beginNewSession). */
export function canOfferCheckIn(attendance: AttendanceView, checkoutState: CheckoutState): boolean {
  return attendance === "CHECKED_OUT" && (checkoutState === "IDLE" || checkoutState === "CHECKED_OUT");
}

/** Manual self movement (right-click free walk, approach-a-colleague) is allowed only for a
 * CHECKED_IN employee whose onboarding is complete and who is not mid-checkout. CHECKED_OUT and
 * UNKNOWN reject it: Check In is the gate to moving around the office. System-driven walks (the
 * check-in entry walk, checkout exit walk, sidewalk lineup placement) do not go through this. */
export function canSelfFreeWalk(
  attendance: AttendanceView,
  onboardingDone: boolean,
  checkoutBusy: boolean,
): boolean {
  return attendance === "CHECKED_IN" && onboardingDone && !checkoutBusy;
}

function isFinitePt(p: Pt | undefined): p is Pt {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Returns null while attendance is still unknown — the caller must wait
 * rather than guess (guessing is exactly the old spawn-at-desk bug). */
export function resolveSpawnPlacement(
  attendance: AttendanceView,
  checkoutState: CheckoutState,
  self: SelfStableSnapshot | null,
  ctx: PlacementContext,
): SpawnPlacement | null {
  if (attendance === "UNKNOWN") return null;
  // Checked out (or today's checkout already completed locally) → outside,
  // regardless of any old room/desk position on record.
  if (attendance !== "CHECKED_IN" || checkoutState === "CHECKED_OUT") return { kind: "sidewalk" };
  // Checked in: restore the last persisted in-office position when it is
  // still valid; anything stale/unsafe falls back to the own desk.
  if (!self || !isFinitePt(self.pos)) return { kind: "desk" };
  const { w, h } = ctx.avatarSize;
  const center = { x: self.pos.x + w / 2, y: self.pos.y + h / 2 };
  // Outside the building (e.g. refreshed mid check-in walk, or a stale
  // sidewalk record) is never a valid in-office resume point.
  if (!ctx.isInsideOffice(center)) return { kind: "desk" };
  // Never let a reload bypass the DND room-lock gate a walk would hit.
  if (ctx.isRoomLocked(center)) return { kind: "desk" };
  if (self.state === "sitting") {
    const seat = self.seatKey ? ctx.findSeat(center, self.seatKey) : null;
    if (!seat) return { kind: "desk" };
    return { kind: "seated", pos: { x: seat.x - w / 2, y: seat.y - h / 2 }, seat };
  }
  if (!ctx.isWalkable(center)) return { kind: "desk" };
  return { kind: "standing", pos: self.pos, facing: self.facing };
}
