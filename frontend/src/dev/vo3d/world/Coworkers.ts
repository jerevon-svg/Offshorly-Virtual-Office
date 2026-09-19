// vo3d world — REAL COWORKERS ON THE FLOOR. Phase 4A: static, read-only, one body per roster person.
//
// WHAT THIS OWNS AND WHAT IT DOES NOT. It owns a THREE.Group and everything under it: the cloned bodies,
// their mixers, their nameplates. `dispose()` takes all of it out in one call, and the world calls that
// on unmount. It does NOT own the data — app/Vo3dHost.tsx subscribes to V1's roster through V1's own
// hooks and pushes a resolved list in. React owns subscriptions, the world owns scene objects, and
// neither reaches into the other.
//
// PHASE 6A: THEY WALK NOW. Phase 4B moved a body in one step when V1 said that person had stopped
// somewhere new, which was correct and looked like a teleport. A body now REPLAYS the movement V1
// published — the route and the duration the walking client sent — with the same clip pair, crossfade and
// turn-toward-travel devtools/Crowd.ts has always used for cast bodies, on the same eased curve V1's own
// PeerWalker replays it with (core/coords easeInOutQuad).
//
// PHASE 6B: THEY FACE EXACTLY WHAT THE WALKER FACES, AND A RUN IS A RUN. Two things V1's wire could not
// say, now said by two optional fields V1 clients never send and never read:
//   • `yaw` on walk_arrived — the walking body's ACTUAL resting rotation. V1's four-word `facing` stays
//     beside it for every V1 reader; a body here is turned to `yaw` when present and to the compass yaw
//     of `facing` when not. Nothing is inferred from the route: an earlier cut turned the body onto the
//     route's final heading and was wrong whenever the walker's own turn had not finished (a short or
//     sharp final segment), which is often. The turn onto the received yaw is taken at the body's own
//     turn rate as the last beat of the walk, never snapped.
//   • `pacing: "linear"` on walk_started — a free-movement LEG (PLAYER mode's 400 ms samples) is a
//     constant-speed slice of motion that did not stop, and is replayed as one. Easing it on V1's curve
//     halted the body at both ends of every leg, and dropping to idle between legs restarted the walk
//     clip 2.5 times a second: the "moving, pausing, moving" peers saw. A leg that runs out now holds
//     its pose for a short grace (LEG_GRACE_MS) — the arrival that follows says whether it stopped.
// Turning in place is still not synchronised: it publishes no movement and no arrival.
//
// THE STABLE POSITION IS STILL THE AUTHORITY. A replay is what the body does between two facts, never a
// fact of its own: it is started by a movement id, replaced by the next movement id, and always settled
// by the arrival that follows. Nothing here extrapolates past the end of a route, and nothing here
// invents a position when the feed goes quiet — see applyPositions for the three cases and
// world/coworkerWalk.ts for what the replay refuses to do.
//
// TWO KINDS OF CHANGE, AND THEY MUST NOT BE THE SAME CODE PATH. `sync()` is called for both, and tells
// them apart itself:
//
//   • A POPULATION CHANGE — somebody joined the roster, left it, or had their 3D character swapped. This
//     is the expensive path: it disposes bodies, fetches GLBs, and bumps `generation` so a load that
//     lands after a newer roster is dropped.
//   • A POSITION CHANGE — the same people, somewhere new. This is the cheap path, and it is SYNCHRONOUS:
//     it moves root nodes and returns. It does NOT bump `generation`, does not touch mixers, does not
//     re-clone and does not await anything.
//
// Keeping them apart is load-bearing, not tidiness. Positions now arrive from a live feed, and if a
// position update took the population path, every one of them would bump `generation` and cancel whatever
// GLB was in flight — with people moving faster than 2 MB parses, no coworker would EVER finish loading.
// `loading` (the emails whose GLB is in flight) is what lets the cheap path recognise itself while an
// expensive one is still running.
//
// PLACEMENT IS REFUSED, NEVER FORCED. A seat centroid is the point a chair is drawn at, so an 8-unit body
// usually does not fit exactly on it; standablePointNear searches outward in rings by the same test every
// WASD step is judged by. A person whose desk has nothing legal within six body radii — a room V2 has not
// reconstructed, a seat buried in furniture — is SKIPPED and reported, because a body dropped inside a
// desk is worse than a body that is honestly absent.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { BON_STANDING_HEIGHT, CLIP_IDLE, CLIP_RUN, CLIP_WALK, type AvatarLod, CLIP_SIT } from "../adapters/v1Avatar";
import { castLabelTexture, prototypeFor, type CastPrototype } from "../avatar/CastPrototypes";
import { dist, FACING_YAW, stepAngle, wrapAngle, type Facing, type Vec2 } from "../core/coords";
import { standablePointNear, type StandTest } from "../player/PlayerBody";
import type { Vo3dCoworker, Vo3dWalkPacing } from "../app/coworkers";
import { PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED } from "../player/PlayerMode";
import { ReplayWalk } from "./coworkerWalk";
import { deskSeatedRootForRig, sceneRig, seatedRootForRig, type SeatedRig } from "../interact/seatContact";

/** How fast a coworker turns toward their direction of travel, rad/s. The navigation controller's rate,
 *  which is also what devtools/Crowd.ts turns its bodies at — one figure for every walking body in V2. */
const TURN_RATE = 7;
/** Ceiling on locomotion playback rate — a spike guard for a long frame, not a look choice. */
const MAX_CLIP_RATE = 2.5;
/** Below this, a correction is not worth animating: the body is already there. */
const RECONCILE_EPSILON = 0.5;
/** THE WIDEST CORRECTION THAT IS GLIDED RATHER THAN SNAPPED, in units.
 *
 *  A replay can end up a little away from the position V1 finally vouches for — clock offset, a rounding
 *  difference, a frame boundary. Sliding a body 20 units to settle that reads as the last step of the
 *  walk; snapping it reads as a glitch. Anything LARGER is not jitter, it is news: an interrupted walk
 *  that stopped somewhere else entirely, or a correction after a reconnect. Those are snapped, because
 *  gliding across the office would be V2 inventing a journey nobody took. */
const RECONCILE_MAX = 24;
/** How long a glided correction takes. Short enough to be a settle, long enough not to be a jump. */
const RECONCILE_MS = 260;

/** PHASE 6B DIAGNOSTIC — the last few ARRIVALS this world resolved: which movement, whether an exact yaw
 *  came with it, V1's four-word facing beside it, and the yaw the body was turned to. Bounded, read-only,
 *  and anonymous: a movement id prefix and angles, never a name, an email or a roster row. */
const ARRIVAL_TRACE_CAP = 8;
export type ArrivalDecision = {
  /** first 8 chars of the movement id this arrival resolved, as the publisher's wire log prints it */
  movementId: string;
  /** the exact yaw V1 relayed, or null for an arrival with none (a V1 client, or a pre-6B row) */
  receivedYaw: number | null;
  /** V1's four-word facing, translated — what the body falls back to */
  facing: Facing;
  /** the yaw the body was turned to */
  applied: number;
};
const arrivals: ArrivalDecision[] = [];
/** Read the trace. A copy, so a console cannot mutate the world's own buffer. */
export const facingTrace = (): ArrivalDecision[] => arrivals.map((d) => ({ ...d }));

