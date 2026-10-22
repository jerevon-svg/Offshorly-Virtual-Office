// vo3d player — THE PLAYER CONTROLLER. Owns the avatar, the gameplay camera and the input while PLAYER
// mode is active, and owns NOTHING otherwise.
//
// It is a coordinator, not an engine: movement resolution is PlayerBody, the rig is PlayerCamera, the
// targeting is PlayerTargeting, the keys are PlayerInput. This file decides only WHO IS DRIVING and WHEN.
//
// OWNERSHIP HANDOFF is the delicate part, and it is deliberately explicit in both directions:
//
//   enter()   stop whatever was moving Bon (a walk, an approach, a seat), then acquire "Player". Bon is
//             re-seated on legal floor if an interaction had parked him somewhere a body cannot stand.
//   interact()release "Player" FIRST, then call V2's own starter. The starter routes with A*, acquires
//             "Interaction", and plays the existing animation — exactly as the GUI button does. Player
//             movement goes quiet automatically, because it only moves Bon while it owns him.
//   update()  when the stack falls back to "Idle" (the seat stood up, the approach finished) PLAYER takes
//             the avatar back. No polling of interaction internals: the stack IS the signal.
//   exit()    release, unlock the pointer, restore the avatar's visibility, hand the camera back.
//
// The full-transform invariant (avatar/Avatar.ts) is respected: every heading write here goes through
// setYaw(), never through `rotation.y`.
import * as THREE from "three";
import type { Avatar } from "../avatar/Avatar";
import { Momentum, type MomentumStep } from "./Momentum";
import type { ControllerStack } from "../avatar/Controller";
import { CLIP_IDLE, CLIP_RUN, CLIP_WALK } from "../adapters/v1Avatar";
import { locomotion, sprintStride } from "../avatar/gait";
import { headingFor, stepAngle, type Vec2 } from "../core/coords";
import type { WorldState } from "../world/WorldState";
import { PlayerBody, standablePointNear, type MoveHeights, type StandTest } from "./PlayerBody";
import { PlayerCamera, type PlayerView } from "./PlayerCamera";
import { PlayerHud } from "./PlayerHud";
import { PlayerInput } from "./PlayerInput";
import { AIRBORNE_POSE_PHASE, PlayerJump, WALK_JUMP } from "./PlayerJump";
import { collectCandidates, cycleTarget, nearbyFixture, pickTarget, rankTargets, REACH, type Candidate, type Target } from "./PlayerTargeting";
import { ScooterMotion, SCOOTER, SCOOTER_JUMP } from "./ScooterMotion";
import { HARD_FALL, LAND_ABSORB_FALL, PARKOUR_MS, ROLL_MS_RANGE } from "../avatar/parkourPose";
import { routeDuration, routeEntriesAt, routeExit, sampleRoute, ziplineHold, type RouteDir, type TraversalRoute } from "../world/traversalRoutes";
import { ZiplineTrolley } from "../world/ziplineRig";
import { MANTLE, planMantle, planVault, traverseHeight, traverseProgress, VAULT, type TraversalWorld, type TraversePlan } from "./traversal";
import { DRIFT, ScooterDrift } from "./ScooterDrift";
import { ScooterHud } from "./ScooterHud";

/** Shared empty list, so a frame with no dynamic candidates allocates nothing. */
const EMPTY_CANDIDATES: readonly Candidate[] = [];

/** how fast the avatar turns toward its heading in third person (rad/s) — the navigation controller's rate */
const TURN_RATE = 9;
/** RIDING: the chase camera's boom (a touch longer, so the road ahead reads at speed), how fast it
 *  swings in behind the deck (rad/s at speed), and how long a mouse look holds it off */
const RIDE_BOOM = 1.18;
/** the idle's frame a mounted rider holds: its start, the neutral stance every rig's arm correction was solved on */
const RIDE_IDLE_PHASE = 0;
/** GROUND FOLLOWING (world/exteriorGround via Avatar.groundAt): how fast the body settles onto a new
 *  surface height, per second — a 1.5 tread in ~0.1 s reads as a step, not a snap or a float — and the
 *  change beyond which it is a relocation, not a step, and is taken at once. */
/** PARKOUR V1 — what a relayed body action is (app/selfMovement carries it; world/Coworkers plays it) */
export type ParkourKind = "jump" | "double" | "roll" | "vault" | "mantle";

const GROUND_FOLLOW = 24;
const GROUND_SNAP = 6;
/** PARKOUR V1 — A LANDING ROLL needs a real fall (a double jump's peak, a table, a ledge — not an ordinary hop's
 *  11.7), some way on, and a clear path ahead on the same surface; anything less is a crouched landing. */
const ROLL_MIN_FALL = 18;
const ROLL_MIN_SPEED = 24;
/** how far a roll travels, units: scaled by the landing's speed and its forward momentum, inside these bounds */
const ROLL_DIST = { min: 18, max: 42 } as const;
/** the path is checked this often, units — a quarter of the body, so nothing thinner than that can hide in it */
const ROLL_PATH_STEP = 4;
/** the landing surface may rise or fall this much along the roll (a gentle slope) — more, and it is no place to roll */
const ROLL_SLOPE_MAX = 1.5;
/** speed handed back to the run when the roll ends, units/s — a roll is a way of keeping going */
const ROLL_EXIT_SPEED = 40;

/** PARKOUR V3 — the tallest top a body is stepped down off when something else takes it (furniture); above this it is a
 *  deck, a floor of its own, and the body is left standing on it */
const STEP_OFF_MAX = 30;
/** PARKOUR V2 — the speed a vault hands back to the run as the feet come down, units/s */
const VAULT_EXIT_SPEED = 46;

const _grip = new THREE.Vector3(), _gripAxis = new THREE.Vector3();
/** PARKOUR V3 — what the world is told about a route: started (with how far along), or cut short at a safe end */
export type RouteEvent =
  | { type: "start"; route: TraversalRoute; dir: RouteDir; ms: number; p0: number }
  | { type: "halt"; route: TraversalRoute; at: Vec2; feet: number; end: "start" | "exit" };

/** a planned roll: from where the feet landed, along the travel direction, `dist` units over `ms` */
export type RollPlan = { from: Vec2; to: Vec2; dir: Vec2; dist: number; ms: number };
const RIDE_CAMERA_FOLLOW = 3.2;
const RIDE_LOOK_HOLD = 1.2;
/** how far ahead of a moving player a door is told to expect him. One stride: enough for the leaf to be
 *  clear by the time he arrives, short enough not to open doors he is merely walking past.
 *
 *  EXPORTED because world/Coworkers gives a REPLICATED body the same courtesy, by the same figure: a
 *  peer whose replayed leg has run out still has a heading, and a door that expected the local employee
 *  one stride ahead but a coworker not at all is the asymmetry that let somebody walk through a shut
 *  door on the other browser. One number, one meaning, one place. */
export const DOOR_LOOKAHEAD = 46;
/** THE POINT A DOOR IS TOLD TO EXPECT A BODY AT: `look` units ahead of `p` along heading `h`, in headingFor's
 *  convention (core/coords: h = atan2(dx, dz), so its unit vector is (sin h, cos h)). Shared with world/Coworkers. */
export const doorLookahead = (p: Vec2, h: number, look = DOOR_LOOKAHEAD): Vec2 => ({ x: p.x + Math.sin(h) * look, z: p.z + Math.cos(h) * look });
/** THE TWO GROUND SPEEDS, in units/s, and the single place either of them is stated.
 *
 *  2026-10-21: the WALK is a brisk 42 (a foot-locked WALK, never a jog, for the HumanBase cast — avatar/gait); the
 *  sprint stays 100, so Shift is the brisk way across the office (SPRINT_MULTIPLIER is derived). Before that:
 *  70 / 100 replaced the original 30 / 54. The old pair was inherited from the click-to-walk router,
 *  where a stroll is the right read because the camera is watching the office; driving a body yourself at
 *  that speed makes an office the size of this one feel like a corridor to be endured. Nothing else about
 *  movement changes: the same WASD, the same camera-relative basis, the same PlayerBody.move, the same
 *  collision answer from the same DerivedNav / Walkability, the same NAV_RADIUS.
 *
 *  TUNNELLING IS UNAFFECTED, and that is arithmetic rather than optimism. PlayerBody splits EVERY step
 *  into sub-steps no longer than a quarter of the body radius (2 units at NAV_RADIUS 8) regardless of how
 *  long the step is, so the resolution of the sweep does not depend on speed at all — 100 u/s on a
 *  stalled-tab 250 ms frame is 25 units, resolved as 13 sub-steps, exactly as 54 u/s was resolved as 7. */
//
//  2026-10-21 (later): a faster walk (1.3x, 42 → 54.6) and a TRUE sprint (2x, 100 → 200), reached and left through
//  the body's momentum (player/Momentum) — a sprint builds, skids to a stop and leans into its turns. Still one
//  PlayerBody.move per frame, sub-stepped at a quarter of the body radius: 200 u/s tunnels nothing walking cannot.
export const PLAYER_WALK_SPEED = 54.6;
export const PLAYER_SPRINT_SPEED = 200;
/** SPRINT. A multiplier on the walk speed and nothing else — no stamina, no state, no second movement
 *  path. Holding Shift scales the per-frame delta; the delta still goes through PlayerBody.move, which
 *  sub-steps at a quarter of the body radius REGARDLESS of how long the step is, so sprinting cannot
 *  tunnel anything walking could not.
 *
 *  Derived from the pair above rather than written out, so the slider and the sprint stay consistent:
 *  whatever walk speed is in force, Shift is worth the same proportion of it. */
export const SPRINT_MULTIPLIER = PLAYER_SPRINT_SPEED / PLAYER_WALK_SPEED;
/** THE LOCOMOTION CLIP AND ITS PLAYBACK RATE now come from avatar/gait, which world/Coworkers reads too
 *  — the numbers were duplicated here and there, and the shared module is also where the "this package
 *  has no run clip" fallback is made to look right rather than skate. See its header. */

/** The airborne pose is AIRBORNE_POSE_PHASE, shared with every replicated body — see player/PlayerJump.
 *  Avatar.freezeClipAt does the holding; landing restores the rate. */

