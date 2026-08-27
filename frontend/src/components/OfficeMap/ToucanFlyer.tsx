import { useEffect, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { FRAME_HEIGHT, FRAME_WIDTH } from "../../data/office-layout";
import { loadGlbCached } from "../../render3d/glbCache";
import { getSharedRenderer, renderToCanvas } from "../../render3d/SharedRenderer";
import styles from "./ToucanFlyer.module.css";

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
// How much of the camera's vertical frame the model's bounding sphere
// should fill (angular diameter / full vertical FOV) — the auto-framing
// target, same 85-95% range CharacterCanvas's own frameMargin constants aim
// for (see its CONFIG.camera doc comment).
const CAMERA_FILL_FRACTION = 0.9;
// Padding multiplier on the bone-derived bounding radius, mirroring
// CharacterCanvas's own bone-position padding (its computeFramingBox pads
// by 12% since skin surface extends past bone joint centers). This rig
// ALSO flaps its wing bones up to +-FLAP_MAX_AMPLITUDE away from the rest
// pose the bounding box below is measured at, so the pad needs to cover
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

// Procedural wing flap (see GLB inspection note above the component): the
// supplied rig has no flying/flapping clip, but IS a real skinned biped
// skeleton whose LeftArm/RightArm bones stand in for the wings (Meshy's
// auto-rig maps any character's limbs onto a generic biped template). Each
// frame, a small oscillating rotation is composed onto the bone's ORIGINAL
// bind-pose quaternion (never accumulated), so it always oscillates around
// the authored rest pose instead of drifting.
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
const FLAP_FREQUENCY = 9; // radians/sec — a brisk small-bird wingbeat
const FLAP_MAX_AMPLITUDE = 0.55; // radians (~31deg) swing off rest pose

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

// Only a clip whose NAME actually suggests flight/flapping counts as
// "usable" — "Running"/"Walking" (this GLB's real clips) are bipedal
// locomotion and must NOT be force-played as a flying animation.
const FLIGHT_CLIP_RE = /fly|flap|wing|glide|soar/i;

export function ToucanFlyer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderPx = Math.round(RENDER_SIZE * dpr * SUPERSAMPLE);
    canvas.style.width = `${RENDER_SIZE}px`;
    canvas.style.height = `${RENDER_SIZE}px`;

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
    const poseGroup = new THREE.Group();
    pivot.add(poseGroup);

    // Flight state — plain mutable refs, no React state, so nothing here
    // triggers a component re-render (see file header). Starts perched at
    // home (the statue) already "paused" — see the INITIAL_PERCH_MS timer
    // set below, right after this block, instead of taking off immediately.
    let currentIdx = HOME_WAYPOINT_INDEX;
    let from = WAYPOINTS[HOME_WAYPOINT_INDEX];
    let to = WAYPOINTS[HOME_WAYPOINT_INDEX];
    let pos = { x: WAYPOINTS[HOME_WAYPOINT_INDEX].x, y: WAYPOINTS[HOME_WAYPOINT_INDEX].y };
    let phase: "flying" | "paused" = "paused";
    let pauseUntil = 0;
    let travelT = 1;
    let travelDuration = 1;
    let yaw = 0;
    let bank = 0;
    let bobT = 0;
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
    let flapT = 0;
    let flapAmplitude = 0;
    let webglBroken = false;

    function startTravelTo(nextIdx: number) {
      from = { ...pos };
      to = WAYPOINTS[nextIdx];
      currentIdx = nextIdx;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const base = dist / SPEED_PX_PER_SEC;
      travelDuration = Math.min(MAX_TRAVEL_S, Math.max(MIN_TRAVEL_S, base)) * (0.85 + Math.random() * 0.3);
      travelT = 0;
      phase = "flying";
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
        // flapped wing (up to +-FLAP_MAX_AMPLITUDE from rest) still lands
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
          // No usable flight clip. Look for independently-controllable
          // wing bones (the earlier placeholder rig had these — Meshy's
          // biped auto-rig mapped its wings onto humanoid Arm bones) to
          // drive a lightweight procedural flap. The CURRENT asset (see
          // header comment) has no skeleton at all — rigging failed twice,
          // a hard Meshy API limitation for this body shape, not a bug
          // here — so these both resolve to null and the flap block below
          // (`if (!usingClipForFlap && (leftWing || rightWing))`) simply
          // never runs. Per spec: skip the animation rather than fake/
          // deform the static mesh. If a future toucan GLB DOES ship a
          // rig with these bone names, flapping will "just work" again
          // with zero code changes.
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

      if (phase === "paused") {
        if (now >= pauseUntil) startTravelTo(pickNextIndex(currentIdx, WAYPOINTS.length));
      } else {
        travelT = Math.min(1, travelT + dt / travelDuration);
        const eased = easeInOutCubic(travelT);
        pos = { x: lerp(from.x, to.x, eased), y: lerp(from.y, to.y, eased) };
        if (travelT >= 1) arriveAndDecide();
      }

      if (phase === "flying") {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        if (dx !== 0 || dy !== 0) {
          // +PI: the pose fix above maps the head to local -Z, and a plain
          // Y-rotation by theta sends local -Z to world (-sin theta, -cos
          // theta) in this (map-x, map-y-as-depth) convention — so theta
          // must be atan2(dx, dy) + PI for local -Z (the head) to actually
          // point toward (dx, dy), not away from it. Omitting this offset
          // is exactly the "faces one way, flies backwards" bug.
          const targetYaw = Math.atan2(dx, dy) + Math.PI;
          const prevYaw = yaw;
          yaw = lerpAngle(yaw, targetYaw, Math.min(1, TURN_SPEED * dt));
          const angularVel = yaw - prevYaw; // signed delta this frame (already shortest-path)
          const targetBank = Math.max(-MAX_BANK, Math.min(MAX_BANK, (angularVel / Math.max(dt, 0.001)) * 0.12));
          bank = lerp(bank, targetBank, Math.min(1, 4 * dt));
        }
      } else {
        bank = lerp(bank, 0, Math.min(1, 3 * dt));
      }

      bobT += dt * BOB_FREQUENCY;
      pivot.rotation.y = yaw;
      pivot.rotation.z = bank;
      pivot.position.y = Math.sin(bobT) * bobAmplitudeWorld;

      // Procedural wing flap — skipped entirely when a real flight clip is
      // driving the mixer instead (usingClipForFlap). Amplitude eases
      // toward full while flying and toward 0 while paused/perched, so the
      // flap visibly slows and settles rather than snapping off.
      if (!usingClipForFlap && (leftWing || rightWing)) {
        const targetAmplitude = phase === "flying" ? FLAP_MAX_AMPLITUDE : 0;
        flapAmplitude = lerp(flapAmplitude, targetAmplitude, Math.min(1, 4 * dt));
        flapT += dt * FLAP_FREQUENCY;
        const flapAngle = Math.sin(flapT) * flapAmplitude;
        if (leftWing && leftWingBindQuat) {
          leftWing.quaternion
            .copy(leftWingBindQuat)
            .multiply(new THREE.Quaternion().setFromAxisAngle(FLAP_AXIS, flapAngle));
        }
        if (rightWing && rightWingBindQuat) {
          rightWing.quaternion
            .copy(rightWingBindQuat)
            .multiply(new THREE.Quaternion().setFromAxisAngle(FLAP_AXIS, -flapAngle));
        }
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

  return (
    <div ref={containerRef} className={styles.toucan} style={{ top: 0, left: 0 }}>
      <canvas
        ref={canvasRef}
        width={RENDER_SIZE}
        height={RENDER_SIZE}
        style={{ transform: `translate(-50%, calc(-50% - ${ALTITUDE_PX}px))` }}
      />
    </div>
  );
}
