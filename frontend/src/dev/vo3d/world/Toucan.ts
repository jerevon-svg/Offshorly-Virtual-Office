// vo3d world — THE TOUCAN. One bird, flying one path over the campus.
//
// WHAT THIS IS NOT: a wildlife framework, an AI, a flocking system or a navmesh client. It is a point
// travelling along a closed spline with a model pinned to it, and the entire per-frame cost is one
// curve sample, one quaternion and two bone rotations. There is one of them and the file is written so
// that a second would be a second `new Toucan()`, not a refactor.
//
// THE ASSET IS THE ONE THE APP ALREADY SHIPS — public/toucan/toucan.glb, the same file V1's 2D
// ToucanFlyer renders. Nothing was generated, bought or downloaded. That GLB is a Meshy biped auto-rig,
// so the wings ride the ARM bones (LeftArm / RightArm) and its two baked clips ("Running", "Walking")
// are bipedal locomotion that no bird should ever play — V1 reached the same conclusion and drives its
// own flap off those bones, which is exactly what this does. No mixer is created at all.
//
// IT NEVER ENTERS ANYTHING. The path is a fixed ring outside and above the building — the lowest point
// on it is more than twice the tallest wall — so "does not enter rooms" and "does not enter the CAVE"
// are properties of the geometry rather than rules that have to be enforced per frame. It is not in the
// world graph, has no footprint, and is not consulted by any stand test, so it cannot collide with the
// player either.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Rect, Vec2 } from "../core/coords";
import type { EnvPhase } from "../env/timeOfDay";
import type { WeatherState } from "../env/weather";
import { CALL_COOLDOWN, callActivity, flightActivity } from "../audio/events";

export const TOUCAN_GLB_URL = `${import.meta.env.BASE_URL}toucan/toucan.glb`;

/** how long the bird is, in world units. Bon is 36 tall and the office walls are 46, so 13 reads as a
 *  big bird rather than as a drone. */
const LENGTH = 13;
/** the flight ring, as a fraction of the office frame it is built around, and the heights it rides */
const RING = { spread: 0.62, lowY: 95, highY: 205 };
/** cruising speed in world units per second, and what a rainy day does to it */
const SPEED = 62;
/** how hard it banks into a turn, in radians per unit of lateral acceleration */
const BANK = 4.2;
/** wing beats per second, and how far the arm bones swing */
const FLAP = { hz: 3.4, radians: 0.72 };
/** how far away the call can still be heard, in world units */
export const CALL_RANGE = 900;

/** the fixed ring, derived from the office frame so it can never be authored somewhere silly */
export function flightPath(frame: Rect): THREE.CatmullRomCurve3 {
  const cx = frame.x + frame.w / 2, cz = frame.z + frame.d / 2;
  const rx = frame.w * RING.spread, rz = frame.d * RING.spread;
  // eight control points at uneven radii and heights: a circle reads as a machine on rails, and a
  // hand-shaped loop is what stops it being a ping-pong path without needing any behaviour at all
  const shape: [number, number, number][] = [
    [1.0, 0.0, 0.35], [0.72, 0.66, 0.9], [0.05, 0.95, 0.45], [-0.7, 0.7, 0.05],
    [-1.0, -0.05, 0.6], [-0.6, -0.78, 1.0], [0.1, -0.98, 0.5], [0.78, -0.6, 0.0],
  ];
  return new THREE.CatmullRomCurve3(
    shape.map(([u, v, h]) => new THREE.Vector3(cx + u * rx, RING.lowY + h * (RING.highY - RING.lowY), cz + v * rz)),
    true, "catmullrom", 0.5,
  );
}

export type ToucanState = {
  status: "absent" | "loading" | "flying" | "resting" | "error";
  pos: string;
  /** 0…1 — how active the weather lets it be */
  activity: number;
  calls: number;
  /** seconds until the next call is even considered */
  nextCall: number;
};

