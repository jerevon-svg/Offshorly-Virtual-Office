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
// ITS AMBIENT LAP NEVER ENTERS ANYTHING. The ring is fixed, outside and above the building — the lowest
// point on it is more than twice the tallest wall — so "does not enter rooms" and "does not enter the
// CAVE" are properties of the geometry rather than rules enforced per frame. It is not in the world
// graph, has no footprint, and is not consulted by any stand test, so it cannot collide with the player.
//
// PHASE 7G — AND IT CAN BE CALLED. V1's office has always had a bird you summon: press the button, it
// flies to you, parks beside your shoulder and the assistant opens when it ARRIVES. That whole decision
// machine — where to park, when to re-aim, when to latch, when to give up following — is V1's own, and
// it is imported rather than re-derived: components/OfficeMap/toucanSummon.ts, extracted from V1's 2D
// ToucanFlyer for exactly this. V1 speaks map pixels in data/office-layout's frame; this world is built
// on that same frame at 1:1, so every threshold transfers verbatim with `y` read as `z`.
//
// FOUR THINGS THIS FILE ADDS AND NOTHING ELSE:
//   • one ALTITUDE rule — summoned flight cruises above the 46-unit wall heads and only descends over
//     the last stretch to the park point, so a bird crossing the building does not fly through a wall;
//   • one FLIGHT LEG — from wherever it is to wherever it was told, eased, with the duration V1's own
//     travelDurationFor returns for a summon;
//   • a way HOME — released, it flies to the interior perch the Central Hub already declares for it
//     (rooms/central-hub TOUCAN_PERCH), sits there, then rejoins its lap at the NEAREST point on the
//     ring rather than snapping back onto it;
//   • V1's WING RHYTHM (components/OfficeMap/toucanWingRhythm) in place of this file's own constant
//     sine, so the wings glide, burst and fold on the perch the way V1's bird does. Only the stroke
//     VALUE changed hands — the axis and the mirrored sign this asset needs are still the ones that
//     were verified here.
//
// THE ONE BIRD RULE. There is a single Toucan instance, owned by app/world.ts, and a summon is a change
// of MODE on it — never a second object. That is what makes "no duplicate birds across a view switch"
// structural rather than something the HUD has to police: the views share one world, and the world has
// one bird.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Rect, Vec2 } from "../core/coords";
import type { EnvPhase } from "../env/timeOfDay";
import type { WeatherState } from "../env/weather";
import { CALL_COOLDOWN, callActivity, flightActivity } from "../audio/events";
import {
  attendFacePointFor,
  decideSummon,
  travelDurationFor,
  type ToucanSummonState,
} from "../../../components/OfficeMap/toucanSummon";
import {
  advanceWingRhythm,
  createWingRhythm,
  wingStrokeAngle,
  type WingRhythmState,
} from "../../../components/OfficeMap/toucanWingRhythm";

export const TOUCAN_GLB_URL = `${import.meta.env.BASE_URL}toucan/toucan.glb`;

/** THE BIRD'S LARGEST DIMENSION, in world units — which for this asset is its WINGSPAN (the mesh measures
 *  1.70 x 1.07 x 1.26 on x/y/z, so x binds). Bon is 36 tall and the office walls are 46.
 *
 *  Was 13, which put a ~9.6-unit body beside a 36-unit avatar and read as a sparrow on the shoulder.
 *  17 gives a ~12.6-unit body at ~11 tall: plainly a toucan, still comfortably smaller than a person, and
 *  still clear of the avatar at V1's own 32-unit park offset (nearest wingtip ~23 units out). */
const LENGTH = 17;

/** THE ONE MODEL-FORWARD CONVENTION, and the reason there is not a rotation offset in any single state.
 *
 *  Measured off the shipped GLB rather than guessed: Hips->Head is (0, 0.999, 0.031) and Head->headfront
 *  is (0, 0, 1.000), so this asset stands up its local +Y and its BEAK POINTS LOCAL +Z. (V1 documents the
 *  same axes for it.)
 *
 *  THREE's Matrix4.lookAt is the camera convention — it orients local -Z at the target — so driving the
 *  root straight off it pointed the bird's TAIL along its direction of travel, and pointed its back at
 *  whoever it was attending. One bird, flying backwards, in every state at once.
 *
 *  The fix is a single yaw of pi applied ABOVE the skeleton and BELOW the root: the model's +Z beak
 *  becomes the root's -Z, which is exactly what every lookAt in this file already drives. Every state —
 *  the ambient lap, the summoned approach, the flight home, the rejoin and the parked hover — is
 *  corrected by that one transform, and none of them carries an offset of its own. The wing bones are
 *  untouched: they rotate in their own local space, under this node, so the flap is unaffected. */
