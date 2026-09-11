// vo3d avatar — explicit movement/animation OWNERSHIP. Exactly one owner drives the avatar at a time:
//   Idle        nobody moving it (idle clip)
//   Navigation  the path walker (click-to-walk, redirects)
//   Interaction a state machine (seat) that moves/attaches the root itself
//   Editor      room edit mode: navigation input is refused while editing
// Acquire/release are explicit; a lower-priority owner cannot take the avatar from a higher one.
import { dist, headingFor, stepAngle, type Vec2 } from "../core/coords";
import { CLIP_IDLE, CLIP_WALK } from "../adapters/v1Avatar";
import type { Avatar } from "./Avatar";

export type Owner = "Idle" | "Navigation" | "Interaction" | "Editor";
const PRIORITY: Record<Owner, number> = { Idle: 0, Navigation: 1, Editor: 2, Interaction: 3 };

export class ControllerStack {
  private current: Owner = "Idle";
  get owner(): Owner { return this.current; }
  /** true when granted (same owner or higher priority than the current one) */
  acquire(owner: Owner): boolean {
    if (owner === this.current) return true;
    if (PRIORITY[owner] < PRIORITY[this.current]) return false;
    this.current = owner;
    return true;
  }
  release(owner: Owner): void { if (this.current === owner) this.current = "Idle"; }
  owns(owner: Owner): boolean { return this.current === owner; }
}

/** The Navigation owner: consumes a world-space waypoint queue with turning + walk clip sync. */
export class NavigationController {
  path: Vec2[] = [];
  speed = 30; // units/s — the walk clip stride is authored for this speed
  turnRate = 7; // rad/s (~0.14 s for a 90° turn)
  onArrive: (() => void) | null = null;
  private readonly avatar: Avatar;
  private readonly stack: ControllerStack;
  constructor(avatar: Avatar, stack: ControllerStack) { this.avatar = avatar; this.stack = stack; }

  get moving(): boolean { return this.path.length > 0; }
  /** Replace the destination (redirect). Returns false if another owner holds the avatar. */
  setPath(path: Vec2[]): boolean {
    if (!this.stack.acquire("Navigation")) return false;
    this.path = path.filter((p, i) => i === 0 || dist(p, path[i - 1]) > 1e-6);
    if (this.path.length === 0) this.stack.release("Navigation");
    return true;
  }
  stop(): void { this.path = []; this.stack.release("Navigation"); }

  /** Step the queue by dt seconds. Only acts while Navigation owns the avatar. */
  update(dt: number): void {
    if (!this.stack.owns("Navigation")) return;
    if (this.path.length === 0) { this.avatar.play(CLIP_IDLE); this.stack.release("Navigation"); return; }
    stepAlong(this.avatar, this.path, this.speed, this.turnRate, dt);
    if (this.path.length === 0) {
      this.avatar.play(CLIP_IDLE);
      this.stack.release("Navigation");
      this.onArrive?.();
    } else {
      this.avatar.play(CLIP_WALK);
      this.avatar.setClipTimeScale(CLIP_WALK, this.speed / 30);
    }
  }
}

/** Shared walk step (used by Navigation and by interactions that walk explicit waypoints). Mutates `path`. */
export function stepAlong(avatar: Avatar, path: Vec2[], speed: number, turnRate: number, dt: number): void {
  let remaining = speed * dt;
  const pos = avatar.root.position;
  while (remaining > 0 && path.length > 0) {
    const tgt = path[0];
    const dx = tgt.x - pos.x, dz = tgt.z - pos.z, d = Math.hypot(dx, dz);
    if (d <= remaining) { pos.x = tgt.x; pos.z = tgt.z; remaining -= d; path.shift(); }
    else { pos.x += (dx / d) * remaining; pos.z += (dz / d) * remaining; remaining = 0; }
  }
  const next = path[0];
  if (next) avatar.setYaw(stepAngle(avatar.yaw, headingFor(next.x - pos.x, next.z - pos.z), dt * turnRate));
}
