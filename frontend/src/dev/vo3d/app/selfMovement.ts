// vo3d app — THE SELF-MOVEMENT CONTRACT, the Phase 5 counterpart to identity.ts and spawn.ts.
//
// Same split, same reason as those two: the V1 side (adapters/v1SelfMovement.ts) reaches into V1's auth
// store, V1's manifest and V1's movement socket, while app/world.ts must stay loadable by the standalone
// dev page with no V1 service anywhere in its graph. The types both sides name live here, in a module
// that imports nothing but V2's own coordinate leaf.
//
// WHAT PHASE 5 IS. Phases 4A/4B made V2 a READER of V1's movement feed — the roster's coworkers standing
// where V1 last saw them stop, and not one byte emitted. Phase 5 makes the SIGNED-IN EMPLOYEE'S OWN
// movement flow the other way: V2 drives the body, and V1's existing pipeline carries it. Explicitly:
//
//   • THERE IS NO SECOND MOVEMENT SYSTEM. V1's `walk_started` / `walk_arrived` are the only events, on
//     V1's own module-level socket (services/presence/movementSync), with V1's own path cap, duration
//     clamp and server-issued revision ordering. V2 adds no event, no endpoint and no socket.
//   • V1 STAYS THE AUTHORITY FOR THE PERSISTED POSITION. The backend writes employee_positions on
//     `walk_arrived` and on nothing else, so a position only becomes durable when V2 says a movement
//     finished. V2's own home-desk spawn (app/spawn.ts) is still a PREVIEW and is never published —
//     standing somewhere is not moving there.
//   • PEERS SEE A WALK, NOT A TELEPORT. Every published movement is a real origin, a real polyline and a
//     real duration, which is exactly what V1's PeerWalker replays. Nothing is invented and nothing is
//     rounded into a jump except an actual jump (see TELEPORT_UNITS).
//
// WHY THIS IS NOT makeMoveSelf (components/OfficeMap/useSelfMovement.ts). That funnel is V1's, and it is
// welded to V1's walker: it computes the duration from V1's own easing formula (3.4 ms per frame unit)
// and then DRIVES the walk itself through useCharacterWalk's rAF loop. V2's body is moved by V2's
// NavigationController and PlayerBody at V2's speeds, so a funnel that owns the walk cannot be the one
// used here — it would either move the avatar twice or broadcast a duration the avatar does not honour.
// What IS reused is everything below the walk: the events, the socket, the movement-id rule, the path
// cap, the duration sanitiser and the facing vocabulary. See adapters/v1SelfMovement.ts.
import { dist, facingForYaw, wrapAngle, type Facing, type Vec2 } from "../core/coords";

/** How a peer replays a movement — the same two words app/coworkers.ts's Vo3dWalkPacing spells, restated
 *  rather than imported so this module keeps exactly one import (spawn.phase5.test.ts holds it to that:
 *  the feed must stay loadable by the standalone page). "linear" is what a free-movement leg is. */
export type SelfWalkPacing = "eased" | "linear";

/** WHERE V2 PUBLISHES A MOVEMENT TO. Implemented by adapters/v1SelfMovement.ts for a real signed-in
 *  session, and by nothing at all for the standalone dev page — which therefore emits nothing, exactly as
 *  it always has.
 *
 *  COORDINATES ARE V1 FRAME-UNIT CENTRE POINTS, the same basis Vo3dHomeDesk.point is in. The caller
 *  (app/world.ts) converts from world units through app/spawn.ts's v1FramePoint, because "where a V2 room
 *  actually stands" is V2's own fact about its own geometry and the room-shift table has exactly one
 *  owner. The sink undoes the remaining V1-side offset (a sprite's top-left origin, against THAT
 *  employee's own manifest box) — see the adapter. */
