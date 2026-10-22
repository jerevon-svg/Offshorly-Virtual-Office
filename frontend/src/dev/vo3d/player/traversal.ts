// vo3d player — PARKOUR V2: CONTEXTUAL TRAVERSAL (the vault and the mantle), as pure planning. No THREE, no scene,
// no clock: it is handed the world's own questions and answers whether a vault or a mantle may happen here, and
// if so exactly where the body goes, how high and for how long. player/PlayerMode runs the plan; world/Coworkers
// replays the same curves for everybody watching.
//
// THE SAFETY ARGUMENT IS THE SAME ONE THE JUMP MAKES (player/PlayerJump): nothing here is a second collision world.
// Every point a plan passes through is judged by THE player's own stand test — walls, door architecture, glass,
// room access, the Reception gate reservations — with exactly one difference, and only for a vault: the ONE
// obstacle being vaulted is excused while the body is over it. A mantle excuses nothing: it asks the stand test
// with the feet at the ledge's height, which already lets a body over the furniture top its feet have cleared and
// still stops it at every wall. So:
//
//   • ELIGIBILITY IS DATA. A vault needs an item flagged `vault` in the standables index (world/standables) —
//     never a wall, a room front wall or glass, whatever their height. A mantle needs a real floor under the
//     landing that is higher than the feet: a standable top, or the campus's own ground. A wall has no top.
//   • THE LANDING IS AN ORDINARY STAND POINT. It must pass the full stand test with nothing excused, at the same
//     level for a vault and at the ledge's level for a mantle, with headroom for the body.
//   • ACCESS IS ASKED EXPLICITLY. `mayEnter(from, to)` is the world's own office-boundary rule (app/access): a
//     traversal that would land an employee without a confirmed check-in inside the working office is refused.
//     That is what keeps the Reception rail from being a way round the gates.
//   • THIN AND REACHABLE ONLY. A vault obstacle may be at most VAULT.maxDepth deep along the line of travel and
//     reached within VAULT.reach; a ledge at most MANTLE.maxRise above the feet. Nothing is climbable beyond that.
import type { Vec2 } from "../core/coords";
import type { Standable } from "../world/standables";
import type { StandContext } from "./PlayerBody";

export type TraverseKind = "vault" | "mantle";

/** A planned traversal: the body goes from `from` to `to` over `ms`, its feet from `startFeet` to `endFeet`,
 *  peaking at `apex` (absolute). `obstacle` is the one item a vault excuses. */
export type TraversePlan = {
  kind: TraverseKind;
  from: Vec2;
  to: Vec2;
  dir: Vec2;
  ms: number;
  startFeet: number;
  endFeet: number;
  apex: number;
  obstacle?: string;
};

/** What a plan asks of the world (app/world.ts supplies the real answers; the tests supply small ones). */
export type TraversalWorld = {
  /** the player's full stand test; `ignore` names the obstacle a vault excuses (absent = nothing excused) */
  stand(p: Vec2, ctx?: StandContext, ignore?: ReadonlySet<string>): boolean;
  /** vault obstacles a disc of radius `r` at `p` overlaps */
  vaultables(p: Vec2, r: number): readonly Standable[];
  /** the floor a body stands on at `p` (ground, or a standable top under it) */
  ground(p: Vec2): number;
  /** the highest the FEET may rise at `p` (Infinity = open sky) */
  headroom(p: Vec2): number;
  /** may a body that is at `from` end up at `to`? (the office boundary: a confirmed check-in to enter) */
  mayEnter(from: Vec2, to: Vec2): boolean;
};

/** THE VAULT. Tuned to a 36-unit body of radius 8. */
export const VAULT = {
  /** how far past the body's own front the obstacle may start */
  reach: 12,
  /** the obstacle's top, above the feet: a knee-high step at least, a waist-high rail at most */
  minRise: 6,
  maxRise: 25,
  /** deepest obstacle (along the line of travel) a hand-planted vault crosses */
  maxDepth: 26,
  /** the run-up: slower than this and Space is a jump, not a vault (a walk is 54.6) */
  minSpeed: 24,
  /** the landing floor may differ from the takeoff floor by at most this */
  levelTol: 1.5,
  /** the feet clear the top by this at the apex */
  clear: 3,
  ms: { min: 520, max: 900 },
} as const;

/** THE MANTLE. */
export const MANTLE = {
  /** how far past the body's front the ledge may be (grounded / in the air) */
  reach: 10,
  airReach: 7,
  /** grounded: a ledge lower than this is a hop's business (an ordinary jump clears ~11.7) */
  minRise: 12,
  /** in the air: the ledge must be above the feet by at least this to be grabbed rather than landed on */
  airMinRise: 1,
  /** the highest ledge above the feet the hands can haul the body onto (chest height on a 36-unit body) */
  maxRise: 30,
  /** the landing must be this flat */
  levelTol: 0.6,
  /** the landing is sought at least this far past where the top was first found (the body's centre well onto it,
   *  not perched on its rim), and no further than `depth` */
  inset: 9,
  depth: 22,
  ms: { min: 700, max: 1100 },
} as const;

const STEP = 2;
const smooth = (a: number, b: number, t: number): number => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const along = (p: Vec2, dir: Vec2, d: number): Vec2 => ({ x: p.x + dir.x * d, z: p.z + dir.z * d });

/** PLAN A VAULT from a grounded body at `pos` moving along unit `dir` with its feet at `feet`, or null.
 *
 *  1. THE OBSTACLE: the first vault-eligible item the body would touch within VAULT.reach, with its top a
 *     vaultable height above the feet. 2. THE CROSSING: every sample along the line, every STEP units, must
 *     stand with ONLY that obstacle excused — so a wall, a chair or a closed doorway beside or behind it refuses
 *     the vault. 3. THE LANDING: the first sample clear of the obstacle that stands with NOTHING excused, on the
 *     same level, within VAULT.maxDepth of crossing, that the body may enter. */
