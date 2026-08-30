import { useEffect, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { WalkDirection } from "../data/bonWalkFrames";
import { loadGlbCached } from "./glbCache";
import { getMaxAnisotropy, getSharedCanvasElement, renderToCanvas } from "./SharedRenderer";
import { MAX_RENDER_SCALE, resolveRenderScale, scaledRenderSize } from "./renderScale";
import { canonicalTop } from "./characterSize";
import { stepAngleTowardsDegrees } from "./angleMath";
import { resolveCharacterAnimState, type CharacterAnimState } from "./characterAnimationState";

// ---------------------------------------------------------------------------
// Live-3D character renderer.
//
// Camera (orthographic, ~35deg elevation, azimuth 0 = front, two-pass
// camera-space bbox auto-framing) is ported as-is from the locked
// calibration pass (scripts/avatar-pipeline/threejs-calibration/
// calibration.html) and confirmed correct — do not re-derive it here.
//
// elevationDeg was lowered from the calibration pass's original 55 to 35
// after a live-3D-specific complaint ("mostly head") that the 2D
// calibration's 50-60deg "high-overhead chibi" convention reads as
// legible full-body chibi in a static illustration but, at this render's
// close-up character scale, makes the head dominate the frame and
// crops/foreshortens the torso+legs. Verified empirically (screenshot +
// pixel-measured silhouette at 55/45/35/30/25/20deg): 35deg is the
// highest elevation that keeps head/torso/arms/legs/feet all clearly
// legible while still reading as a distinctly overhead ("chibi") angle,
// not a flat/eye-level shot. (The temp diagnostic harness used for the
// sweep was a throwaway script, deleted after use — not kept in the repo.)
// The auto-framing math below is untouched — this was purely an
// elevationDeg value change, not a framing/target-point bug.
//
// Material (quality pass 2026-08-29): Meshy's rigged GLBs arrive with a
// metallic=1/roughness=1 MeshPhysicalMaterial (KHR_materials_specular/ior)
// whose base-color texture is ALSO bound as the emissiveMap. The earlier
// calibration drove brightness with emissiveIntensity 0.7 + three scene
// lights on top; the lit term of that metal material is a view-dependent
// specular sheen that shimmered along UV seams and over-brightened light
// skin. The baked atlas already IS the finished toy look (Meshy bakes its
// lighting into the base color), so every character is now drawn with ONE
// unlit MeshBasicMaterial sampling the base-color map once — no lights, no
// emissive duplicate, no metallic/specular term, identical treatment for
// every character (see toUnlitToyMaterial). Colour space is untouched:
// GLTFLoader tags the map SRGB and SharedRenderer outputs SRGB.
//
// Texture filtering: mipmaps + trilinear + anisotropy are ON. They used to
// be disabled because mip generation blended the atlas's black inter-chart
// gaps into the charts ("scratches"); the LOD build now pads those gaps
// (scripts/avatar-pipeline/atlas-dilate.mjs), so filtering is safe and
// removes the minification sparkle the no-mipmap path produced.
//
// Render size: the offscreen render is DPR-aware (renderScale.ts) — the
// base renderWidth/renderHeight stay the calibration reference, and the
// actual device-pixel size is that base × a zoom/DPR bucket (cap DPR 2),
// re-evaluated only every RENDER_SCALE_POLL_FRAMES frames.
//
// Phase A: replaced the earlier "up to 4 independently-loaded GLBs,
// hard-swap visibility" architecture with a single consolidated GLB (one
// mesh/skeleton, all 6 animation-state clips baked in — see
// live3dCharacters.ts/build-character-lods.mjs) driving ONE
// THREE.AnimationMixer. Which clip plays is resolved every render via the
// pure resolveCharacterAnimState() (characterAnimationState.ts) from this
// component's isWalking/isSitting/isGlobalChatActive/isSpatialConversation/
// isTyping props, and
// transitions crossfade (THREE's clipAction.crossFadeTo) over ~0.3s rather
// than snapping. Model rotation is now a continuous per-frame turn (see
// angleMath.ts's stepAngleTowardsDegrees) toward headingDegrees, replacing
// the old instant 4-direction snap.
// ---------------------------------------------------------------------------

const CONFIG = {
  camera: {
    elevationDeg: 35,
    azimuthDeg: 0,
    distance: 5,
    // Re-tuned via pixel-alpha-scan measurement (Phase A live-verify,
    // 2026-08-20). Skip past a couple of wrong turns recorded in git
    // history (an unrelated "~88% frame fill" figure borrowed from the
    // 2D sprite pipeline, then a "190px" target sourced from a stale code
    // comment) — a direct human side-by-side comparison against other
    // characters in the live app is what actually settled this, not any
    // documented number. Final target: as LARGE as possible while still
    // keeping every one of the 6 animation clips fully inside frame (no
    // clipping on any edge) — measured pixel bbox height/width across all
    // 6 states (idle, walking, sit-on-chair-arms, sitting-answering,
    // agree-gesture, listening-gesture) at the real 210x298 render size,
    // this is the tightest margin with zero edge-touching on the tallest
    // clip (`walking`, ~254px). Standing/gesture poses land ~245-254px;
    // `sit-on-chair-arms` is genuinely shorter (~185px) since sitting is a
    // physically shorter silhouette than standing — that's correct, not
    // an inconsistency to fix. frameMarginX has slack to spare (widest
    // measured clip uses well under half the available width) so it isn't
    // independently load-bearing here. Re-measure ALL 6 clips (not just
    // idle, not just walking) via scripts/avatar-pipeline/
    // threejs-calibration if the model is regenerated again — see git
    // history for the measurement harness — and sanity-check against
    // other characters in the live app, not just an internal target.
    frameMarginY: 1.09,
    frameMarginX: 1.115,
  },
};

// How often (in rendered frames) the on-screen size is re-measured to pick
// the render-scale bucket. getBoundingClientRect is a layout read; once a
// quarter-second at 60fps is plenty for zoom changes and costs nothing.
const RENDER_SCALE_POLL_FRAMES = 15;

// `THREE.Box3().setFromObject()` on a SkinnedMesh reads the geometry's
// raw (bind-pose-local, pre-skin) vertex attribute positions transformed
// only by the mesh node's own (near-identity) matrixWorld — it does NOT
// apply the per-vertex skin/bone matrix palette used at render time. For
// this rig, that raw attribute data is a tiny (~centimeter-scale) blob
// near the origin, while the actual world-space pose comes entirely from
// the skeleton's bone transforms. Framing the camera off that raw mesh
// box therefore zooms in on a near-single-point patch of geometry
// instead of the whole character. Frame off the skeleton's bone world
// positions instead — a much cheaper and, for this asset, more accurate
// proxy for the character's actual on-screen extent. Falls back to the
// standard mesh bbox for any (non-skinned) model with no bones.
export function computeFramingBox(root: THREE.Object3D): THREE.Box3 {
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
  if (!hasBones) {
    box.setFromObject(root);
    return box;
  }
  // Bone positions sit at joint centers, inside the actual skin surface
  // (head/hands/feet/chest extend past their nearest bone), so pad the
  // bone-derived box out a bit before the caller's own frameMargin is
  // applied on top.
  const size = new THREE.Vector3();
  box.getSize(size);
  box.expandByVector(size.multiplyScalar(0.12));
  return box;
}

// Swaps every mesh's Meshy PBR material for the shared unlit toy
// material (memoised per source material, see toUnlitToyMaterial).
function setupModelMaterials(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material) {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => toUnlitToyMaterial(m))
        : toUnlitToyMaterial(mesh.material);
    }
  });
}