const MODEL_YAW = Math.PI;
/** the flight ring, as a fraction of the office frame it is built around, and the heights it rides */
const RING = { spread: 0.62, lowY: 95, highY: 205 };
/** cruising speed in world units per second, and what a rainy day does to it */
const SPEED = 62;
/** how hard it banks into a turn, in radians per unit of lateral acceleration */
const BANK = 4.2;
/** how far away the call can still be heard, in world units */
export const CALL_RANGE = 900;

/** SUMMONED ALTITUDES, in world units. The tallest wall head in the building is 46 and a body is ~36.
 *
 *  CRUISE clears the walls by 20, which is the whole of "does not clip through walls where practical":
 *  a summoned bird crosses the building OVER its partitions (there is no drawn roof — see world.ts's own
 *  note) and only comes down once it is nearly at you. PARK sits beside the head rather than above it,
 *  because the nameplate and the chat bubble already own the space directly overhead. */
const CRUISE_Y = 66;
const PARK_Y = 34;
/** horizontal distance to the park point over which the descent is asked for. Not a hard ramp — the
 *  altitude is EASED toward this target (see CLIMB_RATE), so a bird called down from the ring's 205
 *  glides rather than dropping. */
const DESCENT_RANGE = 170;
/** how briskly altitude follows its target, per second. The one number that keeps every height change —
 *  the call-down, the descent, the climb back out — a glide instead of a teleport. */
const CLIMB_RATE = 1.4;
/** the parked hover: a small vertical breathe so a waiting bird is alive without drifting anywhere */
const HOVER = { amplitude: 1.6, hz: 0.42 };
/** how fast the parked bird's altitude tracks its own bob. Faster than CLIMB_RATE on purpose: the bob is
 *  the whole "it is alive" signal, and an eased altitude would flatten it away. */
const HOVER_TRACK = 8;
/** how fast facing and bank settle, per second */
const SETTLE = 3.5;
/** seconds on the perch after a release, before it rejoins its lap */
const PERCH_HOLD_S = 7;

/** INDOOR LIFE. The bird's ambient lap used to be the exterior ring and nothing else, so the office it
 *  lives in never actually had a bird in it — you only met one by summoning it. It now alternates: a few
 *  laps outside, then a wander THROUGH the building, then back out.
 *
 *  THE ROUTES ARE THE OFFICE'S OWN GEOMETRY. Nothing is authored here and nothing is pathfound: the
 *  rooms' own centres (the very rects Room Discovery labels and the camera frames) are the stops, and the
 *  leg between two of them is the same eased hop the summon already flies. Crossing at CRUISE_Y clears
 *  every wall head; VISIT_Y drops it into the room ABOVE the avatars and below the wall line, which is
 *  what keeps it clear of heads, desks and the ceiling without a single collision test. */
const INDOOR = {
  /** hover height inside a room: over a 36-unit avatar, under the 46-unit wall head */
  visitY: 40,
  /** seconds hovering in one room before it moves on */
  visitMin: 3.5,
  visitMax: 7,
  /** how many rooms it takes in before heading back out */
  hopsMin: 2,
  hopsMax: 4,
  /** seconds of exterior lap between visits */
  outsideMin: 14,
  outsideMax: 30,
  /** chance that a visit ends on the hub perch rather than in another room */
  perchChance: 0.35,
} as const;

