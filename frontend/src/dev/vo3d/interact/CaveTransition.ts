// vo3d interact — THE PORTAL: Central Hub ⇄ Championship Cave.
//
// The CAVE is a separate interior volume standing in its own world space (rooms/cave.ts explains why),
// so getting into it is a VOLUME SWAP, not a walk. This file is the only place that swap happens, and it
// is written to make the discontinuity unobservable rather than to hide it behind a loading screen:
//
//   1. the player presses E at the monument's portal — a real user gesture, which is what earns the
//      right to start audible video, so the media is started HERE, synchronously, before anything moves
//   2. the view fades to black over ~240 ms (the "short dark transition" through the tunnel)
//   3. AT BLACK, and only at black, everything moves at once: the office stops being drawn, the CAVE
//      starts being drawn, the environment switches to its sealed-interior rig, and the body is placed
//      at the CAVE's arrival point facing the screen
//   4. the view fades back up, inside
//
// Leaving is the same four steps run backwards, landing the body back at the portal it came out of.
//
// DETERMINISTIC. One state machine, one timer, and every transition is refused while another is running,
// so a mashed E key cannot interleave two swaps or strand the controller. The body is never moved except
// at black, and never moved anywhere `canStand` refuses.
//
// OWNERSHIP. This file never acquires or releases the controller stack. It is invoked FROM PlayerMode's
// own interact() path, which has already released "Player"; PlayerMode takes the avatar back on the next
// idle frame exactly as it does after any other refused/finished interaction. That is why there is no
// unlock path here to get wrong.
import * as THREE from "three";
import type { Vec2 } from "../core/coords";
import type { CaveMedia } from "../media/CaveMedia";
import type { CaveBuild } from "../build/cave";
import { attachCaveVideo } from "../build/cave";
import { SPAWN, SPAWN_LOOK, SPAWN_PITCH } from "../rooms/cave";

/** how long the world is hidden on the way in, and on the way out */
export const FADE_MS = 240;

export type CaveWhere = "office" | "cave";

export type CaveTransitionDeps = {
  /** the CAVE's scene graph and the materials that carry the shared video */
  build: CaveBuild;
  media: CaveMedia;
  /** everything the OFFICE draws — hidden while inside, so an unattended office costs nothing in here */
  officeRoot: THREE.Object3D;
  /** Put the body somewhere legal and point it along a world DIRECTION (not an angle — see
   *  rooms/cave.ts SPAWN_LOOK for why). Returns false if the point is not standable. */
  place: (p: Vec2, look: Vec2, pitch?: number) => boolean;
  /** where standing in the Central Hub means: the monument portal's own walk-up point */
  portalPoint: () => Vec2;
  /** which way to look on coming back out — away from the monument, into the hub */
  portalLook: Vec2;
  /** switch the environment between its normal rig and the sealed-interior one */
  setInterior: (on: boolean) => void;
  /** the sun moved / half the scene appeared: the static shadow map has to be redrawn */
  invalidateShadows: () => void;
  /** PHASE 7D — told which side the body is about to be on, BEFORE the swap. The multiplayer feed uses
   *  it to name the place it is publishing (app/world.ts); a refused transition never calls it. */
  onWhere?: (where: CaveWhere) => void;
  /** make sure PLAYER owns the avatar before a swap; false = refuse the transition */
  requirePlayer: () => boolean;
};

export class CaveTransition {
  private readonly d: CaveTransitionDeps;
  private fader: HTMLDivElement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _where: CaveWhere = "office";
  private _busy = false;
  /** dev/test readout */
  readonly state = { where: "office" as CaveWhere, busy: false, transitions: 0, last: "—" };

  constructor(deps: CaveTransitionDeps) {
    this.d = deps;
  }

  get where(): CaveWhere { return this._where; }
  get inside(): boolean { return this._where === "cave"; }
  get busy(): boolean { return this._busy; }

  /** Central Hub → CAVE. Call from a user gesture: the media's audio permission depends on it. */
  enter(): boolean {
    if (this._busy || this._where === "cave") return false;
    if (!this.d.requirePlayer()) { this.state.last = "refused: PLAYER could not take the avatar"; return false; }
    // START THE MEDIA INSIDE THE GESTURE, before the fade. Deferring it into the fade's timeout would
    // put the play() call outside the user activation the browser is checking for, and the sound would
    // be refused every single time for a reason that has nothing to do with the user's intent.
    const tex = this.d.media.ensure();
    if (tex) attachCaveVideo(this.d.build, tex);
    this.d.media.play();
    this.run(() => this.swapTo("cave"));
    return true;
  }

