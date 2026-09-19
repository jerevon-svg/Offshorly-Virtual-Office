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
import { headingFor, stepAngle, type Vec2 } from "../core/coords";
import type { WorldState } from "../world/WorldState";
import { PlayerBody, type StandTest } from "./PlayerBody";
import { PlayerCamera, type PlayerView } from "./PlayerCamera";
import { PlayerHud } from "./PlayerHud";
import { PlayerInput } from "./PlayerInput";
import { collectCandidates, pickTarget, type Candidate, type Target } from "./PlayerTargeting";

/** Shared empty list, so a frame with no dynamic candidates allocates nothing. */
const EMPTY_CANDIDATES: readonly Candidate[] = [];

/** how fast the avatar turns toward its heading in third person (rad/s) — the navigation controller's rate */
const TURN_RATE = 9;
/** how far ahead of a moving player a door is told to expect him. One stride: enough for the leaf to be
 *  clear by the time he arrives, short enough not to open doors he is merely walking past. */
const DOOR_LOOKAHEAD = 46;
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
/** THE GROUND SPEED EACH LOCOMOTION CLIP WAS AUTHORED FOR, in units/s. Playback rate is then simply
 *  "how fast am I actually travelling / how fast does this clip think it is travelling", which is what
 *  keeps feet planted instead of skating at either speed and at every speed in between.
 *
 *  `walking` = 30 is the figure the navigation controller has always used. `running` is derived from the
 *  clips themselves: the run cycle is 0.667 s against the walk's 1.067 s, so its cadence is 1.6x the
 *  walk's and it covers ground at about 30 x 1.6.
 *
 *  AT THE TUNED SPEEDS these authored figures do not change — they are properties of the CLIPS, not of
 *  the player — so the rate simply follows: walking 70 u/s drives the walk cycle at 2.33x and sprinting
 *  100 u/s drives the run cycle at 2.08x, both under MAX_CLIP_RATE. Feet stay planted at both speeds
 *  because that is the whole point of dividing by the clip's own ground speed. */
const CLIP_GROUND_SPEED: Record<string, number> = { [CLIP_WALK]: 30, [CLIP_RUN]: 48 };
/** ceiling on locomotion playback rate — a spike guard for a long frame, not a look choice */
const MAX_CLIP_RATE = 2.5;

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
};

