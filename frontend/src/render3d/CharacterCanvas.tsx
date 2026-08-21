import { useEffect, useRef } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { WalkDirection } from "../data/bonWalkFrames";
import { loadGlbCached } from "./glbCache";
import { getSharedCanvasElement, renderToCanvas } from "./SharedRenderer";
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
// Lights / emissiveIntensity were RE-CALIBRATED against Meshy's own
// preview render (scripts/avatar-pipeline/reference/
// meshy-preview-alex-front.png) via objective pixel sampling (see git
// history for the calibration pass) — this model's material is
// effectively self-illuminated (metalness=1, roughness=1, full baked
// appearance in the emissiveMap), so these scene lights contribute only a
// small amount on top of the emissive term; emissiveIntensity is the
// dominant brightness control. The baked emissiveMap's R channel for skin
// tones is close to saturated even before any multiplier, so cranking
// emissiveIntensity toward/above 1.0 clips highlights to flat white —
// values below 1.0 are correct here, not a mistake.
//
// Phase A: replaced the earlier "up to 4 independently-loaded GLBs,
// hard-swap visibility" architecture with a single consolidated GLB (one
// mesh/skeleton, all 6 animation-state clips baked in — see
// live3dCharacters.ts/build-character-lods.mjs) driving ONE
// THREE.AnimationMixer. Which clip plays is resolved every render via the
// pure resolveCharacterAnimState() (characterAnimationState.ts) from this
// component's isWalking/isSitting/isChatting/isResponder props, and
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
  lights: {
    ambient: { color: 0xfff2e6, intensity: 0.4 },
    keyTop: { color: 0xfff0dd, intensity: 0.4, pos: [0, 6, 0.6] as [number, number, number] },
    fill: { color: 0xffffff, intensity: 0.2, pos: [-2, 1, 3] as [number, number, number] },
  },
  emissiveIntensity: 0.7,
};

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
  // The single consolidated GLB (mesh + skeleton + all 6 animation-state
  // clips) — see live3dCharacters.ts.
  glbUrl: string;
  // Target heading in degrees — CharacterCanvas turns toward this
  // continuously (see angleMath.ts's stepAngleTowardsDegrees), never snaps.
  headingDegrees?: number;
  // Sprite-path's existing walk-gate.
  isWalking?: boolean;
  // Seated in a real (painted-chair) seat — see OfficeMap's isSitting.
  // Facing (headingDegrees) is expected to already reflect the CHAIR's own
  // defined direction (data/seatDirections.ts) whenever this is true — the
  // caller resolves that (mirroring the existing 2D sitDirection plumbing),
  // never derived from the camera here.
  isSitting?: boolean;
  // This character is a participant in an active chat/call (see
  // OfficeStage's talkingCharacterIds).
  isChatting?: boolean;
  // Within an active chat, this character is the one currently responding
  // (see OfficeStage's talkingTextById). Ignored when isChatting is false.
  isResponder?: boolean;
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
};