export interface Vo3dSelfMovementSink {
  /** A movement has begun: from `origin`, along `path`, taking `durationMs`. Pairs with exactly one
   *  `arrived` or with a superseding `started` (V1's own redirect rule — a newer walk_started outranks
   *  the movement it replaces, and the abandoned one's arrival is simply never sent). */
  started(origin: Vec2, path: readonly Vec2[], durationMs: number, pacing?: SelfWalkPacing): void;
  /** That movement ended HERE, facing this way. `at` is where the body actually stopped, which for an
   *  interrupted walk is not the end of the path it was given — the backend validates the arrival against
   *  the active movement id, never against the path, so the truth is what gets persisted.
   *
   *  `yaw` is the body's ACTUAL resting rotation, radians, wrapped to (-π, π] — Phase 6B. `facing` is the
   *  same fact in V1's four words and stays beside it for every V1 reader; a 3D peer turns to `yaw`. It
   *  is the yaw the body HAS, never the heading it was travelling: the navigation controller turns at a
   *  finite rate and does not turn at all on the frame a path empties, so the two differ on any short or
   *  sharp final segment — which is exactly the difference a peer could not see and V1 could not say.
   *
   *  `seat` — PHASE 6C — is the V2 SEAT ANCHOR the body ended this movement sitting in (app/seats.ts
   *  ids), or absent for a body that stopped standing. The sink decides what V1 is told: a chair V1 knows
   *  becomes `state: "sitting"` with V1's own seat key, a V2-only chair is published as standing at the
   *  chair (adapters/v1Seats). The feed never learns V1's seat vocabulary. */
  arrived(at: Vec2, facing: Facing, yaw: number, seat?: string): void;
  /** PHASE 7D — THE BODY IS NOW IN A NAMED PLACE V1 HAS NO COORDINATE FOR.
   *
   *  NOT to be confused with the feed's own `placed()` below, which means the opposite: that one is a
   *  SILENT placement ("the body was put here, publish nothing"). This one publishes.
   *
   *  The CAVE is at x 2600, outside V1's frame entirely (see `inRange` below), so a body inside it has no
   *  position the movement wire can carry. Before this, crossing that boundary published nothing at all
   *  and every peer left the employee standing at the last in-frame point — the hub, just outside the
   *  portal — which is exactly what "their pill is outside the Cave and their avatar is nowhere" was.
   *
   *  Nothing is fabricated. `at` is the real, in-frame point the body left from (the portal it stepped
   *  through), so V1 and any V1 client still hold a true position for them; `room` is the extra fact that
   *  says where they actually went. Peers that understand the room put the body there (adapters/
   *  v1CoworkerPositions); peers that do not still see them at the portal, which is where V1 thinks they
   *  are and is not a lie.
   *
   *  Published as the same minimum-duration movement pair every other snap uses — this protocol's way of
   *  saying "they are here now" — so no new event, no new validation and no backend change. */
  enteredPlace(at: Vec2, yaw: number, room: string | null, localAt?: Vec2): void;
  /** PHASE 7D — ONE LEG OF REAL MOVEMENT INSIDE A NAMED PLACE.
   *
   *  `anchor` is the in-frame point V1 keeps holding for this employee and is republished unchanged on
   *  every leg — nothing out-of-frame is ever written as a V1 coordinate. `from`/`to` are the real
   *  movement, in `room`'s frame. Published as an ordinary started/arrived pair so peers replay it
   *  through the interpolation every office walk already uses. */
  movedInPlace(anchor: Vec2, from: Vec2, to: readonly Vec2[], yaw: number, room: string): void;
  /** THIS EMPLOYEE JUST JUMPED. A transient, cosmetic relay and NOT a movement: it carries no
   *  position, no duration and no id, it pairs with nothing, it resolves nothing in flight, and the
   *  feed above never calls it — the world does, straight from the takeoff.
   *
   *  It lives on this interface anyway because this interface is the one seam between V2's world and
   *  V1's socket, and the alternative was a second one. OPTIONAL: the standalone dev page's sink does
   *  not implement it, and a jump there simply stays local, exactly as everything else there does. */
  jumped?(): void;
  /** Counters for the dev readout — how many movements went out, and how many were refused because they
   *  were not expressible as a V1 position. Numbers only, never a coordinate.
   *
   *  `wire` is a bounded ring of what actually went out, newest last, for verification: it is the only way
   *  to tell a planned walk, a sampled free leg, a boundary snap and a redirect apart after the fact, and
   *  a count alone cannot. It carries SHAPES — the event, the movement id, how many waypoints, how long —
   *  and no coordinates, for the same redaction reason the DOM readout is counts-only. */
  readonly state: { started: number; arrived: number; refused: number; wire: string[]; movementId?: string | null; seated?: number; v2OnlySeat?: number; jumps?: number };
}

