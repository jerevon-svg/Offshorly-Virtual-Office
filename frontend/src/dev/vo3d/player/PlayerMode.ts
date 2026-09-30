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
import type { ControllerStack } from "../avatar/Controller";
import { CLIP_IDLE, CLIP_RUN, CLIP_WALK } from "../adapters/v1Avatar";
import { locomotionClip, locomotionRate } from "../avatar/gait";
import { headingFor, stepAngle, type Vec2 } from "../core/coords";
import type { WorldState } from "../world/WorldState";
import { PlayerBody, type StandTest } from "./PlayerBody";
import { PlayerCamera, type PlayerView } from "./PlayerCamera";
import { PlayerHud } from "./PlayerHud";
import { PlayerInput } from "./PlayerInput";
import { AIRBORNE_POSE_PHASE, PlayerJump } from "./PlayerJump";
import { collectCandidates, pickTarget, type Candidate, type Target } from "./PlayerTargeting";
import { ScooterMotion } from "./ScooterMotion";

/** Shared empty list, so a frame with no dynamic candidates allocates nothing. */
const EMPTY_CANDIDATES: readonly Candidate[] = [];

/** how fast the avatar turns toward its heading in third person (rad/s) — the navigation controller's rate */
const TURN_RATE = 9;
/** RIDING: the chase camera's boom (a touch longer, so the road ahead reads at speed), how fast it
 *  swings in behind the deck (rad/s at speed), and how long a mouse look holds it off */
const RIDE_BOOM = 1.18;
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
/** THE TWO GROUND SPEEDS, in units/s, and the single place either of them is stated.
 *
 *  70 / 100 replaces the original 30 / 54. The old pair was inherited from the click-to-walk router,
 *  where a stroll is the right read because the camera is watching the office; driving a body yourself at
 *  that speed makes an office the size of this one feel like a corridor to be endured. Nothing else about
 *  movement changes: the same WASD, the same camera-relative basis, the same PlayerBody.move, the same
 *  collision answer from the same DerivedNav / Walkability, the same NAV_RADIUS.
 *
 *  TUNNELLING IS UNAFFECTED, and that is arithmetic rather than optimism. PlayerBody splits EVERY step
 *  into sub-steps no longer than a quarter of the body radius (2 units at NAV_RADIUS 8) regardless of how
 *  long the step is, so the resolution of the sweep does not depend on speed at all — 100 u/s on a
 *  stalled-tab 250 ms frame is 25 units, resolved as 13 sub-steps, exactly as 54 u/s was resolved as 7. */
export const PLAYER_WALK_SPEED = 70;
export const PLAYER_SPRINT_SPEED = 100;
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
  activate: (id: string, kind: Candidate["kind"]) => boolean;
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
  /** DIRECTED MEETING — the meeting owns the chair, so no seat or walk-up is offered (E would be refused);
   *  a person is still a menu that moves nobody. Absent means never. */
  targetsSuppressed?: () => boolean;
};

/** A SCOOTER RIDE, as PlayerMode sees it (app/world.ts starts one; world/scooters defines the area).
 *  `canStand` is the RIDE AREA's stand test (the normal one AND the ride rects); `place` puts the scooter
 *  model under the rider every frame; `forceEnd` is how PlayerMode itself asks the world to dismount when
 *  something else takes the avatar or Player View is left. */