export function planVault(w: TraversalWorld, pos: Vec2, dir: Vec2, feet: number, radius: number): TraversePlan | null {
  let ob: Standable | null = null;
  for (let d = 0; d <= VAULT.reach && !ob; d += STEP) {
    for (const s of w.vaultables(along(pos, dir, d), radius + 0.5)) {
      const rise = s.top - feet;
      if (rise >= VAULT.minRise && rise <= VAULT.maxRise) { ob = s; break; }
    }
  }
  if (!ob) return null;
  const excuse = new Set([ob.id]);
  const maxSpan = VAULT.reach + 2 * radius + VAULT.maxDepth + 2;
  let entered = -1;
  let prev = pos;
  for (let d = STEP; d <= maxSpan; d += STEP) {
    const q = along(pos, dir, d);
    const over = ob.dist(q) < radius + 0.5;
    if (over) {
      if (entered < 0) entered = d;
      // over the obstacle: only it is excused, and there is room above it for the body going over
      if (!w.stand(q, undefined, excuse) || w.headroom(q) < ob.top + VAULT.clear) return null;
      if (d - entered > VAULT.maxDepth + 2 * radius) return null;
    } else if (entered >= 0) {
      // past it: an ordinary stand point on the same level, or keep going while only the obstacle's rim is in the way
      if (!w.stand(q, undefined, excuse)) return null;
      if (w.stand(q, { feet, airborne: false, from: prev }) && Math.abs(w.ground(q) - feet) <= VAULT.levelTol) {
        if (!w.mayEnter(pos, q)) return null;
        const dist = d;
        const ms = Math.round(Math.min(VAULT.ms.max, Math.max(VAULT.ms.min, 420 + dist * 7)));
        return { kind: "vault", from: { ...pos }, to: q, dir, ms, startFeet: feet, endFeet: w.ground(q), apex: ob.top + VAULT.clear, obstacle: ob.id };
      }
    } else if (!w.stand(q, { feet, airborne: false, from: prev })) {
      // something other than the obstacle is between the body and it
      return null;
    }
    prev = q;
  }
  return null;
}

/** PLAN A MANTLE from a body at `pos` facing unit `dir`, feet at `feet` (airborne: a grab mid-jump), or null.
 *
 *  THE LEDGE is the first point ahead, within reach, where the floor is higher than the feet by a mantle's rise
 *  (a standable top, a raised terrace) — a wall has no floor on top and is never one. THE LANDING is the first
 *  point onto that top where the whole body stands at the ledge's height with nothing excused, flat, with headroom,
 *  and the whole line there passes the stand test with the feet at that height (so nothing between the body and
 *  the top — a wall, glass, a shut doorway — can be climbed through). */
export function planMantle(w: TraversalWorld, pos: Vec2, dir: Vec2, feet: number, radius: number, airborne = false): TraversePlan | null {
  const reach = airborne ? MANTLE.airReach : MANTLE.reach;
  const minRise = airborne ? MANTLE.airMinRise : MANTLE.minRise;
  let edge = -1, top = 0;
  for (let d = radius - STEP; d <= radius + reach; d += STEP) {
    const h = w.ground(along(pos, dir, d));
    const rise = h - feet;
    if (rise > MANTLE.maxRise) return null; // taller than a mantle: nothing above it is reachable
    if (rise >= minRise) { edge = d; top = h; break; }
  }
  if (edge < 0) return null;
  const ctxAt = (from: Vec2, air: boolean): StandContext => ({ feet: top, airborne: air, from });
  let prev = pos;
  for (let d = STEP; d <= edge + MANTLE.depth; d += STEP) {
    const q = along(pos, dir, d);
    // the line onto the top, judged with the feet at the top's height: furniture under it is cleared, walls are not
    if (!w.stand(q, ctxAt(prev, true))) return null;
    if (d >= edge + MANTLE.inset && Math.abs(w.ground(q) - top) <= MANTLE.levelTol && w.stand(q, ctxAt(q, false)) && w.headroom(q) >= top) {
      if (!w.mayEnter(pos, q)) return null;
      const rise = top - feet;
      const ms = Math.round(Math.min(MANTLE.ms.max, Math.max(MANTLE.ms.min, 560 + rise * 16)));
      return { kind: "mantle", from: { ...pos }, to: q, dir, ms, startFeet: feet, endFeet: top, apex: top };
    }
    prev = q;
  }
  return null;
}

/** HOW FAR ALONG THE PLAN THE BODY IS, horizontally, at phase u (0..1). Shared by the traverser and its peers.
 *  A vault keeps its run going; a mantle hangs at the ledge while it pulls up, then steps over the edge. */
export function traverseProgress(kind: TraverseKind, u: number): number {
  if (kind === "vault") return u;
  return 0.12 * smooth(0, 0.2, u) + 0.88 * smooth(0.45, 0.9, u);
}

/** HOW HIGH THE FEET ARE at phase u: a vault's arc over the obstacle (peaking at `apex` mid-way), a mantle's haul
 *  from the feet to the top (reach, pull, then the knee over the edge). Shared by the traverser and its peers. */
export function traverseHeight(kind: TraverseKind, u: number, startFeet: number, endFeet: number, apex: number): number {
  if (kind === "mantle") return startFeet + (endFeet - startFeet) * smooth(0.12, 0.7, u);
  const base = startFeet + (endFeet - startFeet) * smooth(0, 1, u);
  const lift = Math.max(0, apex - (startFeet + endFeet) / 2);
  return base + lift * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
}
