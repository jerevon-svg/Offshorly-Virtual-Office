// vo3d interact — automatic sliding door: Closed → Opening → Open → Closing → Closed.
// Data comes from the entity's `door` capability; the door's VIEW is the moving carrier. The door never owns
// or moves the avatar: navigation keeps driving Bon along ONE continuous route, the door reacts to it —
// it opens when Bon's remaining route will pass through the leaf's sweep band, holds while his body is in
// that band, and closes only after he has cleared it. The leaf position is always derived from the exact
// closed transform + slide · ease(t), so every cycle returns to the closed transform with zero drift.
import type * as THREE from "three";
import { circleOverlapsRect, type Rect, type Vec2 } from "../core/coords";
import type { DoorCapability } from "../world/WorldState";

export type DoorState = "closed" | "opening" | "open" | "closing";

const smooth = (t: number): number => t * t * (3 - 2 * t); // smoothstep: eases in and out, C1 on reversal

/** does the segment a→b touch `rect` (axis-aligned slab test)? */
export function segmentHitsRect(a: Vec2, b: Vec2, rect: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const [p, q] of [[-dx, a.x - rect.x], [dx, rect.x + rect.w - a.x], [-dz, a.z - rect.z], [dz, rect.z + rect.d - a.z]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

export class SlidingDoor {
  state: DoorState = "closed";
  /** 0 = closed … 1 = open (linear time parameter; the leaf follows smoothstep(t)) */
  t = 0;
  private hold = 0;
  private readonly view: THREE.Object3D;
  private readonly closed: Vec2;
  readonly spec: DoorCapability;
  /** how many full open→close cycles completed (diagnostics) */
  cycles = 0;

  constructor(view: THREE.Object3D, spec: DoorCapability, closed: Vec2) {
    this.view = view; this.spec = spec; this.closed = { x: closed.x, z: closed.z };
    this.apply();
  }
  get offset(): number { return this.spec.slideDistance * smooth(this.t); }
  get openPosition(): Vec2 { return { x: this.closed.x + this.spec.slide.x * this.spec.slideDistance, z: this.closed.z + this.spec.slide.z * this.spec.slideDistance }; }
  get leafPosition(): Vec2 { return { x: this.view.position.x, z: this.view.position.z }; }
  /** distance of the leaf from the exact closed transform (meaningful while `state === "closed"`) */
  driftError(): number { return Math.hypot(this.view.position.x - this.closed.x, this.view.position.z - this.closed.z); }

  bodyInCrossing(bon: Vec2): boolean { return circleOverlapsRect(bon, this.spec.clearance.bodyRadius, this.spec.crossing); }
  /** open now? body in the sweep band, or approaching with a route that will pass through it */
  wantsOpen(bon: Vec2, path: readonly Vec2[]): boolean {
    if (this.bodyInCrossing(bon)) return true;
    if (!circleOverlapsRect(bon, this.spec.clearance.bodyRadius, this.spec.trigger)) return false;
    const band = { x: this.spec.crossing.x - this.spec.clearance.bodyRadius, z: this.spec.crossing.z - this.spec.clearance.bodyRadius, w: this.spec.crossing.w + 2 * this.spec.clearance.bodyRadius, d: this.spec.crossing.d + 2 * this.spec.clearance.bodyRadius };
    let prev = bon;
    for (const p of path) { if (segmentHitsRect(prev, p, band)) return true; prev = p; }
    return false;
  }

  /** Step by dt seconds given Bon's world position and his remaining navigation route. Moves only the door. */
  update(dt: number, bon: Vec2, path: readonly Vec2[]): void {
    const inBand = this.bodyInCrossing(bon);
    const want = inBand || this.wantsOpen(bon, path);
    const { openMs, closeMs, holdMs } = this.spec.timings;
    switch (this.state) {
      case "closed":
        if (want) this.state = "opening";
        break;
      case "opening": // always completes: a door half-opened for an abandoned approach finishes, holds, then closes
        this.t = Math.min(1, this.t + (dt * 1000) / openMs);
        if (this.t >= 1) { this.state = "open"; this.hold = 0; }
        break;
      case "open":
        if (want) this.hold = 0;
        else if ((this.hold += dt * 1000) >= holdMs) this.state = "closing";
        break;
      case "closing":
        if (want) { this.state = "opening"; break; } // reverse from the current position: never closes onto a body
        this.t = Math.max(0, this.t - (dt * 1000) / closeMs);
        if (this.t <= 0) { this.state = "closed"; this.cycles++; }
        break;
    }
    this.apply();
  }
  reset(): void { this.state = "closed"; this.t = 0; this.hold = 0; this.apply(); }
  private apply(): void {
    const o = this.offset;
    this.view.position.x = this.closed.x + this.spec.slide.x * o;
    this.view.position.z = this.closed.z + this.spec.slide.z * o;
  }
}