export class PlayerMode {
  readonly camera: PlayerCamera;
  readonly body: PlayerBody;
  private readonly d: PlayerDeps;
  private readonly input: PlayerInput;
  private readonly candidates: Map<string, Candidate[]>;
  private hud: PlayerHud | null = null;
  private _active = false;
  private target: Target | null = null;
  /** the heading Bon is walking, kept separate from the camera yaw so third person can turn the body only */
  private heading = 0;
  private moving = false;
  /** a one-segment synthetic route handed to the automatic doors, so they open on approach exactly as they
   *  do for a planned walk — without inventing a second door-trigger path */
  readonly doorIntent: Vec2[] = [];
  /** dev/test readout */
  readonly state = {
    active: false, view: "third" as PlayerView, locked: false, sprinting: false, target: "—",
    owner: "", blocked: false, pos: "",
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
      onLockChange: (locked) => { this.state.locked = locked; this.hud?.setLocked(locked); this.refreshHint(); },
    });
  }

  get active(): boolean { return this._active; }
  get view(): PlayerView { return this.camera.view; }

  /** Take over. Returns false when the avatar cannot be placed on legal floor (nothing is changed then). */
  enter(): boolean {
    if (this._active) return true;
    this.d.yieldAvatar();
    if (!this.body.placeNear(this.d.avatar.position)) return false;
    if (!this.d.stack.acquire("Player")) return false;
    this._active = true;
    this.state.active = true;
    this.d.avatar.setPosition(this.body.pos);
    this.heading = this.d.avatar.yaw;
    this.camera.yaw = this.heading;
    this.camera.snap();
    this.applyVisibility();
    this.hud = new PlayerHud(document.body);
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
    this._active = false;
    this.state.active = false;
    this.input.disable(); // clears every held key, Shift included
    this.state.sprinting = false;
    this.state.travelled = 0;
    this.d.stack.release("Player");
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
  releasePointer(): void {
    this.input.unlock();
  }

  /** Invoke whatever is targeted, through V2's own interaction path. */
  interact(): void {
    if (!this._active) return;
    if (this.d.canStandUp()) { this.d.standUp(); return; }
    const t = this.target;
    if (!t) return;
    // PHASE 6D — A PERSON IS NOT A HANDOFF. Selecting a coworker opens a menu; it moves nobody and owns
    // nothing, so the avatar is never released here. Releasing and re-acquiring it (what every other kind
    // does, because the starters route with A* and take "Interaction") would drop Bon into an idle clip
    // for a frame for a menu that has not even been answered yet.
    if (t.kind === "person") { this.d.activate(t.id, t.kind); return; }
    // release FIRST: the starters route with A* and acquire "Interaction", and Player outranks Navigation
    this.d.stack.release("Player");
    this.d.avatar.play(CLIP_IDLE);
    if (!this.d.activate(t.id, t.kind)) this.d.stack.acquire("Player"); // refused: take the avatar back
  }

  /** One frame. Returns the avatar's ground position so the caller can drive doors/shadows from it. */
  update(dt: number): Vec2 {
    const p = this.body.pos;
    if (!this._active) return p;
    const owner = this.d.stack.owner;
    this.state.owner = owner;
    // an interaction is driving Bon: keep the camera on him, move nothing, and take him back when it ends
    if (owner !== "Player") {
      this.state.sprinting = false;
      this.state.travelled = 0;
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
    this.d.avatar.setPosition(this.body.pos);
    // FIRST person locks the body to the view; THIRD turns it toward travel, which is what sells "Bon is
    // walking" rather than "Bon is being slid around".
    if (this.camera.view === "first") this.d.avatar.setYaw(this.camera.yaw);
    else if (this.moving) this.d.avatar.setYaw(stepAngle(this.d.avatar.yaw, this.heading, TURN_RATE * dt));

    if (this.moving) {
      // idle -> walking -> running -> walking -> idle, all through the mixer's own crossfade. Sprinting
      // with no run clip in the GLB falls back to a faster walk rather than freezing on whatever was
      // already playing, so an older avatar build still behaves.
      const clip = sprinting && this.d.avatar.hasClip(CLIP_RUN) ? CLIP_RUN : CLIP_WALK;
      this.d.avatar.play(clip);
      // rate from the ground ACTUALLY covered, not from the input: a player scraping along a wall slows
      // his own stride down instead of moonwalking on the spot
      this.d.avatar.setClipTimeScale(clip, Math.min(MAX_CLIP_RATE, Math.max(0.15, travelled / dt / CLIP_GROUND_SPEED[clip])));
      // the lookahead follows the HEADING, not the camera: strafing or backing through a doorway has to
      // open it too, and at yaw 0 the camera's forward points north whichever way the player is walking
      this.doorIntent.length = 0;
      this.doorIntent.push({ x: this.body.pos.x + Math.sin(this.heading) * DOOR_LOOKAHEAD, z: this.body.pos.z - Math.cos(this.heading) * DOOR_LOOKAHEAD });
    } else {
      this.d.avatar.play(CLIP_IDLE);
      this.doorIntent.length = 0;
    }
    this.camera.update(this.body.pos, dt);
    this.updateTarget();
    this.state.pos = `${this.body.pos.x.toFixed(0)}, ${this.body.pos.z.toFixed(0)}`;
    return this.body.pos;
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
    this.state.target = this.target ? this.target.label : "—";
    if (this.d.canStandUp()) {
      this.hud?.setTarget("Stand up", null);
      this.state.target = "stand up";
      return;
    }
    this.hud?.setTarget(this.target?.label ?? null, this.target ? this.target.pos : null);
    if (!this.target) this.refreshHint();
  }

  private refreshHint(): void {
    this.hud?.setHint(this.input.locked ? "" : "click to look · WASD to walk · Shift to sprint · V first/third · Esc releases");
  }
}