export type PlayerDeps = {
  avatar: Avatar;
  stack: ControllerStack;
  world: WorldState;
  canStand: StandTest;
  /** the laxer test the third-person boom is judged against (walls and unbuilt space only) */
  cameraProbe: StandTest;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** scene node the target marker is parented to */
  overlayRoot: THREE.Object3D;
  radius: number;
  avatarHeight: number;
  /** walking speed, read live so the GUI slider still applies */
  speed: () => number;
  /** hand an entity id to V2's existing interaction starters; returns false if it could not be started */
  activate: (id: string, kind: Exclude<Candidate["kind"], "route">) => boolean;
  /** PHASE 6D — candidates that MOVE, re-read every frame instead of harvested once at construction:
   *  the coworkers. Absent (the standalone dev page, and every phase before 6D) means there are none and
   *  this costs a single undefined check per frame. The scoring itself is untouched — the same pickTarget
   *  judges a person and a chair, so a chair you are standing on cannot be stolen by somebody behind you. */
  dynamicCandidates?: () => readonly Candidate[];
  /** true when an interaction is engaged and E should stand up instead of sitting down */
  canStandUp: () => boolean;
  standUp: () => void;
  /** stop navigation/approach so PLAYER can take the avatar cleanly */
  yieldAvatar: () => void;
  /** THE ESCAPE HATCH: a movement key pressed while something else owns the body. The world decides:
   *  an automated walk (a routed walk, or an approach still walking to a fixture such as the lift's
   *  doors) is stopped along with anything queued behind it; a seat or a lift ride is left alone. */
  onManualOverride?: (owner: string) => void;
  /** GUIDED TRAVEL (Go Together): true while a system-driven journey holds the body (ControllerStack's
   *  Guided base). The mode then stays on screen without owning the body: it neither yields the walk nor
   *  starts an interaction, and the keys do not move anybody. Absent means never. */
  guided?: () => boolean;
  /** Is the mouse allowed to turn the camera while somebody else drives the body? True for a guided or
   *  routed walk; false while a ride or a seat stages its own shot. Absent means never (the old rule). */
  freeLook?: () => boolean;
  /** TRAVERSAL (outdoors): the floor a body's footprint rests on at a point (world/exteriorGround support)
   *  and the deepest drop it steps down. With it the stand test is handed the body's feet every step, so
   *  a jump clears what its feet clear and lands on whatever is under it; absent (the dev page, indoor-only
   *  tests) the jump is the flat-floor hop it always was. */
  support?: (p: Vec2, feet?: number) => number;
  dropMax?: number;
  /** PARKOUR V1 — the floor the body STANDS on at a point (the avatar's own ground, plus any furniture top under
   *  it — world/standables). Absent = the avatar's ground. */
  groundAt?: (p: Vec2, feet?: number) => number;
  /** PARKOUR V1 — HEADROOM: the highest the FEET may rise at a point (a ceiling or a deck above, less the body).
   *  Absent = open sky. */
  headroom?: (p: Vec2, feet?: number) => number;
  /** PARKOUR V3 — the declared TRAVERSAL ROUTES (world/traversalRoutes: ladders, a zipline) this body may take. Their
   *  ends are offered as targets ("[E] Climb the ladder"); E starts one. Absent = none. */
  routes?: readonly TraversalRoute[];
  /** PARKOUR V2 — CONTEXTUAL TRAVERSAL (player/traversal): the world's vault obstacles, its stand test with one
   *  vaulted obstacle excused, and its office-boundary rule. Absent = no vault and no mantle (Space only jumps). */
  traversal?: Pick<TraversalWorld, "stand" | "vaultables" | "mayEnter">;
  /** DIRECTED MEETING — the meeting owns the chair, so no seat or walk-up is offered (E would be refused);
   *  a person is still a menu that moves nobody. Absent means never. */
  targetsSuppressed?: () => boolean;
  /** INTERACTION V2 — LINE OF SIGHT from the body to a candidate: nothing is offered through a wall or a closed
   *  barrier. Absent (the dev page, the pure tests) = always clear. */
  sight?: (from: Vec2, to: Vec2) => boolean;
  /** ...and a clear view along the floor, for the "walk to the marker" hint (furniture blocks it). Absent = clear. */
  clearView?: (from: Vec2, to: Vec2) => boolean;
};

/** A SCOOTER RIDE, as PlayerMode sees it (app/world.ts starts one; world/scooters defines the area).
 *  `canStand` is the RIDE AREA's stand test (the normal one AND the ride rects); `place` puts the scooter
 *  model under the rider every frame; `forceEnd` is how PlayerMode itself asks the world to dismount when
 *  something else takes the avatar or Player View is left. */
export type RideHooks = {
  canStand: StandTest;
  /** `heading` is the deck as DRAWN — the ride's heading plus a drift's slip into the turn; `fx` is the drift
   *  (player/ScooterDrift) for the pose stream and the effects: the travel heading is `heading − fx.slip` */
  place(pos: Vec2, heading: number, lean: number, speed: number, y?: number, pitch?: number, fx?: ScooterDrift["fx"]): void;
  /** THE GROUND UNDER THE DECK at a rider position and heading: where the scooter's origin stands (y), its
   *  nose-up pitch from its two wheels, and the surface's speed share and class (world/exteriorGround).
   *  Omitted = the flat datum at full speed (the V1 corridor's world). */
  ground?(pos: Vec2, heading: number): RideGround;
  forceEnd(reason: string): void;
  /** the height the rider's feet stand at (the deck top) */
  deckTop: number;
  /** TRAVERSAL — as PlayerDeps.support / dropMax, for the deck's footprint and the RIDE profile */
  support?(pos: Vec2): number;
  dropMax?: number;
};

/** see RideHooks.ground */
export type RideGround = { y: number; pitch: number; cap: number; surface: "fast" | "normal" | "slow" };
const FLAT_GROUND: RideGround = { y: 0, pitch: 0, cap: 1, surface: "fast" };
/** how fast the deck settles onto a new height and attitude, per second — a kerb is a bump, not a snap */
const RIDE_GROUND_FOLLOW = 14;
const RIDE_PITCH_FOLLOW = 10;
/** ROLLING OFF AN EDGE at speed leaves the ground rather than easing down it: past this drop (and above
 *  RIDE_LAUNCH_SPEED) the deck goes airborne and lands, wheels and all, on the ground below */
const RIDE_LAUNCH_DROP = 2;
const RIDE_LAUNCH_SPEED = 80;
/** IN THE AIR the deck pitches with its climb and fall — nose up off the lip, nose down into the landing */
const RIDE_AIR_PITCH = { up: 0.12, down: -0.14 };
/** THE LANDING: a dip of the deck and rider, from the speed it came down at, recovering at RIDE_SQUASH_RECOVER/s */
const RIDE_SQUASH_PER_SPEED = 1 / 90;
const RIDE_SQUASH_MAX = 2.4;
const RIDE_SQUASH_RECOVER = 9;
/** the chase camera follows a hop's height at this rate, so the deck pops in the frame instead of the world */
const RIDE_CAMERA_Y_FOLLOW = 7;

export class PlayerMode {
  readonly camera: PlayerCamera;
  readonly body: PlayerBody;
  private readonly d: PlayerDeps;
  private readonly input: PlayerInput;
  /** THE VERTICAL HALF OF MOVEMENT, and the only thing in this mode that is not on the floor plane.
   *  Horizontal movement is untouched by it — see player/PlayerJump's header for why that is the whole
   *  collision argument. */
  private readonly vertical = new PlayerJump();
  private readonly candidates: Map<string, Candidate[]>;
  private hud: PlayerHud | null = null;
  /** PHASE 7E — remembered across enter/exit, because the HUD is built on entry: a modal opened in OFFICE
   *  and still up when PLAYER is entered must not get its primary button covered. */
  private promptHidden = false;
  private _active = false;
  private target: Target | null = null;
  /** INTERACTION V2 — a target chosen with Tab is HELD while it stays eligible and the aim has not swung far off
   *  the heading it was chosen at; aiming elsewhere hands selection back to the cone */
  private cycled: { id: string; heading: number } | null = null;
  /** every walk-up fixture in the building (the lift's call plate, kiosks, the Cave's way out): the
   *  "walk to the marker" hint is offered across a room boundary, which the room buckets never are */
  private readonly fixtures: Candidate[];
  /** the heading Bon is walking, kept separate from the camera yaw so third person can turn the body only */
  private heading = 0;
  private moving = false;
  /** THE SCOOTER RIDE, while there is one: its handling, its own body (the ride area's stand test, the
   *  same swept/sliding collision) and the world's hooks */
  private ride: { motion: ScooterMotion; body: PlayerBody; hooks: RideHooks; lookHold: number; last: Vec2; ground: RideGround; y: number; pitch: number;
    /** the hop (Space while riding), and the landing's dip and the camera's height */
    jump: PlayerJump; squash: number; camY: number;
    /** S3 — Space HELD through a landing: the drift and its mini-boost */
    drift: ScooterDrift } | null = null;
  /** the surface class under the deck this frame, or null on foot (QA and the HUD) */
  get rideSurface(): RideGround["surface"] | null { return this.ride?.ground.surface ?? null; }
  get riding(): boolean { return this.ride !== null; }
  /** the speed/boost card — present exactly while mounted */
  private scooterHud: ScooterHud | null = null;
  get scooterHudState(): ScooterHud["state"] | null { return this.scooterHud?.state ?? null; }
  /** the ride's live numbers, for the HUD/QA readout */
  get rideState(): { speed: number; heading: number; lean: number; airborne: boolean; y: number; pitch: number } | null {
    const r = this.ride;
    return r ? { speed: r.motion.speed, heading: r.motion.heading, lean: r.motion.lean, airborne: r.jump.airborne, y: r.y - r.squash, pitch: r.pitch } : null;
  }
  /** MOUNT: take the current body position and facing onto the deck. `heading` is in the CAMERA's yaw
   *  convention (forward = (sin h, −cos h)); the default converts the body's current yaw. Refused unless Player View owns the
   *  avatar and the rider is standing somewhere the ride area allows. */
  startRide(hooks: RideHooks, heading = Math.PI - this.d.avatar.yaw): boolean {
    if (!this._active || this.ride || this.d.stack.owner !== "Player" || !hooks.canStand(this.body.pos)) return false;
    this.landNow();
    // stepping onto a deck ends whatever the feet were doing
    this.momentum.reset();
    this.d.avatar.setGait(null);
    const ground = hooks.ground?.(this.body.pos, heading) ?? FLAT_GROUND;
    this.ride = { motion: new ScooterMotion(heading), body: new PlayerBody(this.body.pos, this.d.radius, hooks.canStand), hooks, lookHold: 0, last: { ...this.body.pos }, ground, y: ground.y, pitch: ground.pitch,
      jump: new PlayerJump(SCOOTER_JUMP), squash: 0, camY: ground.y, drift: new ScooterDrift() };
    // MOUNTED: the idle held on its neutral frame (no sway, no walk cycle) under the rider pose
    this.d.avatar.freezeClipAt(CLIP_IDLE, RIDE_IDLE_PHASE);
    this.d.avatar.setRiding(true);
    this.scooterHud?.dispose();
    this.scooterHud = new ScooterHud(document.body, { cruise: SCOOTER.maxSpeed, boost: SCOOTER.boostSpeed });
    this.camera.boomScale = RIDE_BOOM;
    this.state.sprinting = false;
    this.target = null;
    return true;
  }
  /** QA ONLY (the dev rig's way to a test spot): the riding deck set down at `p`, facing `heading`, at rest on
   *  the ground there (rolling at `speed`). Refused where a deck may not stand. */
  /** S5 — A CRASH WAS REPORTED: the deck stops dead and any drift is over, until the server says what happened */
  haltRide(): void {
    if (!this.ride) return;
    this.ride.motion.speed = 0;
    this.ride.drift.reset();
  }

