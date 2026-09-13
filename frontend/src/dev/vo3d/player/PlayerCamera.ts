// vo3d player — THE GAMEPLAY CAMERA RIG: one perspective camera, two views.
//
// THIRD PERSON  a smoothed boom behind and above Bon. Mouse orbits the boom; the boom does not orbit
//               instantly, it CHASES — a rigid boom reads as the world snapping around a static avatar,
//               which is the single thing that makes a follow camera feel cheap.
// FIRST PERSON  the same camera moved onto the avatar's eye line. No boom, no smoothing on position
//               (lag on your own head reads as drunkenness), only the shared yaw/pitch.
//
// The two views SHARE yaw and pitch, so toggling is continuous: you keep looking where you were looking,
// and the avatar does not move at all. Only the pitch limit differs (a third-person boom that goes fully
// vertical turns into a top-down view of a hat).
//
// BOOM COLLISION is done against the same logical clearance data the body uses — NOT against the scene.
// Marching the boom outward and stopping at the first sample that is not open space keeps the camera out
// of walls for a handful of predicate calls per frame, with no raycast and no per-frame traversal.
//
// It is given its OWN, much laxer probe than the body's. Judging the boom at the body radius collapses it
// to the minimum almost everywhere — measured standing at a Central Hub café table, where a camera that
// should sit 79 units back was pulled to 13 and ended up inside Bon's hair. A camera may fly over a desk
// it could not stand on; only walls and unbuilt space should stop it.
import * as THREE from "three";
import type { Vec2 } from "../core/coords";
import type { StandTest } from "./PlayerBody";

export type PlayerView = "third" | "first";

/** Bon is 36 units tall. These are all fractions of that, so an avatar swap re-derives rather than breaks. */
const EYE_HEIGHT = 0.9;
/** third-person: where on the body the boom is aimed, and how long the boom is */
const SHOULDER_HEIGHT = 0.72;
const BOOM_LENGTH = 2.6;
/** how much of the boom is given up to keep the camera clear of geometry */
const BOOM_MIN = 0.8;
const BOOM_SAMPLES = 8;

const PITCH_LIMIT = { third: { min: -0.45, max: 1.05 }, first: { min: -1.45, max: 1.45 } } as const;
const DEFAULT_PITCH = 0.34;
/** radians per pixel of mouse travel */
export const LOOK_SENSITIVITY = 0.0026;
/** exponential smoothing rates (1/s): position chases faster than it orbits, which reads as weight */
const FOLLOW_RATE = 11;
const AIM_RATE = 16;

const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

export class PlayerCamera {
  readonly camera: THREE.PerspectiveCamera;
  view: PlayerView = "third";
  /** shared look angles; yaw is the world heading the camera looks ALONG */
  yaw = 0;
  pitch = DEFAULT_PITCH;
  /** the CAMERA's probe — see the boom-collision note; never the body's */
  private readonly probe: StandTest;
  private readonly height: number;
  private readonly smoothed = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private primed = false;

  constructor(camera: THREE.PerspectiveCamera, avatarHeight: number, probe: StandTest) {
    this.camera = camera;
    this.height = avatarHeight;
    this.probe = probe;
  }

  /** Apply a mouse delta (pixels). Pitch is clamped per view, yaw wraps freely.
   *
   *  YAW SIGN. `forward` is (sin yaw, −cos yaw): at yaw 0 it points north (−z), and INCREASING yaw swings
   *  it toward east (+x) — which is screen-right for the viewer. So a rightward mouse delta must ADD to
   *  yaw. It used to subtract, which turned the view left when the mouse went right. */
  look(dx: number, dy: number): void {
    this.yaw += dx * LOOK_SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * LOOK_SENSITIVITY, PITCH_LIMIT[this.view].min, PITCH_LIMIT[this.view].max);
  }
  setView(v: PlayerView): void {
    if (v === this.view) return;
    this.view = v;
    this.pitch = THREE.MathUtils.clamp(this.pitch, PITCH_LIMIT[v].min, PITCH_LIMIT[v].max);
    this.primed = false; // the next frame places the camera exactly, with no smear across the cut
  }
  /** the ground-plane heading the player walks along when pressing "forward" */
  get forward(): Vec2 {
    return { x: Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }
  get right(): Vec2 {
    return { x: Math.cos(this.yaw), z: Math.sin(this.yaw) };
  }

  /** Place the camera for this frame. `p` is the avatar's ground position. */
  update(p: Vec2, dt: number): void {
    const eye = this.height * EYE_HEIGHT;
    if (this.view === "first") {
      // straight onto the eye line: no smoothing, because lag on your own viewpoint reads as nausea
      this.camera.position.set(p.x, eye, p.z);
      this.aim.set(p.x + this.forward.x * 100, eye - Math.tan(this.pitch) * 100, p.z + this.forward.z * 100);
      this.camera.lookAt(this.aim);
      this.primed = true;
      return;
    }
    const focusY = this.height * SHOULDER_HEIGHT;
    const boom = this.clearBoom(p);
    const cp = Math.cos(this.pitch);
    const want = new THREE.Vector3(
      p.x - this.forward.x * boom * cp,
      focusY + Math.sin(this.pitch) * boom,
      p.z - this.forward.z * boom * cp,
    );
    const focus = new THREE.Vector3(p.x, focusY, p.z);
    if (!this.primed) { this.smoothed.copy(want); this.aim.copy(focus); this.primed = true; }
    else {
      this.smoothed.lerp(want, damp(FOLLOW_RATE, dt));
      this.aim.lerp(focus, damp(AIM_RATE, dt));
    }
    this.camera.position.copy(this.smoothed);
    this.camera.lookAt(this.aim);
  }

  /** Re-seat the rig without a smoothing smear (entering the mode, or teleporting the avatar). */
  snap(): void {
    this.primed = false;
  }

  /** March the boom out from the avatar and stop short of anything that is not open floor. Uses the same
   *  logical clearance the body does — a probe radius rather than the body radius, so the camera may pass
   *  over a desk it could not stand on. */
  private clearBoom(p: Vec2): number {
    const full = this.height * BOOM_LENGTH;
    const min = this.height * BOOM_MIN;
    for (let i = BOOM_SAMPLES; i >= 1; i--) {
      const d = (full * i) / BOOM_SAMPLES;
      if (d <= min) break;
      if (this.probe({ x: p.x - this.forward.x * d, z: p.z - this.forward.z * d })) return d;
    }
    return min;
  }
}
