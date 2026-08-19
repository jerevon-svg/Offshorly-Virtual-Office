import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { WalkDirection } from "../data/bonWalkFrames";
import { loadGlbCached } from "./glbCache";
import { getSharedCanvasElement, renderToCanvas } from "./SharedRenderer";

// ---------------------------------------------------------------------------
// Phase C — live-3D character renderer.
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
// ---------------------------------------------------------------------------

const CONFIG = {
  camera: {
    elevationDeg: 35,
    azimuthDeg: 0,
    distance: 5,
    // Tuned via pixel-alpha-scan measurement (see git history) to bring the
    // front-facing walking silhouette from ~184px up to ~190px at this
    // 210x298 render size, without touching elevationDeg — a slight
    // zoom-in on top of the 35deg elevation fix, not a re-derivation of
    // the framing math itself.
    // Tuned via pixel-alpha-scan measurement (see git history) to bring the
    // front-facing walking bind-pose silhouette from ~180-185px up to
    // ~190px at this 210x298 render size, without touching elevationDeg —
    // a slight zoom-in on top of the 35deg elevation fix, not a
    // re-derivation of the framing math itself. Every other pose variant
    // (idle/shrug/thinking/future) normalizes its own scale against this
    // same frustum via normalizeToReferenceHeight (see loadPoseVariant),
    // so this one pair of constants is the single place controlling
    // apparent character size across every variant.
    frameMarginY: 1.4234,
    frameMarginX: 1.556,
  },
  lights: {
    ambient: { color: 0xfff2e6, intensity: 0.4 },
    keyTop: { color: 0xfff0dd, intensity: 0.4, pos: [0, 6, 0.6] as [number, number, number] },
    fill: { color: 0xffffff, intensity: 0.2, pos: [-2, 1, 3] as [number, number, number] },
  },
  emissiveIntensity: 0.7,
};

// Maps the app's existing 4-direction sprite convention (see
// useCharacterWalk.ts's WalkDirection: y grows downward -> +dy = "front" =
// facing viewer) onto a model rotation.y in degrees, replacing sprite
// swapping with an actual turn of the 3D model. azimuthDeg: 0 in CONFIG
// means the camera looks at the model's front face when rotation.y = 0, so
// "front" maps to 0 here. Left/right sign was picked to match screen-space
// left/right as seen by the camera and confirmed against the running app
// (see OfficeStage dev-toggle integration) — flip the two if a future model
// turns out mirrored.
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
  // The always-present walking-animation GLB (unchanged from before this
  // idle-pose addition).
  walkingGlbUrl: string;
  // Optional dedicated idle-pose GLB (own rig-matched skeleton, single
  // "Idle" clip). When provided, `isWalking=false` shows THIS glb's model
  // with its own mixer running, instead of freezing the walking glb
  // mid-stride. When omitted (e.g. no idle asset generated yet for this
  // character), behavior falls back exactly to the pre-idle single-GLB
  // freeze-on-pause behavior below.
  idleGlbUrl?: string;
  // Optional looping-gesture GLBs (e.g. shrug/thinking) shown while a chat
  // or call with this character is active — see gestureActive below. Both
  // are optional and independent of idleGlbUrl; a character with no
  // gesture assets configured (anyone but Bon/Jerevon right now) simply
  // never shows a gesture, matching the idle-glb graceful-fallback
  // principle (absent prop -> no-op, never an error).
  shrugGlbUrl?: string;
  thinkingGlbUrl?: string;
  // When true, shows ONE of shrugGlbUrl/thinkingGlbUrl (randomly chosen
  // ONCE per activation — i.e. once per false->true transition, not
  // re-rolled every frame/render) looping, instead of the normal
  // idle/walking behavior below. Returns to normal idle/walking exactly as
  // before once this goes back to false. No-ops (renders idle/walking as
  // usual) if neither gesture glb is provided.
  gestureActive?: boolean;
  animationName?: string;
  headingDegrees?: number;
  // Gates which variant is shown/animated, mirroring the sprite path's
  // "only cycle frames while isWalking" behavior — true (the default)
  // matches every existing caller's prior always-animating behavior.
  // - With idleGlbUrl set: true shows the walking glb (mixer running),
  //   false shows the idle glb (its OWN mixer running the idle clip).
  // - Without idleGlbUrl (fallback): true keeps the walking mixer
  //   advancing, false freezes it wherever it happens to be (character
  //   holds its current pose) — the scene keeps rendering, so
  //   rotation/heading changes made while stationary still show up
  //   immediately.
  isWalking?: boolean;
  width: number;
  height: number;
  // Fires (at most once per mount) when this character's live-3D model
  // could not be shown — a GLB fetch/parse failure (walking, idle, shrug,
  // or thinking) or the shared WebGL context being lost mid-session. The
  // caller is expected to fall back to the normal 2D sprite <img> for this
  // character on this signal; CharacterCanvas itself never renders a
  // fallback (it doesn't know about sprite src), it only reports the
  // failure upward. No-ops after the first call per mount (a lost context
  // firing "restored" and lost again wouldn't re-fire) — the caller owns
  // whatever happens next.
  onError?: () => void;
};