  warpRide(p: Vec2, heading: number, speed = 0): boolean {
    const ride = this.ride;
    if (!ride || !ride.hooks.canStand(p)) return false;
    this.body.pos = { x: p.x, z: p.z };
    ride.body.pos = { x: p.x, z: p.z };
    ride.last = { x: p.x, z: p.z };
    ride.motion.heading = heading;
    ride.motion.speed = speed;
    ride.jump.reset();
    ride.ground = ride.hooks.ground?.(p, heading) ?? FLAT_GROUND;
    ride.y = ride.camY = ride.ground.y;
    ride.pitch = ride.ground.pitch;
    ride.squash = 0;
    this.camera.yaw = heading;
    this.camera.snap();
    return true;
  }
  /** DISMOUNT (the world has already chosen where the body stands): walking resumes from `at` */
  endRide(at?: Vec2): void {
    if (!this.ride) return;
    this.ride = null;
    this.scooterHud?.dispose();
    this.scooterHud = null;
    this.camera.boomScale = 1;
    if (at) this.body.pos = { x: at.x, z: at.z };
    this.d.avatar.setPosition(this.body.pos, this.followGround(0, true));
    // DISMOUNTED: the rider pose blends out on its own, and the idle RUNS again — play() is a no-op for the
    // clip already current, so without this the standing idle would stay frozen on the riding frame
    this.d.avatar.setRiding(false);
    this.d.avatar.setRideLean(0);
    this.d.avatar.setRidePitch(0);
    this.d.avatar.setClipTimeScale(CLIP_IDLE, 1);
    this.d.avatar.play(this.restingClip);
    this.moving = false;
  }
  /** a one-segment synthetic route handed to the automatic doors, so they open on approach exactly as they
   *  do for a planned walk — without inventing a second door-trigger path */
  readonly doorIntent: Vec2[] = [];
  /** THE CLIP A STANDING PLAYER RESTS IN — an ordinary idle, unless a conversation pose has been set.
   *  Walking and sprinting still outrank it (they are chosen first, above), which is the same ordering
   *  V1's own resolveCharacterAnimState uses and the same one the coworker bodies follow. */
  private conversationClip: string | null = null;
  setConversationClip(clip: string | null): void {
    this.conversationClip = clip;
  }
  private get restingClip(): string {
    return this.conversationClip ?? CLIP_IDLE;
  }

  /** dev/test readout */
  readonly state = {
    active: false, view: "third" as PlayerView, locked: false, sprinting: false, target: "—",
    owner: "", blocked: false, pos: "", airborne: false, height: 0,
    /** the feet's absolute height (the eased floor when grounded, the arc when not) */
    feet: 0,
    /** GROUND ACTUALLY COVERED this frame. Already computed for the locomotion clip's playback rate;
     *  published so the foley layer can pace footsteps off distance rather than off a timer, which is
     *  what makes them follow 70 and 100 without knowing either number. */
    travelled: 0,
    /** the body's own speed (its momentum, u/s) and how hard it is skidding (0 … 1) — the movement feed tells
     *  peers a braking leg by it */
    speed: 0,
    braking: 0,
  };
  /** ON FOOT IN PLAYER VIEW the body carries momentum (player/Momentum): built up, skidded off, leaned into turns */
  private readonly momentum = new Momentum();
  /** which foot plants ahead in a skid (alternates per skid) */
  private skidLead: 1 | -1 = 1;
  private wasSkidding = false;

  constructor(deps: PlayerDeps) {
    this.d = deps;
    this.camera = new PlayerCamera(deps.camera, deps.avatarHeight, deps.cameraProbe);
    this.body = new PlayerBody(deps.avatar.position, deps.radius, deps.canStand);
    this.candidates = collectCandidates(deps.world);
    this.fixtures = [...this.candidates.values()].flat().filter((c) => c.kind === "approach");
    this.input = new PlayerInput(deps.canvas, {
      onInteract: () => this.interact(),
      onToggleView: () => this.setView(this.camera.view === "third" ? "first" : "third"),
      onJump: () => this.jump(),
      onCycle: () => this.cycle(),
      onLockChange: (locked) => {
        this.state.locked = locked;
        this.hud?.setLocked(locked);
        this.refreshHint();
        if (locked) this.lockDenied = false;
        this.onLockState?.(locked, this.input.usingUnlockedLook);
      },
      onLockDenied: () => {
        this.lockDenied = true;
        this.onLockState?.(false, true);
      },
    });
  }

  get active(): boolean { return this._active; }
  get view(): PlayerView { return this.camera.view; }

  /** Take over. Returns false when the avatar cannot be placed on legal floor (nothing is changed then). */
  enter(): boolean {
    if (this._active) return true;
    // A GUIDED JOURNEY KEEPS THE BODY: entering PLAYER mid-journey changes the camera, never the walk.
    const guided = this.d.guided?.() ?? false;
    if (!guided) this.d.yieldAvatar();
    // PARKOUR V3 — ENTERED ON A DECK (a restore, a re-entry after Office View): the body is placed and followed from the
    // height it actually stands at, never dropped to the floor beneath it
    const y = this.d.avatar.root.position.y, elevated = y > this.d.avatar.groundAt(this.d.avatar.position) + 0.5;
    const placed = elevated
      ? standablePointNear(this.d.avatar.position, this.body.radius, (q) => this.d.canStand(q, { feet: y, airborne: false, from: q }))
      : this.body.placeNear(this.d.avatar.position) ? this.body.pos : null;
    if (!placed) return false;
    this.body.pos = placed;
    if (elevated) this.baseY = y;
    if (!guided && !this.d.stack.acquire("Player")) return false;
    this._active = true;
    this.state.active = true;
    // (elevated: kept at its own height — the first frame stands it on what is under it, or lets it fall)
    this.d.avatar.setPosition(this.body.pos, elevated ? this.baseY : this.followGround(0, true));
    this.heading = this.d.avatar.yaw;
    this.camera.yaw = this.heading;
    this.camera.snap();
    this.applyVisibility();
    this.hud = new PlayerHud(document.body);
    this.hud.setPromptHidden(this.promptHidden);
    this.d.overlayRoot.add(this.hud.marker);
    this.hud.setLocked(this.input.locked);
    this.input.enable();
    this.refreshHint();
    this.camera.update(this.body.pos, 0, this.baseY);
    return true;
  }

  /** Hand everything back. Safe to call when not active. */
  exit(): void {
    if (!this._active) return;
    // leaving Player View always ends a ride first — the world dismounts to a safe point
    if (this.ride) this.ride.hooks.forceEnd("player-exit");
    this._active = false;
    this.state.active = false;
    this.input.disable(); // clears every held key, Shift included
    this.state.sprinting = false;
    this.state.travelled = 0;
    this.d.stack.release("Player");
    // BACK ON THE FLOOR, and the frozen airborne pose released with it: a mode left mid-jump must not
    // hand the next owner a floating body or a walk clip whose time scale is still zero.
    this.vertical.reset();
    this.state.airborne = false;
    this.state.height = 0;
    this.roll = null;
    // PARKOUR V2 — a vault or a mantle left half-done finishes at its landing (endTraverse), then steps off any top
    if (this.traverse) { this.endTraverse(); this.d.avatar.setPosition(this.body.pos, this.baseY); }
    // PARKOUR V3 — and a ladder or a zipline ends at a safe end
    if (this.route) this.haltRoute();
    this.recovering = 0;
    this.d.avatar.cancelTumble();
    this.stepOffTop();
    // (PARKOUR V3: at the height the body stands at — a deck's, if it is on one)
    this.d.avatar.setPosition(this.d.avatar.position, this.groundAt(this.body.pos, this.baseY));
    this.d.avatar.setClipTimeScale(CLIP_WALK, 1);
    this.d.avatar.root.visible = true;
    this.d.avatar.play(CLIP_IDLE);
    if (this.hud) { this.hud.marker.removeFromParent(); this.hud.dispose(); this.hud = null; }
    this.target = null;
    this.doorIntent.length = 0;
  }

  /** Give back everything that does NOT die with the renderer's canvas: the window/document key,
   *  pointer-lock and mouse-move listeners PlayerInput holds, and the HUD div parked on document.body.
   *  exit() covers both when the mode is active; input.disable() is repeated unconditionally (it is
   *  idempotent) so a world torn down while OFFICE mode was showing is still left with nothing attached. */
  dispose(): void {
    this.exit();
    this.input.disable();
    this.scooterHud?.dispose();
    this.scooterHud = null;
  }

  setView(v: PlayerView): void {
    this.camera.setView(v);
    this.state.view = v;
    if (this._active) this.applyVisibility();
  }

  /** FIRST PERSON hides the avatar outright. It is the simplest solution that is actually clean: the model
   *  is one skinned mesh whose head and hair sit exactly where the eye camera does, so any near-plane or
   *  head-bone trick leaves hair strands crossing the view on some frames. A visible body with no head is
   *  a V1 problem, not a V0 one. */
  private applyVisibility(): void {
    this.d.avatar.root.visible = this.camera.view === "third";
  }

  /** PHASE 6D — give the pointer back so a DOM card can be used. PLAYER mode grabs the pointer to look
   *  around; an interaction menu is unusable while it holds it. Releasing is all this does — the mode
   *  stays active, the body keeps standing where it is, and one click on the canvas takes the pointer
   *  back exactly as it did on the way in. */
  /** PHASE 7E — hide the centre-screen "[E] …" line while a modal owns the screen; it is drawn exactly
   *  where a modal's primary button sits. Nothing else about PLAYER changes: the crosshair, the floor
   *  ring, the input and the camera are untouched, and targeting keeps running underneath. */
  setPromptHidden(hidden: boolean): void {
    this.promptHidden = hidden;
    this.hud?.setPromptHidden(hidden);
  }

  releasePointer(): void {
    this.input.unlock();
  }