/** THE PLANNED-WALK DURATION V2 WILL ACTUALLY TAKE, in ms.
 *
 *  NOT V1's walkDurationMs. That formula (clamp(500, 3500, distance × 3.4)) describes V1's own eased rAF
 *  walker, which crosses the whole office in three and a half seconds; V2's NavigationController walks at
 *  a constant `speed` units/s (70 by default, the GUI slider's live value). Broadcasting V1's number for
 *  a V2 walk would have every peer replay the walk four times too fast and then stand waiting for an
 *  arrival — the duration is a FACT ABOUT THIS WALK, not a rule to be reused, and the honest fact is how
 *  long the body is really going to be moving.
 *
 *  The origin is included because the first leg (current position → first waypoint) is part of the walk.
 *  adapters/v1SelfMovement leaves the clamp to V1's own sanitiser, which is the one place the backend's
 *  [100, 20000] window is enforced. */
export function plannedDurationMs(origin: Vec2, path: readonly Vec2[], speed: number): number {
  if (path.length === 0 || speed <= 0) return 0;
  let total = 0;
  let from = origin;
  for (const p of path) { total += dist(from, p); from = p; }
  return (total / speed) * 1000;
}

/** How long a stretch of free movement is allowed to run before it is closed and published as one
 *  movement. Free movement (WASD, or an interaction walking the body itself) has no path known up front,
 *  so it cannot be announced before it happens — it is published as a sequence of legs instead.
 *
 *  LEG LENGTH IS THE ONLY LEVER THE PROTOCOL OFFERS, and it is worth being exact about why. A free walk
 *  cannot be announced before it happens, so a peer's view of it is always: observe for one leg, then
 *  replay for one leg. The lag is therefore between one and two leg lengths, whatever else is tuned —
 *  there is no way to shorten it without either shortening the leg or misstating how long the walk took,
 *  and misstating the duration would make peers replay a real path at a speed nobody walked.
 *
 *  600 ms measured out at roughly 0.6–1.2 s behind a continuously walking player. 400 brings that to
 *  0.4–0.8 s, a third off, for 1.5x the movements — and each movement is one revision bump plus one
 *  employee_positions write on its arrival, which is the real cost being spent. Shorter still (200 ms,
 *  five writes a second per walking employee) buys less than it costs on a shared backend.
 *
 *  A PLANNED walk is unaffected and has no lag at all: its whole path is known up front, so peers replay
 *  it in step with the local walk. This constant only governs free movement. */
const LEG_MS = 400;
/** How long the body has to be still before a free leg is closed. Short enough that stopping publishes
 *  the final position (and its facing) promptly, long enough not to split a walk at every frame where a
 *  wall slide or a key change happened to cover no ground. */
const SETTLE_MS = 120;
/** Below this, a leg is jitter rather than movement and is not published at all — a revision bump per
 *  frame of numeric noise is exactly the kind of traffic V1's own zero-length-path guard refuses. */
const MIN_LEG_UNITS = 2;
/** Spacing of the intermediate waypoints sampled out of a free walk. The polyline peers replay is the
 *  route actually taken, not a straight line to the end, and 12 units is fine enough to keep a corner in
 *  it while leaving a 600 ms sprint leg at five points — far under V1's own 64-point path cap. */
const SAMPLE_UNITS = 12;
/** Hard ceiling on the points in one published leg, so a pathological frame pattern can never approach
 *  V1's cap and get the whole path downsampled by capPath. */
const MAX_LEG_POINTS = 24;
/** A single-frame displacement this large is not walking — it is a seat attaching the body, a CAVE
 *  portal, or a restore. It is published as a minimum-duration movement (a snap, honestly labelled)
 *  rather than as a leg that would claim the body sprinted there. */
const TELEPORT_UNITS = 40;
/** The floor V1's own sanitiser enforces; restated for the teleport case so the intent is explicit rather
 *  than an accident of clamping. */
const MIN_DURATION_MS = 100;
/** Position changes under this are numerically indistinguishable from none. */
const EPSILON = 1e-4;

/** Can this point be published at all? Injected because the answer is V1's, not V2's: only the caller
 *  knows where V1's coordinate frame ends (app/world.ts composes it from adapters/v1Floor's FRAME). The
 *  default says yes to everything, which is exactly right for the standalone dev page — it publishes
 *  nothing, so the question never arises. */
export type InRangeTest = (p: Vec2) => boolean;

