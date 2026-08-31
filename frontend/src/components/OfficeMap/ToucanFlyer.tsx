import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { FRAME_HEIGHT, FRAME_WIDTH } from "../../data/office-layout";
import { loadGlbCached } from "../../render3d/glbCache";
import { getSharedRenderer, renderToCanvas } from "../../render3d/SharedRenderer";
import { MAX_EFFECTIVE_DPR, scaledRenderSize } from "../../render3d/renderScale";
import styles from "./ToucanFlyer.module.css";
import bubbleStyles from "./TalkingBubble.module.css";
import { advanceWingRhythm, createWingRhythm, wingStrokeAngle } from "./toucanWingRhythm";

// ---------------------------------------------------------------------------
// Ambient decorative toucan NPC — V1. Purely a visual flourish: flies a
// smooth, randomized loop between a handful of hand-picked aerial waypoints
// above the office. Deliberately independent of every employee system
// (walkability, findPath, walkTo, doors, room-entry, spatial positioning) —
// see the task doc for why: it's an aerial decoration, not a character, and
// is allowed to fly over furniture/walls/employees/rooms.
//
// Render approach mirrors CharacterCanvas.tsx's established "own THREE
// scene + shared WebGL context, blit into a 2D canvas element" pattern
// (SharedRenderer.renderToCanvas / glbCache.loadGlbCached are the exact same
// singletons CharacterCanvas uses), but simplified: the 3D scene is static
// (camera + lights + model fixed in local space), and ONLY the model's
// local rotation/bob change per frame for the flight "feel." The toucan's
// actual position on the 2D map is driven separately via direct DOM style
// mutation on the wrapping div (percentage of FRAME_WIDTH/FRAME_HEIGHT,
// same convention OfficeStage.tsx uses for every other layer) — never
// through React state, so this never triggers a re-render.
//
// GLB inspection / pipeline result (public/toucan/toucan.glb): the fully
// unrigged Meshy-generated toucan (see git history for that attempt — real
// Image-to-3D/Remesh output, but Rigging failed twice with "422 Pose
// estimation failed": Meshy's `/v1/rigging` pose estimation is a HUMANOID/
// biped detector that a toucan's body plan never matches, a hard API
// limitation) has been swapped back out for the ORIGINAL rigged placeholder
// GLB (Meshy_AI_..._Merged_Animations.glb — the same asset the very first
// version of this component used): a real skinned mesh ("char1", ~7.9k
// verts) driven by a full biped skeleton ("Armature" root, Hips/Spine/
// LeftArm+RightArm/LeftForeArm+RightForeArm/neck/Head/head_end/headfront —
// Meshy's auto-rig maps any character's limbs onto its generic biped
// template, so THIS toucan's wings ride the Arm bones, unlike the unrigged
// asset). Optimized as a derived runtime copy the same way every other
// toucan asset here has been (source GLB in ~/Downloads left untouched):
// texture resize 8192px -> 1024px via gltf-transform, ~34.5MB -> ~1.5MB.
// Ships two baked clips, "Running" and "Walking" — bipedal locomotion, NOT
// flight, so neither is ever played (see FLIGHT_CLIP_RE below); the
// skeleton is used ONLY to drive our own procedural flap (LeftArm/RightArm)
// and the orientation fix (real Hips/Head/headfront bone positions this
// time, not the STATIC_SPINE_DIR/STATIC_CHEST_DIR fallback below — that
// fallback stays in place for robustness/future-proofing but isn't hit
// while this rig is loaded). No separate jaw/beak/mouth bone or mesh
// exists (headfront is a single point marker, not a hinge) — per spec,
// mouth animation is skipped rather than faked.
// ---------------------------------------------------------------------------

const TOUCAN_GLB_URL = `${import.meta.env.BASE_URL}toucan/toucan.glb`;

// Hand-picked safe aerial waypoints (office-layout.ts / office-assets-
// manifest.json room + decor centers) — NOT validated against the employee
// walkability grid on purpose; the toucan is an aerial decoration and may
// fly over anything. Index 0 is the toucan's home/start point (the Central
// Hub statue — office-assets-manifest.json's "statue" decor layer, x=661.88
// y=536.41 w=129.24 h=122.04, so ~top-center of it) and stays a completely
// ordinary entry in the pool afterward, so the normal random-pick logic in
// startTravelTo/arriveAndDecide already lets the toucan occasionally fly
// back to it — no special-cased "return home" behavior needed.
const WAYPOINTS: { x: number; y: number }[] = [
  { x: 727, y: 556 }, // central-hub statue (home / perch)
  { x: 707, y: 1000 }, // reception-room
  { x: 170, y: 1010 }, // meeting-room
  { x: 1256, y: 1000 }, // project-room
  { x: 1270, y: 170 }, // dev-team
  { x: 166, y: 447 }, // design-team
];
const HOME_WAYPOINT_INDEX = 0;
const INITIAL_PERCH_MS = 2200; // "perched → short idle pause → take off"

// CSS-pixel display footprint of the toucan's canvas element — this is the
// ONLY knob that controls how small the bird looks on the office map (see
// the diagnosis: the previous version instead shrank the 3D model inside a
// mostly-empty, oversized camera frustum via targetSize=0.12, which is what
// made it blurry — ~13% frame fill, ~15px of actual bird detail). The model
// itself now fills ~90% of its own render frame (see CAMERA_FILL_FRACTION
// and the auto-framing math in the `.then()` callback below, mirroring
// CharacterCanvas's own tight-framing approach), so this can — and must —
// be small on its own; deliberately well under bon's own ~26x37 CSS
// footprint (office-assets-manifest.json), matching "significantly smaller
// than employee characters."
const RENDER_SIZE = 28;
// Extra raster-vs-display oversampling on top of devicePixelRatio, cheap at
// this small a render target (28-56px CSS -> 84-168px raster instead of
// 28-56px), giving a margin closer to CharacterCanvas's own ~8x raster-to-
// CSS-size ratio (its fixed 210x298 render vs. bon's ~26x37 CSS box) rather
// than the previous 1x-2x.
const SUPERSAMPLE = 3;