  /** SPACE WAS PRESSED. Refused — silently, changing nothing — unless PLAYER is active AND actually
   *  owns the avatar (a seat, an approach or a menu is driving it otherwise) AND the body is on the
   *  floor. Those three are the whole gate: no double jump, no jump out of a chair, no jump in a view
   *  that is not this one, because this handler is only bound while PLAYER's input is enabled. */
  jump(): void {
    if (!this._active || !this.d.stack.owns("Player")) return;
    // ON A SCOOTER, Space is the deck's hop: rider and deck leave together (updateRide), once per landing.
    // Not relayed — there is no scooter multiplayer yet, and a walking hop relayed from a deck would be a lie.
    if (this.ride) { this.ride.jump.start(this.ride.y); return; }
    // PARKOUR V2 — a vault or a mantle in progress owns the body until it ends; Space waits for it (V3: so it does on a
    // ladder or a zipline, and through a hard landing's recovery)
    if (this.traverse || this.route || this.recovering > 0) return;
    // PARKOUR V2 — CONTEXTUAL TRAVERSAL OUTRANKS THE HOP, on the floor: running at a low eligible obstacle vaults
    // it; facing a ledge within reach mantles onto it; anything else is the jump it always was.
    if (!this.vertical.airborne) {
      const plan = this.planGrounded();
      if (plan) { this.startTraverse(plan); return; }
    }
    // ONLY A JUMP THAT ACTUALLY TOOK IS PUBLISHED. `start` refuses one in mid-air, so a held Space, a
    // key repeat and a second press all produce exactly one relay — the traffic is bounded by the arc,
    // not by the keyboard.
    if (this.vertical.start(this.d.support ? this.baseY : 0)) { this.onJumped?.("jump"); return; }
    // PARKOUR V1 — THE DOUBLE JUMP: Space again while airborne, once per arc (PlayerJump refuses a third, and a
    // fall off an edge grants none), and only with headroom above. Its one flip plays on the tumble wrapper.
    if (this.vertical.airJump(this.ceiling())) {
      this.d.avatar.tumble("flip");
      this.onJumped?.("double");
      return;
    }
    // PARKOUR V2 — THE GRAB: with the double jump spent, Space in the air near a ledge within the hands' reach
    // hauls the body onto it
    const grab = this.planGrab(this.heading);
    if (grab) this.startTraverse(grab);
  }

  // ---- PARKOUR V2: THE VAULT AND THE MANTLE (player/traversal plans them; this runs them) --------------------
  /** the vault or mantle in progress */
  private traverse: (TraversePlan & { elapsed: number }) | null = null;
  /** is a vault or a mantle carrying the body right now? (reported to the movement feed as movement) */
  get traversing(): boolean { return this.traverse !== null; }
  /** where the feet will stand when the traversal in progress ends (null when none) */
  get traverseEndFeet(): number | null { return this.traverse ? this.traverse.endFeet : null; }

  private traversalWorld(): TraversalWorld | null {
    const t = this.d.traversal;
    if (!t) return null;
    // a ledge is looked for up to a mantle's reach above the feet (and never on a deck overhead beyond it)
    const feet = this.feetNow;
    return { ...t, ground: (p) => this.groundAt(p, feet + MANTLE.maxRise), headroom: (p, f = feet) => this.d.headroom?.(p, f) ?? Infinity };
  }

  /** On the floor: a vault when running at an eligible obstacle, else a mantle onto a ledge ahead, else null. */
  private planGrounded(): TraversePlan | null {
    const w = this.traversalWorld();
    if (!w) return null;
    const p = this.body.pos, feet = this.baseY;
    // headingFor's convention: the unit vector of heading h is (sin h, cos h)
    const dir = { x: Math.sin(this.heading), z: Math.cos(this.heading) };
    if (this.momentum.speed >= VAULT.minSpeed) {
      const v = Math.hypot(this.momentum.vx, this.momentum.vz);
      const run = v > 1e-6 ? { x: this.momentum.vx / v, z: this.momentum.vz / v } : dir;
      const vault = planVault(w, p, run, feet, this.body.radius);
      if (vault) return vault;
    }
    return planMantle(w, p, dir, feet, this.body.radius);
  }

  /** In the air: a mantle onto a ledge the hands can reach along `heading`, or null. */
  private planGrab(heading: number): TraversePlan | null {
    const w = this.traversalWorld();
    if (!w || !this.vertical.airborne) return null;
    return planMantle(w, this.body.pos, { x: Math.sin(heading), z: Math.cos(heading) }, this.vertical.feet, this.body.radius, true);
  }

  private startTraverse(plan: TraversePlan): void {
    this.landNow();
    // the traversal owns the height from here, starting where the feet are (a grab starts in mid-air)
    this.baseY = plan.startFeet;
    this.traverse = { ...plan, elapsed: 0 };
    this.momentum.reset();
    this.heading = Math.atan2(plan.dir.x, plan.dir.z);
    this.d.avatar.tumble(plan.kind, plan.ms);
    this.onJumped?.(plan.kind, undefined, plan);
  }

  /** one frame of the traversal: along its validated line, at its own height. Returns the feet and the ground covered. */
  private stepTraverse(dt: number): { y: number; travelled: number } {
    const t = this.traverse!;
    t.elapsed += dt * 1000;
    const u = Math.min(1, t.elapsed / t.ms);
    const s = traverseProgress(t.kind, u);
    const prev = this.body.pos;
    const next = { x: t.from.x + (t.to.x - t.from.x) * s, z: t.from.z + (t.to.z - t.from.z) * s };
    this.body.pos = next;
    const y = traverseHeight(t.kind, u, t.startFeet, t.endFeet, t.apex);
    if (u >= 1) this.endTraverse();
    return { y: u >= 1 ? t.endFeet : y, travelled: Math.hypot(next.x - prev.x, next.z - prev.z) };
  }

  /** THE TRAVERSAL ENDS — or is cut short — WHERE IT WAS PLANNED TO: its landing is the only point of it the stand
   *  test vouched for with nothing excused, so a body is never left over (or inside) the obstacle it was crossing. */
  private endTraverse(): void {
    const t = this.traverse;
    if (!t) return;
    this.traverse = null;
    this.body.pos = { x: t.to.x, z: t.to.z };
    this.baseY = t.endFeet;
    if (t.kind === "vault") { this.momentum.vx = t.dir.x * VAULT_EXIT_SPEED; this.momentum.vz = t.dir.z * VAULT_EXIT_SPEED; }
  }

  // ---- PARKOUR V3: ROUTES — ladders and the zipline (world/traversalRoutes declares them; this runs them) ----------
  /** the route in progress: its record, the way it is being taken, and how far along (ms of `ms`) */
  private route: { r: TraversalRoute; dir: RouteDir; elapsed: number; ms: number } | null = null;
  /** a hard landing's recovery still to run, ms (the keys wait for it) */
  private recovering = 0;
  /** is a ladder or a zipline carrying the body right now? */
  get onRoute(): boolean { return this.route !== null; }
  /** PARKOUR V3 — on a zipline: where the trolley and the handle are this frame (the world draws them there; the hands
   *  are posed onto the same handle), or null */
  ziplineHoldNow: ReturnType<typeof ziplineHold> = null;
  /** QA and the dev surface: which route, which way, how far (0..1) */
  get routeState(): { id: string; dir: RouteDir; u: number } | null {
    const r = this.route;
    return r ? { id: r.r.id, dir: r.dir, u: Math.min(1, r.elapsed / r.ms) } : null;
  }
  /** Told when a route starts (`p0`: how far along it starts — a ladder climbed back from part-way) or is cut short at
   *  a safe end; the world relays both (world/Coworkers replays the same route on every peer's screen). */
  onRouteEvent: ((ev: RouteEvent) => void) | null = null;

  /** the ends of the routes this body may enter from where it stands, as targets */
  private routeCandidates(): readonly Candidate[] {
    const routes = this.d.routes;
    if (!routes || routes.length === 0 || this.route || this.vertical.airborne) return EMPTY_CANDIDATES;
    return routeEntriesAt(routes, this.body.pos, this.baseY).map(({ route, dir, at }) => {
      const path = dir === "a" ? route.path : [...route.path].reverse();
      return { id: `route:${route.id}:${dir}`, kind: "route" as const, pos: { x: path[1].x, z: path[1].z }, label: dir === "a" ? route.label.a : route.label.b ?? route.label.a, roomId: "", anchors: [{ x: at.x, z: at.z }] };
    });
  }

  /** QA AND THE DEV SURFACE: take route `id` from its end `dir` exactly as E on its prompt would (refused unless the body
   *  is standing at that end, level with it, with the far end free) */
  enterRoute(id: string, dir: RouteDir): boolean { return this._active && this.d.stack.owns("Player") && this.startRouteFrom(`route:${id}:${dir}`); }

  /** E on a route's end: re-checked here (the body may have moved since it was offered), then started. */
  private startRouteFrom(candidateId: string): boolean {
    const m = /^route:(.+):([ab])$/.exec(candidateId);
    if (!m || this.route || this.ride || this.vertical.airborne || this.traverse || this.roll) return false;
    const entry = routeEntriesAt(this.d.routes ?? [], this.body.pos, this.baseY).find((e) => e.route.id === m[1] && e.dir === m[2]);
    if (!entry) return false;
    // ITS FAR END MUST BE A PLACE TO STAND right now (the stand test, at that end's own height)
    const exit = routeExit(entry.route, entry.dir);
    if (!this.d.canStand({ x: exit.x, z: exit.z }, { feet: exit.y, airborne: false, from: { x: exit.x, z: exit.z } })) return false;
    this.beginRoute(entry.route, entry.dir, 0);
    return true;
  }

  private beginRoute(r: TraversalRoute, dir: RouteDir, p0: number): void {
    this.landNow();
    this.momentum.reset();
    const ms = routeDuration(r);
    this.route = { r, dir, elapsed: p0 * ms, ms };
    this.d.avatar.setGait(null);
    this.d.avatar.tumble(r.kind, ms, p0 * ms);
    this.target = null;
    this.onRouteEvent?.({ type: "start", route: r, dir, ms, p0 });
  }

  /** E on a ladder: back down (or up) the way it came, from where the body is now */
  private reverseRoute(): void {
    const cur = this.route;
    if (!cur || cur.r.kind !== "ladder" || !cur.r.twoWay) return;
    const u = Math.min(1, cur.elapsed / cur.ms);
    this.route = null;
    this.beginRoute(cur.r, cur.dir === "a" ? "b" : "a", 1 - u);
  }