type Mode =
  | { kind: "idle" }
  | { kind: "planned" }
  | { kind: "free"; origin: Vec2; points: Vec2[]; movingMs: number; stillMs: number; sinceSample: number }
  /** PHASE 6C — the body is in a chair. Nothing it does there is a movement: the chair tucking in and
   *  rolling out carries it a few units, the seated clip breathes, and none of that is published. The
   *  seated arrival has already said everything V1 needs; the next thing worth a word is standing up. */
  | { kind: "seated" };

/**
 * WHAT TURNS V2's CONTINUOUS MOVEMENT INTO V1 MOVEMENTS.
 *
 * V1's wire vocabulary has exactly two words — a walk began, a walk ended — and no "I am here now". So
 * every way V2 can move a body has to be expressed as a started/arrived pair, and this is the one place
 * that decision is made. It is pure: given a frame's position, heading and whether the planner is
 * driving, it calls the sink. It opens nothing, holds no timer and reads no clock — `frame` is handed the
 * elapsed milliseconds, so a test drives it exactly as the render loop does.
 *
 * THE TWO SHAPES OF MOVEMENT, and why they are published differently:
 *
 *   PLANNED (Office View click-to-walk). The whole path and the whole duration are known before the body
 *   moves, which is precisely the shape V1's own walks have — so it is announced immediately and peers
 *   replay it LIVE, in step with the local walk. `planned()` at the start, and the end is detected from
 *   the planner going quiet: a walk that arrived and a walk that was interrupted (an interaction taking
 *   the avatar, PLAYER mode taking over, a redirect) both resolve at the body's ACTUAL position, so a
 *   peer is never left believing somebody is at the far end of a walk they abandoned halfway.
 *
 *   FREE (PLAYER mode's WASD, and any interaction that walks the body itself). Nothing is known in
 *   advance, so nothing can be announced in advance. The route is observed, closed into a leg every
 *   LEG_MS or when the body settles, and published as one movement whose duration is the time it really
 *   took. The matching arrival is then held back for exactly that duration, so the peer's replay runs to
 *   the end of the leg instead of being cut short by an arrival landing in the same tick — that is the
 *   difference between peers seeing a walk and peers seeing a row of snaps.
 */
export class SelfMovementFeed {
  private readonly sink: Vo3dSelfMovementSink;
  private mode: Mode = { kind: "idle" };
  private last: Vec2 | null = null;
  private lastYaw = 0;
  /** A leg's arrival, held until its replay would have finished. Never more than one: a leg cannot be
   *  closed without the previous one's arrival being flushed first. */
  private pending: { at: Vec2; facing: Facing; yaw: number; dueInMs: number; seat?: string } | null = null;

  private readonly inRange: InRangeTest;
  /** Was the body somewhere V1 can hold a position, last frame? Starts true so a world built inside the
   *  frame — every real session — does not open with a spurious re-entry snap. */
  private wasInRange = true;
  /** PHASE 7D — the named place the body is in (or about to be in) beyond V1's frame, or null. Set by the
   *  world when a portal takes the body somewhere V1 cannot describe; read on the boundary crossing. */
  private place: string | null = null;
  /** PHASE 7D — the last IN-FRAME point before leaving, republished as `at` on every local leg so V1's
   *  own coordinate never moves while somebody walks around a place it cannot describe. */
  private anchor: Vec2 | null = null;
  /** Where the last local leg ended, so the next one starts from a real previous position. */
  private localLast: Vec2 | null = null;

  constructor(sink: Vo3dSelfMovementSink, inRange: InRangeTest = () => true) {
    this.sink = sink;
    this.inRange = inRange;
  }

  /** A PLANNED walk has just been handed to the navigation controller.
   *
   *  Called with the path the planner produced, in world units, and the duration V2 will take to walk it.
   *  A planned walk SUPERSEDES whatever was happening: a previous planned walk is redirected exactly as
   *  V1 redirects one (the new walk_started outranks it; no arrival is sent for the abandoned one), and
   *  an accumulating free leg is dropped rather than published, because this walk's origin is the body's
   *  real current position and peers snap to it at the start of the replay. */
  planned(origin: Vec2, path: readonly Vec2[], durationMs: number): void {
    // A path with no distance in it is not a movement worth a revision bump — V1's own funnel emits
    // NEITHER event for one (useSelfMovement.ts's zero-length-path rule), and this is the same refusal.
    // Clicking the cell you already stand on is the case that produces it.
    if (path.length === 0 || durationMs <= 0) return;
    this.flushPending();
    this.mode = { kind: "planned" };
    this.last = origin;
    this.sink.started(origin, path, durationMs);
  }