/** Below this, two yaws are the same yaw. */
const YAW_EPSILON = 1e-3;
/** HOW LONG A LEG THAT RAN OUT HOLDS ITS POSE before the body is taken to have stopped, ms.
 *
 *  A free-movement leg's end is ambiguous by construction: the publisher closes a leg every 400 ms and
 *  the peer cannot tell "paused between legs" from "stopped" until either the next walk_started lands or
 *  nothing does. Both land one network hop after the leg's own clock runs out. Idling in that gap is what
 *  restarted the walk clip at every leg boundary; extrapolating through it would be inventing a position.
 *  So the body holds still, in its last pose, for at most this long — enough for the next leg on any
 *  realistic hop, short enough that a real stop reads as a stop. The arrival, when it lands, is still what
 *  turns the body; only the CLIP decision waits. */
const LEG_GRACE_MS = 200;
/** The ground speed each locomotion clip was authored for, units/s — the same figures player/PlayerMode
 *  uses for the signed-in employee's own body, so a peer's feet land where the local's do. */
const CLIP_GROUND_SPEED: Record<string, number> = { [CLIP_WALK]: 30, [CLIP_RUN]: 48 };
/** A movement whose MEAN speed is at least this runs; below it walks. Half way between the two speeds the
 *  player can move at, so a walk at 70 is a walk and a sprint at 100 is a run, with margin either side. */
const RUN_FROM_SPEED = (PLAYER_WALK_SPEED + PLAYER_SPRINT_SPEED) / 2;

/** How close two DESK-PLACED coworkers may stand before the second is nudged to the next legal ring. Half
 *  a body rather than a full one: the roster's own per-room seating already gives everyone a distinct
 *  chair, so this only ever catches the residue — two overflow-grid cells that happen to sit tight, or two
 *  ring nudges that converged — and a larger figure would start shoving people across their own room.
 *
 *  IT DOES NOT APPLY TO A LIVE POSITION, IN EITHER DIRECTION — see placeCoworkers. */
const MIN_SEPARATION = 8;

export type CoworkerPlacement = {
  coworker: Vo3dCoworker;
  /** where the body actually stands, in V2 WORLD units */
  pos: Vec2;
};

export type CoworkerPlacementResult = {
  placed: CoworkerPlacement[];
  /** display names of coworkers with no legal standing point near their desk */
  unplaced: string[];
};

/**
 * WHERE EACH COWORKER ACTUALLY STANDS. Pure, and given its world handles rather than importing them, so
 * the world and its tests run the very same arithmetic.
 *
 * `toWorld` converts a V1 frame point into the built V2 world — app/world.ts passes the same
 * homeDeskWorldPoint the signed-in employee's own desk goes through, so a room that stands away from its
 * V1 art box moves its occupants with it. `canStand` is the world's own player stand test.
 *
 * A LIVE POSITION IS NEVER NUDGED BY ANOTHER COWORKER, AND NEVER NUDGES ONE (Phase 4B). The separation
 * rule is a V2 invention for a V2 problem — the roster's derived seating can put two overflow bodies in
 * each other's laps — and it is resolved in iteration order against a shared list. That is fine while the
 * input is a static seating chart, and wrong the moment one person's position comes from a live feed:
 * every step somebody takes would re-run the resolution and shuffle unrelated, stationary people around
 * the office. So the two kinds of point are kept out of each other's way entirely:
 *
 *    posSource "live" — placed against `canStand` ALONE. V1 is the source of truth for where this person
 *                       is; if V1 has two people standing in each other, V2 draws that honestly rather
 *                       than inventing a correction. Not added to `taken`, so it cannot move anyone else.
 *    posSource "desk" — placed against `canStand` PLUS separation from other desk bodies, exactly as in
 *                       Phase 4A. Unchanged, and now provably independent of anything that moves.
 *
 * `canStand` still applies to both: a persisted position is V1's truth about V1's floor, and V2 has
 * reconstructed rooms V1 never had. Refusing to stand a body inside V2's own furniture is the same
 * refusal Phase 3 makes for the signed-in employee's desk.
 *
 * Deterministic: the input is sorted by email (adapters/v1Coworkers.ts does it), and desk collisions are
 * resolved in that order, so every viewer places the same people in the same spots.
 */
export function placeCoworkers(
  list: readonly Vo3dCoworker[],
  toWorld: (p: Vec2) => Vec2,
  canStand: StandTest,
  radius: number,
): CoworkerPlacementResult {
  return new CoworkerPlacer(toWorld, canStand, radius).place(list);
}

/**
 * THE SAME PLACEMENT, KEPT BETWEEN CALLS (Phase 4C stage 3). `place()` returns exactly what
 * placeCoworkers returns for the same arguments — it IS placeCoworkers, which is now a one-shot instance
 * of this — and differs only in refusing to redo work whose answer cannot have changed.
 *
 * WHY THIS EXISTS. The search above is not cheap: standablePointNear probes the world's stand test once
 * at the point and then up to SPAWN_RINGS x 12 times around it, and that test walks a region lookup, a
 * clearance/grid sample and eight rim samples every probe. Phase 4B made positions LIVE, so `sync()` — and
 * with it this whole pass — now runs on every positions tick rather than once per roster change, and a
 * roomful of stationary people were paying the full search several times a second so that one person
 * could take a step. That is the measured main-thread spike this stage removes.
 *
 * WHAT MAY BE REUSED, AND WHY IT IS SOUND. The two kinds of point are already independent by construction
 * (see placeCoworkers above), and that independence is exactly what makes them separately cacheable:
 *
 *   LIVE — placed against `canStand` ALONE, reading nothing about anybody else and writing nothing to
 *          `taken`. So one live coworker's answer is a pure function of THEIR OWN point, and is memoised
 *          per email on that point. Somebody who did not move is not re-searched; somebody who did is,
 *          and nobody else is disturbed by it — the same guarantee Phase 4B states, now also the reason
 *          the cache is safe.
 *   DESK — placed against `canStand` PLUS separation from the desk bodies BEFORE them in order. So the
 *          whole desk sub-sequence is a pure function of its own ordered (email, point) list, and is
 *          cached as ONE unit keyed on exactly that. Any change to it — somebody joined, left, was
 *          reseated, or flipped between desk and live — misses the key and re-runs the entire desk pass
 *          from scratch, in the original order, so the order-dependent separation resolution is never
 *          applied incrementally. A desk point only changes when V1's roster seating does, which is a
 *          population event, not a positions tick.
 *
 * WHAT IT ASSUMES, STATED SO IT CAN BE CHECKED: that `toWorld`, `canStand` and `radius` answer the same
 * way for the lifetime of the placer. They do — all three are built once per world (world.ts's
 * playerStand closes over `walkability` and `derivedNav`, both `const` and never rebuilt; doorways are
 * baked into the grid at build time through openedLayer, not toggled), and a rebuilt world builds a new
 * Coworkers and therefore a new placer. `invalidate()` is there for the day that stops being true.
 */
export class CoworkerPlacer {
  /** A sentinel no real key can equal: the empty roster's key is "", which is a legitimate hit. */
  private deskKey: string | null = null;
  /** The last desk pass, in desk order — null for a desk coworker who had nowhere legal to stand. */
  private deskSpots: (Vec2 | null)[] = [];
  /** Per-email memo of the live pass. Rebuilt every call from the hits, so a coworker who leaves the
   *  roster leaves the cache with them rather than accumulating forever. */
  private liveSpots = new Map<string, LiveSpot>();