export type RideHooks = {
  canStand: StandTest;
  place(pos: Vec2, heading: number, lean: number, speed: number): void;
  forceEnd(reason: string): void;
  /** the height the rider's feet stand at (the deck top) */
  deckTop: number;
};

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
  /** the heading Bon is walking, kept separate from the camera yaw so third person can turn the body only */
  private heading = 0;
  private moving = false;
  /** THE SCOOTER RIDE, while there is one: its handling, its own body (the ride area's stand test, the
   *  same swept/sliding collision) and the world's hooks */
  private ride: { motion: ScooterMotion; body: PlayerBody; hooks: RideHooks; lookHold: number; last: Vec2 } | null = null;
  get riding(): boolean { return this.ride !== null; }
  /** the ride's live numbers, for the HUD/QA readout */
  get rideState(): { speed: number; heading: number; lean: number } | null {
    return this.ride ? { speed: this.ride.motion.speed, heading: this.ride.motion.heading, lean: this.ride.motion.lean } : null;
  }
  /** MOUNT: take the current body position and facing onto the deck. `heading` is in the CAMERA's yaw
   *  convention (forward = (sin h, −cos h)); the default converts the body's current yaw. Refused unless Player View owns the
   *  avatar and the rider is standing somewhere the ride area allows. */
  startRide(hooks: RideHooks, heading = Math.PI - this.d.avatar.yaw): boolean {
    if (!this._active || this.ride || this.d.stack.owner !== "Player" || !hooks.canStand(this.body.pos)) return false;
    this.landNow();
    this.ride = { motion: new ScooterMotion(heading), body: new PlayerBody(this.body.pos, this.d.radius, hooks.canStand), hooks, lookHold: 0, last: { ...this.body.pos } };
    this.camera.boomScale = RIDE_BOOM;
    this.state.sprinting = false;
    this.target = null;
    return true;
  }
  /** DISMOUNT (the world has already chosen where the body stands): walking resumes from `at` */
  endRide(at?: Vec2): void {
    if (!this.ride) return;
    this.ride = null;
    this.camera.boomScale = 1;
    if (at) this.body.pos = { x: at.x, z: at.z };
    this.d.avatar.setPosition(this.body.pos, 0);
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
    /** GROUND ACTUALLY COVERED this frame. Already computed for the locomotion clip's playback rate;
     *  published so the foley layer can pace footsteps off distance rather than off a timer, which is
     *  what makes them follow 70 and 100 without knowing either number. */
    travelled: 0,
  };

  constructor(deps: PlayerDeps) {
    this.d = deps;
    this.camera = new PlayerCamera(deps.camera, deps.avatarHeight, deps.cameraProbe);
    this.body = new PlayerBody(deps.avatar.position, deps.radius, deps.canStand);
    this.candidates = collectCandidates(deps.world);
    this.input = new PlayerInput(deps.canvas, {
      onInteract: () => this.interact(),
      onToggleView: () => this.setView(this.camera.view === "third" ? "first" : "third"),
      onJump: () => this.jump(),
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
    if (!this.body.placeNear(this.d.avatar.position)) return false;
    if (!guided && !this.d.stack.acquire("Player")) return false;
    this._active = true;
    this.state.active = true;
    this.d.avatar.setPosition(this.body.pos);
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
    this.camera.update(this.body.pos, 0);
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
    this.d.avatar.setPosition(this.d.avatar.position);
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
    if (!this._active || !this.d.stack.owns("Player") || this.ride) return; // no jumping off a moving deck
    // ONLY A JUMP THAT ACTUALLY TOOK IS PUBLISHED. `start` refuses one in mid-air, so a held Space, a
    // key repeat and a second press all produce exactly one relay — the traffic is bounded by the arc,
    // not by the keyboard.
    if (this.vertical.start()) this.onJumped?.();
  }

  /** Told when this body really left the floor, so the world can relay it to the other browsers. Null
   *  on the standalone dev page and in every test that does not care, exactly like `onLockState`. */
  onJumped: (() => void) | null = null;

  /** Is the body off the floor? Read by the dev surface and the tests. */
  get airborne(): boolean { return this.vertical.airborne; }

  /** Invoke whatever is targeted, through V2's own interaction path. */
  interact(): void {
    if (!this._active) return;
    if (this.ride) { this.ride.hooks.forceEnd("dismount"); return; }
    if (this.d.canStandUp()) { this.d.standUp(); return; }
    const t = this.target;
    if (!t) return;
    // GUIDED TRAVEL: the journey owns the body, so nothing that would walk it somewhere else starts. A
    // person is still a menu and moves nobody.
    if (this.d.guided?.() && t.kind !== "person") return;
    // PHASE 6D — A PERSON IS NOT A HANDOFF. Selecting a coworker opens a menu; it moves nobody and owns
    // nothing, so the avatar is never released here. Releasing and re-acquiring it (what every other kind
    // does, because the starters route with A* and take "Interaction") would drop Bon into an idle clip
    // for a frame for a menu that has not even been answered yet.
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
    // an interaction is driving Bon: keep the camera on him, move nothing, and take him back when it ends
    if (owner !== "Player") {
      if (this.input.axis.x || this.input.axis.z) this.d.onManualOverride?.(owner);
      // GUIDED TRAVEL: the system walks the body, the person keeps the camera. Taken only when allowed, so
      // a seat or a ride that stages its own shot sees exactly what it always did.
      if (this.d.freeLook?.()) {
        const look = this.input.takeLook();
        if (look.dx || look.dy) this.camera.look(look.dx, look.dy);
      }
      this.state.sprinting = false;
      this.state.travelled = 0;
      // Somebody else is driving the body; a jump cannot continue through a seat or an approach, and
      // leaving one running would fight whatever they write into the transform.
      this.landNow();
      const a = this.d.avatar.worldPosition();
      this.body.pos = { x: a.x, z: a.z };
      if (owner === "Idle" && this.d.stack.acquire("Player")) { this.body.placeNear(this.body.pos); this.d.avatar.setPosition(this.body.pos); }
      this.camera.update(this.body.pos, dt);
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
    if (axis.x || axis.z) {
      // WASD is CAMERA-RELATIVE: forward is where you are looking, which is what every third-person game
      // means by W and the only thing that stays intuitive while the camera orbits.
      const f = this.camera.forward, r = this.camera.right;
      const dx = (f.x * -axis.z + r.x * axis.x) * speed * dt;
      const dz = (f.z * -axis.z + r.z * axis.x) * speed * dt;
      const from = { x: p.x, z: p.z };
      const res = this.body.move(dx, dz);
      travelled = res.travelled;
      this.state.blocked = res.blocked;
      // face where the body ACTUALLY went (so sliding along a wall turns Bon along it), falling back to
      // where the player is pushing when he is pinned and went nowhere
      this.heading = travelled > 1e-4 ? headingFor(res.pos.x - from.x, res.pos.z - from.z) : headingFor(dx, dz);
    } else this.state.blocked = false;
    this.state.travelled = travelled;

    this.moving = travelled > 1e-4;
    // THE VERTICAL HALF, stepped AFTER the horizontal one and written into the same transform. The
    // horizontal answer above is untouched by it — same WASD, same camera basis, same PlayerBody.move,
    // same stand test — so airborne movement is ordinary movement that happens to be drawn higher, and
    // every wall, desk, door and access rule still applies at full height.
    const landed = this.vertical.update(dt);
    this.state.airborne = this.vertical.airborne;
    this.state.height = this.vertical.height;
    this.d.avatar.setPosition(this.body.pos, this.vertical.height);
    // FIRST person locks the body to the view; THIRD turns it toward travel, which is what sells "Bon is
    // walking" rather than "Bon is being slid around".
    if (this.camera.view === "first") this.d.avatar.setYaw(this.camera.yaw);
    else if (this.moving) this.d.avatar.setYaw(stepAngle(this.d.avatar.yaw, this.heading, TURN_RATE * dt));

    // LANDING RESTORES THE CLIP, once, on the frame it happens: the airborne pose froze the walk cycle,
    // and the locomotion branch below re-writes the rate every frame it runs — but the RESTING branch
    // does not, so a jump that ends standing still would leave the idle playing over a walk action
    // stopped at zero. Restoring here rather than in each branch keeps that one line in one place.
    if (landed) this.d.avatar.setClipTimeScale(CLIP_WALK, 1);

    if (this.vertical.airborne) {
      // IN THE AIR. The pose is held (avatar/Avatar.freezeClipAt) rather than animated: no shipped
      // character package carries a jump clip, and the arc itself is what sells the motion. Takeoff and
      // landing are the crossfades into and out of it.
      this.d.avatar.freezeClipAt(CLIP_WALK, AIRBORNE_POSE_PHASE);
    } else if (this.moving) {
      // idle -> walking -> running -> walking -> idle, all through the mixer's own crossfade. Sprinting
      // with no run clip in the GLB falls back to a faster walk rather than freezing on whatever was
      // already playing, so an older avatar build still behaves — avatar/gait owns that rule and the
      // rate that makes the fallback keep its feet on the ground instead of skating.
      const clip = locomotionClip(sprinting, this.d.avatar.hasClip(CLIP_RUN));
      this.d.avatar.play(clip);
      // rate from the ground ACTUALLY covered, not from the input: a player scraping along a wall slows
      // his own stride down instead of moonwalking on the spot
      this.d.avatar.setClipTimeScale(clip, locomotionRate(clip, travelled / dt));
    } else {
      this.d.avatar.play(this.restingClip);
    }

    if (this.moving) {
      // the lookahead follows the HEADING, not the camera: strafing or backing through a doorway has to
      // open it too, and at yaw 0 the camera's forward points north whichever way the player is walking
      this.doorIntent.length = 0;
      this.doorIntent.push({ x: this.body.pos.x + Math.sin(this.heading) * DOOR_LOOKAHEAD, z: this.body.pos.z - Math.cos(this.heading) * DOOR_LOOKAHEAD });
    } else {
      this.doorIntent.length = 0;
    }
    this.camera.update(this.body.pos, dt);
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
    const { dx, dz } = ride.motion.step({ throttle: -axis.z, steer: axis.x, boost: this.input.sprinting }, dt);
    const res = ride.body.move(dx, dz);
    if (res.blocked) ride.motion.bumped(res.travelled, dt);
    this.body.pos = res.pos;
    this.state.blocked = res.blocked;
    this.state.travelled = res.travelled;
    this.moving = res.travelled > 1e-4;
    this.heading = ride.motion.heading;
    // the rider stands on the deck, facing along it, in the standing idle — no walk cycle while mounted.
    // TWO YAW CONVENTIONS (core/coords): the ride heading is the CAMERA's (forward = (sin h, −cos h)) and a
    // body's yaw is headingFor's (forward = (sin a, cos a)), so the body takes π − h
    this.d.avatar.setPosition(this.body.pos, ride.hooks.deckTop);
    this.d.avatar.setYaw(Math.PI - ride.motion.heading);
    this.d.avatar.play(CLIP_IDLE);
    ride.hooks.place(this.body.pos, ride.motion.heading, ride.motion.lean, ride.motion.speed);
    // CHASE CAMERA: settles in behind the deck unless the rider is looking round with the mouse
    if (ride.lookHold <= 0 && this.camera.view === "third") {
      const rate = RIDE_CAMERA_FOLLOW * (0.35 + 0.65 * Math.min(1, Math.abs(ride.motion.speed) / 120));
      this.camera.yaw = stepAngle(this.camera.yaw, ride.motion.heading, rate * dt);
    }
    if (this.camera.view === "first") this.camera.yaw = ride.motion.heading;
    this.doorIntent.length = 0;
    this.camera.update(this.body.pos, dt);
    this.hud?.setTarget("Dismount", null);
    this.state.target = "dismount";
    ride.last = { x: this.body.pos.x, z: this.body.pos.z };
    this.state.pos = `${this.body.pos.x.toFixed(0)}, ${this.body.pos.z.toFixed(0)}`;
    return this.body.pos;
  }

  private landNow(): void {
    if (!this.vertical.airborne && this.state.height === 0) return;
    this.vertical.reset();
    this.state.airborne = false;
    this.state.height = 0;
    // The one write, on the one frame: `y` alone, never the whole transform. A handoff can land on a
    // frame where an interaction is about to own the root (and may have re-parented it into a carrier),
    // and re-asserting x/z here would be this mode writing a position it no longer owns.
    this.d.avatar.root.position.y = 0;
    this.d.avatar.setClipTimeScale(CLIP_WALK, 1);
  }

  /** Room-scoped candidate scan. No scene traversal, no raycast: the candidate list was built once. */
  private updateTarget(): void {
    const room = this.d.world.regionAt(this.body.pos)?.roomId;
    const list = room ? this.candidates.get(room) : undefined;
    const facing = this.camera.view === "first" ? this.camera.forward : { x: Math.sin(this.d.avatar.yaw), z: -Math.cos(this.d.avatar.yaw) };
    // PHASE 6D — the static room bucket PLUS whoever is standing here right now. People are added
    // regardless of which room the body is in (they are not in any bucket, and a coworker in the hall is
    // still a person you are looking at); pickTarget's reach and cone are what bound them, as for
    // everything else.
    const dynamic = this.d.dynamicCandidates?.() ?? EMPTY_CANDIDATES;
    const all = dynamic.length === 0 ? list : list ? [...list, ...dynamic] : dynamic;
    this.target = all && all.length > 0 ? pickTarget(all, this.body.pos, facing) : null;
    if (this.target && this.target.kind !== "person" && this.d.targetsSuppressed?.()) this.target = null;
    this.state.target = this.target ? this.target.label : "—";
    if (this.d.canStandUp()) {
      this.hud?.setTarget("Stand up", null);
      this.state.target = "stand up";
      return;
    }
    this.hud?.setTarget(this.target?.label ?? null, this.target ? this.target.pos : null);
    if (!this.target) this.refreshHint();
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
  private refreshHint(): void {
    this.hud?.setHint("");
  }

  /** PHASE 7D — the browser refused our last request, so a recovery hint is warranted. */
  lockDenied = false;
  /** Told whenever the lock state or the fallback changes, so the overlay can show the right hint. */
  onLockState: ((locked: boolean, unlockedLook: boolean) => void) | null = null;

  /** PHASE 7D — take the pointer from the caller's own gesture (the C key, or chat's Enter). */
  requestPointerLock(): void { this.input.requestLock(); }
  get pointerLocked(): boolean { return this.input.locked; }
  get unlockedLook(): boolean { return this.input.usingUnlockedLook; }
}