  /** RESOLVE WHATEVER IS IN FLIGHT, HERE, NOW — because something outside the movement system is about to
   *  take the body.
   *
   *  `frame()` already resolves an interrupted planned walk the moment the planner goes quiet, but only on
   *  the NEXT frame. A caller that stops the walker and moves the body in the same tick (app/world.ts's
   *  ejectFromOffice, when V1 confirms a checkout) never gives it that frame, and calling placed() alone
   *  would drop the in-flight movement silently: peers would be left replaying a walk to a destination
   *  nobody reached, and — because the backend persists on arrival and on nothing else — no durable
   *  position would be written for where the body actually stopped. That was a real observed divergence
   *  between the two offices, not a theoretical one.
   *
   *  `pos` is where the body IS, which for an interrupted walk is not the end of its path. */
  interrupt(pos: Vec2, yaw: number): void {
    if (this.mode.kind === "seated") {
      // A seated body has nothing in flight and is NOT stood up by an interruption: the seated arrival is
      // the truth about where they are, and a teardown mid-sit must leave V1 holding it so the reload
      // restores the chair. Only an arrival still held back for a leg is flushed.
      this.flushPending();
      this.last = pos;
      this.lastYaw = yaw;
      return;
    }
    if (this.mode.kind === "free") this.closeFreeLeg(pos, yaw);
    else if (this.mode.kind === "planned") {
      this.mode = { kind: "idle" };
      this.sink.arrived(pos, facingForYaw(yaw), wrapAngle(yaw));
    }
    this.mode = { kind: "idle" };
    this.flushPending();
    this.last = pos;
    this.lastYaw = yaw;
  }

  /** THE BODY WAS PLACED, NOT MOVED — so this displacement is not a movement and is not published.
   *
   *  There is exactly one caller and one reason: app/world.ts's restoreSelf, which stands the employee on
   *  the position V1 ALREADY HOLDS FOR THEM. Publishing that would broadcast a walk to where everybody
   *  already thinks they are, bump a revision and trigger a DB write for no new fact — and, because
   *  placeNear may nudge the body a unit or two clear of the furniture, it would overwrite V1's own
   *  position with a slightly different one on every entry into the route. The spawn is silent for the
   *  same reason (there is no previous frame to compare against); this makes the restore silent too.
   *
   *  It is NOT for the deliberate relocations — the Reception/portal dev buttons, the CAVE transition.
   *  Those really do move the employee, and the teleport branch in frame() publishes them as the snaps
   *  they are. */
  placed(pos: Vec2, seated = false): void {
    // PHASE 6C — a seated RESTORE is a placement into the chair V1 already holds for this employee: silent,
    // like every placement, and it leaves the feed in the seated hold so the chair's own motion is not
    // published either. stood() is what ends it, exactly as after a sit the body performed itself.
    this.mode = seated ? { kind: "seated" } : { kind: "idle" };
    this.last = pos;
    // A placement can cross V1's frame boundary (the CAVE portal does exactly that), so the flag has to
    // follow the body — otherwise the next frame reads as a transition that never happened.
    this.wasInRange = this.inRange(pos);
  }