  private readonly toWorld: (p: Vec2) => Vec2;
  private readonly canStand: StandTest;
  private readonly radius: number;

  constructor(toWorld: (p: Vec2) => Vec2, canStand: StandTest, radius: number) {
    this.toWorld = toWorld;
    this.canStand = canStand;
    this.radius = radius;
  }

  /** Byte-for-byte placeCoworkers, minus the work that cannot have changed. */
  place(list: readonly Vo3dCoworker[]): CoworkerPlacementResult {
    const deskSpots = this.deskPass(list);

    const placed: CoworkerPlacement[] = [];
    const unplaced: string[] = [];
    const liveSpots = new Map<string, LiveSpot>();
    let d = 0;

    for (const coworker of list) {
      let pos: Vec2 | null;
      if (coworker.seat) {
        // PHASE 6C — a seated body is placed by its chair (Coworkers.applyPositions), not by the stand
        // test: a chair's footprint is exactly the kind of point the test refuses. The V1 point is carried
        // through unchanged so a world with no chair for the anchor still has the honest fallback.
        pos = this.toWorld(coworker.point);
      } else if (coworker.posSource === "live") {
        const { x, z } = coworker.point;
        const hit = this.liveSpots.get(coworker.email);
        // Keyed on the V1-frame point, before toWorld: the transform is a constant of this placer, so two
        // equal inputs to it have equal outputs, and skipping the call is part of the saving.
        pos = hit && hit.x === x && hit.z === z ? hit.pos : standablePointNear(this.toWorld(coworker.point), this.radius, this.canStand);
        liveSpots.set(coworker.email, { x, z, pos });
      } else {
        pos = deskSpots[d++];
      }
      if (!pos) {
        unplaced.push(coworker.displayName);
        continue;
      }
      placed.push({ coworker, pos });
    }

    this.liveSpots = liveSpots;
    return { placed, unplaced };
  }

  /** Forget everything. Only needed if the world's floor itself were ever rebuilt under a live placer. */
  invalidate(): void {
    this.deskKey = null;
    this.deskSpots = [];
    this.liveSpots.clear();
  }

  /** THE DESK HALF, all or nothing. Either the ordered desk roster is the one already solved — in which
   *  case its solution is still correct, separation and all — or none of it is and the whole pass re-runs
   *  in list order, exactly as the uncached function did. */
  private deskPass(list: readonly Vo3dCoworker[]): (Vec2 | null)[] {
    let key = "";
    for (const c of list) {
      if (c.posSource === "live") continue;
      key += `${c.email}|${c.point.x}|${c.point.z};`;
    }
    if (key === this.deskKey) return this.deskSpots;

    const spots: (Vec2 | null)[] = [];
    const taken: Vec2[] = [];
    const free: StandTest = (p) => this.canStand(p) && taken.every((t) => dist(t, p) >= MIN_SEPARATION);
    for (const coworker of list) {
      if (coworker.posSource === "live") continue;
      const pos = standablePointNear(this.toWorld(coworker.point), this.radius, free);
      if (pos) taken.push(pos);
      spots.push(pos);
    }
    this.deskKey = key;
    this.deskSpots = spots;
    return spots;
  }
}

/** PHASE 6D — the height an anchored interaction card hangs off, in world units: exactly where the
 *  nameplate sprite already sits (see addLabel), so the card and the name agree about where a person's
 *  head is instead of each having their own idea of it. */
const HEAD_ANCHOR_Y = BON_STANDING_HEIGHT + 6;

/** One memoised live answer: the V1-frame point it was computed for, and what it came out as. */
type LiveSpot = { x: number; z: number; pos: Vec2 | null };

/** One coworker's body: a clone, a mixer, its clips, a nameplate — and, Phase 6A, a walk it may be
 *  replaying. Locomotion is modelled on devtools/Crowd.ts's member, which has walked cast bodies around
 *  this world since the stress harness: same clip pair, same crossfade, same turn-toward-travel. What is
 *  different is where the route comes from — V1's wire rather than a random roam target. */
class CoworkerBody {
  readonly root = new THREE.Group();
  readonly avatarId: string;
  readonly displayName: string;
  readonly triangles: number;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<string, THREE.AnimationAction> = {};
  private current = "";
  private label: THREE.Sprite | null = null;
  private yaw: number;
  /** The walk being replayed, or null when standing. */
  private replay: ReplayWalk | null = null;
  /** THE LAST MOVEMENT ID THIS BODY HAS BEEN GIVEN, kept after its replay finishes.
   *
   *  Not the same question as "what is running": a replay ends when its duration runs out, which is
   *  usually BEFORE the walk_arrived that resolves it lands. Between those two moments the feed keeps
   *  handing over the same movement, and asking the live replay would answer "nothing is running" and
   *  restart the walk from its origin on every re-render — a body flung back down its own route,
   *  repeatedly. V1's own PeerWalker keeps exactly this field for exactly this reason. */
  private playedId: string | null = null;
  /** The yaw to settle on when the current replay finishes — set only for a reconciliation glide, where
   *  the authoritative facing is already known. A peer replay leaves it undefined and keeps the heading
   *  it was travelling, until the arrival that follows supplies the real one. */
  private settleYaw: number | null = null;
  /** Is a reconciliation glide running right now? Distinct from `replay !== null`, which is also true for
   *  a real walk, and from `playedId`, which survives its own replay. */
  private settling = false;
  /** The yaw an arrival asked for, still being turned onto at TURN_RATE — the last beat of a walk. Null
   *  when the body faces what it was last told to. A placement never sets this; it turns at once. */
  private targetYaw: number | null = null;
  /** Time left in a linear leg's grace, ms — see LEG_GRACE_MS. Zero for every body not between legs. */
  private coastMs = 0;
  /** Which locomotion clip this body's current movement plays, chosen once per movement by its mean
   *  speed (see beginWalk). */
  private locomotion: string = CLIP_WALK;
  /** PHASE 6C — the seat anchor this body is seated in, or null while standing/walking. */
  seatedIn: string | null = null;
  /** The clips-and-scale reading the seated pose is computed from — the shared prototype's, which is the
   *  same consolidated GLB the hero avatar plays, so the formula lands both bodies alike. */
  private readonly rig: SeatedRig;

  constructor(proto: CastPrototype, name: string, at: Vec2, yaw: number, phase: number) {
    this.avatarId = proto.id;
    this.displayName = name;
    this.triangles = proto.triangles;
    this.rig = sceneRig(proto.scene, proto.clips);
    const body = cloneSkinned(proto.scene) as THREE.Group;
    this.root.name = `coworker:${name}`;
    this.root.add(body);
    this.root.position.set(at.x, 0, at.z);
    this.yaw = yaw;
    this.root.rotation.set(0, yaw, 0);
    this.mixer = new THREE.AnimationMixer(body);
    // EVERY clip the prototype carries, bound once. The prototypes are the same consolidated GLBs the
    // hero avatar and the stress crowd use, so `walking` is there; hasClip is still asked before it is
    // played, because an older asset without it must fall back rather than freeze mid-pose.
    for (const clip of proto.clips) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.play(CLIP_IDLE, 0);
    const idle = this.actions[CLIP_IDLE];
    // Stagger the idle phase, or a roomful of people breathe in perfect lockstep — and, more to the
    // point, every skeleton hits its keyframe boundaries on the same frame.
    if (idle) idle.time = phase * (idle.getClip().duration || 1);
    this.addLabel(name);
  }

