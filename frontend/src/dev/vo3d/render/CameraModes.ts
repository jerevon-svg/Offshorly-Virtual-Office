// vo3d render — THE TWO CAMERA EXPERIENCES.
//
// The Renderer's camera is a general-purpose orbit rig: every degree of freedom is live, all the time.
// That is right for building a world and wrong for using one. It is also, for V2, a spoiler — the whole
// point of the exterior world is that it is a REVEAL, and a user who can idly drag south past Reception
// has already found the roads, the pond and the future company lots before anyone showed them.
//
// So the rig is not replaced, it is WRAPPED into two modes:
//
//   OFFICE   the default, and what the product will ship. It preserves V1's illusion that the office IS
//            the world: the ground floor is framed automatically, pitch and yaw are fixed, orbit is off,
//            the canonical whole-office framing is the FURTHEST the camera can zoom out, and panning is
//            fenced by hard bounds — invisible camera walls around the company. Zoom in, drag around,
//            focus a room: all normal. Discover the campus by accident: impossible.
//
//   EXPLORE  the reveal, and the inspection rig: free orbit, free pan, no bounds, a far wider zoom range
//            and low pitches so the horizon and the night sky come into view.
//
// THE BOUNDS ARE VIEWPORT-AWARE, not target-aware. Clamping the orbit target alone is not enough: at a
// wide zoom a legal target still shows a screenful of scenery past the fence. So the clamp works on the
// GROUND FOOTPRINT of the viewport — which, under an orthographic camera pitched at `p`, is
// `camera.top / camera.zoom` tall on screen and therefore `that / sin(p)` deep on the ground. The target
// is then clamped so that footprint stays inside the bounds, and centred on whichever axis the footprint
// is already wider than the bounds.
//
// Leaving EXPLORE cannot leak: returning to OFFICE re-asserts pitch, yaw, framing, zoom limits, bounds
// and the orbit target, so however the camera was left, it comes back to exactly one canonical view.
//
//   PLAYER   gameplay. The orthographic rig is not reconfigured at all — it is simply not the camera being
//            drawn: PLAYER selects the Renderer's PERSPECTIVE camera and hands every degree of freedom to
//            player/PlayerCamera. That is why this mode is four lines here and why leaving it cannot
//            corrupt anything: OrbitControls is disabled for the duration, so nothing writes the ortho
//            camera or its target while the player walks, and EXPLORE resumes on exactly the view it was
//            left on. Everything gameplay lives under player/ — this file only decides who is driving.
//
// This is deliberately a thin policy object over the existing Renderer. When the toggle becomes
// production UI, the UI calls set() and nothing else has to change.
import * as THREE from "three";
import type { Renderer, CameraParams } from "./Renderer";
import type { Rect } from "../core/coords";

export type CameraModeId = "office" | "explore" | "player";
export const CAMERA_MODES: CameraModeId[] = ["office", "explore", "player"];

/** The canonical office framing: V1's fixed overhead read, and the maximum zoom-out in OFFICE mode. The
 *  office COVERS the viewport at that zoom (see frameZoom) — no empty stage is ever in frame. */
export const OFFICE_VIEW = { pitch: 52, yaw: 0 } as const;
/** how far IN the wheel may go from the canonical framing (OrbitControls dollies `camera.zoom`) */
const MAX_DOLLY = 6;
const EXPLORE_ZOOM = { min: 0.05, max: 6 };

export class CameraModes {
  private readonly R: Renderer;
  /** the hard fence: the office footprint and its immediate V1 edge context (the frame includes the
   *  exterior sidewalk under Reception, which is exactly where panning south must stop) */
  private readonly bounds: Rect;
  private _mode: CameraModeId = "office";
  /** camParams.zoom that frames the whole office; depends on the aspect ratio, so it is re-derived */
  private officeZoom = 1;
  private aspectAt = 0;
  /** the office datum: the height the orbit target must stay at. See the panning note in set(). */
  private targetY = 8;

  constructor(R: Renderer, officeBounds: Rect) {
    this.R = R;
    this.bounds = officeBounds;
  }