// Heading-independent framing bounds (2026-08-30). computeFramingBox reads
// bone WORLD positions, which include the model's own rotation.y (the
// character's heading). Under the 35deg-elevated orthographic camera a
// Y-rotation swings the rig's wide X arm-span round into Z, and Z projects
// into camera-space Y — so the solved `top` (i.e. the zoom) moved with
// heading: measured 103.675 facing front/back vs 129.843 facing left/right,
// a 25.2% apparent-size swing for bon, 20.2% for micah, 13.9% for alex.
// Framing is solved ONCE at mount, so a canvas that mounted while its
// character faced sideways came back visibly smaller than the same
// character mounted facing front — and any re-mount mid-walk (LOD/tier
// swap, onError recovery, re-entering the crowd budget as depth-sort order
// changes while walking between tiles) made the character jump size.
// Solve the zoom from bounds measured with the heading rotation removed;
// the value is identical to today's front-facing calibration, so nothing
// about the tuned framing changes — it just stops drifting with heading.
// Centering still uses the live world box (below) so the character stays
// centred at every heading.
// The character's STANDING extent, measured with the heading rotation removed.
// Used by the canonical size policy; never for centering.
//
// MUST NOT be computed as `geometry.boundingBox.applyMatrix4(mesh.matrixWorld)`.
// Meshy exports every rig under an `Armature` node with scale 0.01, and the
// glTF's skinned POSITION data is already stored at final world scale, so the
// mesh's matrixWorld carries that 0.01 as well: multiplying the two applies
// the armature scale a SECOND time and yields a box 100x too small
// (1.70 -> 0.0170). Feeding that to the canonical zoom solve shrank the
// orthographic `top` ~100x and rendered every character as a giant cropped
// close-up. Box3.setFromObject resolves the same bounds without the double
// scale — verified against the real bon-v3-hq / alex-v2-hq GLBs, which both
// report 1.70.
export function computeStandingBox(root: THREE.Object3D): THREE.Box3 {
  const savedY = root.rotation.y;
  root.rotation.y = 0;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  root.rotation.y = savedY;
  root.updateMatrixWorld(true);
  return box;
}