  /** PHASE 6C — THE BODY HAS SAT DOWN IN `seat`, here, facing `yaw`.
   *
   *  Called by app/world.ts the frame a seat interaction reaches its seated pose. Whatever movement brought
   *  the body here is resolved AS the seated arrival — V1's own sit is a walk whose walk_arrived says
   *  `sitting` (components/OfficeMap/useSelfMovement.ts's `arrival` metadata), and this is the same shape:
   *
   *    a free leg still accumulating (the walk up to the chair, the step into the gap) is closed and
   *      published, and its arrival — held back for the leg's replay as always — is the seated one;
   *    an arrival already held for the previous leg is re-pointed at the seat: that movement is the one
   *      that ended in the chair;
   *    nothing in flight (a body that was already standing at the chair) is a minimum-duration movement
   *      to the seat with its seated arrival sent at once — the same honest snap a teleport publishes,
   *      because V1 has no arrival without a movement to hang it on.
   *
   *  Then the feed holds in `seated` until stood(): see Mode. */
  seated(pos: Vec2, yaw: number, seat: string): void {
    if (this.mode.kind === "seated") return;
    const facing = facingForYaw(yaw);
    const wrapped = wrapAngle(yaw);
    if (this.mode.kind === "planned") {
      this.mode = { kind: "idle" };
      this.flushPending();
      this.sink.arrived(pos, facing, wrapped, seat);
    } else {
      if (this.mode.kind === "free") this.closeFreeLeg(pos, yaw);
      if (this.pending) {
        this.pending = { ...this.pending, at: pos, facing, yaw: wrapped, seat };
      } else {
        this.sink.started(this.last ?? pos, [pos], MIN_DURATION_MS);
        this.sink.arrived(pos, facing, wrapped, seat);
      }
    }
    this.mode = { kind: "seated" };
    this.last = pos;
    this.lastYaw = yaw;
  }

  /** PHASE 6C — THE BODY HAS LEFT ITS CHAIR. Ends the seated hold; from here the chair rolling out, the
   *  stand-up glide and the walk away are ordinary free legs, and the first walk_started among them is
   *  what releases the seat on V1's side (the backend clears the seat key on every walk_started). No
   *  arrival is fabricated here: standing up is not yet a place the body has stopped. */
  stood(pos: Vec2, yaw: number): void {
    if (this.mode.kind !== "seated") return;
    this.flushPending();
    this.mode = { kind: "idle" };
    this.last = pos;
    this.lastYaw = yaw;
  }

  /** PHASE 6C — THE SEATED BODY TURNED IN ITS CHAIR (the dev tool changed this seat's facing). V1's wire has
   *  no "I turned" word, so this is the smallest honest movement: a minimum-duration movement to the very
   *  same point, resolved at once as the same seated arrival with the new yaw — exactly the snap a teleport
   *  publishes. Peers re-seat the body at the new yaw; the seat is released and re-taken within one
   *  revision pair, which the backend's occupancy check permits for the holder. A no-op unless seated. */
  reseated(pos: Vec2, yaw: number, seat: string): void {
    if (this.mode.kind !== "seated") return;
    this.flushPending();
    this.sink.started(pos, [pos], MIN_DURATION_MS);
    this.sink.arrived(pos, facingForYaw(yaw), wrapAngle(yaw), seat);
    this.last = pos;
    this.lastYaw = yaw;
  }

  /** PHASE 7D — ONE LEG OF MOVEMENT INSIDE A NAMED PLACE.
   *
   *  Sampled on the SAME rule an in-frame free leg is (SAMPLE_UNITS of travel), so the event rate for
   *  walking the CAVE is the event rate for walking the same distance in the office — no new timer and
   *  no second movement system. `at`/`origin` are the anchor, unchanged every time; only the local
   *  coordinates move, which is exactly why the server can skip the database write. */
  private localLeg(pos: Vec2, yaw: number): void {
    const anchor = this.anchor;
    if (!anchor) return;
    const from = this.localLast;
    if (from && dist(from, pos) < SAMPLE_UNITS) return;
    this.localLast = pos;
    if (!from) return; // the first sample only establishes where this leg starts
    this.sink.movedInPlace(anchor, from, [pos], wrapAngle(yaw), this.place!);
  }

  /** PHASE 7D — NAME THE PLACE BEYOND THE FRAME the body is entering, before it gets there, or null on
   *  the way back. Called by the portal itself, which is the only thing that knows; the boundary crossing
   *  in frame() is what actually publishes it, so a portal that is refused publishes nothing. */
  entering(place: string | null): void {
    this.place = place;
  }

  /** Is the feed holding a seated body? Read by the world's readout and by tests. */
  get isSeated(): boolean { return this.mode.kind === "seated"; }

