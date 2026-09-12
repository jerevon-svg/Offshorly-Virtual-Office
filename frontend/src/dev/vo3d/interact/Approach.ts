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

  constructor(avatar: Avatar, stack: ControllerStack, requestWalk: (to: Vec2) => NavResult) {
    this.avatar = avatar;
    this.stack = stack;
    this.requestWalk = requestWalk;
  }
  get ownsAvatar(): boolean {
    return this.state === "turning";
  }

  /** Begin an approach. Returns the nav result so the caller can hand the route to its walk controller. */
  begin(spec: ApproachCapability): NavResult {
    const result = this.requestWalk(spec.point);
    if (!result.ok) {
      this.state = "idle";
      this.spec = null;
      this.route = [];
      this.status = `unreachable: ${result.reason}`;
      return result;
    }
    this.spec = spec;
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
    }
  }
}