export class Toucan {
  readonly root = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private wings: THREE.Object3D[] = [];
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly length: number;
  private u = 0.12;
  private t = 0;
  private cooldown = 6;
  private seed = 0x70c4;
  /** reused every frame — the flyer allocates nothing after construction */
  private readonly here = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly prevTangent = new THREE.Vector3(0, 0, 1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly look = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private roll = 0;
  readonly state: ToucanState = { status: "absent", pos: "—", activity: 1, calls: 0, nextCall: 0 };

  constructor(frame: Rect) {
    this.curve = flightPath(frame);
    this.length = this.curve.getLength();
    this.root.visible = false;
  }

  /** LAZY, AND FORGIVING. A missing or broken GLB leaves the sky empty and the app otherwise untouched —
   *  a decorative bird is never worth a broken world. */
  async load(): Promise<boolean> {
    if (this.model) return true;
    this.state.status = "loading";
    try {
      const gltf = await new GLTFLoader().loadAsync(TOUCAN_GLB_URL);
      const m = gltf.scene;
      // FIT BY MEASUREMENT, not by a magic number: the asset's own units are whatever the pipeline left
      // behind, so the box is measured and scaled to LENGTH once, here.
      const box = new THREE.Box3().setFromObject(m);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = LENGTH / Math.max(size.x, size.y, size.z, 1e-6);
      m.scale.setScalar(scale);
      // re-centre so the group's origin is the bird, not the asset's arbitrary pivot
      const centre = new THREE.Vector3();
      box.getCenter(centre);
      m.position.sub(centre.multiplyScalar(scale));
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = true; }
        // the Meshy biped rig puts the wings on the arm bones — the only two nodes this file touches
        if (/^(left|right)arm$/i.test(o.name.replace(/[_\s]/g, ""))) this.wings.push(o);
      });
      this.model = m;
      this.root.add(m);
      this.state.status = "flying";
      return true;
    } catch (err) {
      console.warn("[vo3d] toucan unavailable:", err);
      this.state.status = "error";
      return false;
    }
  }

  get flying(): boolean {
    return this.root.visible && this.model !== null;
  }
  /** where it is right now, in world x/z — what a positional call is panned and attenuated from */
  get position(): Vec2 {
    return { x: this.root.position.x, z: this.root.position.z };
  }
  get worldPosition(): THREE.Vector3 {
    return this.root.position;
  }

  /** ONE FRAME.
   *
   *  @param outdoors false whenever the exterior is not being drawn (OFFICE presentation, or inside the
   *         sealed CAVE): the bird is hidden outright, which is also the only "does not enter the CAVE"
   *         rule there is or needs to be.
   *  @returns true on the frames a call should be played, so the caller owns the audio and this owns
   *         nothing but the timing — no AudioContext is reachable from this file.
   */
  update(dt: number, weather: WeatherState, phase: EnvPhase, outdoors: boolean): boolean {
    if (!this.model) return false;
    const activity = flightActivity(weather, phase);
    this.state.activity = activity;
    // A SEVERE STORM PUTS IT AWAY. Not slowed — gone, the way a bird actually behaves, and the way that
    // costs nothing: a hidden group is not traversed, not sampled and not drawn.
    const show = outdoors && activity > 0;
    if (this.root.visible !== show) this.root.visible = show;
    this.state.status = show ? "flying" : "resting";
    if (!show) return false;

    this.t += dt;
    // rain does not change the path, only how briskly it is flown — one multiplier, no second behaviour
    this.u = (this.u + (SPEED * (0.55 + 0.45 * activity) * dt) / this.length) % 1;
    this.curve.getPointAt(this.u, this.here);
    // a slow vertical breathe on top of the spline's own height, so the ring never reads as a rail
    this.here.y += Math.sin(this.t * 0.42) * 14;
    this.root.position.copy(this.here);

    // ORIENTATION from the path's own tangent, and BANK from how fast that tangent is turning. Rolling
    // into a turn is what separates a bird from a cursor, and it is two cross products a frame.
    this.curve.getTangentAt(this.u, this.tangent);
    const turn = this.prevTangent.x * this.tangent.z - this.prevTangent.z * this.tangent.x;
    this.prevTangent.copy(this.tangent);
    const wantRoll = THREE.MathUtils.clamp(turn * BANK * (dt > 0 ? 1 / dt : 0) * 0.02, -0.8, 0.8);
    this.roll += (wantRoll - this.roll) * Math.min(1, dt * 3.5);
    this.ahead.copy(this.here).add(this.tangent);
    this.look.lookAt(this.here, this.ahead, this.up);
    this.quat.setFromRotationMatrix(this.look);
    this.root.quaternion.copy(this.quat);
    this.root.rotateZ(this.roll);

    // THE FLAP. Two bone rotations, written every frame, allocating nothing. The asset's own clips are
    // bipedal and are deliberately never played.
    if (this.wings.length) {
      const beat = Math.sin(this.t * FLAP.hz * Math.PI * 2) * FLAP.radians;
      for (let i = 0; i < this.wings.length; i++) this.wings[i].rotation.z = (i === 0 ? 1 : -1) * beat;
    }

    // THE CALL. A cooldown, thinned by time of day and weather — night and storms silence it entirely.
    const willing = callActivity(phase, weather);
    this.cooldown -= dt * (willing > 0 ? willing : 0);
    this.state.nextCall = Math.max(0, Math.round(this.cooldown * 10) / 10);
    this.state.pos = `${this.here.x.toFixed(0)}, ${this.here.z.toFixed(0)} @ y${this.here.y.toFixed(0)}`;
    if (willing <= 0 || this.cooldown > 0) return false;
    this.cooldown = CALL_COOLDOWN.min + this.rand() * (CALL_COOLDOWN.max - CALL_COOLDOWN.min);
    this.state.calls++;
    return true;
  }

  /** put it back on its path from a known place — for the dev panel and for a test */
  reset(u = 0.12): void {
    this.u = u;
    this.cooldown = CALL_COOLDOWN.min;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.model?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.model = null;
    this.wings = [];
    this.state.status = "absent";
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }
}