/** THE TWO BODY POSES, as a pitch about the model's own left-right axis — separate from the heading.
 *
 *  This asset is a standing biped rig: its spine runs up local +Y and its beak points local +Z, which is
 *  why it read as a bird hovering bolt upright. A flying bird leans: the body tips toward where it is
 *  going and the head leads it.
 *
 *  PITCH IS ITS OWN NODE, below the forward fix and above the model, and the heading is still the root's
 *  lookAt. Keeping them apart is deliberate and is the whole reason the backward-flight bug cannot come
 *  back through this feature: nothing here touches which way the bird is pointing, only how its body is
 *  carried. The beak's HORIZONTAL direction is unchanged by any pitch, so it still leads the flight.
 *
 *  0.8 rad (~46 degrees) leans the body plainly forward while the beak keeps a strong forward component
 *  (cos 46 = 0.7); 0.15 rad is upright with the slight forward tilt of something paying attention. V1
 *  draws the same distinction with its own SUMMON_UPRIGHT_MAX_RAD. */
const PITCH = { flight: 0.8, attend: 0.15, rate: 2.2 } as const;
/** close enough to call a leg arrived, in world units. Deliberately looser than V1's 10-unit park
 *  radius, which applies to the PARK point (V1's own ARRIVE_RADIUS_PX, still enforced by decideSummon):
 *  this one only ends the two legs nobody is watching closely, the flight home and the rejoin. */
const LEG_ARRIVE = 14;

/** WHAT THE BIRD IS DOING. The three V1 names mean exactly what they mean in V1; the last three are the
 *  way home and are reported to callers as "roaming", because the only thing a caller acts on is whether
 *  the bird is WITH you — V1's own reason for keeping its public union coarser than its phase. */
type Phase =
  | "roaming"      // the exterior lap
  | "touring"      // a leg to somewhere inside the building
  | "visiting"     // hovering in a room
  | "approaching"  // summoned, in the air
  | "attending"    // summoned, parked beside a body
  | "returning"    // released, flying to the perch
  | "perched"      // sitting on the hub perch
  | "rejoining";   // climbing back out to the ring

/** V1's own phase vocabulary, which is what decideSummon takes. "flying" and "paused" are the two
 *  roaming shapes it distinguishes, and it treats them identically for a fresh summon. */
function v1Phase(phase: Phase): "flying" | "paused" | "approaching" | "attending" {
  if (phase === "approaching" || phase === "attending") return phase;
  // V1 treats its two roaming shapes identically for a fresh summon, so which one a wandering bird maps
  // to only has to be honest: sitting or hovering is "paused", anything with a destination is "flying".
  return phase === "perched" || phase === "visiting" ? "paused" : "flying";
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

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
  /** PHASE 7G — what the summon machine is doing, for the dev panel and for a test */
  phase: Phase;
  pos: string;
  /** 0…1 — how active the weather lets it be */
  activity: number;
  calls: number;
  /** seconds until the next call is even considered */
  nextCall: number;
};

export class Toucan {
  readonly root = new THREE.Group();
  /** Carries the one model-forward correction (MODEL_YAW) and nothing else. */
  private readonly facing = new THREE.Group();
  /** Carries the BODY PITCH and nothing else — see PITCH. Below `facing`, above the model, so the heading
   *  and the posture can never be confused for one another. */
  private readonly posture = new THREE.Group();
  private pitch = PITCH.flight;
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
  // ---- PHASE 7G, the summon ------------------------------------------------------------------------
  /** V1's own wing rhythm, replacing this file's constant sine. Glide, burst, and a fold on the perch. */
  private readonly wing: WingRhythmState = createWingRhythm();
  private phase: Phase = "roaming";
  /** the live park ANCHOR — the player's own body, written every frame by app/world.ts while the bird is
   *  called, and null the instant it is released. V1 passes the same thing through a ref for the same
   *  reason: the target moves every frame and must never be a dependency of anything that rebuilds. */
  private summonTarget: Vec2 | null = null;
  /** the leg in flight: where it started, where it is going, and how far through it is */
  private readonly legFrom = new THREE.Vector3();
  private readonly legTo = new THREE.Vector2();
  private legT = 1;
  private legDuration = 1;
  /** the altitude the current leg is aiming at (park height, perch height, or a point on the ring) */
  private legToY = CRUISE_Y;
  /** the point a PARKED bird faces — latched, so small player movement never swivels it (V1's rule) */
  private facePoint: { x: number; y: number } | null = null;
  private perchHold = 0;
  /** seconds of exterior lap left before it goes indoors again, and how many rooms are left in this visit */
  private outsideHold = 0;
  private hopsLeft = 0;
  /** where it is hovering right now, while visiting a room */
  private visitPoint: { x: number; z: number } | null = null;
  /** where on the ring it rejoins, chosen as the nearest point when it leaves the perch */
  private rejoinU = 0;
  private readonly aim = new THREE.Vector3();
  private readonly probe = new THREE.Vector3();
  readonly state: ToucanState = { status: "absent", pos: "—", activity: 1, calls: 0, nextCall: 0, phase: "roaming" };