  /** CUT SHORT (Player View left, an interaction or a walk took the body): the body goes to a SAFE END at once — a
   *  ladder's nearer end, a zipline's landing (it has no other) — and the peers are told where. */
  private haltRoute(): void {
    const cur = this.route;
    if (!cur) return;
    this.route = null;
    const u = Math.min(1, cur.elapsed / cur.ms);
    const back = cur.r.kind === "ladder" && u < 0.5;
    const end = back ? routeExit(cur.r, cur.dir === "a" ? "b" : "a") : routeExit(cur.r, cur.dir);
    this.body.pos = { x: end.x, z: end.z };
    this.baseY = end.y;
    this.d.avatar.setPosition(this.body.pos, end.y);
    if (this.d.avatar.tumbling) this.d.avatar.cancelTumble();
    this.d.avatar.setGrip(null);
    this.ziplineHoldNow = null;
    this.onRouteEvent?.({ type: "halt", route: cur.r, at: { ...this.body.pos }, feet: end.y, end: back ? "start" : "exit" });
  }

  /** ONE ROUTE FRAME: along the declared line at its own pace, facing the rungs (or along the cable); the camera
   *  follows the body's height as it climbs or rides. */
  private updateRoute(dt: number): Vec2 {
    const cur = this.route!;
    const look = this.input.takeLook();
    if (look.dx || look.dy) this.camera.look(look.dx, look.dy);
    cur.elapsed += dt * 1000;
    const u = Math.min(1, cur.elapsed / cur.ms);
    const s = sampleRoute(cur.r, cur.dir, u);
    // THE ZIPLINE'S HOLD: the trolley on the cable, the handle under it — and the hands put on that handle
    const hold = ziplineHold(cur.r, cur.dir, u);
    this.ziplineHoldNow = hold;
    this.d.avatar.setGrip(hold ? _grip.set(hold.cable.x, hold.cable.y, hold.cable.z) : null, hold ? ZiplineTrolley.axis(hold.yaw, _gripAxis) : undefined, cur.r.grip, hold?.hang);
    const prev = this.body.pos;
    this.body.pos = { x: s.p.x, z: s.p.z };
    this.baseY = s.p.y;
    this.d.avatar.setPosition(this.body.pos, s.p.y);
    if (this.camera.view !== "first") this.d.avatar.setYaw(s.yaw);
    this.d.avatar.setGait(null);
    this.d.avatar.freezeClipAt(CLIP_IDLE, 0);
    this.state.travelled = Math.hypot(this.body.pos.x - prev.x, this.body.pos.z - prev.z);
    this.state.airborne = false; this.state.height = 0; this.state.feet = s.p.y; this.state.speed = 0; this.state.braking = 0; this.state.sprinting = false;
    this.moving = this.state.travelled > 1e-4;
    this.doorIntent.length = 0;
    if (u >= 1) {
      // THE FAR END: an ordinary stand point (proved by the route's own tests, re-checked when it was entered)
      const end = routeExit(cur.r, cur.dir);
      this.route = null;
      this.body.pos = { x: end.x, z: end.z };
      this.baseY = end.y;
      this.d.avatar.setPosition(this.body.pos, end.y);
      if (this.d.avatar.tumbling === cur.r.kind) this.d.avatar.cancelTumble();
      // a zipline lets go a little above the floor: the knees take it (the trolley stays where it was let go)
      if (cur.r.kind === "zipline") this.d.avatar.tumble("land");
      this.d.avatar.setGrip(null);
      this.ziplineHoldNow = null;
      this.d.avatar.play(this.restingClip);
    }
    this.camera.update(this.body.pos, dt, this.baseY);
    const climbing = this.route !== null && cur.r.kind === "ladder";
    this.hud?.setTarget(climbing ? "Climb back" : null, null);
    this.state.target = climbing ? "climb back" : "—";
    this.state.pos = `${this.body.pos.x.toFixed(0)}, ${this.body.pos.z.toFixed(0)}`;
    return this.body.pos;
  }

  /** Told when this body really jumped, double-jumped (with its flip) or rolled on landing, so the world can
   *  relay it to the other browsers. A roll also carries its planned travel, which the world publishes as an
   *  ordinary walk so every peer moves the body along the same path. Null on the standalone dev page and in every
   *  test that does not care, exactly like `onLockState`. */
  onJumped: ((kind: ParkourKind, roll?: RollPlan, traverse?: TraversePlan) => void) | null = null;

  /** PARKOUR V1 — the roll in progress: the body travels its plan on the same decel curve peers replay it on */
  private roll: (RollPlan & { elapsed: number }) | null = null;
  /** is a landing roll carrying the body right now? (the world reports it to the movement feed as movement) */
  get rolling(): boolean { return this.roll !== null; }

  /** the highest the feet may rise where the body is now */
  private ceiling(): number { return this.d.headroom?.(this.body.pos, this.feetNow) ?? Infinity; }
  /** PARKOUR V3 — where the feet are right now: the arc's in the air, else the floor followed under them */
  private get feetNow(): number { return this.vertical.airborne ? this.vertical.feet : this.baseY; }
  /** the floor the body stands on at a point — furniture tops included (PARKOUR V1) — judged from `feet` (PARKOUR V3:
   *  the highest surface at or a step above them, so a body on a lower deck stands on it beneath the upper one) */
  private groundAt(p: Vec2, feet = this.feetNow): number { return this.d.groundAt ? this.d.groundAt(p, feet) : this.d.avatar.groundAt(p); }

  /** PARKOUR V1 — PLAN A LANDING ROLL from the landing itself, or null for a crouched landing instead.
   *
   *  Driven by what actually happened: the fall (and the speed it lands with, √(2·g·fall)), the forward momentum
   *  and the direction of travel. The roll's length and duration scale with both, inside fixed bounds. Its whole
   *  path is checked BEFORE it starts — every few units, a floor-level body may stand there on the same surface
   *  (a gentle slope at most), stepping from the sample before — so it can never carry the body through or onto
   *  anything. An ordinary hop never rolls, and a roll is never a licence to survive a fall: falls are bounded by
   *  the world's own edge rules before any landing happens. */
  private planRoll(feet: number): RollPlan | null {
    const fall = this.vertical.lastFall, speed = this.momentum.speed;
    // (PARKOUR V3: a fall past HARD_FALL is never a roll — the roll does not make a big drop harmless)
    if (fall < ROLL_MIN_FALL || fall >= HARD_FALL || speed < ROLL_MIN_SPEED) return null;
    const impact = Math.sqrt(2 * WALK_JUMP.gravity * fall);
    const dist = Math.min(ROLL_DIST.max, Math.max(ROLL_DIST.min, 8 + speed * 0.22 + impact * 0.12));
    const ms = Math.min(ROLL_MS_RANGE.max, Math.max(ROLL_MS_RANGE.min, 620 + impact * 1.4 + speed * 0.4));
    const p = { x: this.body.pos.x, z: this.body.pos.z };
    // THE DIRECTION OF TRAVEL, in headingFor's own convention (core/coords: heading = atan2(dx, dz), so the unit
    // vector is (sin h, cos h)). Writing −cos here mirrored every roll along z: a body running north rolled south,
    // turned to face that way, and its forward roll read as a BACKWARD one against the run.
    const dir = { x: Math.sin(this.heading), z: Math.cos(this.heading) };
    let prev = p;
    for (let d = ROLL_PATH_STEP; d <= dist + this.body.radius; d += ROLL_PATH_STEP) {
      const q = { x: p.x + dir.x * d, z: p.z + dir.z * d };
      if (!this.d.canStand(q, { feet, airborne: false, from: prev }) || Math.abs(this.groundAt(q) - feet) > ROLL_SLOPE_MAX) return null;
      prev = q;
    }
    return { from: p, to: { x: p.x + dir.x * dist, z: p.z + dir.z * dist }, dir, dist, ms };
  }

  /** one frame of the roll's travel: the body moves through the ordinary swept stand test (so nothing it was not
   *  checked against can be crossed), on the decel curve the published walk replays on */
  private stepRoll(dt: number): number {
    const r = this.roll!;
    r.elapsed += dt * 1000;
    const u = Math.min(1, r.elapsed / r.ms);
    const s = 1 - (1 - u) * (1 - u);
    const p = this.body.pos;
    const res = this.body.move(r.from.x + r.dir.x * r.dist * s - p.x, r.from.z + r.dir.z * r.dist * s - p.z, this.walkHeights());
    this.heading = headingFor(r.dir.x, r.dir.z);
    if (u >= 1 || res.blocked) {
      // out of the roll and on the way: a little speed back in the direction it rolled
      this.roll = null;
      this.momentum.vx = r.dir.x * ROLL_EXIT_SPEED;
      this.momentum.vz = r.dir.z * ROLL_EXIT_SPEED;
    }
    return res.travelled;
  }

  /** PARKOUR V1 — STEP DOWN OFF A FURNITURE TOP when the body is handed to something that walks on the floor
   *  (leaving Player View, an interaction taking it): the nearest point beside it a floor-level body may stand. */
  private stepOffTop(): void {
    const p = this.body.pos;
    const top = this.groundAt(p), floor = this.d.avatar.groundAt(p);
    if (top <= floor + 0.5) return;
    // PARKOUR V3 — A DECK IS A FLOOR OF ITS OWN: stepping "beside" a treehouse deck would be a drop to the ground
    // beneath it, so a body this high up is left standing where it is (only furniture-height tops are stepped off)
    if (top - floor > STEP_OFF_MAX) return;
    const free = standablePointNear(p, this.body.radius, (q) => this.d.canStand(q));
    if (!free) return;
    this.body.pos = free;
    this.baseY = this.d.avatar.groundAt(free);
    this.d.avatar.setPosition(free, this.baseY);
  }

  /** Is the body off the floor? Read by the dev surface and the tests. */
  get airborne(): boolean { return this.vertical.airborne; }

  /** Invoke whatever is targeted, through V2's own interaction path. */
  interact(): void {
    if (!this._active) return;
    if (this.ride) { if (!this.ride.jump.airborne) this.ride.hooks.forceEnd("dismount"); return; } // no stepping off in mid-air
    if (this.d.canStandUp()) { this.d.standUp(); return; }
    // PARKOUR V3 — E on a ladder climbs back the way it came (the start is the one safe place to go); a zipline has no
    // safe exit before its end, so E does nothing on one
    if (this.route) { this.reverseRoute(); return; }
    const t = this.target;
    if (!t) return;
    // GUIDED TRAVEL: the journey owns the body, so nothing that would walk it somewhere else starts. A
    // person is still a menu and moves nobody.
    if (this.d.guided?.() && t.kind !== "person") return;
    // PHASE 6D — A PERSON IS NOT A HANDOFF. Selecting a coworker opens a menu; it moves nobody and owns
    // nothing, so the avatar is never released here. Releasing and re-acquiring it (what every other kind
    // does, because the starters route with A* and take "Interaction") would drop Bon into an idle clip
    // for a frame for a menu that has not even been answered yet.
    if (t.kind === "route") { this.startRouteFrom(t.id); return; }
    if (t.kind === "person" || t.kind === "ride") { this.d.activate(t.id, t.kind); return; }
    // release FIRST: the starters route with A* and acquire "Interaction", and Player outranks Navigation
    this.d.stack.release("Player");
    this.landNow();
    this.d.avatar.play(CLIP_IDLE);
    if (!this.d.activate(t.id, t.kind)) this.d.stack.acquire("Player"); // refused: take the avatar back
  }