  get mode(): CameraModeId {
    return this._mode;
  }
  get officeParams(): CameraParams {
    return { pitch: OFFICE_VIEW.pitch, yaw: OFFICE_VIEW.yaw, zoom: this.officeZoom };
  }
  /** the fence, for tests and dev tooling */
  get officeBounds(): Rect {
    return this.bounds;
  }
  /** The ground rect the viewport currently covers, at yaw 0 (OFFICE pins yaw, so this is exact there).
   *
   *  The orbit target is NOT on the floor — it sits at the office datum, 8 units up. Looking down at the
   *  office pitch, the screen centre therefore lands `datum / tan(pitch)` further NORTH than the target,
   *  and a fence measured from the target alone is out by that much on every z bound. Small, but it is
   *  the whole remaining gap between "clamped" and "clamped exactly at the boundary". */
  viewportGroundRect(): Rect {
    const c = this.R.camera;
    const pitch = THREE.MathUtils.degToRad(OFFICE_VIEW.pitch);
    const halfScreen = c.top / Math.max(c.zoom, 1e-6);
    const halfZ = halfScreen / Math.sin(pitch);
    const halfX = c.right / Math.max(c.zoom, 1e-6);
    const t = this.R.controls.target;
    const groundZ = t.z - this.targetY / Math.tan(pitch);
    return { x: t.x - halfX, z: groundZ - halfZ, w: halfX * 2, d: halfZ * 2 };
  }

  /** Enter a mode. Returns the camera params the caller should mirror into its GUI state. */
  set(mode: CameraModeId): CameraParams {
    this._mode = mode;
    const c = this.R.controls;
    if (mode === "player") {
      // Hand the canvas over whole. OrbitControls stays bound to the orthographic camera but is switched
      // OFF, so neither it nor the fence can touch the ortho rig while PLAYER owns the view — which is
      // precisely what makes the round trip back to OFFICE or EXPLORE state-preserving rather than
      // state-restoring. The perspective camera is selected by the caller's player controller.
      this.R.constrain = null;
      c.enabled = false;
      return { ...this.R.camParams };
    }
    c.enabled = true;
    this.R.setActiveCamera(this.R.camera);
    this.R.shadowFocus = null;
    this.R.shadowRadius = null;
    if (mode === "office") {
      this.officeZoom = this.frameZoom(this.bounds, 1, "cover");
      this.aspectAt = window.innerWidth / window.innerHeight;
      this.R.focusOn(this.bounds); // centres the orbit target on the office and resets camera.zoom to 1
      // THE DATUM comes from the Renderer's own focus point, which focusOn has just written. Sampling
      // controls.target instead gives the wrong answer twice over: before placeCamera it still holds
      // whatever height EXPLORE left behind (measured 5942), and after placeCamera it carries OrbitControls'
      // damping residue (measured 9.28). The office floor datum is a constant of the mode, not something
      // to read off a control mid-settle — and the clamp then pulls any residue back to it next frame.
      this.targetY = this.R.target.y;
      this.R.camParams = { pitch: OFFICE_VIEW.pitch, yaw: OFFICE_VIEW.yaw, zoom: this.officeZoom };
      c.enableRotate = false;
      c.enablePan = true; // dragging inside the office is normal V1 navigation — the fence does the work
      // GROUND-PLANE PANNING, and this is load-bearing rather than cosmetic.
      //
      // OrbitControls' screen-space panning moves the target along the CAMERA'S OWN Y AXIS. At the office
      // pitch of 52 degrees that axis is mostly world-Y, so a vertical drag lifts the target into the air
      // instead of sliding it north/south — measured at over 1700 units of Y drift in ten drags. The fence
      // owns x and z, so the Y component escaped it completely and the view kept sliding over the empty
      // stage: vertical pan was effectively infinite while horizontal (whose axis is pure world-X at yaw 0)
      // behaved perfectly.
      //
      // With screen-space panning OFF, panUp becomes `worldUp x cameraRight`, which at yaw 0 is pure -Z:
      // the target stays on the office floor and every pan is a movement the fence can actually see. This
      // is what a bounded map viewport wants anyway. EXPLORE keeps the free screen-space behaviour.
      c.screenSpacePanning = false;
      // The dolly floor is 1: the canonical framing IS the maximum zoom-out. There is no way to pull back
      // far enough to see the campus, which is the entire point of the mode.
      c.minZoom = 1;
      c.maxZoom = MAX_DOLLY;
      this.R.placeCamera();
      this.R.constrain = () => this.clamp();
      this.clamp();
    } else {
      c.enableRotate = true;
      c.enablePan = true;
      c.screenSpacePanning = true; // free-flying inspection rig: unchanged from before the modes existed
      c.minZoom = EXPLORE_ZOOM.min;
      c.maxZoom = EXPLORE_ZOOM.max;
      this.R.constrain = null; // no fence out here: this is the reveal
    }
    return { ...this.R.camParams };
  }