export function computeStableFramingBox(root: THREE.Object3D): THREE.Box3 {
  const savedY = root.rotation.y;
  root.rotation.y = 0;
  root.updateMatrixWorld(true);
  const box = computeFramingBox(root);
  root.rotation.y = savedY;
  root.updateMatrixWorld(true);
  return box;
}

// One unlit material per SOURCE material. The cached GLTF's materials are
// shared by every SkeletonUtils.clone() of that GLB (three's Mesh.copy shares
// material by reference), so the conversion is memoised per source so all
// instances of a character keep sharing one material — same ownership rule
// as before (never disposed by an instance; see cleanup below).
const unlitMaterialCache = new WeakMap<THREE.Material, THREE.MeshBasicMaterial>();

export function toUnlitToyMaterial(source: THREE.Material): THREE.MeshBasicMaterial {
  const cached = unlitMaterialCache.get(source);
  if (cached) return cached;
  const src = source as THREE.MeshStandardMaterial;
  const map = src.map ?? null;
  if (map) {
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.anisotropy = getMaxAnisotropy();
    map.needsUpdate = true;
  }
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    side: src.side,
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    depthWrite: src.depthWrite,
  });
  mat.name = `${src.name || "material"} (unlit toy)`;
  unlitMaterialCache.set(source, mat);
  return mat;
}

// Continuous turn rate for the smooth-rotation state machine (Phase A.3) —
// reaches a typical 90deg direction change in 125ms and a full 180deg
// about-face in 250ms, comfortably inside the "a few hundred ms" target.
const TURN_RATE_DEG_PER_SEC = 720;

// Crossfade duration (seconds) used for every animation-state transition —
// picked from the 0.2-0.3s spec range; no single transition in the current
// 6-state set warrants a different value.
const CROSSFADE_SECONDS = 0.3;

// Maps the app's existing 4-direction sprite convention (see
// useCharacterWalk.ts's WalkDirection: y grows downward -> +dy = "front" =
// facing viewer) onto a model heading in degrees — this is the STEP
// TARGET fed into the continuous per-frame turn above, not an instant
// snap. azimuthDeg: 0 in CONFIG means the camera looks at the model's front
// face when rotation.y = 0, so "front" maps to 0 here. Left/right sign was
// picked to match screen-space left/right as seen by the camera and
// confirmed against the running app (see OfficeStage dev-toggle
// integration) — flip the two if a future model turns out mirrored.
export function directionToHeadingDegrees(direction: WalkDirection): number {
  switch (direction) {
    case "front":
      return 0;
    case "back":
      return 180;
    case "left":
      return -90;
    case "right":
      return 90;
  }
}