export function CharacterCanvas({
  glbUrl,
  headingDegrees = 0,
  isWalking = true,
  isSitting = false,
  isChatting = false,
  isResponder = false,
  width,
  height,
  onError,
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

  const headingTargetRef = useRef(headingDegrees);
  useEffect(() => {
    headingTargetRef.current = headingDegrees;
  }, [headingDegrees]);

  const stateInputsRef = useRef({ isWalking, isSitting, isChatting, isResponder });
  useEffect(() => {
    stateInputsRef.current = { isWalking, isSitting, isChatting, isResponder };
  }, [isWalking, isSitting, isChatting, isResponder]);

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
    let cancelled = false;
    let disposed = false;
    let rafId = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let model: THREE.Object3D | null = null;
    let tickStarted = false;
    // Every clip resolveCharacterAnimState() can name, looked up by name
    // once the gltf's animations array is known.
    const clipsByState = new Map<CharacterAnimState, THREE.AnimationClip>();
    let currentAction: THREE.AnimationAction | null = null;
    let currentState: CharacterAnimState | null = null;
    let currentHeading = headingTargetRef.current;

    const scene = new THREE.Scene();

    const ambient = new THREE.AmbientLight(CONFIG.lights.ambient.color, CONFIG.lights.ambient.intensity);
    scene.add(ambient);
    const keyTop = new THREE.DirectionalLight(CONFIG.lights.keyTop.color, CONFIG.lights.keyTop.intensity);
    keyTop.position.set(...CONFIG.lights.keyTop.pos);
    scene.add(keyTop);
    const fill = new THREE.DirectionalLight(CONFIG.lights.fill.color, CONFIG.lights.fill.intensity);
    fill.position.set(...CONFIG.lights.fill.pos);
    scene.add(fill);

    const aspect = width / height;
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
    function computeFramingBox(root: THREE.Object3D): THREE.Box3 {
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

    function setupModelMaterials(root: THREE.Object3D) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const mat = m as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = CONFIG.emissiveIntensity;
            // The baked emissiveMap is a tightly-packed UV atlas whose charts
            // butt up against hard-edged (torn-looking) boundaries with no
            // padding/dilation between islands. Mipmap generation blends
            // across those chart seams at lower mip levels, bleeding the
            // gaps' dark fill color into the charts themselves — visible on
            // screen as fine scratchy "cracks" across otherwise-smooth skin.
            // Disabling mipmaps (and using linear min-filtering instead)
            // removes that seam-bleed at the cost of some minification
            // aliasing, which is an acceptable trade at this render's small
            // on-screen character size.
            for (const tex of [mat.map, mat.emissiveMap] as (THREE.Texture | null)[]) {
              if (!tex) continue;
              tex.generateMipmaps = false;
              tex.minFilter = THREE.LinearFilter;
              tex.magFilter = THREE.LinearFilter;
              tex.needsUpdate = true;
            }
          }
        }
      });
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
    function applyAnimState(nextState: CharacterAnimState) {
      if (!mixer) return;
      if (currentState === nextState) return;
      const nextClip = clipsByState.get(nextState);
      if (!nextClip) {
        // eslint-disable-next-line no-console
        console.warn(`[CharacterCanvas] no "${nextState}" animation clip on ${glbUrl}`);
        currentState = nextState;
        return;
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
        const canvas = canvasRef.current;
        if (canvas) {
          renderToCanvas(scene, camera, canvas, width, height);
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    loadGlbCached(glbUrl).then((gltf) => {
      if (cancelled) return;
      // Clone via SkeletonUtils so each mounted instance of the same GLB
      // gets its own independent skeleton/bones instead of sharing one
      // live Object3D graph (plain Object3D.clone() does not correctly
      // re-target skinned-mesh bone bindings).
      model = cloneSkeleton(gltf.scene) as THREE.Object3D;
      scene.add(model);

      setupModelMaterials(model);
      currentHeading = headingTargetRef.current;
      model.rotation.y = (currentHeading * Math.PI) / 180;
      groundModel(model);

      const box = computeFramingBox(model);
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

      const ext2 = getCameraSpaceExtent(box, camera);
      const halfHeight = ((ext2.maxY - ext2.minY) / 2) * CONFIG.camera.frameMarginY;
      const halfWidth = ((ext2.maxX - ext2.minX) / 2) * CONFIG.camera.frameMarginX;
      const topFromHeight = halfHeight;
      const topFromWidth = halfWidth / aspect;
      const top = Math.max(topFromHeight, topFromWidth);
      camera.top = top;
      camera.bottom = -top;
      camera.right = top * aspect;
      camera.left = -top * aspect;
      camera.updateProjectionMatrix();

      if (gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        for (const clip of gltf.animations) {
          clipsByState.set(clip.name as CharacterAnimState, clip);
        }
        applyAnimState(resolveCharacterAnimState(stateInputsRef.current));
      }

      startTickLoopOnce();
    }).catch((err) => {
      if (cancelled) return;
      // eslint-disable-next-line no-console
      console.warn(`[CharacterCanvas] failed to load glb ${glbUrl}`, err);
      reportError();
    });

    return () => {
      cancelled = true;
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
  }, [glbUrl, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

export default CharacterCanvas;