  /** One frame. Returns the avatar's ground position so the caller can drive doors/shadows from it. */
  update(dt: number): Vec2 {
    const p = this.body.pos;
    if (!this._active) return p;
    const owner = this.d.stack.owner;
    this.state.owner = owner;
    // anything that takes the avatar (a click-to-walk, a guided journey, a cinematic) ends the ride first
    if (this.ride && owner !== "Player") this.ride.hooks.forceEnd(`owner:${owner}`);
    // THE SAFETY NET: something else relocated the body (a restore, a lift, an ejection, a teleport) — the
    // scooter does not follow it anywhere; the ride ends where the body now is
    if (this.ride && Math.hypot(this.body.pos.x - this.ride.last.x, this.body.pos.z - this.ride.last.z) > 30) this.ride.hooks.forceEnd("relocated");
    if (this.ride) return this.updateRide(dt);
    // PARKOUR V3 — a ladder or a zipline carries the body (it is handed back at an end if anything takes it)
    if (this.route && owner === "Player") return this.updateRoute(dt);
    // an interaction is driving Bon: keep the camera on him, move nothing, and take him back when it ends
    if (owner !== "Player") {
      if (this.input.axis.x || this.input.axis.z) this.d.onManualOverride?.(owner);
      // GUIDED TRAVEL AND SEATS: the system walks or seats the body, the person keeps the camera. Taken only when
      // allowed, so the lift or the portal, which stage their own shot, see exactly what they always did.
      // Drained either way: a look the camera may not take now is DROPPED, not banked — a lift ride or a portal used to
      // hand the camera every mouse movement made during it in one jump when it ended.
      const look = this.input.takeLook();
      if (this.d.freeLook?.() && (look.dx || look.dy)) this.camera.look(look.dx, look.dy);
      this.state.sprinting = false;
      this.state.travelled = 0;
      // an interaction (or anything else) took the body: whatever momentum it had is gone, not banked
      this.momentum.reset();
      this.state.speed = 0; this.state.braking = 0;
      this.d.avatar.setGait(null);
      // Somebody else is driving the body; a jump cannot continue through a seat or an approach, and
      // leaving one running would fight whatever they write into the transform.
      this.landNow();
      const a = this.d.avatar.worldPosition();
      this.body.pos = { x: a.x, z: a.z };
      this.stepOffTop();
      if (owner === "Idle" && this.d.stack.acquire("Player")) { this.body.placeNear(this.body.pos); this.d.avatar.setPosition(this.body.pos, this.followGround(0, true)); }
      this.camera.update(this.body.pos, dt, this.d.avatar.groundAt(this.body.pos));
      this.updateTarget();
      return this.body.pos;
    }
    const look = this.input.takeLook();
    if (look.dx || look.dy) this.camera.look(look.dx, look.dy);
    const axis = this.input.axis;
    const sprinting = this.input.sprinting;
    const speed = this.d.speed() * (sprinting ? SPRINT_MULTIPLIER : 1);
    this.state.sprinting = sprinting;
    let travelled = 0;
    // WASD is CAMERA-RELATIVE: forward is where you are looking, which is what every third-person game
    // means by W and the only thing that stays intuitive while the camera orbits. It says where the body WANTS
    // to go; its momentum (player/Momentum) says how far it actually tries to go this frame.
    let want: Vec2 | null = null;
    if (axis.x || axis.z) {
      const f = this.camera.forward, r = this.camera.right;
      const wx = f.x * -axis.z + r.x * axis.x, wz = f.z * -axis.z + r.z * axis.x, wl = Math.hypot(wx, wz);
      if (wl > 1e-9) want = { x: wx / wl, z: wz / wl };
    }
    // a landing roll owns the body's travel until it ends (stepRoll below); the keys wait for it — and so do they
    // for a vault or a mantle (PARKOUR V2), which also owns the height
    const pushed = want;
    if (this.recovering > 0) this.recovering = Math.max(0, this.recovering - dt * 1000);
    if (this.roll || this.traverse || this.recovering > 0) want = null;
    const m: MomentumStep = this.momentum.step(want, speed * (want ? Math.min(1, Math.hypot(axis.x, axis.z)) : 0), sprinting, dt);
    let traverseY: number | null = null;
    if (this.traverse) {
      const t = this.stepTraverse(dt);
      traverseY = t.y;
      this.baseY = t.y;
      travelled = t.travelled;
      this.state.blocked = false;
    } else if (this.roll) {
      travelled = this.stepRoll(dt);
      this.state.blocked = false;
    } else if (m.dx || m.dz) {
      const from = { x: p.x, z: p.z };
      const res = this.body.move(m.dx, m.dz, this.walkHeights());
      // WALKED OFF AN EDGE deeper than a step down (only ever one it was already straddling — see
      // world/exteriorGround): the body falls from where its feet were, and lands below
      if (res.fell) this.vertical.fall(res.feet!);
      travelled = res.travelled;
      this.state.blocked = res.blocked;
      // MOMENTUM MEETS THE WORLD: a wall, a desk, a car — what it did not allow is lost there, never carried on
      if (res.blocked) this.momentum.blocked(res.pos.x - from.x, res.pos.z - from.z, dt);
      // face where the body ACTUALLY went (so sliding along a wall turns Bon along it) — and in a skid, the way
      // it is still sliding, not the new way the keys push; falling back to the push when it is pinned
      this.heading = travelled > 1e-4 ? headingFor(res.pos.x - from.x, res.pos.z - from.z) : want ? headingFor(want.x, want.z) : this.heading;
    } else {
      this.state.blocked = false;
      if (want) this.heading = headingFor(want.x, want.z);
    }
    this.state.travelled = travelled;
    this.state.speed = this.momentum.speed;
    this.state.braking = m.brake;
    const skidding = m.brake > 0.2;
    if (skidding && !this.wasSkidding) this.skidLead = this.skidLead === 1 ? -1 : 1;
    this.wasSkidding = skidding;

    this.moving = travelled > 1e-4;
    // THE VERTICAL HALF, stepped AFTER the horizontal one and written into the same transform. The
    // horizontal answer above is untouched by it — same WASD, same camera basis, same PlayerBody.move,
    // same stand test — so airborne movement is ordinary movement that happens to be drawn higher, and
    // every wall, desk, door and access rule still applies at full height.
    // OUTDOORS the arc is in absolute height over the floor actually under the body now: it lands on a
    // ledge above its takeoff or a lawn below it (player/PlayerJump), the feet resolve onto that height,
    // and a landing hanging off an edge is set back onto the edge it caught.
    const sup = this.d.support;
    // PARKOUR V3 — THE SUPPORT WENT AWAY without a step off an edge (entered over open air, a surface below it only):
    // that is a fall, from where the feet are, never a snap down to whatever is under them
    if (sup && !this.vertical.airborne && !this.traverse && !this.roll && this.d.dropMax !== undefined && sup(this.body.pos, this.baseY) < this.baseY - this.d.dropMax) this.vertical.fall(this.baseY);
    const landed = this.vertical.update(dt, sup ? sup(this.body.pos, this.vertical.feet) : undefined, this.ceiling());
    // PARKOUR V2 — THE AUTOMATIC GRAB: falling into a ledge while pushing toward it hauls the body up onto it
    if (!landed && this.vertical.airborne && this.vertical.verticalSpeed < 0 && pushed && this.state.blocked && !this.traverse) {
      const grab = this.planGrab(Math.atan2(pushed.x, pushed.z));
      if (grab) this.startTraverse(grab);
    }
    if (landed && sup) {
      this.settleLanding(this.body, this.vertical.feet, this.d.dropMax ?? Infinity);
      this.baseY = this.vertical.feet;
    }
    if (landed) {
      // a flip still turning finishes over a short tail; a real fall with room ahead becomes a roll
      if (this.d.avatar.tumbling === "flip") this.d.avatar.hurryTumble();
      const plan = this.planRoll(this.vertical.feet);
      if (plan) {
        this.roll = { ...plan, elapsed: 0 };
        this.momentum.reset();
        this.d.avatar.tumble("roll", plan.ms);
        this.onJumped?.("roll", plan);
      } else if (this.vertical.lastFall >= HARD_FALL) {
        // PARKOUR V3 — A HARD LANDING: too far for a roll to make it nothing. The body takes it low — a deep crouch, a
        // hand to the floor — and gets up before it goes anywhere (no injury system; just a controlled recovery)
        if (this.d.avatar.tumbling) this.d.avatar.cancelTumble();
        this.d.avatar.tumble("hard");
        this.recovering = PARKOUR_MS.hard;
        this.momentum.reset();
      } else if (!this.d.avatar.tumbling && this.vertical.lastFall >= LAND_ABSORB_FALL) {
        // a real fall without a roll: the knees and hips give (every viewer plays the same from its own arc)
        this.d.avatar.tumble("land");
      }
    }
    this.state.airborne = this.vertical.airborne;
    this.state.height = this.vertical.height;
    this.state.feet = this.vertical.airborne ? this.vertical.feet : this.baseY;
    this.d.avatar.setPosition(this.body.pos, traverseY ?? (this.traverse ? this.baseY : this.vertical.airborne && sup ? this.vertical.feet : this.followGround(dt) + this.vertical.height));
    // FIRST person locks the body to the view; THIRD turns it toward travel, which is what sells "Bon is
    // walking" rather than "Bon is being slid around".
    if (this.camera.view === "first") this.d.avatar.setYaw(this.camera.yaw);
    else if (this.moving) this.d.avatar.setYaw(stepAngle(this.d.avatar.yaw, this.heading, TURN_RATE * dt));

    // LANDING RESTORES THE CLIP, once, on the frame it happens: the airborne pose froze the walk cycle,
    // and the locomotion branch below re-writes the rate every frame it runs — but the RESTING branch
    // does not, so a jump that ends standing still would leave the idle playing over a walk action
    // stopped at zero. Restoring here rather than in each branch keeps that one line in one place.
    if (landed) this.d.avatar.setClipTimeScale(CLIP_WALK, 1);

    // THE GAIT'S SHAPE (avatar/gaitPose): the sprint's lean, stride and arm pump grow with the speed it is
    // actually doing; a skid plants a foot and leans back; a turn at speed banks. Off in the air.
    const sprintAmount = Math.max(0, Math.min(1, (this.momentum.speed - 80) / (PLAYER_SPRINT_SPEED - 80)));
    const tb = this.d.avatar.tumbling;
    const tumbling = tb === "flip" || tb === "roll" || tb === "vault" || tb === "mantle" || tb === "hard";
    this.d.avatar.setGait(this.vertical.airborne || tumbling ? null : { sprint: skidding ? 0 : sprintAmount, bank: m.bank, brake: m.brake, lead: this.skidLead });

    if (tumbling) {
      // PARKOUR V1/V2 — A FLIP, A ROLL, A VAULT OR A MANTLE is articulated by avatar/parkourPose over the NEUTRAL stance (the idle's first
      // frame), so the tuck is symmetric rather than built on a frozen stride; the clip comes back when it ends.
      this.d.avatar.freezeClipAt(CLIP_IDLE, 0);
    } else if (this.vertical.airborne) {
      // IN THE AIR. The pose is held (avatar/Avatar.freezeClipAt) rather than animated: no shipped
      // character package carries a jump clip, and the arc itself is what sells the motion. Takeoff and
      // landing are the crossfades into and out of it.
      this.d.avatar.freezeClipAt(CLIP_WALK, AIRBORNE_POSE_PHASE);
    } else if (this.moving && skidding) {
      // A SKID: the run eases into the idle under the braking pose (avatar/gaitPose) — a body braking, not a
      // run cycle dragged along the floor
      this.d.avatar.play(this.restingClip, 0.15);
    } else if (this.moving) {
      // idle -> walking -> running -> walking -> idle, all through the mixer's own crossfade. Sprinting
      // with no run clip in the GLB falls back to a faster walk rather than freezing on whatever was
      // already playing, so an older avatar build still behaves — avatar/gait owns that rule and the
      // rate that makes the fallback keep its feet on the ground instead of skating.
      // rate from the ground ACTUALLY covered, not from the input: a player scraping along a wall slows
      // his own stride down instead of moonwalking on the spot (a HumanBase body also picks walk/run by it)
      const g = locomotion(this.d.avatar.runtime, travelled / dt, sprinting, this.d.avatar.hasClip(CLIP_RUN), this.d.avatar.currentClip, sprintStride(sprintAmount));
      this.d.avatar.play(g.clip);
      this.d.avatar.setClipTimeScale(g.clip, g.rate);
    } else {
      this.d.avatar.play(this.restingClip);
    }

    if (this.moving) {
      // the lookahead follows the HEADING, not the camera: strafing or backing through a doorway has to
      // open it too, and at yaw 0 the camera's forward points north whichever way the player is walking
      this.doorIntent.length = 0;
      // (further ahead the faster it goes: a sprint reaches a door in under half the time a walk does)
      const look = Math.max(DOOR_LOOKAHEAD, this.momentum.speed * 0.45);
      // headingFor's convention (core/coords): heading h travels along (sin h, cos h). This was −cos, which mirrored
      // the lookahead along z — walking north told the doors to expect the body behind it (PARKOUR V2 fix).
      this.doorIntent.push(doorLookahead(this.body.pos, this.heading, look));
    } else {
      this.doorIntent.length = 0;
    }
    // (PARKOUR V3: the camera follows a FALL down as it happens — a hop up leaves it where it is — so a drop from a deck
    // is a smooth descent, not a long hang and a swoop after the landing)
    this.camera.update(this.body.pos, dt, this.vertical.airborne ? Math.min(this.baseY, this.vertical.feet) : this.baseY);
    this.updateTarget();
    this.state.pos = `${this.body.pos.x.toFixed(0)}, ${this.body.pos.z.toFixed(0)}`;
    return this.body.pos;
  }