  /** CAVE → Central Hub. */
  exit(): boolean {
    if (this._busy || this._where === "office") return false;
    if (!this.d.requirePlayer()) { this.state.last = "refused: PLAYER could not take the avatar"; return false; }
    this.run(() => this.swapTo("office"));
    return true;
  }

  /** PHASE 7D — PUT THE WORLD IN THE CAVE BECAUSE THAT IS WHERE THIS EMPLOYEE ALREADY WAS.
   *
   *  A RESTORE, not a transition: no fade (there is nothing to hide — the world has not been drawn yet),
   *  no busy gate, and no `requirePlayer` refusal, because nothing is being taken from anybody. It runs
   *  the SAME swap every entry runs, so the office is hidden, the interior lighting is applied and the
   *  body lands on the same spawn — there is no second way into this room.
   *
   *  It starts NO meeting and touches no call: being in the Cave and being in a meeting are different
   *  facts, and only the first one is persisted. Returns false if the swap could not land, leaving the
   *  caller to restore in the office as before. */
  restoreInside(): boolean {
    if (this.inside) return true;
    // PLAYER MUST OWN THE AVATAR, exactly as it must for an ordinary entry. Skipping this was a real
    // bug: the world came up inside the Cave and looked right, but nothing owned the body, so the
    // person could not walk — and, because the feed only publishes what the body does, nobody else
    // saw them move either. A restore takes the avatar from nobody, so this succeeds in practice;
    // refusing when it does not is still correct, and restoreSelf then restores them in the office.
    if (!this.d.requirePlayer()) {
      this.state.last = "refused: PLAYER could not take the avatar for a restore";
      return false;
    }
    this.swapTo("cave");
    return this.inside;
  }

  /** Whichever way it goes from here. The one verb a key binding or a GUI button needs. */
  toggle(): boolean {
    return this._where === "office" ? this.enter() : this.exit();
  }

  /** THE SWAP, all of it, executed in one tick at full black. Nothing here is animated, on purpose:
   *  every frame that shows a half-swapped world is a frame that shows the seam. */
  private swapTo(to: CaveWhere): void {
    const inCave = to === "cave";
    // Announced BEFORE the body moves, so the movement feed's next boundary crossing already knows what
    // to call this place. Announced here rather than in enter()/exit() so an aborted swap (nowhere legal
    // to land, below) is the only path that can leave the two out of step — and that path restores it.
    this.d.onWhere?.(to);
    const landed = inCave
      ? this.d.place(SPAWN, SPAWN_LOOK, SPAWN_PITCH)
      : this.d.place(this.d.portalPoint(), this.d.portalLook);
    if (!landed) {
      // Nothing moved after all: take the announcement back.
      this.d.onWhere?.(this._where);
      // Nowhere legal on the far side: abort rather than leave a body inside geometry. The fade still
      // completes, so the player is never left staring at a black screen.
      this.state.last = `refused: no standable ground at the ${to} end`;
      return;
    }
    this.d.build.group.visible = inCave;
    this.d.officeRoot.visible = !inCave;
    this.d.setInterior(inCave);
    if (!inCave) this.d.media.pause(); // a paused video decodes nothing: an empty CAVE is free
    else this.d.media.play();
    this._where = to;
    this.state.where = to;
    this.state.transitions++;
    this.state.last = inCave ? "entered the Championship Cave" : "returned to the Central Hub";
    this.d.invalidateShadows();
  }

  /** fade out → do the work → fade in. The only timer in this file. */
  private run(work: () => void): void {
    this._busy = true;
    this.state.busy = true;
    const done = (): void => {
      work();
      this.fade(0);
      this.timer = setTimeout(() => { this._busy = false; this.state.busy = false; this.timer = null; }, FADE_MS);
    };
    if (!this.fade(1)) { done(); return; } // no DOM (tests): swap immediately, same result, no theatre
    this.timer = setTimeout(done, FADE_MS);
  }

  /** The black curtain. Returns false when there is no document to hang it on. */
  private fade(to: 0 | 1): boolean {
    if (typeof document === "undefined") return false;
    if (!this.fader) {
      const el = document.createElement("div");
      el.id = "vo3d-cave-fade";
      el.style.cssText = [
        "position:fixed", "inset:0", "background:#000", "opacity:0", "pointer-events:none",
        "z-index:40", `transition:opacity ${FADE_MS}ms ease-in-out`,
      ].join(";");
      document.body.appendChild(el);
      this.fader = el;
      void el.offsetWidth; // force a layout so the first transition actually animates
    }
    this.fader.style.opacity = String(to);
    return true;
  }

  /** Per-frame, and only while inside: keeps the media readout live. Costs two number reads. */
  update(): void {
    if (this._where === "cave") this.d.media.sample();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.fader?.remove();
    this.fader = null;
  }
}
