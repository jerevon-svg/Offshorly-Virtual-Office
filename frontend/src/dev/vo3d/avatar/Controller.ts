// vo3d avatar — explicit movement/animation OWNERSHIP. Exactly one owner drives the avatar at a time:
//   Idle        nobody moving it (idle clip)
//   Navigation  the path walker (click-to-walk, redirects)
//   Editor      room edit mode: navigation input is refused while editing
//   Player      direct WASD control (PLAYER camera mode). Outranks Navigation so entering PLAYER cannot be
//               stolen back by a stray click-to-walk, and is OUTRANKED by Interaction so that a seat/approach
//               started FROM player mode still gets the avatar — player/PlayerMode releases and re-acquires
//               around that handoff rather than fighting for it.
//   Guided      a SYSTEM-DRIVEN JOURNEY (Go Together): the path walker, but outranking Player so the body can
//               be walked while PLAYER stays on screen and keeps its camera. Held for the whole journey as
//               the stack's BASE (setBase), so an Interaction that takes the body mid-journey (the lift, an
//               approach, a seat) falls back to Guided on release rather than to Idle.
//   Interaction a state machine (seat) that moves/attaches the root itself
// Acquire/release are explicit; a lower-priority owner cannot take the avatar from a higher one.
import { dist, headingFor, stepAngle, type Vec2 } from "../core/coords";
import { CLIP_IDLE, CLIP_WALK } from "../adapters/v1Avatar";
import type { Avatar } from "./Avatar";

export type Owner = "Idle" | "Navigation" | "Interaction" | "Editor" | "Player" | "Guided";
const PRIORITY: Record<Owner, number> = { Idle: 0, Navigation: 1, Editor: 2, Player: 3, Guided: 4, Interaction: 5 };

export class ControllerStack {
  private current: Owner = "Idle";
  /** What a release falls back to: Idle, or Guided for the length of a guided journey. */
  private base: "Idle" | "Guided" = "Idle";
  get owner(): Owner { return this.current; }
  /** true while a guided journey holds the base (whoever is driving this frame) */
  get guided(): boolean { return this.base === "Guided"; }
  /** true when granted (same owner or higher priority than the current one) */
  acquire(owner: Owner): boolean {
    if (owner === this.current) return true;
    if (PRIORITY[owner] < PRIORITY[this.current]) return false;
    this.current = owner;
    return true;
  }
  release(owner: Owner): void { if (this.current === owner && owner !== this.base) this.current = this.base; }
  /** GUIDED TRAVEL. "Guided" takes the body from anything it outranks (Player, a routed walk) at once and
   *  becomes what every later release falls back to; "Idle" ends it, handing a body Guided was holding back
   *  to Idle — where PLAYER re-acquires it on its next frame, exactly as after a finished seat. */
  setBase(base: "Idle" | "Guided"): void {
    if (base === this.base) return;
    const prev = this.base;
    this.base = base;
    if (base === "Guided") { if (PRIORITY[this.current] < PRIORITY.Guided) this.current = "Guided"; }
    else if (this.current === prev) this.current = "Idle";
  }
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
  /** Replace the destination (redirect). Returns false if another owner holds the avatar. Under Guided the
   *  walker drives WITHOUT taking the body: Guided already holds it, and keeps it between walks. */
  setPath(path: Vec2[]): boolean {
    if (!this.stack.owns("Guided") && !this.stack.acquire("Navigation")) return false;
    this.path = path.filter((p, i) => i === 0 || dist(p, path[i - 1]) > 1e-6);
    if (this.path.length === 0) this.stack.release("Navigation");
    return true;
  }
  stop(): void { this.path = []; this.stack.release("Navigation"); }

  /** Step the queue by dt seconds. Only acts while Navigation (or a guided journey) owns the avatar; under
   *  Guided an empty queue just stands (the release below is a no-op — Guided is the stack's base). */
  update(dt: number): void {
    if (!this.stack.owns("Navigation") && !this.stack.owns("Guided")) return;
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