  /** PUT THE BODY BACK ON THE FLOOR NOW, with no landing frame: the avatar is being handed to somebody
   *  else (an interaction, a seat) or the mode is ending. Idempotent, and cheap enough to call every
   *  frame of a handoff. */
  /** ONE RIDING FRAME: handling → swept move through the ride area → deck, rider and camera. */
  private updateRide(dt: number): Vec2 {
    const ride = this.ride!;
    const look = this.input.takeLook();
    if (look.dx || look.dy) { this.camera.look(look.dx, look.dy); ride.lookHold = RIDE_LOOK_HOLD; }
    else ride.lookHold = Math.max(0, ride.lookHold - dt);
    const axis = this.input.axis;
    ride.body.pos = { x: this.body.pos.x, z: this.body.pos.z };
    // the surface under the deck sets its speed share; the deck eases to it (player/ScooterMotion `cap`)
    // IN THE AIR the wheels have nothing to push on: no drive or brake, light steering (ScooterMotion)
    const sup = ride.hooks.support;
    const air = ride.jump.airborne;
    // S3 — THE DRIFT: Space held through the landing, steering (player/ScooterDrift). It reads LAST frame's
    // hit: a graze along a kerb is not a crash, so only a hit that cost most of the step counts
    const drift = ride.drift;
    const hardHit = this.state.blocked && this.state.travelled < 0.5 * Math.abs(ride.motion.speed) * dt;
    drift.update({ held: this.input.jumpHeld, steer: axis.x, airborne: air, speed: ride.motion.speed, cap: ride.ground.cap, allowed: this.d.stack.owner === "Player" && !this.input.menuOpen, hardHit }, dt * 1000);
    const { dx, dz } = ride.motion.step({
      throttle: -axis.z, steer: axis.x, boost: this.input.sprinting, cap: ride.ground.cap, airborne: air,
      drift: drift.active ? { dir: drift.dir as -1 | 1, turnRate: drift.turnRate, lean: DRIFT.lean, drag: DRIFT.drag } : null,
      surge: drift.boostSpeed,
    }, dt);
    // the deck's feet go with every sub-step: a kerb rolls, a deeper edge stops it, an airborne deck clears
    // what its wheels clear — and a roll off an edge at speed leaves the ground
    const fallDrop = Math.abs(ride.motion.speed) > RIDE_LAUNCH_SPEED ? RIDE_LAUNCH_DROP : ride.hooks.dropMax;
    const res = ride.body.move(dx, dz, sup ? { feet: air ? ride.jump.feet : sup(ride.body.pos), airborne: air, support: sup, fallDrop } : undefined);
    if (res.blocked) ride.motion.bumped(res.travelled, dt);
    if (res.fell) ride.jump.fall(res.feet!);
    this.body.pos = res.pos;
    this.state.blocked = res.blocked;
    this.state.travelled = res.travelled;
    this.moving = res.travelled > 1e-4;
    this.heading = ride.motion.heading;
    // the rider stands on the deck, facing along it, hands on the grips (avatar/riderPose) over the frozen
    // idle — no walk cycle while mounted — and leans with the deck.
    // TWO YAW CONVENTIONS (core/coords): the ride heading is the CAMERA's (forward = (sin h, −cos h)) and a
    // body's yaw is headingFor's (forward = (sin a, cos a)), so the body takes π − h
    // ON THE GROUND UNDER THE DECK: its height and pitch from both wheels, eased so a kerb or a lip is a bump
    // THE HOP: gravity over the floor under the deck now; on the landing frame the wheels meet that floor
    // (set back onto an edge they caught), and the deck and rider dip by how hard it came down
    if (ride.jump.airborne) {
      const falling = -(ride.jump.verticalSpeed - SCOOTER_JUMP.gravity * dt);
      if (ride.jump.update(dt, sup ? sup(ride.body.pos) : 0)) {
        if (sup) this.settleLanding(ride.body, ride.jump.feet, ride.hooks.dropMax ?? Infinity);
        this.body.pos = ride.body.pos;
        ride.y = ride.jump.feet;
        ride.squash = Math.min(RIDE_SQUASH_MAX, Math.max(0, falling) * RIDE_SQUASH_PER_SPEED);
      }
    }
    ride.ground = ride.hooks.ground?.(this.body.pos, ride.motion.heading) ?? FLAT_GROUND;
    if (ride.jump.airborne) {
      // rider and deck are one body in the air: the arc's height, pitched with the climb and the fall
      ride.y = ride.jump.feet;
      const k = ride.jump.verticalSpeed / SCOOTER_JUMP.takeoff;
      const want = k > 0 ? k * RIDE_AIR_PITCH.up : -k * RIDE_AIR_PITCH.down;
      ride.pitch += (want - ride.pitch) * Math.min(1, dt * RIDE_PITCH_FOLLOW * 0.6);
    } else {
      ride.y += (ride.ground.y - ride.y) * Math.min(1, dt * RIDE_GROUND_FOLLOW);
      ride.pitch += (ride.ground.pitch - ride.pitch) * Math.min(1, dt * RIDE_PITCH_FOLLOW);
    }
    ride.squash += (0 - ride.squash) * Math.min(1, dt * RIDE_SQUASH_RECOVER);
    if (ride.squash < 0.01) ride.squash = 0;
    const deckY = ride.y - ride.squash;
    ride.camY += (ride.y - ride.camY) * Math.min(1, dt * (ride.jump.airborne ? RIDE_CAMERA_Y_FOLLOW : RIDE_GROUND_FOLLOW));
    this.state.airborne = ride.jump.airborne;
    this.state.height = ride.jump.height;
    this.state.feet = deckY;
    this.d.avatar.setPosition(this.body.pos, deckY + ride.hooks.deckTop);
    this.d.avatar.setRidePitch(ride.pitch);
    // the deck as DRAWN points a drift's slip INTO the turn; the ride itself carries on round it
    const drawn = ride.motion.heading + drift.slip;
    this.d.avatar.setYaw(Math.PI - drawn);
    this.d.avatar.freezeClipAt(CLIP_IDLE, RIDE_IDLE_PHASE);
    this.d.avatar.setRideLean(ride.motion.lean);
    // the card reads the deck's own state: BOOST only while boost is actually driving it forward
    this.scooterHud?.update(ride.motion.speed, (this.input.sprinting && -axis.z > 0 && ride.motion.speed > 20) || drift.boosting, dt, ride.ground.surface);
    this.scooterHud?.setDrift(drift.active, drift.charge, drift.tier);
    ride.hooks.place(this.body.pos, drawn, ride.motion.lean, ride.motion.speed, deckY, ride.pitch, drift.fx);
    // CHASE CAMERA: settles in behind the deck unless the rider is looking round with the mouse
    if (ride.lookHold <= 0 && this.camera.view === "third") {
      const rate = RIDE_CAMERA_FOLLOW * (0.35 + 0.65 * Math.min(1, Math.abs(ride.motion.speed) / 120));
      this.camera.yaw = stepAngle(this.camera.yaw, ride.motion.heading, rate * dt);
    }
    if (this.camera.view === "first") this.camera.yaw = ride.motion.heading;
    this.doorIntent.length = 0;
    this.camera.update(this.body.pos, dt, ride.camY);
    // E is refused in mid-air, so it is not offered there either
    this.hud?.setTarget(ride.jump.airborne ? null : "Dismount", null);
    this.state.target = ride.jump.airborne ? "—" : "dismount";
    ride.last = { x: this.body.pos.x, z: this.body.pos.z };
    this.state.pos = `${this.body.pos.x.toFixed(0)}, ${this.body.pos.z.toFixed(0)}`;
    return this.body.pos;
  }