// ---------------------------------------------------------------------------
// Zoom-aware render resolution — the same policy the live-3D characters use
// (render3d/renderScale.ts): measure the canvas's ACTUAL on-screen size (which
// already includes the map's CSS transform zoom), multiply by a capped device
// pixel ratio, snap to a small bucket ladder so the shared WebGL surface is
// resized only when the bucket changes, and cap the top so a deep zoom on a
// high-DPI display can't run away with fill cost.
//
// Why this needs its own ladder instead of calling resolveRenderScale()
// directly: that helper's buckets top out at 2x base because a character's
// base render (e.g. 298px) is already ~8x its on-screen height, so 2x is
// plenty. The toucan's base is only RENDER_SIZE * SUPERSAMPLE (84px) against a
// 28px sprite that grows to ~140 CSS px at max zoom — 2x of that base is still
// an upscale, which is exactly why the bird went soft while characters stayed
// sharp. The STRATEGY (measure x capped DPR, snap, cap) and the shared
// MAX_EFFECTIVE_DPR / scaledRenderSize primitives are reused verbatim; only
// the ladder is re-calibrated for this asset's much smaller base.
//
// Bucket 1 is EXACTLY the previous fixed size, so nothing changes at normal
// zoom and a zoomed-out bird never renders bigger than it used to.
const TOUCAN_RENDER_SCALE_BUCKETS: readonly number[] = [1, 1.5, 2, 3];

// How often (in rendered frames) the on-screen size is re-measured, matching
// CharacterCanvas's RENDER_SCALE_POLL_FRAMES: getBoundingClientRect is a
// layout read, and once a quarter-second at 60fps is ample for zoom changes.
const TOUCAN_RENDER_SCALE_POLL_FRAMES = 15;

/** Backing-buffer size (device px, square) for a toucan canvas currently
 *  displayed at `cssSizePx`. Pure, so the buckets are unit-testable. */
export function toucanRenderPx(cssSizePx: number, devicePixelRatio: number): number {
  const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), MAX_EFFECTIVE_DPR);
  // Bucket 1 == the original fixed raster.
  const base = RENDER_SIZE * SUPERSAMPLE * dpr;
  // 1:1 with the pixels the bird actually occupies on screen; never below the
  // original base, so zooming out cannot make it worse than it was.
  const wanted = Math.max(base, (cssSizePx > 0 ? cssSizePx : RENDER_SIZE) * dpr);
  const ratio = wanted / base;
  let bucket = TOUCAN_RENDER_SCALE_BUCKETS[TOUCAN_RENDER_SCALE_BUCKETS.length - 1];
  for (const candidate of TOUCAN_RENDER_SCALE_BUCKETS) {
    if (candidate >= ratio) {
      bucket = candidate;
      break;
    }
  }
  return scaledRenderSize(base, base, bucket).width;
}
// How much of the camera's vertical frame the model's bounding sphere
// should fill (angular diameter / full vertical FOV) — the auto-framing
// target, same 85-95% range CharacterCanvas's own frameMargin constants aim
// for (see its CONFIG.camera doc comment).
const CAMERA_FILL_FRACTION = 0.9;
// Padding multiplier on the bone-derived bounding radius, mirroring
// CharacterCanvas's own bone-position padding (its computeFramingBox pads
// by 12% since skin surface extends past bone joint centers). This rig
// ALSO flaps its wing bones up to +0.55 rad away from the rest pose the
// bounding box below is measured at (toucanWingRhythm's GLIDE_SPREAD_ANGLE
// + FLAP_STROKE_AMPLITUDE peak, pinned by its unit tests), so the pad
// needs to cover
// both slop sources — 18% leaves comfortable headroom for a full-amplitude
// flap without re-fitting the camera every frame.
const FRAME_PADDING_FACTOR = 1.18;
const SPEED_PX_PER_SEC = 55; // calm, ambient pace
const MIN_TRAVEL_S = 4;
const MAX_TRAVEL_S = 18;
const PAUSE_CHANCE = 0.5;
const PAUSE_MIN_MS = 2000;
const PAUSE_MAX_MS = 5000;
// Bob amplitude as a FRACTION of camera distance, not a fixed world-unit
// constant — bob is applied to `pivot` in the same outer scene space the
// camera sits in (see the tick loop below), so its ON-SCREEN size depends
// on how far away the camera is. The old fixed camera sat at distance
// hypot(1.5, 0.65)~=1.635 with a 0.05-unit bob (~3.06% of that distance);
// the auto-framing fix below moves the camera to a DIFFERENT (larger)
// distance to properly frame the model, so the bob is now expressed as
// that same ~3.06% ratio and multiplied by the real (computed) distance
// once it's known — preserving the exact same on-screen bob magnitude
// instead of the raw constant becoming proportionally smaller.
const BOB_AMPLITUDE_TO_DISTANCE_RATIO = 0.05 / Math.hypot(1.5, 0.65);
const BOB_FREQUENCY = 1.6; // radians/sec
const TURN_SPEED = 3.2; // radians/sec, how fast facing catches up to travel direction
const MAX_BANK = 0.42; // radians (~24deg)
const ALTITUDE_PX = 46; // fixed screen-space offset so it reads as "above" the office

// The ONLY thing the world-space pill ever says. Not derived from, and never
// replaced by, an assistant response — a bird in the office behaves like a
// bird; the meaningful reply is the assistant panel's job.
const BIRD_TALK = "Squawk squawk…";

// Procedural wing flap (see GLB inspection note above the component): the
// supplied rig has no flying/flapping clip — its only two clips are the
// bipedal "Running"/"Walking" and neither is ever played — but it IS a real
// skinned biped skeleton whose LeftArm/RightArm bones stand in for the
// wings (Meshy's auto-rig maps any character's limbs onto a generic biped
// template). Each frame, a small rotation is composed onto the bone's
// ORIGINAL bind-pose quaternion (never accumulated), so it always
// oscillates around the authored rest pose instead of drifting.
//
// The stroke VALUE and the glide/burst rhythm driving it live in
// ./toucanWingRhythm.ts (pure + unit-tested); this file only owns the axis
// and the bone application. Read that module's two invariants before
// touching either — in particular, both bones take the same-signed angle on
// purpose, because this rig's Left/Right bind quaternions are already
// mirrored.
//
// Axis chosen by rendering both candidates through the real top-down camera
// (see the offline debug-harness screenshots taken while implementing this)
// and comparing two flying frames a half flap-period apart: local X made
// the wing appendage visibly foreshorten/extend (grow and shrink in
// projected top-down length) between frames — the signature of a wing
// lifting/lowering out of the horizontal plane — while local Z instead made
// it visibly swing sideways (a forward/back sweep, not up/down). If this
// still reads wrong in the live app, this is the one constant to flip
// (try Vector3(0,0,1) or Vector3(0,1,0)) — do not change anything else.
const FLAP_AXIS = new THREE.Vector3(1, 0, 0);