  /** @param perch where a RELEASED bird goes to sit — the Central Hub's own declared perch
   *         (rooms/central-hub TOUCAN_PERCH), passed in rather than imported so this file keeps its one
   *         dependency on the office's room modules at zero. Omitted, a released bird rejoins its lap
   *         directly. */
  private readonly perch?: { x: number; z: number; y: number };
  private readonly indoors: readonly Vec2[];

  /** @param perch where a RELEASED bird goes to sit — the Central Hub's own declared perch.
   *  @param indoors the stops on its indoor wander, in world x/z. The caller passes the office's OWN room
   *         centres (app/world.ts, from the same rects Room Discovery and the camera framing use), so no
   *         route is authored here and none can drift from the building. Empty means it simply keeps to
   *         its exterior lap, exactly as it did before. */
  constructor(frame: Rect, perch?: { x: number; z: number; y: number }, indoors: readonly Vec2[] = []) {
    this.perch = perch;
    this.indoors = indoors;
    this.curve = flightPath(frame);
    this.length = this.curve.getLength();
    this.root.visible = false;
    this.outsideHold = INDOOR.outsideMin;
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
      // THE FORWARD FIX (see MODEL_YAW). A node of its own rather than a rotation written onto `m`: the
      // re-centring above is expressed in model space, and rotating a parent turns the centred model
      // about that centre instead of swinging it around an offset pivot. One node, no arithmetic to get
      // wrong, and nothing below it — skeleton included — has to know it is there.
      this.facing.rotation.y = MODEL_YAW;
      this.posture.rotation.x = this.pitch;
      this.posture.add(m);
      this.facing.add(this.posture);
      this.root.add(this.facing);
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
  /** HOW BIG A CLICK TARGET IT IS, in world units — asked for rather than duplicated, so changing LENGTH
   *  can never leave the pick sphere behind. A little inside the full span: the sphere is centred on the
   *  body, and the wingtips are the part nobody aims at. */
  get pickRadius(): number {
    return LENGTH * 0.8;
  }

  /** CALLED — or let go.
   *
   *  The park ANCHOR is the player's own body, and app/world.ts writes it every frame while the bird is
   *  called; `null` is a release. V1 hands its bird the same thing through a ref, for the same reason:
   *  the target moves every frame and must never be a dependency of anything that rebuilds. Where the
   *  bird actually parks relative to that body is V1's parkPointFor, not this file's guess. */
  setSummonTarget(target: Vec2 | null): void {
    this.summonTarget = target;
  }

  /** V1's own coarse union. The whole way home reports "roaming", because the only thing a caller acts
   *  on is whether the bird is WITH you — the same reason V1 keeps its public state coarser than its
   *  internal phase. */
  get summonState(): ToucanSummonState {
    return this.phase === "approaching" || this.phase === "attending" ? this.phase : "roaming";
  }

  /** Doing something a summon asked for — which is also the ONE reason it is drawn while the exterior
   *  is not (a bird you called comes, whatever the camera and whatever the weather). */
  get summonActive(): boolean {
    return this.phase !== "roaming";
  }

  /** The body pitch it is currently carrying, in radians — for the dev panel and for a test. Nothing
   *  outside this class may write it: the pose is a consequence of what the bird is doing. */
  get bodyPitch(): number {
    return this.pitch;
  }

  /** THE SUMMON DECISIONS, all of them V1's except the way home. Runs whether or not the bird is being
   *  drawn, so a bird called from the OFFICE presentation — where the exterior is hidden — sets off at
   *  once rather than on the frame somebody happens to switch views. */
  private advanceSummon(dt: number): void {
    const target = this.summonTarget;
    if (target) {
      const decision = decideSummon({
        center: { x: target.x, y: target.z },
        phase: v1Phase(this.phase),
        pos: { x: this.root.position.x, y: this.root.position.z },
        to: { x: this.legTo.x, y: this.legTo.y },
      });
      if (decision.kind === "approach" || decision.kind === "retarget") {
        this.beginLeg(decision.target, PARK_Y);
        this.phase = "approaching";
        this.facePoint = null;
      } else if (decision.kind === "attend") {
        this.phase = "attending";
        this.legT = 1;
      }
      // LATCHED FACING, V1's rule: the parked bird looks at where you WERE when it arrived, and only
      // turns once you have genuinely walked — so standing still can never make it swivel.
      if (this.phase === "attending") {
        this.facePoint = attendFacePointFor(this.facePoint, { x: target.x, y: target.z });
      }
      return;
    }
    // RELEASED. V1 goes straight back to roaming; this bird has somewhere to be — the perch the Central
    // Hub already declares for it — so it flies home, sits a while, and only then rejoins its lap. That
    // is what makes a release read as the bird leaving rather than as the bird being deleted.
    if (this.phase === "approaching" || this.phase === "attending") {
      this.facePoint = null;
      if (this.perch) {
        this.beginLeg({ x: this.perch.x, y: this.perch.z }, this.perch.y);
        this.phase = "returning";
      } else {
        this.beginRejoin();
      }
      return;
    }
    if (this.phase === "returning") {
      if (this.legArrived()) {
        this.phase = "perched";
        this.perchHold = PERCH_HOLD_S;
      }
      return;
    }
    if (this.phase === "perched") {
      this.perchHold -= dt;
      if (this.perchHold <= 0) this.beginRejoin();
      return;
    }
    // ---- THE INDOOR WANDER -------------------------------------------------------------------------
    // Ambient life, and the only part of this machine nobody asked for: after a stretch of exterior lap
    // the bird lets itself into the building, hovers over a few rooms and lets itself back out. Every leg
    // is the SAME eased hop the summon flies and every stop is a room the office already declares, so
    // this adds one timer and no geometry, no route data and no pathfinding.
    if (this.phase === "touring") {
      if (this.legArrived()) {
        this.phase = "visiting";
        this.visitPoint = { x: this.legTo.x, z: this.legTo.y };
        this.perchHold = INDOOR.visitMin + this.rand() * (INDOOR.visitMax - INDOOR.visitMin);
      }
      return;
    }
    if (this.phase === "visiting") {
      this.perchHold -= dt;
      if (this.perchHold > 0) return;
      this.visitPoint = null;
      this.hopsLeft -= 1;
      // One stop in a visit may be the hub perch, which is what makes "it sometimes sits down" true
      // without a second resting mechanism — `perched` already knows how to hold and fold its wings.
      if (this.hopsLeft > 0 && this.perch && this.rand() < INDOOR.perchChance) {
        this.beginLeg({ x: this.perch.x, y: this.perch.z }, this.perch.y);
        this.phase = "returning";
        return;
      }
      if (this.hopsLeft > 0 && this.beginTour()) return;
      this.beginRejoin();
      return;
    }
    if (this.phase === "roaming" && this.indoors.length > 0) {
      this.outsideHold -= dt;
      if (this.outsideHold <= 0) {
        this.hopsLeft = INDOOR.hopsMin + Math.floor(this.rand() * (INDOOR.hopsMax - INDOOR.hopsMin + 1));
        if (!this.beginTour()) this.armOutsideHold();
      }
      return;
    }
    if (this.phase === "rejoining" && this.legArrived()) {
      this.u = this.rejoinU;
      // The ambient bank is a DERIVATIVE of the tangent, so handing back with a stale previous tangent
      // is one frame of phantom roll. Seeding it is cheaper than damping the spike.
      this.curve.getTangentAt(this.u, this.prevTangent);
      this.phase = "roaming";
      this.hopsLeft = 0;
      this.armOutsideHold();
    }
  }

  private beginLeg(target: { x: number; y: number }, toY: number): void {
    this.legFrom.copy(this.root.position);
    this.legTo.set(target.x, target.y);
    this.legToY = toY;
    // V1'S OWN DURATION for a summoned leg — its faster speed and its much shorter floor, with no
    // jitter, because a click should answer the same way every time.
    this.legDuration = Math.max(
      0.2,
      travelDurationFor(Math.hypot(target.x - this.legFrom.x, target.y - this.legFrom.z), "summon"),
    );
    this.legT = 0;
  }

  private legArrived(): boolean {
    if (this.legT >= 1) return true;
    return Math.hypot(this.legTo.x - this.root.position.x, this.legTo.y - this.root.position.z) <= LEG_ARRIVE;
  }

  /** Rejoin the lap at the NEAREST point on the ring, so leaving the perch is a flight rather than a
   *  snap back onto the rail. Sampled once, at the transition — never per frame. */
  /** Head for a room — a different one from the one it is standing over, when there is a choice. Returns
   *  false when the office declared no rooms at all, in which case the bird simply keeps to its lap. */
  private beginTour(): boolean {
    if (this.indoors.length === 0) return false;
    const here = this.visitPoint;
    let pick = this.indoors[Math.floor(this.rand() * this.indoors.length) % this.indoors.length];
    if (here && this.indoors.length > 1) {
      for (let tries = 0; tries < 4 && Math.hypot(pick.x - here.x, pick.z - here.z) < 1; tries++) {
        pick = this.indoors[Math.floor(this.rand() * this.indoors.length) % this.indoors.length];
      }
    }
    this.beginLeg({ x: pick.x, y: pick.z }, INDOOR.visitY);
    this.phase = "touring";
    return true;
  }

  private armOutsideHold(): void {
    this.outsideHold = INDOOR.outsideMin + this.rand() * (INDOOR.outsideMax - INDOOR.outsideMin);
  }

  private beginRejoin(): void {
    this.rejoinU = this.nearestU();
    this.curve.getPointAt(this.rejoinU, this.aim);
    this.beginLeg({ x: this.aim.x, y: this.aim.z }, this.aim.y);
    this.phase = "rejoining";
  }

  private nearestU(): number {
    let best = this.u;
    let bestD = Infinity;
    for (let i = 0; i < 96; i++) {
      const u = i / 96;
      this.curve.getPointAt(u, this.probe);
      const d = this.probe.distanceToSquared(this.root.position);
      if (d < bestD) { bestD = d; best = u; }
    }
    return best;
  }

  /** ONE SUMMONED FRAME — a leg, an altitude and a facing. No pathfinding and no world graph: the bird
   *  flies OVER the building's partitions (CRUISE_Y clears every wall head) and only comes down over the
   *  last DESCENT_RANGE, which is the whole of "does not clip through walls where practical". */
  private flySummon(dt: number): void {
    const p = this.root.position;
    const holding = this.phase === "attending" || this.phase === "perched" || this.phase === "visiting";
    if (holding) {
      const k = Math.min(1, dt * CLIMB_RATE * 2);
      const sitting = this.phase === "perched" && this.perch;
      const hx = sitting ? this.perch!.x : this.legTo.x;
      const hz = sitting ? this.perch!.z : this.legTo.y;
      p.x += (hx - p.x) * k;
      p.z += (hz - p.z) * k;
      // A perched bird sits still; a hovering one breathes. `visiting` hovers over a room at the indoor
      // height, `attending` beside a shoulder at the park height — one hover, two altitudes.
      const bob = Math.sin(this.t * HOVER.hz * Math.PI * 2) * HOVER.amplitude;
      const wantY = sitting ? this.perch!.y : (this.phase === "visiting" ? INDOOR.visitY : PARK_Y) + bob;
      p.y += (wantY - p.y) * Math.min(1, dt * HOVER_TRACK);
    } else {
      this.legT = Math.min(1, this.legT + dt / this.legDuration);
      const e = easeInOutCubic(this.legT);
      p.x = this.legFrom.x + (this.legTo.x - this.legFrom.x) * e;
      p.z = this.legFrom.z + (this.legTo.y - this.legFrom.z) * e;
      const remaining = Math.hypot(this.legTo.x - p.x, this.legTo.y - p.z);
      // Cruise is never BELOW the destination, so the climb out to the ring does not dip first.
      const cruise = Math.max(CRUISE_Y, this.legToY);
      const wantY = this.legToY + (cruise - this.legToY) * Math.min(1, remaining / DESCENT_RANGE);
      // EASED, never written: this is the one number that keeps a bird called down from the ring's 205
      // a glide instead of a teleport.
      p.y += (wantY - p.y) * Math.min(1, dt * CLIMB_RATE);
    }

    // WHERE IT LOOKS — the same lookAt primitive the ambient lap uses, so there is one orientation path
    // in this file and not two. A parked bird looks at its latched face point; a flying one looks where
    // it is going. Slerped, so a re-aimed leg turns the bird instead of snapping it.
    if (this.phase === "attending" && this.facePoint) this.aim.set(this.facePoint.x, p.y, this.facePoint.y);
    else this.aim.set(this.legTo.x, p.y, this.legTo.y);
    if (this.aim.distanceToSquared(p) > 1e-4) {
      this.look.lookAt(p, this.aim, this.up);
      this.quat.setFromRotationMatrix(this.look);
      this.root.quaternion.slerp(this.quat, Math.min(1, dt * SETTLE));
    }
    // No banking beside somebody's shoulder. Decayed rather than zeroed so the ambient lap is handed
    // back a roll it can keep easing from.
    this.roll += (0 - this.roll) * Math.min(1, dt * SETTLE);
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
    // THE SUMMON IS DECIDED FIRST, and unconditionally. A bird called from the OFFICE presentation (where
    // the exterior is not drawn at all) or in weather that would have grounded the lap has to set off on
    // the frame it was called, not on the frame somebody happens to switch cameras.
    this.advanceSummon(dt);
    // A SEVERE STORM PUTS IT AWAY. Not slowed — gone, the way a bird actually behaves, and the way that
    // costs nothing: a hidden group is not traversed, not sampled and not drawn.
    //
    // …UNLESS IT WAS CALLED. That is the one override, and it is what makes the summon work in all three
    // views rather than only in the two that draw the outdoors.
    const show = (outdoors && activity > 0) || this.summonActive;
    if (this.root.visible !== show) this.root.visible = show;
    this.state.phase = this.phase;
    this.state.status = show ? "flying" : "resting";
    if (!show) return false;

    this.t += dt;
    if (this.phase === "roaming") {
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
    } else {
      this.flySummon(dt);
      this.here.copy(this.root.position);
    }

    // THE FLAP, on V1'S OWN RHYTHM (toucanWingRhythm): glides held for a few seconds, then a burst of a
    // whole number of wingbeats, and the spread folding away on the perch. Only the stroke VALUE came
    // from V1 — the axis and the mirrored sign are the ones that were verified against this asset here,
    // and they are untouched. Two bone rotations a frame, allocating nothing; the asset's own clips are
    // bipedal and are deliberately never played.
    // THE BODY POSE, blended rather than switched — see PITCH. Upright only while it is actually
    // attending somebody; every flying phase (the lap, the wander, the approach, the flight home, the
    // rejoin) carries the leaning posture, and a bird that is let go leans back into it on the way out.
    // A perched bird stands up, because a bird on a rail is not flying.
    const wantPitch =
      this.phase === "attending" || this.phase === "perched" ? PITCH.attend : PITCH.flight;
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * PITCH.rate);
    this.posture.rotation.x = this.pitch;

    advanceWingRhythm(this.wing, dt, this.phase !== "perched");
    if (this.wings.length) {
      const beat = wingStrokeAngle(this.wing);
      for (let i = 0; i < this.wings.length; i++) this.wings[i].rotation.z = (i === 0 ? 1 : -1) * beat;
    }

    // THE CALL. A cooldown, thinned by time of day and weather — night and storms silence it entirely.
    // A SUMMONED bird does not call: it is a hand's width from somebody's ear, and the positional squawk
    // is an ambient sound written for the other side of a campus.
    if (this.phase !== "roaming") {
      this.state.pos = `${this.here.x.toFixed(0)}, ${this.here.z.toFixed(0)} @ y${this.here.y.toFixed(0)}`;
      return false;
    }
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
    // A restarted lap is not a summoned bird. Clearing the intent too is what stops "▶ restart its lap"
    // leaving a bird that flies the ring while the host still believes it is parked beside somebody.
    this.summonTarget = null;
    this.phase = "roaming";
    this.facePoint = null;
    this.legT = 1;
    this.visitPoint = null;
    this.hopsLeft = 0;
    this.armOutsideHold();
  }

  dispose(): void {
    this.root.removeFromParent();
    this.facing.removeFromParent();
    this.posture.removeFromParent();
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