  /** Crossfade to a clip, byte-for-byte the switch Avatar.play and Crowd's member use. */
  private play(name: string, fade = 0.25): void {
    if (this.current === name) return;
    const next = this.actions[name];
    if (!next) return;
    const prev = this.current ? this.actions[this.current] : null;
    next.reset().setEffectiveWeight(1).play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else if (prev) prev.stop();
    this.current = name;
  }

  get moving(): boolean { return this.replay !== null; }
  get clip(): string { return this.current; }
  /** Which way this body is looking, radians. Read-only, and read by the dev surface alone. */
  get facingYaw(): number { return this.yaw; }
  get pos(): Vec2 { return { x: this.root.position.x, z: this.root.position.z }; }
  /** The movement this body has been given, running or finished, so a re-push of the same one is
   *  recognised and ignored. See `playedId`. */
  get movementId(): string | null { return this.playedId; }

  /** START REPLAYING A MOVEMENT V1 PUBLISHED. Called once per movement id — a redirect is simply the
   *  next one, and it REPLACES whatever was running, exactly as V1's own store replaces a superseded
   *  movement. The body is not first snapped back to the origin: the replay's own fast-forward puts it
   *  where the walk currently is, which for a redirect is about where the body already stood. */
  beginWalk(movementId: string, worldPath: readonly Vec2[], durationMs: number, elapsedMs: number, pacing: Vo3dWalkPacing = "eased"): void {
    // A walk stands a seated body up first — V1 clears the seat on every walk_started, and so does this.
    if (this.seatedIn !== null) this.standUp();
    this.replay = new ReplayWalk(movementId, worldPath, durationMs, elapsedMs, pacing);
    this.playedId = movementId;
    this.settleYaw = null;
    this.settling = false;
    // A new movement owns the rotation from here: a turn an arrival had queued is moot, and a leg that
    // follows another ends the grace the previous one was holding its pose through.
    this.targetYaw = null;
    this.coastMs = 0;
    // The clip is a property of the MOVEMENT — its mean speed — chosen once, so an eased walk does not
    // break into a run at the peak of its own curve. A prototype without a run clip walks faster instead.
    this.locomotion = this.replay.meanSpeed >= RUN_FROM_SPEED && this.actions[CLIP_RUN] ? CLIP_RUN : CLIP_WALK;
    const at = this.replay.position;
    this.root.position.set(at.x, 0, at.z);
  }

  /** PHASE 6C — SIT THIS BODY IN `anchor`, at the pose the world resolved for it. The root is put where
   *  the sit clip's pelvis meets the cushion — deskSeatedRootForRig for a movable chair (interact/Seat's
   *  own formula), seatedRootForRig for fixed seating (interact/LoungeSeat's) — at the chair's own yaw,
   *  and the seated clip plays. Any replay, queued turn or leg grace is dropped: the seated arrival is the
   *  authoritative account of where this person is. Returns true when anything changed. */
  sitAt(anchor: string, pose: SeatAnchorPose): boolean {
    const root = pose.kind === "seat"
      ? deskSeatedRootForRig(this.rig, pose.contact, pose.yaw)
      : seatedRootForRig(this.rig, pose.contact, pose.yaw, pose.sink ?? 0);
    const same = this.seatedIn === anchor && this.root.position.equals(root) && this.yaw === pose.yaw;
    this.replay = null;
    this.playedId = null;
    this.settleYaw = null;
    this.settling = false;
    this.targetYaw = null;
    this.coastMs = 0;
    this.seatedIn = anchor;
    this.root.position.copy(root);
    this.yaw = pose.yaw;
    this.root.rotation.set(0, pose.yaw, 0);
    this.play(this.actions[CLIP_SIT] ? CLIP_SIT : CLIP_IDLE);
    return !same;
  }

  /** PHASE 6C — leave the chair: back on the floor at the same x/z, idling. The position that follows
   *  (an arrival, a walk) is applied by the caller as for any standing body. */
  standUp(): void {
    if (this.seatedIn === null) return;
    this.seatedIn = null;
    this.root.position.y = 0;
    this.play(CLIP_IDLE);
  }

  /** THE AUTHORITATIVE POSITION HAS ARRIVED, and the yaw to face: the exact one V1 relayed when the
   *  walking session published it (Phase 6B), or the compass yaw of V1's four-word facing when it did
   *  not. Returns true when anything changed or a turn was queued.
   *
   *  A GLIDE IS ONLY EVER THE SEAM AT THE END OF A REPLAY, and that is what `playedId` gates. A replay can
   *  finish a little away from the position V1 finally vouches for — clock offset, a rounding difference,
   *  a frame boundary — and sliding the last few units reads as the end of the walk while snapping reads
   *  as a glitch. A body that has NOT been replaying anything has no such seam: its position is a
   *  PLACEMENT (a desk, a roster reseat, a separation nudge, a first sync), and a placement is applied at
   *  once. Gliding those would make where a coworker stands depend on how recently it was told, which is
   *  exactly what the Phase 4C cache-equivalence test measures — and would have been wrong anyway.
   *
   *  THE SAME RULE FOR THE ROTATION. Resolving a walk turns the body onto `yaw` at its own turn rate (the
   *  walker's body turned at that rate too, and an instant snap of the last degrees is the jerk this
   *  phase set out to remove); a placement is turned at once, like it is moved.
   *
   *  So, in order:
   *    already there   — settle, turning smoothly if this resolves a walk. The normal end of a replay.
   *    seam, short way — glide, and take the yaw when the glide lands.
   *    anything else   — snap. An interrupted walk, a reconnect correction, or an ordinary placement. */
  reconcileTo(at: Vec2, yaw: number): boolean {
    const d = dist(this.pos, at);
    const resolvesWalk = this.playedId !== null || this.settling;
    if (d <= RECONCILE_EPSILON) return this.settle(at, yaw, resolvesWalk);
    if (resolvesWalk && d <= RECONCILE_MAX) {
      // Re-glided only when the target actually moved: a repeated sync toward the same point must not
      // restart the settle and leave the body creeping forever.
      if (!this.settling || !this.replay || dist(this.replay.end, at) > RECONCILE_EPSILON) {
        this.replay = new ReplayWalk(`settle:${at.x.toFixed(2)},${at.z.toFixed(2)}`, [this.pos, at], RECONCILE_MS);
        this.settleYaw = yaw;
        this.settling = true;
      }
      // The movement is resolved; only the glide is still running. Clearing the id here is what stops a
      // later, unrelated placement change from being treated as another seam.
      this.playedId = null;
      return true;
    }
    return this.settle(at, yaw, false);
  }

