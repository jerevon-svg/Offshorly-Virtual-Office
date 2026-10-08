// vo3d player — THE JUMP, as pure arithmetic. No THREE, no scene, no clock, no input: it is handed a dt
// and answers how high off the floor the body is. player/PlayerMode owns everything else.
//
// WHY IT IS ONLY VERTICAL, AND WHY THAT IS THE WHOLE SAFETY ARGUMENT. V2 has no physics engine and no
// vertical collision: PlayerBody resolves movement on the FLOOR PLANE against a stand test (walls,
// footprints, door architecture, room access), swept and axis-sliding. A jump that could clear anything
// would need a second, volumetric collision world — exactly the rewrite this was told not to force.
//
// So the jump does not clear anything. Horizontal movement keeps going through PlayerBody.move
// UNCHANGED on every airborne frame, which means every wall, desk, door leaf and access rule applies at
// full height for the whole arc: you cannot jump through a wall, over a desk, or into a room you may not
// enter, because the only thing the jump changes is the avatar's y. The apex (about 12 units against a
// 36-unit body and 46-unit walls) is a hop, not a platforming move, and nothing in the world is reachable
// by it.
//
// TRAVERSAL (exterior free roam). Outdoors the arc is in ABSOLUTE height and PlayerMode hands PlayerBody the
// feet with every airborne step: the ground model (world/exteriorGround TraversalState) then lets the body
// pass over any EDGE its feet clear and lands it on the highest ground under it — a ledge above the takeoff
// or a lawn below it. What it clears is only ever an edge: solids, walls, water and the world's rim are
// judged at every height exactly as before, so nothing above stops being true for them.
//
// AND IT ALWAYS COMES DOWN. `y` is clamped at the floor on the frame the arc crosses it and the state is cleared
// there, so there is no accumulating float to drift; `reset()` puts the body back on the floor for every
// way out of the mode (exit, an interaction taking the avatar, a blur).

/** Downward acceleration, units/s². Tuned WITH the takeoff speed below, not independently. */
const GRAVITY = 260;
/** Upward speed at takeoff, units/s.
 *
 *  The pair above and here give an apex of 78² / (2 x 260) ≈ 11.7 units — a third of the 36-unit body,
 *  which is what a natural hop looks like at this scale — reached in 0.3 s, for about 0.6 s in the air.
 *  Short enough that it never interrupts walking, high enough to read as a jump from the third-person
 *  boom and from across the room. */
const TAKEOFF_SPEED = 78;

/** HOW LONG ONE JUMP LASTS, ms — 2 v / g, derived rather than written so it can never drift from the
 *  pair above. Read by the replication layer as the natural width of its staleness window: a relayed
 *  jump older than this has already finished everywhere else, and starting it now would be a phantom
 *  hop rather than the thing that happened. */
export const JUMP_DURATION_MS = (2 * TAKEOFF_SPEED / GRAVITY) * 1000;

/** THE POSE A BODY HOLDS IN MID-AIR, as a fraction of the walk cycle.
 *
 *  No shipped character package carries a jump clip, so the airborne pose is made from one every rig
 *  already has: the walk cycle stopped dead at its CONTACT frame — legs at their widest, arms counter-
 *  swung — which is the silhouette a jump reads as. Half way through the cycle is a contact pose (the
 *  other is at 0, and 0 is also where a freshly reset action sits, so the mid-cycle one is the
 *  unambiguous choice).
 *
 *  Shared by the local body (player/PlayerMode) and every replicated one (world/Coworkers), so a
 *  jumper and the people watching them hold the SAME pose. */
export const AIRBORNE_POSE_PHASE = 0.5;

/** A jump's own arc: takeoff speed and gravity (u/s, u/s²). The walk's is the default; the scooter has its own. */
export type JumpTuning = { takeoff: number; gravity: number };
export const WALK_JUMP: JumpTuning = { takeoff: TAKEOFF_SPEED, gravity: GRAVITY };

export class PlayerJump {
  /** the feet's height, ABSOLUTE (the world's y), while airborne */
  private y = 0;
  private vy = 0;
  private inAir = false;
  /** the height the jump left from — `height` is measured above it */
  private base = 0;
  private readonly tune: JumpTuning;

  constructor(tune: JumpTuning = WALK_JUMP) {
    this.tune = tune;
  }

  /** Height above the takeoff floor, world units. 0 whenever the body is grounded. */
  get height(): number { return this.inAir ? this.y - this.base : 0; }
  /** The feet's absolute height while airborne (the takeoff floor's when grounded). */
  get feet(): number { return this.inAir ? this.y : this.base; }
  /** Vertical speed, u/s (positive = rising); 0 when grounded. */
  get verticalSpeed(): number { return this.vy; }
  /** Is the body off the floor? The grounded test, and the no-double-jump test, are the same question. */
  get airborne(): boolean { return this.inAir; }

  /** Ask for a jump from a floor at `from` (absolute; 0 = the datum). Refused — and nothing changes —
   *  unless the body is on the floor, which is what makes a held Space or a second press a no-op. */
  start(from = 0): boolean {
    if (this.inAir) return false;
    this.inAir = true;
    this.base = this.y = from;
    this.vy = this.tune.takeoff;
    return true;
  }

  /** LEAVE AN EDGE without jumping: airborne at `from` with no upward speed (a body that walked or rolled
   *  off a drop deeper than it steps down). A no-op in mid-air. */
  fall(from: number): void {
    if (this.inAir) return;
    this.inAir = true;
    this.base = this.y = from;
    this.vy = 0;
  }

  /** Step by dt seconds over a floor at `floor` (absolute — the highest ground under the body now; the
   *  takeoff floor by default, which is the flat-floor jump). Returns TRUE on the one frame the body lands,
   *  so the caller can put the right clip back. It lands only while descending, so a jump taken beside a
   *  step rises past it rather than snagging on it, and it lands ON the floor — never below it. */
  update(dt: number, floor = this.base): boolean {
    if (!this.inAir) return false;
    this.vy -= this.tune.gravity * dt;
    this.y += this.vy * dt;
    if (this.vy > 0 || this.y > floor) return false;
    this.base = this.y = floor;
    this.vy = 0;
    this.inAir = false;
    return true;
  }

  /** Back on the floor, now, with no landing reported: the mode is being handed over or torn down. */
  reset(): void {
    this.y = this.base;
    this.vy = 0;
    this.inAir = false;
  }
}