  /** this frame's heights for a walking move (outdoors only — see PlayerDeps.support) */
  private walkHeights(): MoveHeights | undefined {
    const sup = this.d.support;
    if (!sup) return undefined;
    const air = this.vertical.airborne;
    return { feet: air ? this.vertical.feet : sup(this.body.pos, this.baseY), airborne: air, support: sup, fallDrop: this.d.dropMax };
  }

  /** A LANDING THAT CAUGHT AN EDGE: the footprint rests on the higher side while its centre hangs over the
   *  drop. Set it back onto the edge it caught — the shortest move (at most a footprint and a bit, along the
   *  eight compass points, nearest to the way it was travelling first) that puts the centre on that floor
   *  and that the stand test allows; with none, it stays, and the stand test still lets it walk or roll off
   *  (it never refuses a move that straddles no worse). */
  private settleLanding(body: PlayerBody, feet: number, dropMax: number): void {
    // the walker stands on furniture tops too (PARKOUR V1); a scooter's deck keeps the plain ground it always had
    const centre = (q: Vec2): number => (body === this.body ? this.groundAt(q) : this.d.avatar.groundAt(q));
    const p = body.pos;
    if (centre(p) >= feet - Math.min(dropMax, 1)) return;
    const ctx = { feet, airborne: false, from: p };
    const stand = (q: Vec2): boolean => (body === this.body ? this.d.canStand(q, ctx) : this.ride!.hooks.canStand(q, ctx));
    const h = this.ride ? this.ride.motion.heading : Math.PI - this.d.avatar.yaw;
    const dirs = Array.from({ length: 8 }, (_, i) => h + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 4));
    for (let d = 1; d <= body.radius + 2; d++) {
      for (const a of dirs) {
        const q = { x: p.x + Math.sin(a) * d, z: p.z - Math.cos(a) * d };
        if (centre(q) >= feet - 0.5 && stand(q)) { body.pos = q; return; }
      }
    }
  }

  /** THE GROUND UNDER THE BODY, followed: eased onto a new surface height, taken at once after a relocation */
  private baseY = 0;
  private followGround(dt: number, snap = false): number {
    const t = this.groundAt(this.body.pos);
    if (snap || Math.abs(t - this.baseY) > GROUND_SNAP) this.baseY = t;
    else {
      this.baseY += (t - this.baseY) * Math.min(1, dt * GROUND_FOLLOW);
      if (Math.abs(t - this.baseY) < 0.004) this.baseY = t;
    }
    return this.baseY;
  }

  private landNow(): void {
    // PARKOUR V3 — a route cut short ends at a SAFE END (see haltRoute), never in mid-air
    if (this.route) this.haltRoute();
    // PARKOUR V2 — a vault or a mantle cut short finishes at its landing (see endTraverse). The one place this
    // writes x/z: the body must never be handed over standing inside the obstacle it was crossing.
    if (this.traverse) {
      this.endTraverse();
      this.d.avatar.setPosition(this.body.pos, this.baseY);
      if (this.d.avatar.tumbling) this.d.avatar.cancelTumble();
    }
    this.roll = null;
    if (this.d.avatar.tumbling) this.d.avatar.cancelTumble();
    if (!this.vertical.airborne && this.state.height === 0) return;
    this.vertical.reset();
    this.state.airborne = false;
    this.state.height = 0;
    // The one write, on the one frame: `y` alone, never the whole transform. A handoff can land on a
    // frame where an interaction is about to own the root (and may have re-parented it into a carrier),
    // and re-asserting x/z here would be this mode writing a position it no longer owns.
    this.d.avatar.root.position.y = this.baseY;
    this.d.avatar.setClipTimeScale(CLIP_WALK, 1);
  }

  /** Room-scoped candidate scan. No scene traversal, no raycast: the candidate list was built once. */
  private scoringSet(): { all: readonly Candidate[] | undefined; facing: Vec2 } {
    const room = this.d.world.regionAt(this.body.pos)?.roomId;
    const list = room ? this.candidates.get(room) : undefined;
    // THIRD PERSON faces the body's own yaw, in headingFor's convention (core/coords: yaw h looks along (sin h, cos h)).
    // This was (sin h, −cos h) — mirrored along z, the same slip as the V1 door lookahead: a body facing north was
    // offered what stood behind it (PARKOUR V3 fix).
    const facing = this.camera.view === "first" ? this.camera.forward : { x: Math.sin(this.d.avatar.yaw), z: Math.cos(this.d.avatar.yaw) };
    // PHASE 6D — the static room bucket PLUS whoever is standing here right now. People are added
    // regardless of which room the body is in (they are not in any bucket, and a coworker in the hall is
    // still a person you are looking at); pickTarget's reach, cone and line of sight are what bound them.
    const people = this.d.dynamicCandidates?.() ?? EMPTY_CANDIDATES;
    // PARKOUR V3 — the ends of the routes this body is standing at, level with them
    const routes = this.routeCandidates();
    const dynamic = routes.length === 0 ? people : people.length === 0 ? routes : [...people, ...routes];
    const all = dynamic.length === 0 ? list : list ? [...list, ...dynamic] : dynamic;
    return { all, facing };
  }

  private updateTarget(): void {
    const { all, facing } = this.scoringSet();
    // INTERACTION V2 — STABLE SELECTION: the target held last frame survives a near-tie (pickTarget's
    // hysteresis); one chosen with Tab is held outright while it stays eligible and the aim stays near it.
    const heading = Math.atan2(facing.x, -facing.z);
    let held: Target | null = null;
    if (this.cycled && all) {
      const swung = Math.abs(Math.atan2(Math.sin(heading - this.cycled.heading), Math.cos(heading - this.cycled.heading)));
      held = swung < 0.8 ? rankTargets(all, this.body.pos, facing, this.d.sight).find((t) => t.id === this.cycled!.id) ?? null : null;
      if (!held) this.cycled = null;
    }
    this.target = held ?? (all && all.length > 0 ? pickTarget(all, this.body.pos, facing, { current: this.target?.id ?? null, sight: this.d.sight }) : null);
    if (this.target && this.target.kind !== "person" && this.d.targetsSuppressed?.()) this.target = null;
    this.state.target = this.target ? this.target.label : "—";
    if (this.d.canStandUp()) {
      this.hud?.setTarget("Stand up", null);
      this.state.target = "stand up";
      return;
    }
    // more than one thing here: say how to pick between them (Tab), once, on the prompt itself
    const more = this.target && all ? rankTargets(all, this.body.pos, facing, this.d.sight).length > 1 : false;
    // WHERE TO STAND: the ring goes on the object; a walk-up fixture also marks its stand spot
    const stand = this.target?.kind === "approach" ? this.target.anchors?.[0] ?? null : null;
    this.hud?.setTarget(this.target?.label ?? null, this.target ? this.target.pos : null, more, stand);
    if (!this.target) this.refreshHint(facing);
  }

  /** TAB — the next eligible target in a crowded spot. Silent when there is one or none. */
  private cycle(): boolean {
    if (!this._active || this.d.canStandUp()) return false;
    const { all, facing } = this.scoringSet();
    if (!all) return false;
    const next = cycleTarget(all, this.body.pos, facing, this.target?.id ?? null, this.d.sight);
    if (!next) return false;
    this.cycled = { id: next.id, heading: Math.atan2(facing.x, -facing.z) };
    this.updateTarget();
    return true;
  }

  /** PHASE 7D — THE PERSISTENT CENTRE-SCREEN PILL IS GONE.
   *
   *  "click to look · WASD to walk · …" sat over the avatar for as long as the pointer was unlocked,
   *  which was most of the time and directly in the middle of the view. It said the wrong thing too:
   *  entering PLAYER now takes the pointer from the view-switch gesture itself, so clicking the world
   *  is a recovery route rather than the way in.
   *
   *  What replaced it: the view-switch indicator, which says PLAYER VIEW and its controls once, briefly,
   *  on entry (app/Vo3dViewIndicator) — and a contextual recovery hint shown only when the browser
   *  actually refused the lock. A permanent instruction for a state that is usually fine is chrome. */
  private refreshHint(facing?: Vec2): void {
    // INTERACTION V2 — JUST OUT OF REACH: a walk-up fixture ahead (the lift's call plate behind a crowd, a kiosk
    // across the lobby) is named, and its stand spot marked on the floor, until the body is close enough to use it
    const near = facing ? nearbyFixture(this.fixtures, this.body.pos, facing, REACH * 2, this.d.clearView) : null;
    this.hud?.setHint(near ? `Walk to the marker to ${near.label.charAt(0).toLowerCase()}${near.label.slice(1)}` : "", near?.anchors?.[0] ?? null);
  }

  /** PHASE 7D — the browser refused our last request, so a recovery hint is warranted. */
  lockDenied = false;
  /** Told whenever the lock state or the fallback changes, so the overlay can show the right hint. */
  onLockState: ((locked: boolean, unlockedLook: boolean) => void) | null = null;

  /** PHASE 7D — take the pointer from the caller's own gesture (the C key, or chat's Enter). */
  requestPointerLock(): void { this.input.requestLock(); }
  /** AN INTERACTION MENU OPENED / CLOSED over the world (app/menuPointer): the menu owns the mouse and its
   *  keys while it is up (player/PlayerInput menuOpen) */
  setMenuOpen(on: boolean): void { this.input.menuOpen = on; }
  /** HAND THE MOUSE BACK after a menu — QUIETLY: refused (no user gesture, browser cooldown), nothing
   *  changes and the next deliberate click on the canvas locks, exactly as it always has */
  resumePointerLock(): void { if (this.active) this.input.requestLock({ fallback: false }); }
  get pointerLocked(): boolean { return this.input.locked; }
  get unlockedLook(): boolean { return this.input.usingUnlockedLook; }
}