  /** Stop replaying anything and take the authoritative pose. The position is taken at once either way;
   *  the rotation is queued onto `targetYaw` when this resolves a walk and taken at once otherwise. A leg's
   *  grace (`coastMs`) is deliberately NOT touched: the arrival of a leg is not yet the news that the
   *  person stopped — the next walk_started, or its absence, is. */
  private settle(at: Vec2, yaw: number, turnSmoothly: boolean): boolean {
    this.replay = null;
    this.settleYaw = null;
    this.settling = false;
    this.playedId = null;
    if (!turnSmoothly) {
      // A re-push of the very yaw a queued turn is already heading for must not cut that turn short and
      // snap it — the same "identical fact re-applied" rule the position glide has.
      if (this.targetYaw !== null && Math.abs(wrapAngle(this.targetYaw - yaw)) <= YAW_EPSILON) return this.moveTo(at);
      this.targetYaw = null;
      return this.snapTo(at, yaw);
    }
    let moved = this.moveTo(at);
    if (Math.abs(wrapAngle(yaw - this.yaw)) > YAW_EPSILON) {
      this.targetYaw = yaw;
      moved = true;
    } else this.targetYaw = null;
    return moved;
  }

  /** Position only. True when it changed. */
  private moveTo(at: Vec2): boolean {
    if (this.root.position.x === at.x && this.root.position.z === at.z) return false;
    this.root.position.set(at.x, 0, at.z);
    return true;
  }

  /** Snap to a new spot. Returns TRUE only when something actually moved.
   *
   *  The return value is what keeps the shadow map honest. A coworker's idle clip deforms them every
   *  frame but their ROOT never drifts, so the only thing that can invalidate their shadow is this call —
   *  and only when it changes something. Reporting "moved" for a sync that re-applied identical
   *  coordinates would redraw the shadow map on every snapshot tick, which at a roomful of people costs
   *  more than the bodies do. */
  private snapTo(at: Vec2, yaw: number): boolean {
    if (this.root.position.x === at.x && this.root.position.z === at.z && this.yaw === yaw) return false;
    this.root.position.set(at.x, 0, at.z);
    this.yaw = yaw;
    this.root.rotation.set(0, yaw, 0);
    return true;
  }

  /** COMPACT: the name and nothing else. No status, no dot — Phase 4A measures no presence detail, and a
   *  plate that showed one would be asserting something nobody read. */
  private addLabel(name: string): void {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: castLabelTexture(name), depthTest: true, transparent: true }));
    sprite.scale.set(22, 5.5, 1);
    sprite.position.set(0, BON_STANDING_HEIGHT + 6, 0);
    sprite.frustumCulled = false;
    this.root.add(sprite);
    this.label = sprite;
  }

  /** One frame. Advances a replay if there is one, then any queued turn, then the mixer — the same order
   *  Crowd's member uses. Returns TRUE when the body's transform changed, which is what the caller turns
   *  into a cheap dynamic shadow invalidation (a walking coworker costs the composite pass, never the
   *  static redraw). */
  update(dt: number): boolean {
    if (this.seatedIn !== null) {
      // Seated: the clip breathes, the root does not move. Nothing below may play idle over the sit.
      this.mixer.update(dt);
      return false;
    }
    let moved = false;
    if (this.replay) {
      const step = this.replay.advance(dt * 1000);
      moved = step.travelled > 1e-6;
      this.root.position.set(step.pos.x, 0, step.pos.z);
      if (step.heading !== null) {
        this.yaw = stepAngle(this.yaw, step.heading, TURN_RATE * dt);
        this.root.rotation.set(0, this.yaw, 0);
        moved = true;
      }
      if (moved) {
        this.play(this.locomotion);
        const action = this.actions[this.locomotion];
        // Rate from the ground ACTUALLY covered this frame, against the speed THIS clip was authored for,
        // so a replay that is slower or faster than the clip still lands its feet instead of skating.
        if (action) {
          action.timeScale = Math.min(
            MAX_CLIP_RATE,
            Math.max(0.15, step.travelled / Math.max(dt, 1e-4) / CLIP_GROUND_SPEED[this.locomotion]),
          );
        }
      }
      if (this.replay.done) {
        // The route has run out. A reconciliation glide already knew its yaw; a peer walk waits for the
        // arrival to say — and until it does, the body idles where it ended.
        const legRanOut = this.replay.pacing === "linear" && !this.settling;
        this.replay = null;
        this.settling = false;
        if (this.settleYaw !== null) {
          this.targetYaw = this.settleYaw;
          this.settleYaw = null;
        }
        if (legRanOut) {
          // A LEG THAT RAN OUT IS NOT A STOP — see LEG_GRACE_MS. Hold the pose: the clip is frozen rather
          // than left running (feet sliding on a body that is not moving) or swapped for idle (a walk clip
          // restarted from its first frame at every leg boundary). No position is invented meanwhile.
          this.coastMs = LEG_GRACE_MS;
          const action = this.actions[this.locomotion];
          if (action) action.timeScale = 0;
        } else this.play(CLIP_IDLE);
      }
    } else if (this.coastMs > 0) {
      this.coastMs -= dt * 1000;
      if (this.coastMs <= 0) {
        this.coastMs = 0;
        this.play(CLIP_IDLE);
      }
    } else {
      this.play(CLIP_IDLE);
    }
    if (this.targetYaw !== null) {
      // The last beat of a walk: onto the yaw the arrival asked for, at the rate the body turns.
      const next = stepAngle(this.yaw, this.targetYaw, TURN_RATE * dt);
      const remaining = Math.abs(wrapAngle(this.targetYaw - next));
      this.yaw = remaining <= YAW_EPSILON ? this.targetYaw : next;
      if (remaining <= YAW_EPSILON) this.targetYaw = null;
      this.root.rotation.set(0, this.yaw, 0);
      moved = true;
    }
    this.mixer.update(dt);
    return moved;
  }

  /** Stop replaying without moving the body — for a walk whose person left the roster mid-stride. */
  stopWalk(): void {
    this.replay = null;
    this.playedId = null;
    this.settleYaw = null;
    this.settling = false;
    this.targetYaw = null;
    this.coastMs = 0;
  }

  /** Geometry and materials are the PROTOTYPE's and are shared with every sibling — disposing them here
   *  would blank every other body of the same character. Only what this body owns goes: its mixer's
   *  bindings, its nameplate canvas, and its own node. */
  dispose(): void {
    if (this.label) {
      const m = this.label.material;
      m.map?.dispose();
      m.dispose();
      this.root.remove(this.label);
      this.label = null;
    }
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
    this.root.clear();
  }
}

export type CoworkerStats = {
  rendered: number;
  /** of `rendered`, how many are replaying a walk right now (Phase 6A). A count, never who. */
  walking: number;
  /** of `rendered`, how many are seated in a chair this world identified (Phase 6C). A count, never who. */
  seated: number;
  /** of `rendered`, how many stand on a LIVE persisted position rather than their derived desk (Phase
   *  4B). A count, never a list of who — the readouts this feeds stay redacted. */
  live: number;
  unplaced: string[];
  missingAvatar: string[];
  triangles: number;
  loading: boolean;
};

/** One rendered body, for the dev verification surface. Display name, world position and which way it is
 *  looking — the same facts the scene graph already carries in `root.name` and `root.rotation`, and
 *  deliberately NOT the email.
 *
 *  `yaw` is there for Phase 6B: whether a diagonal walk KEPT its heading or was squared up by the arrival
 *  is a question about rotation, and a two-session check had no way to ask it. Radians, as the body holds
 *  them (core/coords FACING_YAW's convention), rounded like x and z so a readout is stable to compare. */