  /**
   * One frame, AFTER everything that moves the avatar has written this frame's transform.
   *
   * `navMoving` is "the navigation controller still has waypoints" — the one signal that separates a
   * planned walk from free movement, and the signal a planned walk's end is read from. Everything else is
   * derived from the position itself, so this feed does not need to know which of PLAYER mode, a seat, an
   * approach or a portal is driving: all of them are simply a body that moved.
   */
  frame(dtMs: number, pos: Vec2, yaw: number, navMoving: boolean): void {
    this.lastYaw = yaw;
    if (this.pending) {
      this.pending.dueInMs -= dtMs;
      if (this.pending.dueInMs <= 0) this.flushPending();
    }

    // PHASE 6C — SEATED: the chair may carry the body a few units (tuck, roll-out) and nothing about that
    // is a movement. Track the position so stood() and a later leg start from where the body really is.
    if (this.mode.kind === "seated") {
      this.last = pos;
      return;
    }

    // THE EDGE OF V1'S WORLD, HANDLED AS AN EDGE. V2's campus legs, the AI Lab and the CAVE are all
    // outside V1's coordinate frame, and V1 has no position to hold for a body out there. Before this,
    // a leg that began out there was refused whole by the adapter and every peer simply stayed at the
    // last position V2 had managed to publish — which is how an employee who walked out to the Lab and
    // came back was left standing in the wrong place for everybody else.
    //
    // Neither transition fabricates anything. Leaving publishes the leg UP TO the last in-frame sample —
    // a real position the body really occupied — so peers see them walk to the edge and stop there, which
    // is the truthful end of the part of the walk V1 can express. Returning publishes a SNAP to the first
    // in-frame sample, because the walk that brought them back happened somewhere V1 cannot describe: the
    // only honest statement left is "they are here now", and a minimum-duration movement is how this
    // protocol says that. Normal legs resume from there.
    const nowInRange = this.inRange(pos);
    if (this.wasInRange !== nowInRange) {
      this.wasInRange = nowInRange;
      if (!nowInRange) {
        // `last` is still the previous, in-frame sample — close the leg there, not out here.
        if (this.mode.kind === "free" && this.last) this.closeFreeLeg(this.last, yaw);
        else if (this.mode.kind === "planned" && this.last) { this.mode = { kind: "idle" }; this.sink.arrived(this.last, facingForYaw(yaw), wrapAngle(yaw)); }
        this.mode = { kind: "idle" };
        // PHASE 7D — SAY WHERE THEY WENT. The leg above ends at the boundary, which is true but not the
        // whole truth: they are in a named place out there. Publishing it at the SAME in-frame point adds
        // the fact without inventing a coordinate. Only when the world has named one — an unnamed
        // excursion (a campus leg) behaves exactly as it did.
        if (this.place && this.last) {
          this.anchor = this.last;
          // The position they landed on, published WITH the entry — otherwise a peer draws them at the
          // portal until they happen to take their first step, which reads as somebody standing in the
          // doorway of a room they are plainly inside.
          this.localLast = pos;
          this.sink.enteredPlace(this.last, wrapAngle(yaw), this.place, pos);
        }
        this.last = pos;
        return;
      }
      this.mode = { kind: "idle" };
      this.flushPending();
      // BACK INSIDE THE FRAME: a plain snap to where they re-appeared, and the room fact is cleared with
      // it — they are demonstrably not in the CAVE any more.
      this.sink.enteredPlace(pos, wrapAngle(yaw), null);
      this.last = pos;
      this.place = null;
      this.anchor = null;
      this.localLast = null;
      return;
    }
    if (!nowInRange) {
      // PHASE 7D — MOVEMENT OUT HERE IS REAL, AND NOW REPRESENTED.
      //
      // It used to be published as nothing at all, which is why two people standing in the CAVE could
      // not see each other walk. What changed is not WHERE it is published — `anchor` below stays the
      // last real in-frame point, so V1 still holds the portal for them and nothing out-of-frame is
      // ever written as a V1 coordinate — but that the real position now rides ALONGSIDE it, in the
      // frame `place` names. Peers who understand the place replay it through the same interpolation
      // every office walk uses; peers who do not see exactly what they saw before.
      //
      // Only inside a NAMED place. An unnamed excursion (a campus leg) is still unrepresented, because
      // there is no frame to say those numbers are in.
      if (!this.place || !this.anchor) {
        this.mode = { kind: "idle" };
        this.last = pos;
        return;
      }
      this.localLeg(pos, yaw);
      this.last = pos;
      return;
    }

    if (navMoving) {
      // The planner took over. A free leg being accumulated when that happens has already been dropped by
      // planned(); this branch also covers a path set by anything that did not announce itself, in which
      // case the safe reading is "not our movement to publish" rather than a leg with a fabricated origin.
      if (this.mode.kind === "free") this.mode = { kind: "idle" };
      this.last = pos;
      return;
    }

    if (this.mode.kind === "planned") {
      // ARRIVED, OR ABANDONED — the same resolution either way, and deliberately so. The body is where it
      // is; publishing that is what keeps every peer and the persisted row honest about an interrupted
      // walk. V1 leaves an abandoned walk unresolved only because a superseding walk_started always
      // follows it there; nothing guarantees that here.
      this.mode = { kind: "idle" };
      this.last = pos;
      this.sink.arrived(pos, facingForYaw(yaw), wrapAngle(yaw));
      return;
    }

    const step = this.last ? dist(pos, this.last) : 0;
    // FIRST FRAME OF A WORLD publishes nothing: `last` is null, so the home-desk spawn (and the default
    // one) is a placement, not a movement. V1's own spawn restore is the authority on where this employee
    // is, and app/world.ts's restoreSelf is how it lands here.
    if (this.last === null) { this.last = pos; return; }

    if (step > TELEPORT_UNITS) {
      // Not a walk. Publish it as the snap it is: one minimum-duration movement to the new point, with
      // its arrival sent immediately so peers resolve it at once instead of gliding across the office.
      const from = this.mode.kind === "free" ? this.mode.origin : this.last;
      this.mode = { kind: "idle" };
      this.flushPending();
      this.sink.started(from, [pos], MIN_DURATION_MS);
      this.sink.arrived(pos, facingForYaw(yaw), wrapAngle(yaw));
      this.last = pos;
      return;
    }

    if (step > EPSILON) {
      if (this.mode.kind === "idle") {
        this.mode = { kind: "free", origin: this.last, points: [], movingMs: 0, stillMs: 0, sinceSample: 0 };
      }
      const leg = this.mode;
      leg.movingMs += dtMs;
      leg.stillMs = 0;
      leg.sinceSample += step;
      if (leg.sinceSample >= SAMPLE_UNITS && leg.points.length < MAX_LEG_POINTS - 1) {
        leg.points.push(pos);
        leg.sinceSample = 0;
      }
      this.last = pos;
      if (leg.movingMs >= LEG_MS) this.closeFreeLeg(pos, yaw);
      return;
    }

    // Still. A leg in progress is closed once the body has been still long enough to call it a stop.
    if (this.mode.kind === "free") {
      this.mode.stillMs += dtMs;
      if (this.mode.stillMs >= SETTLE_MS) this.closeFreeLeg(pos, yaw);
    }
    this.last = pos;
  }