// Fallback pose-basis reference vectors for the CURRENT unrigged toucan
// mesh (see header comment) — used only when no Hips/Head bones are found,
// i.e. exactly this asset. Play the exact same role spineDir/chestDir fill
// when derived from bone positions on a rigged asset (see the `.then()`
// callback below): "the model's own standing/forward axes," fed into the
// same basis-alignment math either way. Verified by rendering the actual
// mesh from multiple angles offline, not guessed — beak points local +Z,
// "up the body" is local +Y.
const STATIC_SPINE_DIR = new THREE.Vector3(0, 1, 0);
const STATIC_CHEST_DIR = new THREE.Vector3(0, 0, 1);

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Shortest-path angle interpolation (radians), so facing never spins the
// "long way around" through a 2*PI wrap.
function lerpAngle(a: number, b: number, t: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function pickNextIndex(current: number, count: number): number {
  if (count <= 1) return 0;
  let next = current;
  while (next === current) next = Math.floor(Math.random() * count);
  return next;
}

// Bone-world-position bounding box — mirrors CharacterCanvas.tsx's
// computeFramingBox: THREE.Box3().setFromObject() on a SkinnedMesh reads
// only the raw bind-pose-local geometry (near-origin, ~cm scale), NOT the
// actual posed skeleton extent. Bone world positions are unaffected by that
// quirk since they're plain node-hierarchy transforms, so they're a much
// more accurate (and cheap) proxy for this rig's real on-screen size.
function boneWorldBox(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const pos = new THREE.Vector3();
  let hasBones = false;
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) {
      hasBones = true;
      o.getWorldPosition(pos);
      box.expandByPoint(pos);
    }
  });
  if (!hasBones) box.setFromObject(root);
  return box;
}