  /** Focus a sub-rect (a room, an employee). Allowed in both modes.
   *
   *  In OFFICE the extra magnification is expressed as OrbitControls DOLLY rather than as a new frustum
   *  size, so the wheel still reaches all the way back out to the canonical framing afterwards — and the
   *  result is clamped by the same fence as a manual drag. */
  focus(rect: Rect, fill = 0.9): CameraParams {
    if (this._mode !== "office") {
      this.R.camParams = { ...this.R.camParams, zoom: this.R.focusOn(rect, fill) };
      this.R.placeCamera();
      return { ...this.R.camParams };
    }
    const need = this.frameZoom(rect, fill);
    this.R.focusOn(rect, fill); // target + camera.zoom = 1
    this.R.camParams = { pitch: OFFICE_VIEW.pitch, yaw: OFFICE_VIEW.yaw, zoom: this.officeZoom };
    this.R.camera.zoom = THREE.MathUtils.clamp(need / this.officeZoom, 1, MAX_DOLLY);
    this.R.placeCamera();
    this.clamp();
    return { ...this.R.camParams };
  }

  /** camParams.zoom at which `rect`'s GROUND footprint meets the viewport at the office pitch. Renderer
   *  computes camera.top as (focus.d * 0.62 + 40) / camParams.zoom — that relation is inverted here, with
   *  the pitch foreshortening (which Renderer.focusOn does not model) folded in.
   *
   *  FIT MATTERS, and it is the whole difference between the two framings:
   *    "contain" — the rect fits INSIDE the viewport, letterboxing the other axis. Right for focusing a
   *                room, where the point is to see all of it.
   *    "cover"   — the viewport fits inside the RECT, cropping the other axis. Right for the office's
   *                maximum zoom-out: a 16:9 viewport cannot contain a near-square office without showing
   *                a band of empty stage down each side, and that stage is exactly what must never be
   *                visible. Covering instead means the office fills the frame at every legal zoom, and
   *                the axis it crops is simply the axis you pan along — a viewport moving over a bounded
   *                V1 office map, which is the behaviour being asked for. */
  private frameZoom(rect: Rect, fill = 1, fit: "cover" | "contain" = "contain"): number {
    const aspect = window.innerWidth / window.innerHeight;
    const sinP = Math.sin(THREE.MathUtils.degToRad(OFFICE_VIEW.pitch));
    const byDepth = (rect.d / 2) * sinP, byWidth = rect.w / 2 / aspect;
    const top = (fit === "cover" ? Math.min(byDepth, byWidth) : Math.max(byDepth, byWidth)) / fill;
    return (this.R.focus.d * 0.62 + 40) / top;
  }

  /** THE FENCE. Runs every frame in OFFICE mode, straight after OrbitControls has moved things. */
  private clamp(): void {
    if (this._mode !== "office") return;
    const R = this.R, c = R.controls, cam = R.camera;
    // a resize changes the aspect and therefore the canonical framing; re-derive without moving the view
    const aspect = window.innerWidth / window.innerHeight;
    if (Math.abs(aspect - this.aspectAt) > 1e-6) {
      this.aspectAt = aspect;
      this.officeZoom = this.frameZoom(this.bounds, 1, "cover");
      R.camParams = { ...R.camParams, zoom: this.officeZoom };
      R.placeCamera();
    }
    if (cam.zoom < 1) cam.zoom = 1; // belt and braces: never past the canonical zoom-out
    // HOLD THE DATUM. Ground-plane panning is what stops Y drifting in the first place, but the fence
    // must also own the axis it implicitly assumes: viewportGroundRect reads only x and z, so any Y the
    // target acquired by any route would slide the visible ground without the clamp ever seeing it.
    // Re-asserted every frame, so nothing can accumulate.
    const dy = this.targetY - c.target.y;
    if (dy !== 0) {
      c.target.y += dy;
      cam.position.y += dy;
    }
    const v = this.viewportGroundRect();
    const b = this.bounds;
    const t = c.target;
    // Clamp so the VIEWPORT stays inside the fence. On an axis where the viewport is already wider than
    // the fence (16:9 against a near-square office, at full zoom-out) there is nothing to choose: centre.
    const centreX = b.x + b.w / 2, centreZ = b.z + b.d / 2;
    const slackX = (b.w - v.w) / 2, slackZ = (b.d - v.d) / 2;
    const wantX = slackX <= 0 ? centreX : THREE.MathUtils.clamp(t.x, centreX - slackX, centreX + slackX);
    // the orbit target sits 6 units north of the rect centre (Renderer.focusOn), so the same offset is
    // carried here — clamping the raw target would otherwise drift the view by that much
    const vCentreZ = v.z + v.d / 2;
    const wantCentreZ = slackZ <= 0 ? centreZ : THREE.MathUtils.clamp(vCentreZ, centreZ - slackZ, centreZ + slackZ);
    const dx = wantX - t.x, dz = wantCentreZ - vCentreZ;
    if (dx === 0 && dz === 0) return;
    // move the CAMERA with the target: OrbitControls pans both, so clamping one alone shears the view
    t.x += dx;
    t.z += dz;
    cam.position.x += dx;
    cam.position.z += dz;
  }
}