  /** Publish whatever is still in flight, now. Called from the world's teardown, where the movement
   *  socket is a module-level singleton that OUTLIVES the world — so the last thing a V2 session does is
   *  persist where it left the employee, rather than leaving the previous leg's arrival unsent and the
   *  durable position one leg stale. */
  dispose(): void {
    if (this.last) this.interrupt(this.last, this.lastYaw);
    else this.flushPending();
    this.mode = { kind: "idle" };
    this.last = null;
  }

  /** Close the accumulating free leg and publish it as one V1 movement. */
  private closeFreeLeg(end: Vec2, yaw: number): void {
    if (this.mode.kind !== "free") return;
    const leg = this.mode;
    this.mode = { kind: "idle" };

    const points = leg.points.slice();
    if (points.length === 0 || dist(points[points.length - 1], end) > EPSILON) points.push(end);
    let total = 0;
    let from = leg.origin;
    for (const p of points) { total += dist(from, p); from = p; }
    if (total < MIN_LEG_UNITS) return;

    // STRICT PAIRING. The previous leg's arrival goes out before this leg's start, always — a started
    // that overtakes the arrival it follows is a movement the backend rejects (wrong active movementId)
    // and a peer replay that never resolves.
    this.flushPending();
    const durationMs = Math.max(MIN_DURATION_MS, leg.movingMs);
    // LINEAR: a leg is a constant-speed sample of motion that did not stop, and is replayed as one.
    this.sink.started(leg.origin, points, durationMs, "linear");
    this.pending = { at: end, facing: facingForYaw(yaw), yaw: wrapAngle(yaw), dueInMs: durationMs };
  }

  private flushPending(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.sink.arrived(p.at, p.facing, p.yaw, p.seat);
  }
}