function findBone(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  for (const name of names) {
    const found = root.getObjectByName(name);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stage 1 "Call Toucan" summon support. The bird stays a roaming office
// decoration by default; a summon is expressed ENTIRELY as "a park point is
// present in summonTargetRef, or it isn't." Everything below is additive —
// the roaming waypoint logic, the flight interpolation, the yaw/bank/bob
// math, the GLB, the camera and toucanWingRhythm's timing are untouched;
// summoned flight deliberately runs through the SAME approved flight motion
// (see the two `phase === "flying" || phase === "approaching"` checks in
// tick()).
//
// The target arrives through a REF, never a prop the effect depends on: the
// GLB-loading effect has []-deps on purpose, so making it observe the live
// player position would reload the model and teleport the bird home on every
// walk frame.
// ---------------------------------------------------------------------------

// What the parent renders its Call/Coming/Ask button from. Deliberately
// coarser than the internal `phase` union — "flying" vs "paused" is a
// roaming implementation detail the button must not care about.
export type ToucanSummonState = "roaming" | "approaching" | "attending";

// How far to the SIDE of the player's character centre the bird parks.
// Lateral on purpose: StatusLabel/TalkingBubble occupy the space directly
// above every avatar's head (see greetingAnchor), so parking overhead would
// sit the bird on top of the viewer's own nameplate. Note the canvas is
// already lifted ALTITUDE_PX in screen space, so a park point at the
// character's own centre-y reads as "hovering beside the head."
//
// Was 55px, which read as "across the desk" rather than "with you" — tuned
// down to 32px so the bird is plainly beside the character while still
// clearing the avatar body and the nameplate above it.
const PARK_LATERAL_PX = 32;
// Re-target deadband while approaching: the park point is recomputed from
// the player's live position every frame, but a fresh beginTravel() resets
// travelT to 0, so re-issuing one per frame would leave the bird
// permanently at the start of an ease and effectively frozen. Only a
// MEANINGFUL move (the player actually walking somewhere) re-aims it.
const RETARGET_DEADBAND_PX = 40;
// Close enough to latch `attending` and stop moving. Latching on a radius
// rather than only on travelT>=1 is what stops the bird endlessly
// converging on a target that keeps shifting by a few pixels.
//
// Was 24px, which was fine against the old 55px park offset but became the
// DOMINANT term once that dropped to 32 — measured live, the bird was
// latching up to 24px short and parking ~44px away instead of ~32. Tightened
// to 10px: the normal latch is travelT>=1 (which lands exactly on the park
// point), and this radius is only the early-out for a target that keeps
// shifting slightly, so a small value costs nothing.
const ARRIVE_RADIUS_PX = 10;
// Hysteresis while parked: small player movement is ignored completely (no
// chasing/jitter), but walking properly away re-enters `approaching` so the
// bird catches up. Must stay well above ARRIVE_RADIUS_PX or the two
// thresholds would oscillate.
const FOLLOW_BREAK_PX = 140;
// How much faster a SUMMONED approach flies than normal roaming. Applied
// only on the "approaching" path in beginTravel — SPEED_PX_PER_SEC itself is
// untouched, so roaming is bit-for-bit unchanged.
const SUMMON_SPEED_MULTIPLIER = 1.8;
// Roaming's MIN_TRAVEL_S (4s) exists to keep ambient hops languid; on a
// summon it would swallow the speed-up entirely for the short hops that are
// most common (the bird is usually already in the same room), so a summon
// gets its own, much shorter floor. MAX_TRAVEL_S still applies.
const SUMMON_MIN_TRAVEL_S = 0.9;
// Nose-up pitch applied ONLY while summoned, so the bird reads as
// approaching/hovering in front of its owner instead of presenting its full
// back to the overhead camera. Lives on its own group between the yaw/bank
// pivot and the one-time pose fix, so it never fights either.
// Was 0.55 rad (~32deg), which still read as "looking at the bird's back from
// above." 0.95 rad (~54deg) tips the chest and head clearly toward the
// overhead camera so a summoned toucan reads as hovering in front of its
// owner. Deliberately not 90deg — the silhouette has to stay a flying bird
// with a wing to each side.
const SUMMON_UPRIGHT_MAX_RAD = 0.95;
// Distance to the park point at which the upright blend starts easing in —
// the bird sets up as it closes the last stretch rather than flying the whole
// way tilted.
const SUMMON_UPRIGHT_BLEND_START_PX = 320;
// Blend rate (per second) for the upright pitch, both in and out. Roaming's
// target is 0, so releasing the bird eases it back to exactly the original
// flight orientation.
const SUMMON_UPRIGHT_LERP = 2.5;
// While parked, the bird faces the LATCHED user centre; the latch only moves
// when the user really moves, so tiny position noise can never make the bird
// swivel. Same value as the approach re-target deadband, same reasoning.
const ATTEND_FACE_DEADBAND_PX = RETARGET_DEADBAND_PX;

type ToucanFlyerProps = {
  // Live park anchor: the viewer's character CENTRE (not the park point —
  // the lateral offset and map-edge choice are owned here, next to the
  // FRAME_WIDTH the rest of this file already works in), or null when the
  // bird is not summoned. Read fresh inside the rAF loop.
  summonTargetRef?: RefObject<{ x: number; y: number } | null>;
  // Fired only on real transitions, never per frame. Held in a ref inside
  // the effect so a re-rendered parent callback can't stale-close.
  onSummonStateChange?: (state: ToucanSummonState) => void;
  // Shows the bird's world-space BIRD-TALK pill ("Squawk squawk…") while the
  // assistant is preparing a reply. Deliberately a BOOLEAN, not text: the
  // world-space bird is personality only and must never mirror the assistant's
  // real answer — that lives exclusively in ToucanAssistantPanel. The caller
  // owns how long it lingers after a reply lands (see OfficeMap's
  // toucanSquawk). Pure presentation — no AI-driven animation.
  thinking?: boolean;
};

// Park point for a given character centre: beside the avatar, on whichever
// side faces the middle of the map, clamped so the bird never parks off the
// frame edge. Exported for the unit tests.
export function parkPointFor(center: { x: number; y: number }): { x: number; y: number } {
  const towardInterior = center.x > FRAME_WIDTH / 2 ? -1 : 1;
  const x = Math.max(
    PARK_LATERAL_PX,
    Math.min(FRAME_WIDTH - PARK_LATERAL_PX, center.x + towardInterior * PARK_LATERAL_PX),
  );
  return { x, y: center.y };
}

// The whole summon state machine, as a pure function of (intent, phase,
// current position, current travel target). Kept out of the rAF closure so
// the thresholds above are unit-testable without a WebGL context or a
// simulated animation loop; updateSummon() below is a thin apply-the-verdict
// wrapper.
export type ToucanSummonDecision =
  // Nothing to do this frame.
  | { kind: "hold" }
  // Start (or restart) a summoned flight AND report the new state.
  | { kind: "approach"; target: { x: number; y: number } }
  // Re-aim an in-progress approach; state is already "approaching".
  | { kind: "retarget"; target: { x: number; y: number } }
  // Close enough — latch parked.
  | { kind: "attend" }
  // Summon withdrawn while approaching/attending — resume roaming.
  | { kind: "release" };

export function decideSummon(input: {
  // Viewer's character centre, or null when not summoned.
  center: { x: number; y: number } | null;
  phase: "flying" | "paused" | "approaching" | "attending";
  pos: { x: number; y: number };
  // Current travel target (only meaningful while approaching).
  to: { x: number; y: number };
}): ToucanSummonDecision {
  const { center, phase, pos, to } = input;

  if (!center) {
    return phase === "approaching" || phase === "attending" ? { kind: "release" } : { kind: "hold" };
  }

  const park = parkPointFor(center);
  const distToPark = Math.hypot(park.x - pos.x, park.y - pos.y);

  if (phase === "attending") {
    // Small movement is ignored entirely (no chasing); a real walk away
    // re-triggers the approach.
    return distToPark > FOLLOW_BREAK_PX ? { kind: "approach", target: park } : { kind: "hold" };
  }

  if (phase === "approaching") {
    if (distToPark <= ARRIVE_RADIUS_PX) return { kind: "attend" };
    // Deadband: only a meaningful shift in the park point re-aims the leg,
    // otherwise travelT would reset every frame and the bird would stall.
    return Math.hypot(park.x - to.x, park.y - to.y) > RETARGET_DEADBAND_PX
      ? { kind: "retarget", target: park }
      : { kind: "hold" };
  }

  // Summoned out of roaming — "flying" mid-leg and "paused"/perched behave
  // identically.
  return { kind: "approach", target: park };
}

// Travel duration for one leg. "roaming" is the ORIGINAL formula verbatim
// (including its +-15% jitter, passed in so this stays pure); "summon" swaps
// in the faster speed and the shorter floor, and takes no jitter at all — a
// click should respond the same way every time.
export function travelDurationFor(
  distancePx: number,
  mode: "roaming" | "summon",
  jitter = 1,
): number {
  if (mode === "summon") {
    const base = distancePx / (SPEED_PX_PER_SEC * SUMMON_SPEED_MULTIPLIER);
    return Math.min(MAX_TRAVEL_S, Math.max(SUMMON_MIN_TRAVEL_S, base));
  }
  const base = distancePx / SPEED_PX_PER_SEC;
  return Math.min(MAX_TRAVEL_S, Math.max(MIN_TRAVEL_S, base)) * jitter;
}

// Nose-up pitch the bird should be easing toward, in radians. Zero for both
// roaming phases — that is what guarantees normal flight is untouched — and
// eases in over the last SUMMON_UPRIGHT_BLEND_START_PX of an approach, held
// at full while parked.
export function uprightPitchTarget(
  phase: "flying" | "paused" | "approaching" | "attending",
  distanceToParkPx: number,
): number {
  if (phase === "attending") return SUMMON_UPRIGHT_MAX_RAD;
  if (phase !== "approaching") return 0;
  const closeness = 1 - Math.min(1, Math.max(0, distanceToParkPx) / SUMMON_UPRIGHT_BLEND_START_PX);
  return SUMMON_UPRIGHT_MAX_RAD * closeness;
}

// The point a parked bird faces. Latches on arrival and only moves once the
// user has genuinely walked, so small position noise never swivels the bird.
export function attendFacePointFor(
  current: { x: number; y: number } | null,
  center: { x: number; y: number },
): { x: number; y: number } {
  if (!current) return center;
  return Math.hypot(center.x - current.x, center.y - current.y) > ATTEND_FACE_DEADBAND_PX
    ? center
    : current;
}

// Yaw (radians) that points the bird's head at `to`. The +PI is not
// decoration: the pose fix maps the head to local -Z, and a plain Y-rotation
// by theta sends local -Z to world (-sin theta, -cos theta) in this
// (map-x, map-y-as-depth) convention — so theta must be atan2(dx, dy) + PI
// for the head to point toward the target rather than away from it. Omitting
// it is exactly the "faces one way, flies backwards" bug.
export function yawToward(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.atan2(to.x - from.x, to.y - from.y) + Math.PI;
}

// Only a clip whose NAME actually suggests flight/flapping counts as
// "usable" — "Running"/"Walking" (this GLB's real clips) are bipedal
// locomotion and must NOT be force-played as a flying animation.
const FLIGHT_CLIP_RE = /fly|flap|wing|glide|soar/i;

export function ToucanFlyer({ summonTargetRef, onSummonStateChange, thinking = false }: ToucanFlyerProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest callback, re-pointed on every render so the []-dep effect below
  // can call it without depending on it (which would remount the bird).
  const onStateChangeRef = useRef(onSummonStateChange);
  onStateChangeRef.current = onSummonStateChange;
  // Same reasoning for the target ref itself — the ref OBJECT may be a
  // different one across renders even though its identity normally isn't.
  const targetRefRef = useRef(summonTargetRef);
  targetRefRef.current = summonTargetRef;

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let cancelled = false;
    let rafId = 0;
    let mixer: THREE.AnimationMixer | null = null;

    // Retina/high-DPI handling (capped at 2, same pattern CharacterCanvas's
    // shared renderer relies on elsewhere) PLUS a flat SUPERSAMPLE factor —
    // together these give the raster buffer a healthy multiple of the
    // small CSS display size, the same "render big, display small"
    // oversampling margin CharacterCanvas gets from its fixed 210x298
    // raster vs. a character's tiny percentage-based CSS box. This alone
    // does NOT fix blur (proven in the diagnosis) — it's paired with the
    // camera auto-framing below, which is what actually puts bird detail
    // into those raster pixels instead of empty margin.
    // CSS size is fixed (the bird's visible size on the map never changes);
    // only the BACKING BUFFER follows zoom — see toucanRenderPx above.
    canvas.style.width = `${RENDER_SIZE}px`;
    canvas.style.height = `${RENDER_SIZE}px`;
    let renderPx = toucanRenderPx(RENDER_SIZE, window.devicePixelRatio || 1);
    let framesSinceRenderScalePoll = TOUCAN_RENDER_SCALE_POLL_FRAMES; // poll on the first frame
    function updateRenderPx() {
      const el = canvasRef.current;
      if (!el) return;
      // Includes the map's CSS transform zoom, exactly as CharacterCanvas's
      // own measurement does.
      renderPx = toucanRenderPx(el.getBoundingClientRect().height, window.devicePixelRatio || 1);
    }

    const scene = new THREE.Scene();
    const ambient = new THREE.AmbientLight(0xfff2e6, 0.55);
    scene.add(ambient);
    const keyTop = new THREE.DirectionalLight(0xfff0dd, 0.5);
    keyTop.position.set(0, 6, 2);
    scene.add(keyTop);
    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(-2, 1, 3);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
    // Steep overhead viewing ANGLE only, at unit distance — "looking down
    // onto a flying bird," not a front-on portrait shot. The actual
    // distance is computed once the model's real bounding sphere is known
    // (see the `.then()` callback below) so the model fills
    // CAMERA_FILL_FRACTION of the frame regardless of its raw mesh scale,
    // instead of the previous fixed guess that left ~87% of the frame
    // empty. Rotation/bob only ever change below on `pivot`/`poseGroup`,
    // never the model's own scale, so one auto-fit at load time is enough
    // (unlike CharacterCanvas, which must re-fit every frame because
    // different animation poses change a HUMANOID's silhouette — this
    // static mesh's silhouette doesn't change shape, so a bounding SPHERE
    // fit stays valid at every yaw/bank angle).
    const cameraDir = new THREE.Vector3(0, 1.5, 0.65).normalize();

    const pivot = new THREE.Group();
    scene.add(pivot);
    // Static "flying posture" fix, computed once after load (see the basis
    // construction below) — tips the rig from its authored standing/upright
    // bind pose onto its belly, spine horizontal, so what we see from the
    // overhead camera is the toucan's back/top with wings out to the
    // sides, not its front. `pivot` carries the PER-FRAME yaw/bank; this
    // inner group carries the ONE-TIME orientation correction, so the two
    // never fight each other.
    // Summon-only nose-up pitch. Sits BETWEEN pivot (per-frame yaw/bank) and
    // poseGroup (the one-time orientation fix) so the pitch is applied in the
    // already-yawed frame — i.e. a real "nose up relative to heading", not a
    // world-axis tilt — and so neither of the other two transforms is
    // touched. Stays at identity for the whole of normal roaming.
    const uprightGroup = new THREE.Group();
    pivot.add(uprightGroup);
    const poseGroup = new THREE.Group();
    uprightGroup.add(poseGroup);

    // Flight state — plain mutable refs, no React state, so nothing here
    // triggers a component re-render (see file header). Starts perched at
    // home (the statue) already "paused" — see the INITIAL_PERCH_MS timer
    // set below, right after this block, instead of taking off immediately.
    let currentIdx = HOME_WAYPOINT_INDEX;
    let from = WAYPOINTS[HOME_WAYPOINT_INDEX];
    let to = WAYPOINTS[HOME_WAYPOINT_INDEX];
    let pos = { x: WAYPOINTS[HOME_WAYPOINT_INDEX].x, y: WAYPOINTS[HOME_WAYPOINT_INDEX].y };
    // "flying"/"paused" are the original roaming states and behave exactly as
    // before. "approaching" is a summoned flight (identical motion, different
    // target + no arriveAndDecide on arrival) and "attending" is parked beside
    // the player while the assistant panel is up.
    let phase: "flying" | "paused" | "approaching" | "attending" = "paused";
    let pauseUntil = 0;
    let travelT = 1;
    let travelDuration = 1;
    let yaw = 0;
    let bank = 0;
    let bobT = 0;
    // Current (blended) summon pitch, and the last known distance to the park
    // point that drives its target. Both are meaningless while roaming: the
    // target is 0 there, so uprightGroup stays at identity.
    let uprightPitch = 0;
    let distToPark = Infinity;
    // Latched point a parked bird faces (the user's centre, not the park
    // point). Null whenever not attending.
    let attendFacePoint: { x: number; y: number } | null = null;
    // Resolved to the real value (BOB_AMPLITUDE_TO_DISTANCE_RATIO * actual
    // camera distance) once the model loads and auto-framing runs — see
    // the `.then()` callback. Kept at 0 until then so no bob applies to an
    // as-yet-unloaded/unframed scene.
    let bobAmplitudeWorld = 0;
    let lastNow = performance.now();
    let leftWing: THREE.Object3D | null = null;
    let rightWing: THREE.Object3D | null = null;
    let leftWingBindQuat: THREE.Quaternion | null = null;
    let rightWingBindQuat: THREE.Quaternion | null = null;
    let usingClipForFlap = false;
    // Glide/flap-burst rhythm — a plain mutable object advanced by dt in the
    // rAF loop below (no timers, no listeners, no React state), created once
    // per mount inside this []-dep effect so rerenders can never reset it
    // and unmount discards it wholesale.
    const wingRhythm = createWingRhythm();
    // Scratch quaternion reused every frame for the stroke rotation, so the
    // flap never allocates inside the render loop.
    const flapQuat = new THREE.Quaternion();
    let webglBroken = false;

    // Shared travel setup for BOTH a roaming waypoint leg and a summoned
    // approach — same `from = current position` continuity (so a summon
    // issued mid-flight transitions smoothly instead of snapping), same
    // speed, same duration clamp, same randomization. Only the target point
    // and the resulting phase differ.
    function beginTravel(target: { x: number; y: number }, nextPhase: "flying" | "approaching") {
      from = { ...pos };
      to = target;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      travelDuration =
        nextPhase === "approaching"
          ? travelDurationFor(dist, "summon")
          : travelDurationFor(dist, "roaming", 0.85 + Math.random() * 0.3);
      travelT = 0;
      phase = nextPhase;
    }

    function startTravelTo(nextIdx: number) {
      currentIdx = nextIdx;
      beginTravel(WAYPOINTS[nextIdx], "flying");
    }

    // Coarse state reported to the parent, emitted on transitions only.
    let lastReportedState: ToucanSummonState = "roaming";
    function reportState(state: ToucanSummonState) {
      if (state === lastReportedState) return;
      lastReportedState = state;
      onStateChangeRef.current?.(state);
    }

    // Reads the live park anchor and drives every summon transition. Runs
    // once per frame BEFORE the movement advance below, so a state change
    // takes effect on the same frame it is decided.
    function updateSummon() {
      const center = targetRefRef.current?.current ?? null;
      // Kept fresh for the upright-pitch blend below (Infinity while roaming,
      // where the pitch target is 0 anyway).
      if (center) {
        const park = parkPointFor(center);
        distToPark = Math.hypot(park.x - pos.x, park.y - pos.y);
      } else {
        distToPark = Infinity;
      }
      const decision = decideSummon({ center, phase, pos, to });
      if (phase === "attending" && center) {
        // Deadbanded re-latch, so the parked bird only turns when the user
        // has actually walked.
        attendFacePoint = attendFacePointFor(attendFacePoint, center);
      }
      switch (decision.kind) {
        case "hold":
          return;
        case "approach":
          beginTravel(decision.target, "approaching");
          attendFacePoint = null;
          reportState("approaching");
          return;
        case "retarget":
          beginTravel(decision.target, "approaching");
          return;
        case "attend":
          // `pos` is deliberately NOT snapped onto the park point — snapping
          // is a visible jump, and being inside the arrival radius is by
          // definition close enough.
          phase = "attending";
          if (center) attendFacePoint = center;
          reportState("attending");
          return;
        case "release":
          // Resume roaming through the EXISTING waypoint logic; no dedicated
          // "returning" state and no special return-home animation. The
          // upright pitch eases back to 0 on its own (see the blend below),
          // restoring the original flight orientation exactly.
          startTravelTo(pickNextIndex(currentIdx, WAYPOINTS.length));
          attendFacePoint = null;
          reportState("roaming");
          return;
      }
    }

    function arriveAndDecide() {
      pos = { ...to };
      if (Math.random() < PAUSE_CHANCE) {
        phase = "paused";
        pauseUntil = performance.now() + PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS);
      } else {
        startTravelTo(pickNextIndex(currentIdx, WAYPOINTS.length));
      }
    }

    // "Perched on the statue → short idle pause → take off → begin
    // roaming" — phase is already "paused" at the home waypoint (see
    // above), so this just arms the existing pause->pickNextWaypoint path
    // (tick()'s `if (phase === "paused" && now >= pauseUntil)` branch) with
    // a short initial timer instead of a random 2-5s one, no separate
    // "perched" state needed.
    pauseUntil = performance.now() + INITIAL_PERCH_MS;

    loadGlbCached(TOUCAN_GLB_URL)
      .then((gltf) => {
        if (cancelled) return;
        const model = cloneSkeleton(gltf.scene) as THREE.Object3D;
        model.updateMatrixWorld(true);

        const box = boneWorldBox(model);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        // Bounding-SPHERE radius (box diagonal / 2 — THREE.Box3's own
        // getBoundingSphere uses the identical formula) rather than a
        // per-axis size: rotation-invariant, so the camera fit computed
        // below stays correct at every yaw/bank angle without re-fitting
        // per frame. Normalize the model to exactly radius=1 so the camera
        // distance formula (below) is a clean, readable unit-sphere fit
        // instead of baking the model's raw mesh units into it.
        const radius = Math.max(size.length() / 2, 1e-6);
        const scale = 1 / radius;

        // Recenter the model on its own bone-derived centroid, then scale
        // poseGroup (not the model) so rotation/bob below always happens
        // around the toucan's own center, not an arbitrary rig-root offset.
        model.position.sub(center);
        poseGroup.add(model);
        poseGroup.scale.setScalar(scale);

        // Camera auto-framing: place the camera along the fixed overhead
        // viewing angle (cameraDir) at the distance where the now-unit-
        // radius model's PADDED bounding sphere (FRAME_PADDING_FACTOR,
        // covering bone-vs-skin slop and full-amplitude wing flap) subtends
        // CAMERA_FILL_FRACTION of the vertical FOV — i.e. the RESTING model
        // fills ~90%/1.18 =~ 76% of the frame, leaving headroom so a fully
        // flapped wing (up to +0.55 rad from rest) still lands
        // inside frame instead of clipping. asin(paddedRadius/distance) =
        // half the target angle, solved for distance. Same "fit the camera
        // to the model's real extent" principle CharacterCanvas's own two-
        // pass camera-space bbox framing uses, simplified to one pass since
        // (see above) a bounding-sphere fit stays valid at every yaw/bank
        // angle without re-fitting per frame.
        const paddedRadius = FRAME_PADDING_FACTOR; // model itself is normalized to radius=1
        const halfFovRad = (camera.fov * Math.PI) / 180 / 2;
        const targetHalfAngle = CAMERA_FILL_FRACTION * halfFovRad;
        const distance = paddedRadius / Math.sin(targetHalfAngle);
        camera.position.copy(cameraDir).multiplyScalar(distance);
        camera.lookAt(0, 0, 0);
        bobAmplitudeWorld = BOB_AMPLITUDE_TO_DISTANCE_RATIO * distance;

        // Anisotropic filtering — the GLB's texture (mipmapped by default
        // at load) is viewed at a steep, ever-rotating angle (top-down
        // camera + continuous yaw/bank), which is exactly the case
        // minification aliasing/blur shows up in without it. Source
        // resolution is untouched; this only changes how it's SAMPLED.
        try {
          const maxAniso = getSharedRenderer().capabilities.getMaxAnisotropy();
          model.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
              const map = (mat as THREE.MeshStandardMaterial).map;
              if (map) map.anisotropy = maxAniso;
            }
          });
        } catch {
          // No real WebGL context (e.g. test/non-DOM env) — texture
          // sampling quality is irrelevant there since nothing renders.
        }

        // Flying-posture + forward-axis fix, derived from real bone world
        // positions where available (not hand-guessed constants) via two
        // reference vectors describing the model's OWN standing/forward
        // axes:
        //   spineDir  hips -> head, or STATIC_SPINE_DIR with no skeleton
        //   chestDir  head -> headfront/beak, or STATIC_CHEST_DIR
        // The authored model stands/rests upright (spineDir ~ its own "up")
        // facing some direction (chestDir). We want, after this one-time
        // correction: spineDir -> local -Z (head/beak becomes the
        // horizontal "front" of a flying body — this IS the per-frame
        // travel-facing axis, see targetYaw below) and chestDir -> local
        // -Y (the belly faces down toward the floor, so the BACK faces up
        // toward the overhead camera, per the "see the back/top"
        // requirement). Falls back to a straight vector alignment (spine
        // only) if no chest/front reference is available at all —
        // orientation is still correct front-to-back, just without the
        // guaranteed belly-down roll.
        const headBone = findBone(model, ["Head", "head", "neck"]);
        const frontBone = findBone(model, ["headfront"]);
        const hipsBone = findBone(model, ["Hips", "hips", "Spine"]);

        let spineDir: THREE.Vector3 | null = null;
        let chestDir: THREE.Vector3 | null = null;
        if (headBone && hipsBone) {
          const headPos = new THREE.Vector3();
          const hipsPos = new THREE.Vector3();
          headBone.getWorldPosition(headPos);
          hipsBone.getWorldPosition(hipsPos);
          spineDir = headPos.clone().sub(hipsPos).normalize();

          if (frontBone) {
            const frontPos = new THREE.Vector3();
            frontBone.getWorldPosition(frontPos);
            const raw = frontPos.sub(headPos);
            raw.addScaledVector(spineDir, -raw.dot(spineDir)); // strip spine-aligned component
            if (raw.lengthSq() > 1e-8) chestDir = raw.normalize();
          }
        } else {
          // No skeleton (current asset — see header comment) — use the
          // empirically-verified fixed axes for this specific mesh instead.
          spineDir = STATIC_SPINE_DIR.clone();
          chestDir = STATIC_CHEST_DIR.clone();
        }

        if (spineDir) {
          if (chestDir) {
            const srcZ = spineDir;
            const srcY = chestDir.clone().addScaledVector(srcZ, -chestDir.dot(srcZ)).normalize();
            const srcX = new THREE.Vector3().crossVectors(srcY, srcZ).normalize();
            const srcBasis = new THREE.Matrix4().makeBasis(srcX, srcY, srcZ);

            const tgtZ = new THREE.Vector3(0, 0, -1);
            const tgtY = new THREE.Vector3(0, -1, 0);
            const tgtX = new THREE.Vector3().crossVectors(tgtY, tgtZ).normalize();
            const tgtBasis = new THREE.Matrix4().makeBasis(tgtX, tgtY, tgtZ);

            const rot = tgtBasis.multiply(srcBasis.invert());
            poseGroup.quaternion.setFromRotationMatrix(rot);
          } else {
            poseGroup.quaternion.setFromUnitVectors(spineDir, new THREE.Vector3(0, 0, -1));
          }
        }

        const flightClip = gltf.animations.find((c) => FLIGHT_CLIP_RE.test(c.name));
        if (flightClip) {
          // A real flying/flapping clip exists — use it as-is, per spec.
          mixer = new THREE.AnimationMixer(model);
          mixer.clipAction(flightClip).play();
          usingClipForFlap = true;
        } else {
          // No usable flight clip ("Running"/"Walking" are bipedal
          // locomotion). Look for independently-controllable wing bones to
          // drive the procedural flap instead — the current rig DOES have
          // them (Meshy's biped auto-rig mapped this toucan's wings onto
          // humanoid LeftArm/RightArm), so both of these resolve. If a
          // future toucan GLB drops the rig, they resolve to null and the
          // flap block below simply never runs; if it ships a real flight
          // clip, the branch above takes over. Either way, zero code
          // changes here.
          leftWing = findBone(model, ["LeftArm", "LeftUpperArm", "LeftShoulder"]);
          rightWing = findBone(model, ["RightArm", "RightUpperArm", "RightShoulder"]);
          leftWingBindQuat = leftWing?.quaternion.clone() ?? null;
          rightWingBindQuat = rightWing?.quaternion.clone() ?? null;
        }
      })
      .catch(() => {
        // No visible fallback needed — a missing/failed GLB just means no
        // toucan renders; every other office feature is unaffected.
      });

    function tick(now: number) {
      // Re-read from the refs (rather than closing over the outer
      // container/canvas consts) — same convention CharacterCanvas.tsx's
      // own tick loop uses for its canvasRef, so TS can narrow them fresh
      // inside this nested closure instead of relying on the outer guard's
      // narrowing to persist across the closure boundary.
      const canvasEl = canvasRef.current;
      const containerEl = containerRef.current;
      if (!canvasEl || !containerEl) return;

      const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
      lastNow = now;

      if (mixer) mixer.update(dt);

      // Summon intent first, so an entered/left approach is reflected in the
      // same frame's movement and orientation below.
      updateSummon();

      if (phase === "paused") {
        if (now >= pauseUntil) startTravelTo(pickNextIndex(currentIdx, WAYPOINTS.length));
      } else if (phase === "attending") {
        // Parked beside the player — hold position. Re-approach is decided
        // by updateSummon()'s FOLLOW_BREAK_PX hysteresis, never here.
      } else {
        travelT = Math.min(1, travelT + dt / travelDuration);
        const eased = easeInOutCubic(travelT);
        pos = { x: lerp(from.x, to.x, eased), y: lerp(from.y, to.y, eased) };
        if (travelT >= 1) {
          if (phase === "approaching") {
            // A summoned leg must NOT run arriveAndDecide() (that would pause
            // or pick a new roaming waypoint) — it parks instead.
            pos = { ...to };
            phase = "attending";
            reportState("attending");
          } else {
            arriveAndDecide();
          }
        }
      }

      // Summoned flight reuses the approved roaming flight motion verbatim —
      // only the phase test widens.
      if (phase === "flying" || phase === "approaching") {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        if (dx !== 0 || dy !== 0) {
          // Same heading math as always (see yawToward's own note on the +PI).
          const targetYaw = yawToward(from, to);
          const prevYaw = yaw;
          yaw = lerpAngle(yaw, targetYaw, Math.min(1, TURN_SPEED * dt));
          const angularVel = yaw - prevYaw; // signed delta this frame (already shortest-path)
          const targetBank = Math.max(-MAX_BANK, Math.min(MAX_BANK, (angularVel / Math.max(dt, 0.001)) * 0.12));
          bank = lerp(bank, targetBank, Math.min(1, 4 * dt));
        }
      } else {
        // Parked: turn to face the user (latched point, so no swivelling on
        // position noise) using the same heading math and the same turn rate
        // the flight legs use. Roaming's "paused" keeps its original
        // behaviour — attendFacePoint is only ever set while attending.
        if (phase === "attending" && attendFacePoint) {
          const facingDist = Math.hypot(attendFacePoint.x - pos.x, attendFacePoint.y - pos.y);
          // Degenerate vector guard: atan2(0,0) would swing the bird a full
          // half-turn for no reason.
          if (facingDist > 1) {
            yaw = lerpAngle(yaw, yawToward(pos, attendFacePoint), Math.min(1, TURN_SPEED * dt));
          }
        }
        bank = lerp(bank, 0, Math.min(1, 3 * dt));
      }

      // Summon-only upright posture. Target is 0 for both roaming phases, so
      // this line is a no-op (identity) for every frame of normal flight, and
      // eases the bird back to exactly that on release.
      uprightPitch = lerp(
        uprightPitch,
        uprightPitchTarget(phase, distToPark),
        Math.min(1, SUMMON_UPRIGHT_LERP * dt),
      );
      uprightGroup.rotation.x = uprightPitch;

      bobT += dt * BOB_FREQUENCY;
      pivot.rotation.y = yaw;
      pivot.rotation.z = bank;
      pivot.position.y = Math.sin(bobT) * bobAmplitudeWorld;

      // Procedural wing flap — skipped entirely when a real flight clip is
      // driving the mixer instead (usingClipForFlap). The rhythm module
      // decides WHEN (glide hold vs. a whole number of wingbeats) and HOW
      // FAR; this just stamps the one shared stroke angle onto both wing
      // bones. Same sign on both sides is deliberate — see toucanWingRhythm's
      // invariant 1: these bones' bind quaternions are already mirrored, so
      // an identical local rotation yields mirrored (i.e. synchronized)
      // world motion, while negating one side is what used to make the wings
      // look like they were alternating left/right.
      if (!usingClipForFlap && (leftWing || rightWing)) {
        advanceWingRhythm(wingRhythm, dt, phase === "flying" || phase === "approaching");
        const strokeAngle = wingStrokeAngle(wingRhythm);
        flapQuat.setFromAxisAngle(FLAP_AXIS, strokeAngle);
        if (leftWing && leftWingBindQuat) {
          leftWing.quaternion.copy(leftWingBindQuat).multiply(flapQuat);
        }
        if (rightWing && rightWingBindQuat) {
          rightWing.quaternion.copy(rightWingBindQuat).multiply(flapQuat);
        }
      }

      if (++framesSinceRenderScalePoll >= TOUCAN_RENDER_SCALE_POLL_FRAMES) {
        framesSinceRenderScalePoll = 0;
        updateRenderPx();
      }

      if (!webglBroken) {
        try {
          renderToCanvas(scene, camera, canvasEl, renderPx, renderPx);
        } catch {
          // No real WebGL available (e.g. headless test environment) — stop
          // trying every frame; position/flight math above still runs
          // harmlessly, it just never gets rendered.
          webglBroken = true;
        }
      }

      containerEl.style.left = `${(pos.x / FRAME_WIDTH) * 100}%`;
      containerEl.style.top = `${(pos.y / FRAME_HEIGHT) * 100}%`;

      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      mixer?.stopAllAction();
      pivot.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        }
      });
    };
  }, []);

  // NOTE: the container's left/top are mutated directly by tick() above.
  // The inline style below is a constant object, so React's per-key style
  // diff never writes either property again after mount and a re-render
  // (e.g. `thinking` toggling) cannot reset the bird's position.
  return (
    <div ref={containerRef} className={styles.toucan} style={{ top: 0, left: 0 }}>
      <canvas
        ref={canvasRef}
        width={RENDER_SIZE}
        height={RENDER_SIZE}
        style={{ transform: `translate(-50%, calc(-50% - ${ALTITUDE_PX}px))` }}
      />
      {thinking && (
        // Reuses TalkingBubble's existing text pill verbatim (styles only — no
        // chat state), anchored just above the bird's own lifted canvas rather
        // than above a character layer. Bird talk only, by construction: the
        // string is a module constant, so no response text can reach here.
        <div
          className={bubbleStyles.anchor}
          style={{ transform: `translateY(calc(-50% - ${ALTITUDE_PX + RENDER_SIZE / 2}px))` }}
        >
          <div
            className={bubbleStyles.bubbleText}
            // The shared pill class wraps (it is sized for real chat text);
            // bird talk is two short words and reads better on one line.
            style={{ whiteSpace: "nowrap" }}
            data-testid="toucan-bird-talk"
          >
            {BIRD_TALK}
          </div>
        </div>
      )}
    </div>
  );
}
