// vo3d interact — APPROACH: walk to a declared standing point and turn to face the thing you came for.
// The lightest member of the same family as SeatInteraction: data comes from the entity's `approach`
// capability, navigation does the walking (the controller never teleports the avatar), and the avatar is
// OWNED ("Interaction") only while turning, so a click-to-walk can still interrupt an approach.
//
// Deliberately NOT a new framework: it reuses ControllerStack ownership, planWalk routing and the same
// capability-on-an-entity shape the seat and door interactions already use.
import type { Avatar } from "../avatar/Avatar";
import type { ControllerStack } from "../avatar/Controller";
import { stepAngle, type Vec2 } from "../core/coords";
import type { NavResult } from "../nav/planner";
import type { ApproachCapability } from "../world/WorldState";

export type ApproachState = "idle" | "walking" | "turning" | "arrived";

const TURN_RATE = 4.2; // rad/s — the same unhurried turn the navigation controller uses

export class ApproachInteraction {
  state: ApproachState = "idle";
  status = "idle";
  private readonly avatar: Avatar;
  private readonly stack: ControllerStack;
  private readonly requestWalk: (to: Vec2) => NavResult;
  /** set while walking so the caller can drive its own navigation controller with this route */
  route: Vec2[] = [];
  spec: ApproachCapability | null = null;
  /** PHASE 7E — WHICH ENTITY THIS APPROACH IS AIMED AT, when the caller named one.
   *
   *  The capability alone cannot answer that: `spec` is the walk-up point and a human label, and two
   *  entities may legitimately share a label. Carrying the id HERE rather than in the caller is what makes
   *  the lifecycle correct by construction — every existing `cancel()` call site (a click-to-walk, a sit,
   *  a portal, the editor) clears it without knowing it exists, and a refused walk never sets it. */
  private targetId: string | null = null;
  /** PHASE 7E — FIRED ONCE, at the instant the turn completes and the state becomes `arrived`.
   *
   *  Only for an approach that was given an entity id. It is a NOTIFICATION, not a dispatch: this class
   *  has no idea what the caller does with it, which is the same line app/interactions.ts draws for a
   *  coworker selection. Set by app/world.ts; null on the standalone dev page, where nobody is listening.
   *
   *  IT CANNOT DOUBLE-FIRE. The transition below leaves `turning`, and `update()` returns immediately in
   *  every other state — so the frames that keep arriving after an arrival do nothing. A second call is a
   *  second `begin()`, which is a second approach and genuinely is a second arrival. */
  onArrivedAtTarget: ((entityId: string) => void) | null = null;

  constructor(avatar: Avatar, stack: ControllerStack, requestWalk: (to: Vec2) => NavResult) {
    this.avatar = avatar;
    this.stack = stack;
    this.requestWalk = requestWalk;
  }
  get ownsAvatar(): boolean {
    return this.state === "turning";
  }

  /** Begin an approach. Returns the nav result so the caller can hand the route to its walk controller.
   *
   *  `entityId` is optional and purely for the arrival notification (PHASE 7E) — an approach without one
   *  behaves exactly as it always has. */
  begin(spec: ApproachCapability, entityId: string | null = null): NavResult {
    const result = this.requestWalk(spec.point);
    if (!result.ok) {
      this.state = "idle";
      this.spec = null;
      this.targetId = null;
      this.route = [];
      this.status = `unreachable: ${result.reason}`;
      return result;
    }
    this.spec = spec;
    this.targetId = entityId;
    this.route = result.path.slice();
    this.state = "walking";
    this.status = `walking to ${spec.label}`;
    return result;
  }

  /** Call when the walk controller reports arrival at the approach point. */
  onArrived(): void {
    if (this.state !== "walking") return;
    this.state = "turning";
    this.stack.acquire("Interaction");
    this.status = `facing ${this.spec?.label ?? ""}`;
  }

  cancel(): void {
    if (this.state === "turning") this.stack.release("Interaction");
    this.state = "idle";
    this.spec = null;
    this.targetId = null;
    this.route = [];
    this.status = "idle";
  }

  /** Turn toward the declared facing. No allocation, no geometry. */
  update(dt: number): void {
    if (this.state !== "turning" || !this.spec) return;
    const next = stepAngle(this.avatar.yaw, this.spec.yaw, TURN_RATE * dt);
    this.avatar.setYaw(next);
    let d = this.spec.yaw - next;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) < 0.02) {
      this.avatar.setYaw(this.spec.yaw);
      this.stack.release("Interaction");
      this.state = "arrived";
      this.status = `at ${this.spec.label}`;
      // PHASE 7E — LAST, and only once the state has already moved on: a listener that cancels or starts
      // another approach from inside this callback must not have its work undone by the lines above.
      const arrived = this.targetId;
      if (arrived) this.onArrivedAtTarget?.(arrived);
    }
  }
}