type Props = {
  // This character's office-manifest layer height, in frame units — the thing
  // that actually sets its CSS footprint on the map. Used ONLY by the
  // canonical size policy (characterSize.ts) so every employee ends up the
  // same visible standing height; it never affects resolution or LOD.
  layerHeight?: number;
  // Spatial-conversation quality override. When true this character is an
  // active, visible participant, so it renders at the maximum approved
  // internal resolution bucket (renderScale.ts's MAX_RENDER_SCALE) instead of
  // the zoom/DPR-derived one. This changes the offscreen BUFFER only — the
  // canvas keeps its CSS 100%/100% size, the camera is untouched and the
  // canonical model size is untouched, so the character looks identical in
  // size and simply resolves more detail. DPR stays capped at 2 inside
  // resolveRenderScale. Reverts to the adaptive bucket when the character
  // leaves the session.
  maxQuality?: boolean;
  // Horizontal painting capacity (see live3dCharacters.ts's widthCapacity).
  // Widens the offscreen buffer AND the canvas's painted area by the same
  // factor, so pixels stay square and the model is never stretched: the ortho
  // camera just sees more world sideways. The canvas is centred with a
  // negative margin so the character's horizontal centre, vertical anchor and
  // the wrapper's own hit area / label positioning are all unchanged.
  widthScale?: number;
  // The single consolidated GLB (mesh + skeleton + all 6 animation-state
  // clips) — see live3dCharacters.ts.
  glbUrl: string;
  // Target heading in degrees — CharacterCanvas turns toward this
  // continuously (see angleMath.ts's stepAngleTowardsDegrees), never snaps.
  headingDegrees?: number;
  // Sprite-path's existing walk-gate.
  // Inputs to resolveCharacterAnimState() — see characterAnimationState.ts
  // for each flag's exact meaning and the locked priority order.
  isWalking?: boolean;
  isSitting?: boolean;
  // Visible, non-minimized remote DM/group window open via Global Chat
  // (self: local remoteChatWindows OR server snapshot; peers: server
  // `global_chat_activity`). Only matters while seated.
  isGlobalChatActive?: boolean;
  // Member of the active spatial conversation (server `spatial_sessions`,
  // surfaced as OfficeStage's talkingCharacterIds).
  isSpatialConversation?: boolean;
  // Real keystroke typing in the spatial chat (OfficeStage's
  // typingCharacterIds). Never sent-message history.
  isTyping?: boolean;
  width: number;
  height: number;
  // Fires (at most once per mount) when this character's live-3D model
  // could not be shown — a GLB fetch/parse failure or the shared WebGL
  // context being lost mid-session. The caller is expected to fall back to
  // the normal 2D sprite <img> for this character on this signal;
  // CharacterCanvas itself never renders a fallback (it doesn't know about
  // sprite src), it only reports the failure upward. No-ops after the
  // first call per mount.
  onError?: () => void;
  // Default true (every existing caller/test that doesn't pass this keeps
  // today's fully-animated behavior unchanged). false = "static frame"
  // mode for a confirmed-too-weak-but-has-WebGL device (software renderer,
  // or a weak-static device that failed/never ran its microbench rescue —
  // see OfficeStage.tsx and deviceTier.ts's D-D bucket): the GLB still
  // loads and renders exactly ONE real frame at the resolved pose/heading,
  // but the requestAnimationFrame tick loop (mixer updates, continuous
  // heading turn) never starts — no per-frame render loop ever runs for
  // this instance, not merely "started then immediately stopped," so a
  // confirmed-weak device never pays the ongoing per-frame render cost it
  // couldn't afford in the first place (the whole point of this mode).
  animated?: boolean;
};