export function CharacterCanvas({
  walkingGlbUrl,
  idleGlbUrl,
  shrugGlbUrl,
  thinkingGlbUrl,
  gestureActive = false,
  animationName,
  headingDegrees = 0,
  isWalking = true,
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
  // At most once per mount — a lost-then-restored-then-lost-again context,
  // or multiple variants failing independently, should only notify the
  // caller once (it's already switched this character to the sprite path
  // after the first call, so repeat calls would be no-ops anyway).
  const reportedErrorRef = useRef(false);
  function reportError() {
    if (reportedErrorRef.current) return;
    reportedErrorRef.current = true;
    onErrorRef.current?.();
  }
  const walkModelRef = useRef<THREE.Object3D | null>(null);
  const idleModelRef = useRef<THREE.Object3D | null>(null);
  const shrugModelRef = useRef<THREE.Object3D | null>(null);
  const thinkingModelRef = useRef<THREE.Object3D | null>(null);
  const isWalkingRef = useRef(isWalking);
  const gestureActiveRef = useRef(gestureActive);
  // Which gesture glb is currently "chosen" for this activation — randomly
  // picked once per false->true transition (see the gestureActive effect
  // below), then held steady (not re-rolled) for as long as gestureActive
  // stays true, per the props doc above.
  const chosenGestureRef = useRef<"shrug" | "thinking" | null>(null);

  // Reconciles which of the (up to four) loaded model variants is visible,
  // given the latest isWalking/gestureActive/chosen-gesture refs. Called
  // from every effect below that can change one of those inputs, plus from
  // each variant's own load callback (in case that variant finishes loading
  // after the relevant effect already ran). "effective" gesture mode only
  // engages when gestureActive is true AND the chosen gesture's glb has
  // actually finished loading — driven by loaded-model availability, not
  // prop presence, so a gesture (or idle) glb that fails to load falls back
  // to the walk model staying visible/animating instead of a blank canvas.
  // Likewise idle "availability" is based on idleModelRef, not idleGlbUrl,
  // for the same reason.
  function applyVisibility() {
    const chosen = chosenGestureRef.current;
    const effectiveGesture =
      gestureActiveRef.current &&
      (chosen === "shrug"
        ? !!shrugModelRef.current
        : chosen === "thinking"
          ? !!thinkingModelRef.current
          : false);
    const idleAvailable = !!idleModelRef.current;
    const walking = isWalkingRef.current;
    if (walkModelRef.current) {
      walkModelRef.current.visible = !effectiveGesture && (!idleAvailable || walking);
    }
    if (idleModelRef.current) {
      idleModelRef.current.visible = !effectiveGesture && idleAvailable && !walking;
    }
    if (shrugModelRef.current) {
      shrugModelRef.current.visible = effectiveGesture && chosenGestureRef.current === "shrug";
    }
    if (thinkingModelRef.current) {
      thinkingModelRef.current.visible =
        effectiveGesture && chosenGestureRef.current === "thinking";
    }
  }

  // Live model rotation without re-triggering the GLB load effect. Applied
  // to every loaded variant so whichever one is currently visible is
  // always facing the right way, and swapping visibility never needs to
  // re-sync rotation separately.
  useEffect(() => {
    const rad = (headingDegrees * Math.PI) / 180;
    if (walkModelRef.current) walkModelRef.current.rotation.y = rad;
    if (idleModelRef.current) idleModelRef.current.rotation.y = rad;
    if (shrugModelRef.current) shrugModelRef.current.rotation.y = rad;
    if (thinkingModelRef.current) thinkingModelRef.current.rotation.y = rad;
  }, [headingDegrees]);

  // Live walk-gate without re-triggering the GLB load effect (same pattern
  // as headingDegrees above). Also flips which model is visible right away
  // (rather than waiting for the next load) when the relevant variants are
  // already loaded.
  useEffect(() => {
    isWalkingRef.current = isWalking;
    applyVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWalking, idleGlbUrl]);

  // Live gesture-gate, same "don't re-trigger the GLB load effect" pattern.
  // Picks a random gesture (once) on every false->true transition, per the
  // Props doc — not re-rolled on every render while gestureActive stays
  // true, and reset back to null on deactivation so the next activation
  // re-rolls fresh.
  const prevGestureActiveRef = useRef(false);
  useEffect(() => {
    const activating = gestureActive && !prevGestureActiveRef.current;
    prevGestureActiveRef.current = gestureActive;
    gestureActiveRef.current = gestureActive;
    if (activating) {
      const options: Array<"shrug" | "thinking"> = [];
      if (shrugGlbUrl) options.push("shrug");
      if (thinkingGlbUrl) options.push("thinking");
      chosenGestureRef.current =
        options.length > 0 ? options[Math.floor(Math.random() * options.length)] : null;
    } else if (!gestureActive) {
      chosenGestureRef.current = null;
    }
    applyVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureActive, shrugGlbUrl, thinkingGlbUrl]);

  // WebGL context loss on the shared renderer's canvas (see SharedRenderer)
  // is a mid-session failure, not a load-time one — every currently-mounted
  // CharacterCanvas attaches its own listener here, so each independently
  // (and safely — reportError() is idempotent) tells its own caller to fall
  // back to the sprite, without any of them needing to know about the
  // others. Not in the main GLB-load effect below since this listener must
  // stay attached regardless of which GLB urls/props change.
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
    let rafId = 0;
    let mixer: THREE.AnimationMixer | null = null;
    let model: THREE.Object3D | null = null;
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

    let disposed = false;
    let idleMixer: THREE.AnimationMixer | null = null;
    let idleModel: THREE.Object3D | null = null;
    let shrugMixer: THREE.AnimationMixer | null = null;
    let shrugModel: THREE.Object3D | null = null;
    let thinkingMixer: THREE.AnimationMixer | null = null;
    let thinkingModel: THREE.Object3D | null = null;
    let tickStarted = false;

    // Shared per-mesh material tweaks (mipmap seam-bleed fix + baked
    // emissiveIntensity) — identical treatment for both variants since
    // they're the same underlying character/material, just a different
    // pose GLB.
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

    // Grounds a model at its own bbox (centers X/Z, drops feet to y=0) —
    // used for BOTH variants so each stands correctly on the shared floor
    // plane even though the idle pose's bbox may differ slightly from the
    // walk pose's bind-pose bbox. Only the WALK model's post-centering box
    // drives the shared camera framing below (per CONFIG comment: same
    // rig/character, one frustum, no per-variant re-framing).
    function groundModel(root: THREE.Object3D) {
      const box = computeFramingBox(root);
      const center = new THREE.Vector3();
      box.getCenter(center);
      root.position.x -= center.x;
      root.position.z -= center.z;
      root.position.y -= box.min.y;
    }

    function startTickLoopOnce() {
      if (tickStarted) return;
      tickStarted = true;
      const clock = new THREE.Clock();
      const tick = () => {
        if (disposed) return;
        const delta = clock.getDelta();
        // Gesture mode (chat/call active + a gesture chosen) takes priority
        // over the normal walk/idle mixer selection below — same
        // "effective gesture" gating as applyVisibility(), kept in sync
        // manually here rather than reusing that function (it also touches
        // .visible, which this tick loop doesn't need to redo every frame).
        const chosenTick = chosenGestureRef.current;
        const effectiveGesture =
          gestureActiveRef.current &&
          (chosenTick === "shrug"
            ? !!shrugModelRef.current
            : chosenTick === "thinking"
              ? !!thinkingModelRef.current
              : false);
        if (effectiveGesture) {
          const activeMixer = chosenGestureRef.current === "shrug" ? shrugMixer : thinkingMixer;
          activeMixer?.update(delta);
        } else if (idleGlbUrl) {
          // Without an idle glb: exact prior behavior — only advance the
          // (sole) walking mixer while isWalking, else freeze mid-pose.
          // With an idle glb: whichever variant is currently shown keeps
          // animating (walk cycle while moving, idle breathing/sway while
          // stationary) — there's always a "correct" mixer to run.
          const activeMixer = isWalkingRef.current ? mixer : idleMixer;
          activeMixer?.update(delta);
        } else if (isWalkingRef.current) {
          mixer?.update(delta);
        }
        const canvas = canvasRef.current;
        if (canvas) {
          renderToCanvas(scene, camera, canvas, width, height);
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    // Captures the walk model's calibrated framing-box world height, so the
    // idle glb load (below) can scale itself to match it — see idle-load
    // callback comment for why this is needed.
    let walkFramingHeight = 0;

    loadGlbCached(walkingGlbUrl).then((gltf) => {
      if (cancelled) return;
      // Clone via SkeletonUtils so each mounted instance of the same GLB
      // gets its own independent skeleton/bones instead of sharing one
      // live Object3D graph (plain Object3D.clone() does not correctly
      // re-target skinned-mesh bone bindings).
      model = cloneSkeleton(gltf.scene) as THREE.Object3D;
      walkModelRef.current = model;
      scene.add(model);

      setupModelMaterials(model);
      model.rotation.y = (headingDegrees * Math.PI) / 180;
      groundModel(model);
      // Only the walk-glb-if-no-idle case (or, when other variants haven't
      // finished loading yet) needs this visible immediately; once any
      // other variant finishes loading, applyVisibility() reconciles final
      // visibility.
      model.visible = !idleGlbUrl || isWalkingRef.current;

      const box2 = computeFramingBox(model);
      const size2 = new THREE.Vector3();
      box2.getSize(size2);
      walkFramingHeight = size2.y;

      const target = new THREE.Vector3(0, size2.y * 0.5, 0);
      positionCamera(target);

      const ext1 = getCameraSpaceExtent(box2, camera);
      const centerX = (ext1.minX + ext1.maxX) / 2;
      const centerY = (ext1.minY + ext1.maxY) / 2;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
      camera.position.addScaledVector(right, centerX);
      camera.position.addScaledVector(up, centerY);
      camera.updateMatrixWorld(true);

      const ext2 = getCameraSpaceExtent(box2, camera);
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
        const clip =
          (animationName && THREE.AnimationClip.findByName(gltf.animations, animationName)) ||
          gltf.animations[0];
        if (clip) mixer.clipAction(clip).play();
      }

      startTickLoopOnce();

      // Kicked off from inside the walk model's .then (rather than fired
      // in parallel alongside it) so walkFramingHeight above is guaranteed
      // set before the scale-correction logic below needs it, regardless
      // of which GLB happens to finish fetching first.
      if (idleGlbUrl) loadIdleVariant(idleGlbUrl);
      if (shrugGlbUrl) loadGestureVariant(shrugGlbUrl, "shrug");
      if (thinkingGlbUrl) loadGestureVariant(thinkingGlbUrl, "thinking");
    }).catch((err) => {
      if (cancelled) return;
      // The always-present walking glb is this character's baseline —
      // failing to load it (network error, bad URL, corrupt asset) means
      // there is nothing to show at all, so this is the one failure that
      // always reports upward (unlike an optional idle/gesture variant
      // below, which degrades gracefully instead).
      // eslint-disable-next-line no-console
      console.warn(`[CharacterCanvas] failed to load walking glb ${walkingGlbUrl}`, err);
      reportError();
    });

    // Scales `root` (in place) so its OWN first-played-frame bone-derived
    // height matches `referenceHeight` (walkFramingHeight — the walking
    // model's calibrated bind-pose framing height, the single source of
    // truth every non-walking variant normalizes against). Generalized
    // from the original idle-only fix (Bon reported the idle stand
    // visibly bigger than the walking stand when toggling between them):
    // investigation found every one of these Meshy Animation-API exports'
    // raw (pre-animation) bind poses measures an IDENTICAL bone-derived
    // height to the walking glb's — there's no baked scale difference
    // between exports. The mismatch only appears once a clip is actually
    // evaluated: a variant's pose (even at its very first frame) can stand
    // measurably taller/shorter than its own bind pose (idle observed
    // ~10-13% taller). Since the frustum is deliberately kept calibrated
    // off the walking model (per product decision — don't touch the
    // walking size), every OTHER variant corrects itself here instead, one
    // at a time, via this exact same formula — not idle-specific, applies
    // uniformly to however many additional pose variants get loaded (idle,
    // shrug, thinking today; any future variant, e.g. sitting, later).
    // Computed dynamically (not a hardcoded constant) so this self-corrects
    // if any GLB export is regenerated later.
    function normalizeToReferenceHeight(
      root: THREE.Object3D,
      animations: THREE.AnimationClip[],
      referenceHeight: number,
    ) {
      if (animations.length === 0 || referenceHeight <= 0) return;
      const calibMixer = new THREE.AnimationMixer(root);
      const calibAction = calibMixer.clipAction(animations[0]);
      calibAction.play();
      calibMixer.setTime(0);
      const boxAtFirstFrame = computeFramingBox(root);
      const sizeAtFirstFrame = new THREE.Vector3();
      boxAtFirstFrame.getSize(sizeAtFirstFrame);
      if (sizeAtFirstFrame.y > 0) {
        root.scale.setScalar(referenceHeight / sizeAtFirstFrame.y);
      }
      calibMixer.stopAllAction();
    }

    // Shared loader for every non-walking pose variant (idle, shrug,
    // thinking, and any future gesture/pose glb) — loads, clones, applies
    // materials/heading, normalizes scale against walkFramingHeight (see
    // normalizeToReferenceHeight above), grounds, warns if the clip count
    // looks wrong, and plays its single animation clip looped.
    function loadPoseVariant(
      url: string,
      label: string,
      modelRef: MutableRefObject<THREE.Object3D | null>,
      onLoaded: (model: THREE.Object3D, mixer: THREE.AnimationMixer | null) => void,
    ) {
      loadGlbCached(url).then((gltf) => {
        if (cancelled) return;
        const poseModel = cloneSkeleton(gltf.scene) as THREE.Object3D;
        modelRef.current = poseModel;
        scene.add(poseModel);

        setupModelMaterials(poseModel);
        poseModel.rotation.y = (headingDegrees * Math.PI) / 180;
        normalizeToReferenceHeight(poseModel, gltf.animations, walkFramingHeight);
        groundModel(poseModel);

        if (gltf.animations.length !== 1) {
          // eslint-disable-next-line no-console
          console.warn(
            `[CharacterCanvas] ${label} glb ${url} has ${gltf.animations.length} animation clip(s)` +
              ` (expected exactly 1 dedicated clip): ${gltf.animations.map((a) => a.name).join(", ")}`,
          );
        }
        let poseMixer: THREE.AnimationMixer | null = null;
        if (gltf.animations.length > 0) {
          poseMixer = new THREE.AnimationMixer(poseModel);
          poseMixer.clipAction(gltf.animations[0]).play();
        }
        onLoaded(poseModel, poseMixer);

        applyVisibility();
        startTickLoopOnce();
      }).catch((err) => {
        if (cancelled) return;
        // Optional-variant failure (idle/shrug/thinking) degrades
        // gracefully — the walking glb still loaded/loads independently,
        // so this character keeps showing live-3D, just without this one
        // variant (matching idleGlbUrl's existing absent-prop no-op
        // behavior). Does NOT call reportError()/fall back to the sprite —
        // that's reserved for the always-present walking glb above.
        // eslint-disable-next-line no-console
        console.warn(`[CharacterCanvas] failed to load ${label} glb ${url}`, err);
        // Re-reconcile visibility now that this variant is known to have
        // failed (rather than just "not yet loaded") — e.g. the walk model
        // may currently be hidden pending this variant's resolution (see
        // the initial `model.visible` assignment on the walking glb above),
        // and needs to fall back to visible now instead of staying hidden
        // indefinitely.
        applyVisibility();
      });
    }

    function loadIdleVariant(url: string) {
      loadPoseVariant(url, "idle", idleModelRef, (loadedModel, loadedMixer) => {
        idleModel = loadedModel;
        idleMixer = loadedMixer;
      });
    }

    function loadGestureVariant(url: string, kind: "shrug" | "thinking") {
      const modelRef = kind === "shrug" ? shrugModelRef : thinkingModelRef;
      loadPoseVariant(url, kind, modelRef, (loadedModel, loadedMixer) => {
        if (kind === "shrug") {
          shrugModel = loadedModel;
          shrugMixer = loadedMixer;
        } else {
          thinkingModel = loadedModel;
          thinkingMixer = loadedMixer;
        }
      });
    }

    return () => {
      cancelled = true;
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      mixer?.stopAllAction();
      mixer = null;
      idleMixer?.stopAllAction();
      idleMixer = null;
      shrugMixer?.stopAllAction();
      shrugMixer = null;
      thinkingMixer?.stopAllAction();
      thinkingMixer = null;
      for (const m of [model, idleModel, shrugModel, thinkingModel]) {
        if (!m) continue;
        // NOTE: geometry/material are NOT disposed here. They are owned by
        // the cached GLTF in glbCache.ts (which never evicts successfully
        // loaded entries) and shared by reference across every
        // SkeletonUtils.clone() of that cache entry (per three.js's
        // Mesh.copy() behavior — only nodes/bones/skeleton are per-clone).
        // Disposing them on this instance's unmount would break any other
        // still-mounted clone of the same character (e.g. main view +
        // PiP mini-camera both showing the self-avatar). Only this
        // instance's cloned Object3D nodes are instance-owned; let GC
        // reclaim those via scene.remove + ref nulling below.
        scene.remove(m);
      }
      walkModelRef.current = null;
      idleModelRef.current = null;
      shrugModelRef.current = null;
      thinkingModelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkingGlbUrl, idleGlbUrl, shrugGlbUrl, thinkingGlbUrl, animationName, width, height]);

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
