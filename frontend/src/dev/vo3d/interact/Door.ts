// vo3d interact — automatic sliding door: Closed → Opening → Open → Closing → Closed.
// Single-leaf (Design Room) or bi-parting (Reception entrance): one controller, one state machine, one `t`.
// A bi-parting door passes an `opposed` leaf whose offset is the negation of the driving leaf's, so both
// panels are derived from the SAME closed transforms + slide · ease(t) and neither can accumulate drift.
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
  /** DID THE LEAF ACTUALLY MOVE on the last update()? — the shadow map's input, and the reason it is a
   *  flag rather than a state test. A door is a STATIC caster: any frame its leaf moves costs a full
   *  redraw of every static caster in the building (app/world's worldShadowsAreStale → Renderer
   *  .invalidateShadows). But `state !== "closed"` is true for the whole HOLD as well, and a held-open
   *  door is standing perfectly still — those redraws produce a shadow map identical to the last one.
   *  Measured while walking through the Design Room door: 119 of 202 static redraws were held-open
   *  frames. So staleness is derived from the transform that was written, not from the state machine:
   *  `moved` is true on exactly the frames the leaf's offset changed — opening, closing, the frame it
   *  lands closed, and a reset that snaps it back — and false while it is merely open. */
  moved = false;
  /** the offset last written to the leaf, so apply() can tell a move from a re-write of the same pose */
  private applied = 0;

  /** the second, counter-sliding panel of a bi-parting door (null for a single-leaf door) */
  private readonly opposed: { view: THREE.Object3D; closed: Vec2 } | null;

  constructor(view: THREE.Object3D, spec: DoorCapability, closed: Vec2, opposed?: { view: THREE.Object3D; closed: Vec2 }) {
    this.view = view; this.spec = spec; this.closed = { x: closed.x, z: closed.z };
    this.opposed = opposed ? { view: opposed.view, closed: { x: opposed.closed.x, z: opposed.closed.z } } : null;
    this.apply();
  }
  get offset(): number { return this.spec.slideDistance * smooth(this.t); }
  get openPosition(): Vec2 { return { x: this.closed.x + this.spec.slide.x * this.spec.slideDistance, z: this.closed.z + this.spec.slide.z * this.spec.slideDistance }; }
  get leafPosition(): Vec2 { return { x: this.view.position.x, z: this.view.position.z }; }
  /** distance of the leaf from the exact closed transform (meaningful while `state === "closed"`) */
  driftError(): number {
    const a = Math.hypot(this.view.position.x - this.closed.x, this.view.position.z - this.closed.z);
    if (!this.opposed) return a;
    return Math.max(a, Math.hypot(this.opposed.view.position.x - this.opposed.closed.x, this.opposed.view.position.z - this.opposed.closed.z));
  }

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
    this.moved = o !== this.applied;
    this.applied = o;
    this.view.position.x = this.closed.x + this.spec.slide.x * o;
    this.view.position.z = this.closed.z + this.spec.slide.z * o;
    if (this.opposed) {
      this.opposed.view.position.x = this.opposed.closed.x - this.spec.slide.x * o;
      this.opposed.view.position.z = this.opposed.closed.z - this.spec.slide.z * o;
    }
  }
}