export function CharacterCanvas({
  layerHeight,
  maxQuality = false,
  widthScale = 1,
  glbUrl,
  headingDegrees = 0,
  isWalking = true,
  isSitting = false,
  isGlobalChatActive = false,
  isSpatialConversation = false,
  isTyping = false,
  width,
  height,
  onError,
  animated = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Ref (not a direct closure over the onError prop) so the main load
  // effect below doesn't need onError in its dependency array — an inline
  // arrow-function prop identity changing every render must never
  // re-trigger a GLB re-fetch.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // At most once per mount — a lost-then-restored-then-lost-again context
  // should only notify the caller once (it's already switched this
  // character to the sprite path after the first call).
  const reportedErrorRef = useRef(false);
  function reportError() {
    if (reportedErrorRef.current) return;
    reportedErrorRef.current = true;
    onErrorRef.current?.();
  }

  const layerHeightRef = useRef(layerHeight);
  layerHeightRef.current = layerHeight;
  const maxQualityRef = useRef(maxQuality);
  maxQualityRef.current = maxQuality;
  // Seamless LOD switching (2026-08-30). The scene/camera/RAF loop live in a
  // long-lived effect keyed on [width, height, animated]; `glbUrl` gets its
  // OWN effect that loads in the background and hands the result to
  // installModelRef, which swaps atomically. Splitting them is what keeps the
  // current character on screen while the next tier downloads — the old
  // single effect tore the scene down the instant glbUrl changed, which is
  // what produced the blank frame.
  const installModelRef = useRef<((gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }) => void) | null>(null);
  const hasModelRef = useRef(false);
  const loadTokenRef = useRef(0);
  const headingTargetRef = useRef(headingDegrees);
  useEffect(() => {
    headingTargetRef.current = headingDegrees;
  }, [headingDegrees]);

  const stateInputsRef = useRef({ isWalking, isSitting, isGlobalChatActive, isSpatialConversation, isTyping });
  useEffect(() => {
    stateInputsRef.current = { isWalking, isSitting, isGlobalChatActive, isSpatialConversation, isTyping };
  }, [isWalking, isSitting, isGlobalChatActive, isSpatialConversation, isTyping]);

  // WebGL context loss on the shared renderer's canvas (see SharedRenderer)
  // is a mid-session failure, not a load-time one — every currently-mounted
  // CharacterCanvas attaches its own listener here, so each independently
  // (and safely — reportError() is idempotent) tells its own caller to fall
  // back to the sprite, without any of them needing to know about the
  // others.
  useEffect(() => {
    let glCanvas: HTMLCanvasElement | undefined;
    try {
      glCanvas = getSharedCanvasElement();
    } catch {
      // No real WebGL/DOM environment (e.g. some test setups) — nothing to
      // listen for.
      return;
    }
    const handleContextLost = () => reportError();
    glCanvas.addEventListener("webglcontextlost", handleContextLost);
    return () => glCanvas?.removeEventListener("webglcontextlost", handleContextLost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let disposed = false;
    let rafId = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let model: THREE.Object3D | null = null;
    let tickStarted = false;
    let framed = false;
    // Every clip resolveCharacterAnimState() can name, looked up by name
    // once the gltf's animations array is known.
    const clipsByState = new Map<CharacterAnimState, THREE.AnimationClip>();
    let currentAction: THREE.AnimationAction | null = null;
    let currentState: CharacterAnimState | null = null;
    let currentHeading = headingTargetRef.current;

    // Unlit material — no scene lights (see header).
    const scene = new THREE.Scene();

    // Device-pixel render size = base size × zoom/DPR bucket (renderScale.ts).
    // The camera/framing below is computed from the BASE width/height, so it
    // stays exactly as calibrated at every scale.
    // Painted buffer is `width x widthScale` wide; height is untouched.
    const bufferWidth = Math.max(1, Math.round(width * widthScale));
    let renderScale = 1;
    let renderSize = scaledRenderSize(bufferWidth, height, renderScale);
    let framesSincePoll = RENDER_SCALE_POLL_FRAMES; // poll on the first frame
    function updateRenderScale() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;
      // Spatial participants pin the top bucket; everyone else follows the
      // zoom/DPR-derived one. Either way the value is a stable bucket, so the
      // shared (grow-only) WebGL surface is resized only when it actually
      // changes — never per frame.
      const next = maxQualityRef.current
        ? MAX_RENDER_SCALE
        : resolveRenderScale(rect.height, height, dpr);
      if (next !== renderScale) {
        renderScale = next;
        renderSize = scaledRenderSize(bufferWidth, height, renderScale);
      }
    }

    // Wider aspect => camera.right widens while `top` is unchanged, i.e. more
    // world is visible sideways at the SAME scale. The canonical solve below is
    // invariant to this: it rescales `top` to hit a standing fraction measured
    // purely in Y.
    const aspect = bufferWidth / height;
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);

    function positionCamera(target: THREE.Vector3) {
      const elev = (CONFIG.camera.elevationDeg * Math.PI) / 180;
      const az = (CONFIG.camera.azimuthDeg * Math.PI) / 180;
      const d = CONFIG.camera.distance;
      const x = d * Math.cos(elev) * Math.sin(az);
      const y = d * Math.sin(elev);
      const z = d * Math.cos(elev) * Math.cos(az);
      camera.position.set(target.x + x, target.y + y, target.z + z);
      camera.lookAt(target);
    }

    // Same camera-space bbox extent helper as calibration.html — needed so
    // the auto-framing math is identical (elevated ortho camera means
    // world-space Y alone isn't a reliable framing proxy).
    function getCameraSpaceExtent(box3: THREE.Box3, cam: THREE.Camera) {
      cam.updateMatrixWorld(true);
      const inv = cam.matrixWorldInverse.clone().copy(cam.matrixWorld).invert();
      const corners = [
        new THREE.Vector3(box3.min.x, box3.min.y, box3.min.z),
        new THREE.Vector3(box3.min.x, box3.min.y, box3.max.z),
        new THREE.Vector3(box3.min.x, box3.max.y, box3.min.z),
        new THREE.Vector3(box3.min.x, box3.max.y, box3.max.z),
        new THREE.Vector3(box3.max.x, box3.min.y, box3.min.z),
        new THREE.Vector3(box3.max.x, box3.min.y, box3.max.z),
        new THREE.Vector3(box3.max.x, box3.max.y, box3.min.z),
        new THREE.Vector3(box3.max.x, box3.max.y, box3.max.z),
      ];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of corners) {
        const local = c.clone().applyMatrix4(inv);
        minX = Math.min(minX, local.x);
        maxX = Math.max(maxX, local.x);
        minY = Math.min(minY, local.y);
        maxY = Math.max(maxY, local.y);
      }
      return { minX, maxX, minY, maxY };
    }

    // Grounds the model at its own bbox (centers X/Z, drops feet to y=0).
    function groundModel(root: THREE.Object3D) {
      const box = computeFramingBox(root);
      const center = new THREE.Vector3();
      box.getCenter(center);
      root.position.x -= center.x;
      root.position.z -= center.z;
      root.position.y -= box.min.y;
    }

    // Applies the currently-resolved animation state to the mixer, crossfading
    // from whatever was previously playing. No-ops entirely (does not touch
    // the mixer/action at all) if the resolved state hasn't changed since
    // the last call — the no-restart-on-same-state contract from the task
    // spec, kept here (the effectful side) separate from the pure
    // resolveCharacterAnimState() (characterAnimationState.ts).
    function applyAnimState(nextState: CharacterAnimState): THREE.AnimationAction | null {
      if (!mixer) return null;
      if (currentState === nextState) return currentAction;
      const nextClip = clipsByState.get(nextState);
      if (!nextClip) {
        // eslint-disable-next-line no-console
        console.warn(`[CharacterCanvas] no "${nextState}" animation clip on ${glbUrl}`);
        currentState = nextState;
        return null;
      }
      const nextAction = mixer.clipAction(nextClip);
      nextAction.reset();
      nextAction.enabled = true;
      nextAction.setEffectiveWeight(1);
      nextAction.setEffectiveTimeScale(1);
      nextAction.play();
      if (currentAction && currentAction !== nextAction) {
        currentAction.crossFadeTo(nextAction, CROSSFADE_SECONDS, true);
      }
      currentAction = nextAction;
      currentState = nextState;
      // Observability only: exposes the resolved clip name on the canvas so
      // live-browser validation / tests can assert the real state machine
      // outcome without reaching into the mixer. No rendering effect.
      canvasRef.current?.setAttribute("data-anim-state", nextState);
      return nextAction;
    }

    function tickHeadingAndAnimState(delta: number) {
      if (!model) return;
      const maxDelta = TURN_RATE_DEG_PER_SEC * delta;
      currentHeading = stepAngleTowardsDegrees(currentHeading, headingTargetRef.current, maxDelta);
      model.rotation.y = (currentHeading * Math.PI) / 180;

      const resolved = resolveCharacterAnimState(stateInputsRef.current);
      applyAnimState(resolved);
    }

    function startTickLoopOnce() {
      if (tickStarted) return;
      tickStarted = true;
      const clock = new THREE.Clock();
      const tick = () => {
        if (disposed) return;
        const delta = clock.getDelta();
        mixer?.update(delta);
        tickHeadingAndAnimState(delta);
        if (++framesSincePoll >= RENDER_SCALE_POLL_FRAMES) {
          framesSincePoll = 0;
          updateRenderScale();
        }
        const canvas = canvasRef.current;
        if (canvas) {
          renderToCanvas(scene, camera, canvas, renderSize.width, renderSize.height);
          if (import.meta.env.DEV) {
            canvas.setAttribute("data-render-scale", String(renderScale));
            canvas.setAttribute("data-spatial-quality", String(maxQualityRef.current));
          }
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    // Builds a model from a loaded GLTF and swaps it in ATOMICALLY: the
    // replacement is fully constructed, posed and playing before the outgoing
    // one is removed, so there is never a frame without a character. Called by
    // the glbUrl effect below, both for the first load and every LOD swap.
    function installModel(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }) {
      const previousModel = model;
      const previousMixer = mixer;
      // Carry the outgoing clip's normalized progress + play state across, so
      // a tier swap never restarts or freezes the animation.
      const carried = previousMixer && currentAction && currentAction.getClip().duration > 0
        ? {
            state: currentState,
            progress: (currentAction.time % currentAction.getClip().duration) / currentAction.getClip().duration,
            paused: currentAction.paused,
          }
        : null;

      // Clone via SkeletonUtils so each mounted instance of the same GLB
      // gets its own independent skeleton/bones instead of sharing one
      // live Object3D graph (plain Object3D.clone() does not correctly
      // re-target skinned-mesh bone bindings).
      model = cloneSkeleton(gltf.scene) as THREE.Object3D;
      scene.add(model);

      setupModelMaterials(model);
      // Heading is NEVER re-derived on a SWAP: it carries over from the
      // outgoing model, so changing LOD cannot reset facing. Only the very
      // first install adopts the current target.
      if (!previousModel) currentHeading = headingTargetRef.current;
      model.rotation.y = (currentHeading * Math.PI) / 180;
      groundModel(model);

      // Framing/zoom is solved ONCE, from the first model. Later tiers share
      // the skeleton and the canonical size rule, so reusing the camera makes
      // apparent size and composition bit-identical across a swap instead of
      // merely close.
      if (!framed) {
      const box = computeFramingBox(model);
      const stableBox = computeStableFramingBox(model);
      const size = new THREE.Vector3();
      box.getSize(size);

      const target = new THREE.Vector3(0, size.y * 0.5, 0);
      positionCamera(target);

      const ext1 = getCameraSpaceExtent(box, camera);
      const centerX = (ext1.minX + ext1.maxX) / 2;
      const centerY = (ext1.minY + ext1.maxY) / 2;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
      camera.position.addScaledVector(right, centerX);
      camera.position.addScaledVector(up, centerY);
      camera.updateMatrixWorld(true);

      // Zoom comes from the heading-independent bounds (see
      // computeStableFramingBox) so apparent size never changes with facing;
      // the centering above deliberately keeps using the live world box.
      const ext2 = getCameraSpaceExtent(stableBox, camera);
      const halfHeight = ((ext2.maxY - ext2.minY) / 2) * CONFIG.camera.frameMarginY;
      const halfWidth = ((ext2.maxX - ext2.minX) / 2) * CONFIG.camera.frameMarginX;
      const topFromHeight = halfHeight;
      const topFromWidth = halfWidth / aspect;
      let top = Math.max(topFromHeight, topFromWidth);
      // --- canonical size (characterSize.ts) -------------------------------
      // The zoom solved above is driven by whichever of height/width is
      // larger, which for a T-pose bind skeleton is usually the ARM SPAN. That
      // made visible standing height depend on how wide a character's arms
      // were drawn (bon 31.0 frame units vs alex 28.1). Re-solve the zoom from
      // the STANDING silhouette so every employee is the same visible height.
      // Measured with the heading rotation already removed, so this stays
      // heading-independent, and it changes only zoom — never proportions.
      const standingBox = computeStandingBox(model);
      const extStanding = getCameraSpaceExtent(standingBox, camera);
      const standingFraction = (extStanding.maxY - extStanding.minY) / (2 * top);
      top = canonicalTop(top, standingFraction, layerHeightRef.current ?? 0);

      camera.top = top;
      camera.bottom = -top;
      camera.right = top * aspect;
      camera.left = -top * aspect;
      camera.updateProjectionMatrix();
      framed = true;
      }

      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        clipsByState.clear();
        for (const clip of gltf.animations) {
          clipsByState.set(clip.name as CharacterAnimState, clip);
        }
        // Force applyAnimState to actually bind on the NEW mixer.
        currentAction = null;
        currentState = null;
        const boundAction = applyAnimState(
          carried?.state ?? resolveCharacterAnimState(stateInputsRef.current),
        );
        if (carried && boundAction) {
          // Resume at the same normalized point in the clip, not from 0.
          boundAction.time = carried.progress * boundAction.getClip().duration;
          boundAction.paused = carried.paused;
          mixer.update(0);
        }
      }

      // Only now is the replacement fully live — retire the outgoing one.
      if (previousMixer && previousMixer !== mixer) previousMixer.stopAllAction();
      if (previousModel && previousModel !== model) {
        // geometry/materials stay owned by glbCache (see the unmount note
        // below); only this instance's cloned nodes are dropped.
        scene.remove(previousModel);
      }
      hasModelRef.current = true;

      if (animated) {
        startTickLoopOnce();
      } else {
        // Static-frame mode: render exactly this one frame at the resolved
        // pose/heading and stop — never call startTickLoopOnce, so no
        // requestAnimationFrame loop or mixer.update() ever runs for this
        // instance (not "start then immediately cancel," which would still
        // pay for at least one scheduled tick and leave a rafId to clean
        // up for no benefit).
        // Sample the resolved action's pose (at time 0, since it was just
        // .play()ed) into the skeleton's bones without advancing the clip
        // or requiring a running tick loop — otherwise the SkinnedMesh
        // stays in the GLB's raw bind pose (T/A-pose) for this static frame.
        mixer?.update(0);
        updateRenderScale();
        const canvas = canvasRef.current;
        if (canvas) {
          renderToCanvas(scene, camera, canvas, renderSize.width, renderSize.height);
        }
      }
    }

    installModelRef.current = installModel;

    return () => {
      installModelRef.current = null;
      hasModelRef.current = false;
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      mixer?.stopAllAction();
      mixer = null;
      if (model) {
        // NOTE: geometry/material are NOT disposed here. They are owned by
        // the cached GLTF in glbCache.ts (which never evicts successfully
        // loaded entries) and shared by reference across every
        // SkeletonUtils.clone() of that cache entry (per three.js's
        // Mesh.copy() behavior — only nodes/bones/skeleton are per-clone).
        // Disposing them on this instance's unmount would break any other
        // still-mounted clone of the same character (e.g. main view +
        // PiP mini-camera both showing the self-avatar). Only this
        // instance's cloned Object3D nodes are instance-owned; let GC
        // reclaim those via scene.remove below.
        scene.remove(model);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, animated, widthScale]);

  // Background load + atomic swap. Separate from the effect above so the
  // scene, camera and RAF loop survive a tier change and the current
  // character stays on screen for the whole download.
  useEffect(() => {
    const token = ++loadTokenRef.current;
    let cancelled = false;
    loadGlbCached(glbUrl)
      .then((gltf) => {
        // Newest request wins: a slower earlier load must never overwrite a
        // newer tier that already landed (rapid near/far movement).
        if (cancelled || token !== loadTokenRef.current) return;
        installModelRef.current?.(gltf);
      })
      .catch((err) => {
        if (cancelled || token !== loadTokenRef.current) return;
        // eslint-disable-next-line no-console
        console.warn(`[CharacterCanvas] failed to load glb ${glbUrl}`, err);
        // A failed SWAP keeps the model already on screen; only a failure with
        // nothing to fall back on drops this character to its 2D sprite.
        if (!hasModelRef.current) reportError();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbUrl]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.max(1, Math.round(width * widthScale))}
      height={height}
      {...(import.meta.env.DEV
        ? {
            "data-lod": /-(lod[012])\.glb(?:[?#]|$)/.exec(glbUrl)?.[1] ?? "unknown",
            "data-spatial-quality": String(maxQuality),
          }
        : {})}
      style={{
        // The painted box takes its aspect from the BUFFER, never from the
        // wrapper.
        //
        // Sizing the canvas as a percentage of the wrapper made the painted
        // aspect (wrapper.width x widthScale / wrapper.height) independent of
        // the buffer aspect, so any wrapper shaped differently from the
        // character's own render dimensions stretched the image non-uniformly.
        // That is exactly what happened to a PEER: rosterLayers.ts sizes every
        // seat/roster layer from bonLayer, so alex rendered inside bon's box
        // and came out 21.6% too wide, while alex-as-self (his own manifest
        // layer) was correct.
        //
        // height:100% keeps the feet anchor and the canonical standing-height
        // policy exactly as before; aspect-ratio then derives the width from
        // the buffer, so pixels stay square for every character, every wrapper
        // and every LOD. Centred on the wrapper, so the horizontal centre and
        // the label above it are unchanged, and free to overflow (the wrapper
        // sets overflow:visible for 3D layers) so wide poses are not clipped.
        position: "absolute",
        top: 0,
        left: "50%",
        transform: "translateX(-50%)",
        height: "100%",
        width: "auto",
        aspectRatio: `${Math.max(1, Math.round(width * widthScale))} / ${height}`,
        display: "block",
        pointerEvents: "none",
      }}
    />
  );
}

export default CharacterCanvas;