export type CoworkerPosition = {
  name: string;
  x: number;
  z: number;
  yaw: number;
  source: "desk" | "live";
  /** the movement this body is replaying or last resolved, first 8 chars, or null — compare with the
   *  walker's own `selfMovement.movementId()` */
  movementId: string | null;
  /** the clip playing — idle, walking, running or seated — for telling a position stutter from an animation one */
  clip: string;
  /** PHASE 6C — the seat anchor this body is seated in, or null */
  seat: string | null;
};

/** PHASE 6C — WHERE A SEAT ANCHOR PUTS A BODY, answered by the world (which owns the chair views).
 *  `contact` is the cushion point in world space; `yaw` the chair's own seated rotation; `kind` selects
 *  the pose formula (a movable desk chair and fixed lounge seating land the pelvis differently — see
 *  interact/seatContact); `sink` is the lounge cushion's compression. */
export type SeatAnchorPose = { contact: THREE.Vector3; yaw: number; kind: "seat" | "lounge"; sink?: number };

export interface CoworkersDeps {
  parent: THREE.Object3D;
  /** the world's own player stand test */
  canStand: StandTest;
  /** body radius the stand test was built for (NAV_RADIUS) */
  radius: number;
  /** V1 frame point -> built V2 world point, room shifts applied */
  toWorld: (p: Vec2) => Vec2;
  lod?: AvatarLod;
  /** PHASE 6C — resolve a seat anchor id to the pose a body takes in it, or null for an anchor this world
   *  has no chair for. The world implements it over its own chair views (and tucks the chair in while it
   *  is occupied, as the local sit does); this module only asks. Absent = nobody can be drawn seated. */
  seatAnchor?: (id: string) => SeatAnchorPose | null;
  /** PHASE 6C — the anchor is no longer occupied by the body that held it; the world returns the chair. */
  releaseSeat?: (id: string) => void;
  /** WHAT KIND of change a sync produced, because the two cost the renderer different things.
   *
   *  "population" — a body was added or removed. The new clone's MESHES only exist now, so they still
   *                 have to join the dynamic-caster layer before the composite pass can draw them.
   *  "position"   — the same bodies, somewhere new. Nothing was created; only the composite is stale.
   *
   *  A sync that does both reports "population", which is the superset. */
  onChanged?: (change: CoworkerChange) => void;
}

/** See CoworkersDeps.onChanged. */
export type CoworkerChange = "population" | "position";

/** THE COWORKERS. One group in the scene; everything in it is disposable in one call. */
export class Coworkers {
  readonly group = new THREE.Group();
  private readonly deps: CoworkersDeps;
  /** THE PLACEMENT PASS, kept across syncs rather than rebuilt per call — see CoworkerPlacer. This is the
   *  whole of Phase 4C stage 3: with live positions arriving several times a second, re-searching a
   *  standing spot for every stationary person on every tick was the measured main-thread spike. The
   *  answers it reuses are the answers the uncached pass would have recomputed identically. */
  private readonly placer: CoworkerPlacer;
  private bodies = new Map<string, CoworkerBody>();
  /** THE LATEST PLACEMENT for everyone who should have a body, by email. Rewritten by every sync,
   *  population or position. A GLB that lands mid-flight reads its body's spot from HERE rather than from
   *  the placement its own batch captured, so somebody who moved while their character was downloading is
   *  added where they are NOW, not where they were when the fetch started. */
  private wanted = new Map<string, CoworkerPlacement>();
  /** Emails whose GLB is in flight right now. This is what lets a position update recognise itself as one
   *  while a population load is still running: somebody who is neither rendered nor loading is a
   *  newcomer, and a sync with no newcomers cannot need to fetch anything. */
  private loading = new Set<string>();
  /** The last sync's roster-shaped facts, kept on the instance rather than closed over, so the expensive
   *  path's final publish (which happens after an await) reports the NEWEST answer and not the one its own
   *  batch captured several syncs ago. */
  private lastUnplaced: string[] = [];
  private lastMissingAvatar: string[] = [];
  private stats: CoworkerStats = { rendered: 0, walking: 0, seated: 0, live: 0, unplaced: [], missingAvatar: [], triangles: 0, loading: false };
  /** Bumped by every POPULATION sync. A GLB that lands after a newer roster arrived belongs to a world
   *  state that no longer exists, and is dropped rather than added — the roster can change while 8 MB is
   *  in flight. Deliberately NOT bumped by a position sync: doing so would cancel every in-flight load
   *  each time anybody took a step, and nobody would ever finish loading. */
  private generation = 0;
  private disposed = false;

  constructor(deps: CoworkersDeps) {
    this.deps = deps;
    this.placer = new CoworkerPlacer(deps.toWorld, deps.canStand, deps.radius);
    this.group.name = "coworkers";
    deps.parent.add(this.group);
  }

  get size(): number { return this.bodies.size; }
  getStats(): CoworkerStats { return this.stats; }

  /** Every rendered body, for the dev verification surface (app/world.ts's `__vo3d.coworkers`). Name and
   *  world position only — no email, no roster row, nothing derived from the session. */
  positions(): CoworkerPosition[] {
    const out: CoworkerPosition[] = [];
    for (const [email, body] of this.bodies) {
      out.push({
        name: body.displayName,
        x: Math.round(body.root.position.x * 10) / 10,
        z: Math.round(body.root.position.z * 10) / 10,
        yaw: Math.round(body.facingYaw * 1000) / 1000,
        movementId: body.movementId?.slice(0, 8) ?? null,
        clip: body.clip,
        source: this.wanted.get(email)?.coworker.posSource ?? "desk",
        seat: body.seatedIn,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Reconcile the scene against a roster. Adds what is new, moves what has moved, removes what is gone,
   * and leaves an unchanged body completely untouched (no reload, no re-clone, no nameplate rebuild) —
   * a roster refetch fires on every SSE reconnect, and rebuilding the room each time would restart every
   * idle animation.
   *
   * SPLIT IN TWO INTERNALLY (Phase 4B) — see the module header. A sync with no newcomers never awaits,
   * never bumps `generation` and never touches a mixer, so a stream of live position updates cannot
   * disturb a GLB that is still downloading or restart an idle clip that is already playing.
   */
  async sync(list: readonly Vo3dCoworker[], missingAvatar: readonly string[] = []): Promise<void> {
    if (this.disposed) return;

    const { placed, unplaced } = this.placer.place(list);
    this.wanted = new Map(placed.map((p) => [p.coworker.email, p]));
    this.lastUnplaced = unplaced;
    this.lastMissingAvatar = [...missingAvatar];

    // ---- population reconciliation, first half: who no longer belongs -------------------------------
    // REMOVAL AND MOVEMENT ARE COUNTED APART. They used to share one `changed` flag, which meant the world
    // could not tell a body appearing (new meshes, which need the caster layer) from a body sliding across
    // the floor (nothing new at all). See CoworkersDeps.onChanged.
    let removed = false;
    for (const [email, body] of [...this.bodies]) {
      const next = this.wanted.get(email);
      // An avatarId change is a different character, not a moved one — the body has to be rebuilt.
      if (!next || next.coworker.avatarId !== body.avatarId) {
        if (body.seatedIn !== null) this.deps.releaseSeat?.(body.seatedIn);
        body.stopWalk();
        body.dispose();
        this.bodies.delete(email);
        removed = true;
      }
    }

    // ---- position updates, for everyone who already has a body -------------------------------------
    // Synchronous, and the only thing the cheap path does. A body whose coordinates are unchanged is not
    // written to at all, so `moved` stays false and the shadow map is left alone.
    const moved = this.applyPositions();
    /** a sync that both removed somebody and moved somebody reports the superset */
    const reported: CoworkerChange | null = removed ? "population" : moved ? "position" : null;

    // ---- THE CHEAP PATH: same people, somewhere new ------------------------------------------------
    const newcomers = placed.filter(
      (p) => !this.bodies.has(p.coworker.email) && !this.loading.has(p.coworker.email),
    );
    if (newcomers.length === 0) {
      this.publishStats(this.loading.size > 0);
      if (reported) this.deps.onChanged?.(reported);
      return;
    }

    // ---- THE EXPENSIVE PATH: somebody new, or a different character --------------------------------
    // Takes over everything in flight: `additions` is computed against the RENDERED bodies alone, so a
    // person whose load the previous generation is about to drop is re-requested here rather than lost.
    // prototypeFor is promise-cached per (character, LOD), so re-requesting one already in flight attaches
    // a second continuation to the same fetch — it does not start a second one.
    const generation = ++this.generation;
    const additions = placed.filter((p) => !this.bodies.has(p.coworker.email));
    this.loading = new Set(additions.map((p) => p.coworker.email));
    this.publishStats(true);
    if (reported) this.deps.onChanged?.(reported);

    // Loaded in parallel, added in list order, so the scene graph order does not depend on which GLB
    // happened to resolve first. prototypeFor is cached per (character, LOD), so a second person of the
    // same character costs a clone, not a fetch.
    const lod = this.deps.lod ?? 1;
    const protos = await Promise.all(
      additions.map((p) =>
        // A character whose GLB will not load must not take the world down with it, or one bad asset
        // costs every other coworker too. The failure is swallowed to a null and that person is simply
        // absent, which is the same honest absence a missing registry entry produces.
        prototypeFor(p.coworker.avatarId, lod).catch((e: unknown) => {
          console.warn(`vo3d: could not load the 3D character for ${p.coworker.displayName}`, e);
          return null;
        }),
      ),
    );
    // The world may have been disposed, or a newer POPULATION roster may have arrived, while those were
    // in flight. The newer batch owns `loading` now, so this one clears nothing on its way out.
    if (this.disposed || generation !== this.generation) return;

    let added = false;
    for (let i = 0; i < additions.length; i++) {
      const proto = protos[i];
      if (!proto) continue;
      const email = additions[i].coworker.email;
      // THE NEWEST SPOT, not the one this batch captured: position syncs have been running freely while
      // this downloaded. A person who dropped off the roster in the meantime has no entry and is skipped.
      const spot = this.wanted.get(email);
      if (!spot || this.bodies.has(email)) continue;
      const { coworker, pos } = spot;
      // Deterministic per person rather than random: the same viewer reloading, and two viewers looking
      // at the same room, see the same stagger instead of a fresh shuffle.
      const phase = phaseFor(coworker.email);
      const body = new CoworkerBody(proto, coworker.displayName, pos, coworker.yaw ?? FACING_YAW[coworker.facing], phase);
      // PHASE 6A — A NEWCOMER MAY ALREADY BE WALKING. `applyPositions` only reaches bodies that exist, and
      // this one did not until now: somebody whose character was still downloading when their movement
      // started, or anybody at all on the very first sync. The walk comes from the NEWEST spot (like the
      // position beside it), and its own elapsed time puts them part way along rather than at the origin.
      if (coworker.walk) {
        body.beginWalk(
          coworker.walk.movementId,
          coworker.walk.path.map(this.deps.toWorld),
          coworker.walk.durationMs,
          coworker.walk.elapsedMs,
          coworker.walk.pacing,
        );
      } else if (coworker.seat) {
        // PHASE 6C — a newcomer may already be SEATED (the first sync of a session finds most people
        // wherever V1 last saw them, chairs included).
        const pose = seatedPose(this.deps.seatAnchor?.(coworker.seat) ?? null, coworker.yaw);
        if (pose) body.sitAt(coworker.seat, pose);
      }
      this.group.add(body.root);
      this.bodies.set(email, body);
      added = true;
    }

    this.loading.clear();
    this.publishStats(false);
    if (added) this.deps.onChanged?.("population");
  }

  /** THE POSITION HALF, and after Phase 6A the MOVEMENT half too. Still synchronous, still touching no
   *  clone and no nameplate, and still reporting whether anything changed.
   *
   *  THREE CASES PER BODY, and the movement id is what tells them apart:
   *
   *    A NEW MOVEMENT (`walk` present, id differs from what the body is replaying) — start replaying it.
   *      That covers a fresh walk, a REDIRECT (V1 publishes a successor with its own id and never an
   *      arrival for the one it replaced, so the successor simply takes over), and a movement already in
   *      flight when this viewer connected (its own fast-forward puts the body mid-route).
   *
   *    THE SAME MOVEMENT (ids match) — leave it entirely alone. This is the case that makes the walk
   *      smooth: a re-render caused by somebody ELSE's event re-pushes this person's unchanged walk
   *      several times a second, and snapping them to their stable position on each one is precisely the
   *      stutter Phase 4B had. The stable half is deliberately not applied while its own walk is running;
   *      the walk is the newer account of the same person.
   *
   *    NO MOVEMENT (`walk` absent) — the authoritative stable position governs, through reconcileTo:
   *      already-there snaps, a short gap glides, a long one snaps. That is the arrival, the interrupted
   *      walk, the late arrival and the reconnect correction, all in one rule.
   */
  private applyPositions(): boolean {
    let moved = false;
    for (const [email, body] of this.bodies) {
      const spot = this.wanted.get(email);
      if (!spot) continue;
      const walk = spot.coworker.walk;
      if (walk) {
        if (body.movementId !== walk.movementId) {
          if (body.seatedIn !== null) this.deps.releaseSeat?.(body.seatedIn);
          body.beginWalk(walk.movementId, walk.path.map(this.deps.toWorld), walk.durationMs, walk.elapsedMs, walk.pacing);
          moved = true;
        }
        continue;
      }
      // PHASE 6C — SEATED. The chair, not the position, says where the body is: V1's `at` for a sitter is
      // the painted centroid (adapters/v1SelfMovement publishes exactly that), which is the chair's
      // footprint, not a standable point — so the stand-test placement is skipped and the anchor's own
      // cushion is used. An anchor this world cannot resolve falls through to the standing rule.
      const seat = spot.coworker.seat;
      if (seat) {
        const pose = seatedPose(this.deps.seatAnchor?.(seat) ?? null, spot.coworker.yaw);
        if (pose) {
          if (body.seatedIn !== seat || Math.abs(wrapAngle(body.facingYaw - pose.yaw)) > YAW_EPSILON) {
            if (body.seatedIn !== null) this.deps.releaseSeat?.(body.seatedIn);
            if (body.sitAt(seat, pose)) moved = true;
          }
          continue;
        }
      }
      if (body.seatedIn !== null) {
        this.deps.releaseSeat?.(body.seatedIn);
        body.standUp();
        moved = true;
      }
      // PHASE 6B — the exact yaw the walking session published, or V1's compass word when it did not.
      const yaw = spot.coworker.yaw ?? FACING_YAW[spot.coworker.facing];
      if (body.movementId !== null) {
        arrivals.push({ movementId: body.movementId.slice(0, 8), receivedYaw: spot.coworker.yaw ?? null, facing: spot.coworker.facing, applied: yaw });
        if (arrivals.length > ARRIVAL_TRACE_CAP) arrivals.shift();
      }
      if (body.reconcileTo(spot.pos, yaw)) moved = true;
    }
    return moved;
  }

  /** PHASE 6C — a seat's configured facing changed (dev tool): every body seated in `anchor` (or in any
   *  seat, when omitted) asks the world for its pose again and takes it. Position and clip are unchanged
   *  unless the pose says otherwise. Returns true when anything moved. */
  reposeSeated(anchor?: string): boolean {
    let moved = false;
    for (const body of this.bodies.values()) {
      if (body.seatedIn === null || (anchor !== undefined && body.seatedIn !== anchor)) continue;
      const pose = this.deps.seatAnchor?.(body.seatedIn) ?? null;
      if (pose && body.sitAt(body.seatedIn, pose)) moved = true;
    }
    if (moved) this.deps.onChanged?.("position");
    return moved;
  }

  /** How many bodies are seated. Read by the stats. */
  private get seatedCount(): number {
    let n = 0;
    for (const body of this.bodies.values()) if (body.seatedIn !== null) n++;
    return n;
  }

  /** How many bodies are replaying a walk. Read by the stats and by the world's shadow gate. */
  private get walkingCount(): number {
    let n = 0;
    for (const body of this.bodies.values()) if (body.moving) n++;
    return n;
  }

  /** IS ANYBODY WALKING? The world's frame loop folds this into its dynamic-shadow gate exactly as it
   *  already folds `crowd.moving`: a walking body deforms AND translates every frame, so the cheap
   *  composite pass is stale while it does. The static depth cache is never touched by this — a coworker
   *  is a registered dynamic caster and is hidden before the static pass draws. */
  get moving(): boolean {
    for (const body of this.bodies.values()) if (body.moving) return true;
    return false;
  }

  private publishStats(loading: boolean): void {
    let triangles = 0;
    let live = 0;
    for (const [email, body] of this.bodies) {
      triangles += body.triangles;
      if (this.wanted.get(email)?.coworker.posSource === "live") live++;
    }
    this.stats = {
      rendered: this.bodies.size,
      walking: this.walkingCount,
      seated: this.seatedCount,
      live,
      unplaced: this.lastUnplaced,
      missingAvatar: this.lastMissingAvatar,
      triangles,
      loading,
    };
  }

  /** ONE FRAME. Mixers, and — Phase 6A — whatever walk each body is replaying.
   *
   *  The cost per body is a handful of arithmetic ops plus the mixer update that was always here; the
   *  replay math is a segment lookup on a precomputed cumulative table (world/coworkerWalk.ts), not a
   *  search. A room of standing people pays exactly what it paid before: `replay` is null for all of them
   *  and the branch is not taken.
   *
   *  Returns TRUE when any body's transform changed, so the caller can invalidate the dynamic composite
   *  and nothing else. */
  /** PHASE 6D — WHO IS UNDER THE POINTER. The caller sets the ray (it owns the camera and the canvas);
   *  this answers which coworker it hit and how far away, so the caller can weigh that against whatever
   *  its OWN pick found — a body standing behind a desk must not beat the desk, and a body in front of
   *  one must not lose to it.
   *
   *  The bodies are raycast DIRECTLY, not through the scene: they live in this group and nowhere else, and
   *  the nameplate sprite is deliberately included — clicking somebody's name is clicking them. */
  pick(raycaster: THREE.Raycaster): { email: string; displayName: string; distance: number } | null {
    if (!this.group.visible) return null;
    const hits = raycaster.intersectObject(this.group, true);
    if (hits.length === 0) return null;
    // The hit's own subtree root IS the body (Coworkers.group's children are CoworkerBody.root), so the
    // owning email is found by walking up to the child of this group — never by name-matching.
    for (const hit of hits) {
      for (let n: THREE.Object3D | null = hit.object; n; n = n.parent) {
        if (n.parent !== this.group) continue;
        for (const [email, body] of this.bodies) {
          if (body.root !== n) continue;
          return { email, displayName: body.displayName, distance: hit.distance };
        }
      }
    }
    return null;
  }

  /** PHASE 6D — the world point an anchored card hangs off: the top of this person's head, which is where
   *  their nameplate already sits. Null for somebody with no body (not rendered, or still loading). */
  headPoint(email: string): THREE.Vector3 | null {
    const body = this.bodies.get(email);
    return body ? body.root.position.clone().setY(HEAD_ANCHOR_Y) : null;
  }

  /** PHASE 6D — where this person's body stands, in world units. Null when they have none. */
  pointOf(email: string): Vec2 | null {
    const body = this.bodies.get(email);
    return body ? { ...body.pos } : null;
  }

  /** PHASE 6D — everybody within `reach` of `p`. PLAYER mode's targeting scores a handful of candidates
   *  per frame and needs them as plain data; this is the only shape of that data the world hands out.
   *  Deliberately a distance filter and nothing more — the CONE is PlayerTargeting's judgement, not this
   *  module's, and duplicating it here is how the two would drift. */
  within(p: Vec2, reach: number): { email: string; displayName: string; pos: Vec2 }[] {
    const out: { email: string; displayName: string; pos: Vec2 }[] = [];
    for (const [email, body] of this.bodies) {
      const q = body.pos;
      if (Math.hypot(q.x - p.x, q.z - p.z) <= reach) out.push({ email, displayName: body.displayName, pos: q });
    }
    return out;
  }

  update(dt: number): boolean {
    if (!this.group.visible) return false;
    let moved = false;
    for (const body of this.bodies.values()) if (body.update(dt)) moved = true;
    return moved;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const body of this.bodies.values()) {
      if (body.seatedIn !== null) this.deps.releaseSeat?.(body.seatedIn);
      body.dispose();
    }
    this.bodies.clear();
    this.placer.invalidate();
    this.wanted.clear();
    this.loading.clear();
    this.lastUnplaced = [];
    this.lastMissingAvatar = [];
    this.group.removeFromParent();
    this.stats = { rendered: 0, walking: 0, seated: 0, live: 0, unplaced: [], missingAvatar: [], triangles: 0, loading: false };
  }
}

/** THE YAW A SEATED PEER TAKES: the yaw the SITTER published (their own configured facing, exact, Phase
 *  6B's wire field) when there is one, else the local table's facing for the anchor (`pose.yaw`) — which is
 *  what a V1 sitter, who publishes no yaw, gets. The published one wins so every browser shows exactly
 *  what the sitter sees, including a facing edited in the dev tool before it is saved. */
function seatedPose(pose: SeatAnchorPose | null, publishedYaw: number | undefined): SeatAnchorPose | null {
  if (!pose) return null;
  return publishedYaw === undefined ? pose : { ...pose, yaw: wrapAngle(publishedYaw) };
}

/** A stable 0..1 from an email — the idle-phase stagger, deterministic per person. */
export function phaseFor(email: string): number {
  let h = 2166136261;
  for (let i = 0; i < email.length; i++) {
    h ^= email.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
