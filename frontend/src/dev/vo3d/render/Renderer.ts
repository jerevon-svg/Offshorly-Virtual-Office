// vo3d render — ONE WebGLRenderer, ONE Scene, ONE orthographic camera, lights and environment.
// Promoted from designRoom3d/main.ts.
//
// SSAO: CORRECTED, TUNED, GRADED — AND ON BY DEFAULT. It is the V2 FULL GRAPHICS BASELINE, which means it
// is the state every later optimisation pass measures against, the 70-avatar stress scenarios included.
// Benchmarking this world with AO switched off no longer measures the product.
//
//   WHAT IT COST, measured on the ground floor at 1440x810 on an M1: 16.7 ms/frame without AO, 34.3 ms
//   with it. Rendering the AO at a QUARTER of the pixels changed that by nothing at all (34.3 ms), which
//   rules out fill cost entirely. The scene drew 15,611 CALLS over 13,464 objects per frame, and SSAOPass
//   re-drew every one of them into a normal buffer before it could compute anything: the AO did not cost
//   pixels, it cost A SECOND FULL SCENE TRAVERSAL. Slices 1-3 took the world's own submission count down
//   (instancing, room culling, static batching) and SLICE 4 took that second traversal away outright —
//   the AO now reconstructs its normals from the depth the beauty pass already wrote, so the scene is
//   submitted once. See render/SSAOFromDepth; `?ao=legacy` puts the stock two-submission pass back.
//   Recorded here so the optimisation phase starts from the measurement rather than re-deriving it.
//
// The Light > SSAO toggle stays live so the pass can still be A/B'd off. Three things had to be fixed
// before any of this was correct enough to be a baseline:
//   • CORRECTNESS. SSAOPass ships with PERSPECTIVE_CAMERA hard-defined to 1 and only refreshes the
//     camera projection uniforms inside setSize(). This rig draws an ORTHOGRAPHIC camera that zooms
//     constantly, so the AO was being computed from a perspective depth conversion against a stale
//     projection matrix — i.e. it was wrong at every zoom but the one the window was last resized at.
//     Both are fixed here: the define follows the active camera, and the matrices are refreshed per frame.
//   • COST, as far as it goes. The AO is rendered at AO_SCALE of the drawing buffer and the sample kernel
//     drops from 32 to 16. Both are free quality-wise (the result is blurred and multiplied over the
//     beauty), and both are worth keeping for when the draw-call figure above comes down — they are simply
//     not where this scene's AO cost is.
//   • STRENGTH. Stock SSAOPass multiplies raw (1 - occlusion) into the frame with no way to dial it
//     back, which is what turns a cream wall dirty. One patched line in the composite shader lerps the
//     AO toward white by `aoStrength`, so the environment can grade contact occlusion per phase the
//     same way it grades every other global (see env/presets `ao`).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOFromDepthPass, makeBeautyTarget, ssaoDepthReuseEnabled } from "./SSAOFromDepth";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Rect, Vec2 } from "../core/coords";

/** THE DYNAMIC-CASTER LAYER. An avatar's meshes sit on layer 0 (so every camera still draws them
 *  normally) AND on this one, which is the ONLY thing that separates them from the static world for the
 *  split shadow update below. Nothing else in the app uses layers, so enabling it changes no other pass. */
export const DYNAMIC_CASTER_LAYER = 2;

export type CameraParams = { pitch: number; yaw: number; zoom: number };
export type LightParams = { azimuth: number; elevation: number; keyIntensity: number; ambientIntensity: number; envIntensity: number; exposure: number };
export const DEFAULT_CAMERA: CameraParams = { pitch: 52, yaw: 0, zoom: 1.32 };
/** The DAY grade, duplicated here because the renderer has to stand up before the environment exists.
 *  It must stay byte-for-byte equal to ENV_PRESETS.day's light fields — env.test asserts exactly that. */
export const DEFAULT_LIGHT: LightParams = { azimuth: -48, elevation: 54, keyIntensity: 3.05, ambientIntensity: 0.92, envIntensity: 0.38, exposure: 1.06 };

/** How many consecutive frames of static invalidation before the split shadow update stands down and
 *  lets three do one plain full redraw instead. Three is long enough that a one-off change (an asset
 *  landing, a camera nudge) still takes the cheap path, and short enough that a door cycle — sixty-odd
 *  frames of continuous static motion — spends almost all of itself on the cheaper full redraw. */
const STATIC_THRASH_FRAMES = 3;

/** Resolution the AO is computed at, as a fraction of the drawing buffer. (Since slice 4 it no longer
 *  feeds a normal pass of its own — it samples the beauty buffer's full-resolution depth.) */
const AO_SCALE = 0.5;
/** Fallback AO strength. The environment overwrites this per phase the moment it applies a grade. */
const AO_STRENGTH = 0.6;

// WORLD-SCALE DEPTH RANGE. The camera is orthographic, so its distance from the target changes nothing
// about framing — only which slice of the world survives the near/far clip. With the office alone, 1500 /
// 4000 was ample. With an exterior world around it (±5.4k of terrain, see world/campus) that slice clipped
// the landscape away at roughly 4k out. Ortho depth is LINEAR, so widening the range costs no precision:
// 24-bit depth over 30k units still resolves finer than a hundredth of a unit.
//
// Anything that measures in camera depth has to move with it — that is the SSAO pass (rescaled below) and
// the environment's fog, which is expressed as offsets from CAM_DIST for exactly this reason.
const CAM_DIST = 6000;
const FAR = 15000;

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, FAR);
  /** THE PLAYER CAMERA. A second, PERSPECTIVE camera that exists only so PLAYER mode does not have to fake
   *  a first/third-person view through an orthographic frustum (which cannot be done — ortho has no
   *  viewpoint, so there is no such thing as standing inside it). It is never made active by this class:
   *  render/CameraModes decides, and OFFICE/EXPLORE are byte-for-byte unaffected because they simply never
   *  select it. Near/far are avatar-scale (Bon is 36 units tall), not world-scale like the ortho slice. */
  readonly playerCamera = new THREE.PerspectiveCamera(55, 1, 1.5, 9000);
  readonly controls: OrbitControls;
  readonly key: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** the cool bounce opposite the key; the environment re-colours it per phase */
  readonly fill: THREE.DirectionalLight;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly ssao: SSAOFromDepthPass;
  /** the camera actually drawn. Defaults to the orthographic rig; only CameraModes ever changes it. */
  private active: THREE.Camera;
  /** the world-space focus rect (a room today; the whole office later) */
  focus: Rect;
  readonly target = new THREE.Vector3();
  camParams: CameraParams = { ...DEFAULT_CAMERA };
  lightParams: LightParams = { ...DEFAULT_LIGHT };
  /** THE FULL GRAPHICS BASELINE. See the SSAO note at the top of this file for what it costs and why. */
  ssaoEnabled = true;
  /** Optional camera POLICY hook, run every frame immediately after OrbitControls has moved the camera
   *  and before anything reads the target. This is where OFFICE mode's pan/zoom bounds are enforced —
   *  the renderer itself stays policy-free. See render/CameraModes. */
  constrain: (() => void) | null = null;
  /** SHADOW FRAME OVERRIDE. The shadow frustum normally follows the orbit target and is sized from the
   *  orthographic viewport — neither of which means anything when a perspective camera is walking around
   *  inside the building. A mode that owns its own viewpoint sets these two and the frustum follows IT
   *  instead. Null (the default) leaves OFFICE and EXPLORE on exactly the behaviour they were approved
   *  with. This is a camera/lighting knob, not gameplay: the renderer still knows nothing about a player. */
  shadowFocus: Vec2 | null = null;
  shadowRadius: number | null = null;
  /** Optional VISIBILITY hook, run every frame after the shadow frame has been settled and before
   *  anything is drawn. Room-level culling lives behind it (render/RoomVisibility, driven by
   *  app/bootstrap) — the renderer itself still knows nothing about rooms.
   *
   *  THE ORDER MATTERS. updateShadowFrame() may have just moved the light and flagged the shadow map for
   *  a redraw; running the cull after it means the visibility the shadow pass sees is the visibility that
   *  was decided against THIS frame's shadow frustum, never the previous one's. */
  cull: (() => void) | null = null;
  private readonly lightDir = new THREE.Vector3(0, 1, 0);
  private shadowKey = "";
  // ---- SPLIT SHADOW UPDATE (see the block comment above updateShadowMaps) ----
  /** A/B switch. Off = the pre-split behaviour exactly: one flag, one full redraw of every caster. */
  shadowCache = true;
  /** the static world must be re-drawn into the shadow map (light moved, frustum moved, a door/chair/
   *  asset/room changed) — this is what invalidateShadows() has always meant */
  private staticShadowDirty = true;
  /** only the avatars moved: the cached static depth is still valid, they just have to be re-composited */
  private dynamicShadowDirty = true;
  /** the cached STATIC-ONLY depth, blitted in and out of the light's own shadow map */
  private staticShadowRT: THREE.WebGLRenderTarget | null = null;
  /** roots whose meshes are dynamic casters (the hero avatar, the stress crowd) */
  private readonly dynamicCasters: THREE.Object3D[] = [];
  /** THE COMPOSITE'S SCENE. Never part of the world graph: the caster roots are BORROWED into its
   *  children array for the duration of one render and handed straight back, so nothing is re-parented
   *  and world transforms keep coming from each root's real parent (a chair carrier included).
   *
   *  WHY BORROW RATHER THAN RENDER this.scene. WebGLRenderer.render() walks the whole graph in
   *  projectObject before it draws anything, and the ground floor is ~3,000 objects — measured at ~6.5 ms
   *  of pure traversal, which is most of what the cached static pass had just saved. Handing it the ~210
   *  objects that can actually be drawn skips that. It has to be a Scene rather than a bare Group because
   *  three only honours overrideMaterial when scene.isScene === true. */
  private readonly dynamicScene = new THREE.Scene();
  private static readonly NO_CHILDREN: THREE.Object3D[] = [];
  /** the shadow camera, restricted to the dynamic-caster layer, used for the composite pass */
  private readonly dynamicShadowCamera = new THREE.OrthographicCamera();
  /** THE STATIC PROBE. A 1° camera parked in empty space far under the world, rendered into a 1×1 target.
   *  Its only job is to give three.js a real render call to hang its OWN shadow pass off — see
   *  renderStaticShadowPass for why the static half cannot simply call shadowMap.render() directly. */
  private readonly staticProbeCamera = new THREE.PerspectiveCamera(1, 1, 0.1, 1);
  private readonly staticProbeTarget = new THREE.WebGLRenderTarget(1, 1);
  private readonly hiddenCasters: { root: THREE.Object3D; visible: boolean }[] = [];
  /** colorWrite is off: for a non-VSM shadow map three binds shadow.map.depthTexture as the sampler
   *  (WebGLLights), so the colour attachment is never read and writing it is pure bandwidth. side is
   *  BackSide to match what three\'s own depth pass does with a FrontSide material (shadowSide). */
  private readonly dynamicDepthMaterial = Object.assign(new THREE.MeshDepthMaterial({ side: THREE.BackSide, colorWrite: false }), { fog: false });
  /** set by invalidateShadows(), consumed once per frame — how the streak below is counted */
  private staticInvalidatedThisFrame = false;
  /** consecutive frames on which the static world was invalidated (see THRASH below) */
  private staticStreak = 0;
  /** dev/report readout — how the shadow map was updated over the last stretch of frames */
  readonly shadowStats = { staticPasses: 0, dynamicPasses: 0, fullPasses: 0, skipped: 0, frames: 0 };

  constructor(canvas: HTMLCanvasElement, focus: Rect) {
    this.focus = focus;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // STATIC-SCENE SHADOWS. The ground floor is architecture: 800-odd meshes in the Central Hub alone,
    // none of which ever move. With three.js' default autoUpdate every one of them is re-drawn into the
    // shadow map EVERY FRAME — a second full pass that profiling showed costs roughly half the frame
    // (shadows off: a locked 16.7ms; shadows on: 22–26ms). So the map is redrawn only when something that
    // casts one has actually changed: the shadow frustum moves, the avatar moves, a door or chair
    // animates, or the light is repositioned. See invalidateShadows().
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    // PCF SOFT rather than plain PCF: the edge is filtered over a texel neighbourhood that scales with
    // distance, which is what separates a long sunset rake (wants a soft tail) from a chair leg on a floor
    // (wants a tight contact). It costs a few extra samples in the shadowed fragments only — no extra
    // geometry pass, and the map is still redrawn on demand, so the per-frame budget is unchanged.
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = this.lightParams.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.scene.background = new THREE.Color(0xe7ded4);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = this.lightParams.envIntensity;
    this.hemi = new THREE.HemisphereLight(0xfff4ea, 0xcdb9a6, this.lightParams.ambientIntensity);
    this.key = new THREE.DirectionalLight(0xfff1e0, this.lightParams.keyIntensity);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.near = 200;
    this.key.shadow.camera.far = 1600;
    // TIGHTER THAN BEFORE, on purpose. normalBias pushes the sample along the surface normal to kill
    // acne, and every unit of it is a unit of the shadow DETACHING from the thing casting it — which is
    // exactly the contact the depth pass is here to sell. 0.6 was enough to float a chair leg; 0.4 still
    // holds the cream walls clean under a 3.05-intensity key.
    this.key.shadow.bias = -0.00045;
    this.key.shadow.normalBias = 0.4;
    this.key.shadow.radius = 3;
    this.fill = new THREE.DirectionalLight(0xe4ecff, 0.35);
    this.scene.add(this.hemi, this.key, this.key.target, this.fill);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minZoom = 0.12; // whole ground floor (1440 × 1244) fits at the default frustum
    this.controls.maxZoom = 6;
    this.active = this.camera;
    // SLICE 4: the composer's beauty buffer carries a DEPTH TEXTURE, and SSAO reads it instead of
    // re-drawing the scene into a normal buffer of its own (see render/SSAOFromDepth). `?ao=legacy`
    // leaves the target undefined, which is what puts the stock two-submission pass back for the A/B.
    const dpr = this.renderer.getPixelRatio();
    this.composer = ssaoDepthReuseEnabled()
      ? new EffectComposer(this.renderer, makeBeautyTarget(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr)))
      : new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.ssao = new SSAOFromDepthPass(this.scene, this.camera, Math.round(window.innerWidth * AO_SCALE), Math.round(window.innerHeight * AO_SCALE), 16);
    // A CONTACT radius, not an ambient one. 14 units spread the darkening a third of a metre up a wall,
    // which is what made cream architecture read as grubby; 7 keeps it in the crease where two surfaces
    // actually meet — under a desk, behind a chair leg, where a wall lands on a floor.
    this.ssao.kernelRadius = 7;
    // SSAO's min/max are FRACTIONS of the camera's depth range. The range grew with the world (see FAR),
    // so these are rescaled by the same factor to preserve the world-space distances they used to mean
    // (2 units and 320 units) — AO looks identical to the single-room build. Untouched by slice 4: these
    // are fractions of the camera's depth range, and the depth range did not change, only its source.
    this.ssao.minDistance = (0.0005 * 4000) / FAR;
    this.ssao.maxDistance = (0.03 * 4000) / FAR;
    this.tuneSSAO();
    this.composer.addPass(this.ssao);
    this.composer.addPass(new OutputPass());
    this.setFocus(focus);
    this.fill.position.set(focus.x + focus.w, 300, focus.z + focus.d * 1.6);
    this.placeLight();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }
  /** the orbit distance, in world units — fog/AO distances are measured from it (see CAM_DIST) */
  get camDist(): number {
    return CAM_DIST;
  }
  /** whether the AO pass actually took the slice-4 depth-reuse path (false under `?ao=legacy`) */
  get ssaoReusesDepth(): boolean {
    return this.ssao.reusesDepth;
  }
  /** the camera currently being drawn (the ortho rig unless a mode has selected another) */
  get activeCamera(): THREE.Camera {
    return this.active;
  }
  /** Select which camera renders. The post pipeline follows, so SSAO keeps working in either. */
  setActiveCamera(cam: THREE.Camera): void {
    if (cam === this.active) return;
    this.active = cam;
    this.renderPass.camera = cam;
    this.ssao.camera = cam as THREE.PerspectiveCamera;
    this.followSSAOCamera();
  }
  /** 0 = no AO … 1 = stock SSAOPass strength. Graded per phase by the environment. */
  get aoStrength(): number {
    return (this.ssao.copyMaterial as THREE.ShaderMaterial).uniforms.aoStrength.value as number;
  }
  set aoStrength(v: number) {
    (this.ssao.copyMaterial as THREE.ShaderMaterial).uniforms.aoStrength.value = THREE.MathUtils.clamp(v, 0, 1);
  }
  /** One-time surgery on the stock pass: a strength uniform in the composite, and the ortho define. */
  private tuneSSAO(): void {
    const cm = this.ssao.copyMaterial as THREE.ShaderMaterial;
    cm.uniforms.aoStrength = { value: AO_STRENGTH };
    cm.fragmentShader = cm.fragmentShader
      .replace("uniform float opacity;", "uniform float opacity;\n\t\tuniform float aoStrength;")
      .replace("gl_FragColor = opacity * texel;", "gl_FragColor = vec4( mix( vec3( 1.0 ), texel.rgb * opacity, aoStrength ), 1.0 );");
    cm.needsUpdate = true;
    this.followSSAOCamera();
  }
  /** Point the AO shader at whichever camera is drawing: projection KIND (the define) and its clip range.
   *  Stock SSAOPass does neither — it assumes a perspective camera and reads near/far once, at construction. */
  private followSSAOCamera(): void {
    const cam = this.active as THREE.Camera & { near?: number; far?: number };
    const persp = (cam as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    for (const m of [this.ssao.ssaoMaterial, this.ssao.depthRenderMaterial] as THREE.ShaderMaterial[]) {
      const want = persp ? 1 : 0;
      if (m.defines.PERSPECTIVE_CAMERA !== want) { m.defines.PERSPECTIVE_CAMERA = want; m.needsUpdate = true; }
      m.uniforms.cameraNear.value = cam.near ?? 1;
      m.uniforms.cameraFar.value = cam.far ?? FAR;
    }
  }
  setFocus(rect: Rect): void {
    this.focus = rect;
    this.target.set(rect.x + rect.w / 2, 8, rect.z + rect.d / 2 - 6);
    this.key.target.position.set(rect.x + rect.w / 2, 0, rect.z + rect.d / 2);
    this.placeCamera();
  }
  placeCamera(): void {
    const p = this.camParams;
    const pitch = THREE.MathUtils.degToRad(p.pitch), yaw = THREE.MathUtils.degToRad(p.yaw);
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.copy(this.target).addScaledVector(dir, CAM_DIST);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    const aspect = window.innerWidth / window.innerHeight;
    const halfH = (this.focus.d * 0.62 + 40) / p.zoom;
    this.camera.top = halfH; this.camera.bottom = -halfH; this.camera.left = -halfH * aspect; this.camera.right = halfH * aspect;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.target);
    this.controls.update();
  }
  /** Frame `rect` in view: recentres the orbit target and returns the `camParams.zoom` that fits it. */
  focusOn(rect: Rect, fill = 0.9): number {
    this.target.set(rect.x + rect.w / 2, 8, rect.z + rect.d / 2 - 6);
    this.camera.zoom = 1;
    const aspect = window.innerWidth / window.innerHeight;
    const halfNeeded = Math.max(rect.d / 2, rect.w / 2 / aspect) / fill;
    return Math.round(((this.focus.d * 0.62 + 40) / halfNeeded) * 100) / 100;
  }
  /** WRITE THE LEVELS, MOVE NOTHING. Intensities and exposure only — no direction, no frustum, and
   *  explicitly NO shadow invalidation.
   *
   *  A shadow map stores DEPTH, not brightness, so making the key brighter or the exposure hotter cannot
   *  invalidate it. That distinction is what lets the environment re-grade every frame — a Clear→Rain
   *  fade, a lightning flash — without asking for a shadow redraw per frame. `placeLight()` remains the
   *  path that moves the sun, and it alone pays for the redraw. */
  applyLightLevels(): void {
    const l = this.lightParams;
    this.key.intensity = l.keyIntensity;
    this.hemi.intensity = l.ambientIntensity;
    this.scene.environmentIntensity = l.envIntensity;
    this.renderer.toneMappingExposure = l.exposure;
  }
  placeLight(): void {
    const l = this.lightParams;
    const az = THREE.MathUtils.degToRad(l.azimuth), el = THREE.MathUtils.degToRad(l.elevation);
    this.lightDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.applyLightLevels();
    // THE SUN MOVED: the cached static depth was rendered from the old direction and is now wrong
    // everywhere. This must go through invalidateShadows(), not straight at three's flag — writing
    // three's flag alone would leave the cache believing it was still valid and blit stale depth back
    // over the new pass. Same for the frustum move below.
    this.invalidateShadows();
    this.updateShadowFrame(true);
  }
  /** The shadow frustum follows what is being looked at: centred on the orbit target, sized to the visible
   *  height (clamped). Keeps Design-Room-scale shadow resolution while zoomed in on a 1440-unit floor. */
  private updateShadowFrame(force = false): void {
    const halfVisible = this.camera.top / Math.max(this.camera.zoom, 1e-6);
    const s = this.shadowRadius ?? Math.round(THREE.MathUtils.clamp(halfVisible * 1.7, 180, 760));
    const c = this.shadowFocus ?? this.target;
    const t: Vec2 = { x: Math.round(c.x / 8) * 8, z: Math.round(c.z / 8) * 8 };
    const key = `${s}:${t.x}:${t.z}`;
    if (!force && key === this.shadowKey) return;
    this.shadowKey = key;
    this.key.target.position.set(t.x, 0, t.z);
    this.key.position.copy(this.key.target.position).addScaledVector(this.lightDir, 800);
    const sc = this.key.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s;
    sc.updateProjectionMatrix();
    this.key.shadow.needsUpdate = true;
    // THE FRUSTUM MOVED: every cached texel now maps to a different place on the floor, so the cache is
    // not merely stale, it is misaligned. A full static redraw is the only correct answer.
    this.invalidateShadows();
  }
  /** THE FULL INVALIDATION, and the meaning every existing caller already has: the STATIC world changed
   *  (a door leaf, a chair, the sun, the shadow frustum, a room built, a volume swapped), so the cached
   *  static depth is stale and everything has to be re-drawn. */
  invalidateShadows(): void {
    this.staticShadowDirty = true;
    this.dynamicShadowDirty = true;
    this.staticInvalidatedThisFrame = true;
    this.renderer.shadowMap.needsUpdate = true;
  }
  /** THE CHEAP INVALIDATION: only registered dynamic casters moved. The cached static depth is still
   *  exactly right, so the next frame restores it and re-composites the avatars over it. */
  invalidateDynamicShadows(): void {
    this.dynamicShadowDirty = true;
    if (!this.shadowCache) this.renderer.shadowMap.needsUpdate = true;
  }
  /** Register a subtree whose meshes cast DYNAMIC shadows (an avatar, the stress crowd). Their meshes
   *  join DYNAMIC_CASTER_LAYER, which is what lets the composite pass draw them and nothing else. */
  addDynamicCaster(root: THREE.Object3D): void {
    if (!this.dynamicCasters.includes(root)) this.dynamicCasters.push(root);
    this.markDynamicCaster(root);
    this.invalidateShadows(); // a new body has to enter the cached static pass' exclusion list too
  }
  removeDynamicCaster(root: THREE.Object3D): void {
    const i = this.dynamicCasters.indexOf(root);
    if (i >= 0) this.dynamicCasters.splice(i, 1);
    this.invalidateShadows();
  }
  /** Re-mark a subtree after it has gained meshes (a GLB landed, a body was cloned in).
   *
   *  MESHES ONLY. three's own shadow pass draws nothing but meshes, lines and points, so a Sprite in the
   *  subtree — an avatar's nameplate — is silently excluded from it. The composite, being an ordinary
   *  render, is not so picky: put a sprite on this layer and its quad writes depth through the override
   *  depth material and the nameplate starts casting a rectangular shadow on the floor. Groups do not
   *  need the layer at all: projectObject recurses into children whatever the parent's mask says. */
  markDynamicCaster(root: THREE.Object3D): void {
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.layers.enable(DYNAMIC_CASTER_LAYER); });
  }
  /** true when the split path is actually in force this frame (dev readout + the A/B report) */
  get shadowCacheActive(): boolean {
    return this.shadowCache && this.renderer.shadowMap.enabled && this.dynamicCasters.length > 0;
  }
  setShadows(on: boolean): void {
    this.renderer.shadowMap.enabled = on;
    this.staticShadowDirty = true;
    this.dynamicShadowDirty = true;
    this.renderer.shadowMap.needsUpdate = on;
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
  }
  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.playerCamera.aspect = window.innerWidth / window.innerHeight;
    this.playerCamera.updateProjectionMatrix();
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.ssao.setSize(Math.round(window.innerWidth * AO_SCALE), Math.round(window.innerHeight * AO_SCALE));
    this.placeCamera();
  }
  // ============================ SPLIT SHADOW UPDATE ===============================================
  //
  // WHY. Measured on the 70-avatar stress matrix (devtools/Stress): while avatars move, the shadow map
  // is invalidated on ~98% of frames and the redraw costs 8.21 ms of a 35.45 ms frame in the office and
  // 6.34 ms of 34.35 ms in the CAVE. Splitting that cost by caster set showed WHERE it goes:
  //
  //        scenario                     static world      the avatars
  //        70 distributed + motion         5.29 ms          2.92 ms      (+2,054 shadow draw calls)
  //        70 CAVE + motion                1.22 ms          5.12 ms      (+75 shadow draw calls)
  //
  // In the office, two thirds of the bill is RE-DRAWING TWO THOUSAND PIECES OF ARCHITECTURE that did not
  // move, purely because somebody walked past them. That is the waste this removes, and it removes it
  // without touching shadow resolution, filtering, bias, the caster set or the art: the static world's
  // depth is identical, it is simply not recomputed when nothing static changed.
  //
  // HOW. The light's shadow map is a real DepthTexture (three r185, non-VSM path), so depth from two
  // passes composites correctly with an ordinary depth test:
  //
  //   STATIC PASS (only when something static changed). Dynamic casters are switched off, three renders
  //   its own shadow pass for the key light, and the resulting depth is blitted into a cached target
  //   (renderer.copyTextureToTexture takes the gl.blitFramebuffer/DEPTH_BUFFER_BIT path for a
  //   DepthTexture — public API, no three internals).
  //
  //   DYNAMIC PASS (every frame an avatar moved). The cached static depth is blitted back into the
  //   light's shadow map and the avatars are drawn over it with a depth material, no clear. Layer
  //   DYNAMIC_CASTER_LAYER is what selects them: the composite camera is restricted to it, so exactly
  //   the registered bodies are submitted and nothing else can leak in.
  //
  // WHAT IS DELIBERATELY UNCHANGED. invalidateShadows() still means "everything is stale" and every one
  // of its existing callers — doors, chairs, the editor, the environment grade, the CAVE swap, an async
  // asset landing, the sun moving, the frustum moving — still triggers a full static redraw. The only
  // new verb is invalidateDynamicShadows(), and the only caller that may use it is one that knows the
  // thing that moved is a registered dynamic caster. Get that wrong and a moved chair keeps its old
  // shadow until the next static invalidation; that is why the split lives here rather than in a caller.
  private updateShadowMaps(): void {
    const sm = this.renderer.shadowMap;
    this.shadowStats.frames++;
    if (!sm.enabled) { sm.needsUpdate = false; return; }
    if (!this.shadowCacheActive) { this.staticInvalidatedThisFrame = false; return; } // legacy path
    // THRASH FALLBACK. Caching only pays when the static world holds still between avatar steps. While
    // something static changes on EVERY frame — a door cycling, a chair being dragged, a weather or
    // time-of-day grade travelling — the split does strictly more work than the thing it replaced: a
    // probe render, a full static pass, a blit AND a composite, instead of one redraw. Measured at 25
    // avatars in the office it costs 4 ms/frame (34.9 → 30.6 fps). So after a short streak the split
    // stands down and three's single full redraw takes over, exactly as the pre-split build did; the
    // dirty flag is deliberately LEFT SET, so the first calm frame re-primes the cache before using it.
    if (this.staticInvalidatedThisFrame) this.staticStreak++; else this.staticStreak = 0;
    this.staticInvalidatedThisFrame = false;
    if (this.staticStreak > STATIC_THRASH_FRAMES) {
      sm.needsUpdate = true; // three redraws every caster, dynamic ones included — the legacy behaviour
      this.dynamicShadowDirty = false;
      this.shadowStats.fullPasses++;
      return;
    }
    if (!this.staticShadowDirty && !this.dynamicShadowDirty) { sm.needsUpdate = false; this.shadowStats.skipped++; return; }
    // three recreates shadow.map on a type/size change; the cache has to follow it or the blit mismatches
    const map = this.key.shadow.map;
    if (map && this.staticShadowRT && (this.staticShadowRT.width !== map.width || this.staticShadowRT.height !== map.height)) {
      this.staticShadowRT.dispose();
      this.staticShadowRT = null;
      this.staticShadowDirty = true;
    }
    if (this.staticShadowDirty || this.key.shadow.map === null || this.staticShadowRT === null) {
      this.renderStaticShadowPass();
      this.cacheStaticDepth();
      this.staticShadowDirty = false;
      this.shadowStats.staticPasses++;
    } else {
      this.restoreStaticDepth();
    }
    sm.needsUpdate = false; // set BEFORE the composite: renderer.render() runs the shadow pass itself
    this.compositeDynamicShadows();
    this.dynamicShadowDirty = false;
    this.shadowStats.dynamicPasses++;
  }

  /** THE STATIC-ONLY SHADOW PASS, rendered by three.js itself.
   *
   *  It cannot be invoked directly: WebGLShadowMap.render() reads the renderer's current render STATE
   *  (the light list setProgram needs), and that only exists inside a WebGLRenderer.render() call — call
   *  it standalone and every caster throws on a null render state. So the pass is hung off a real render
   *  that is arranged to draw nothing:
   *
   *    • the PROBE CAMERA is a 1° frustum parked far below the world, so projectObject frustum-culls the
   *      entire scene out of the beauty render list — but still pushes the LIGHTS (lights are not
   *      frustum-culled), which is what puts the key light in shadowsArray and makes three run the pass.
   *    • the shadow pass itself does NOT use the probe camera's frustum — it culls against the light's own
   *      (shadow.getFrustum()) and uses the view camera only for the LAYER test, which the probe passes.
   *      So every static caster is drawn into the shadow map exactly as it always was.
   *    • the beauty half renders into a 1×1 target.
   *
   *  The point of going through three rather than rolling a depth pass by hand is FIDELITY: getDepthMaterial
   *  carries shadowSide, alphaMap/alphaTest cut-outs, displacement and per-object customDepthMaterial. A
   *  hand-rolled override material would quietly change what the foliage and cut-out props cast. */
  private renderStaticShadowPass(): void {
    const r = this.renderer;
    const sm = r.shadowMap;
    const prevTarget = r.getRenderTarget();
    this.hideDynamicCasters();
    sm.needsUpdate = true;
    this.staticProbeCamera.position.set(0, -1e5, 0);
    this.staticProbeCamera.lookAt(0, -1e5 - 1, 0);
    this.staticProbeCamera.updateMatrixWorld(true);
    r.setRenderTarget(this.staticProbeTarget);
    r.render(this.scene, this.staticProbeCamera);
    r.setRenderTarget(prevTarget);
    this.restoreDynamicCasters();
  }
  /** Take the avatars out of BOTH lists for the static pass — invisible removes them from the beauty
   *  render list as well as the shadow pass, which matters because their meshes are frustumCulled = false. */
  private hideDynamicCasters(): void {
    this.hiddenCasters.length = 0;
    for (const root of this.dynamicCasters) {
      this.hiddenCasters.push({ root, visible: root.visible });
      root.visible = false;
    }
  }
  private restoreDynamicCasters(): void {
    for (const h of this.hiddenCasters) h.root.visible = h.visible;
    this.hiddenCasters.length = 0;
  }

  /** shadow.map depth → the cache. Creates the cache target on first use. */
  private cacheStaticDepth(): void {
    const map = this.key.shadow.map;
    if (!map || !map.depthTexture) return;
    if (!this.staticShadowRT) {
      const rt = new THREE.WebGLRenderTarget(map.width, map.height);
      rt.depthTexture = new THREE.DepthTexture(map.width, map.height, THREE.UnsignedIntType);
      rt.depthTexture.format = THREE.DepthFormat;
      rt.texture.name = "shadow-cache";
      this.renderer.initRenderTarget(rt); // both sides must exist on the GPU before a blit
      this.staticShadowRT = rt;
    }
    this.renderer.copyTextureToTexture(map.depthTexture, this.staticShadowRT.depthTexture!);
  }

  /** the cache → shadow.map depth, ready for the avatars to be composited over it */
  private restoreStaticDepth(): void {
    const map = this.key.shadow.map;
    if (!map || !map.depthTexture || !this.staticShadowRT?.depthTexture) return;
    this.renderer.copyTextureToTexture(this.staticShadowRT.depthTexture, map.depthTexture);
  }

  /** Draw the registered dynamic casters into the light's shadow map WITHOUT clearing it. */
  private compositeDynamicShadows(): void {
    const map = this.key.shadow.map;
    if (!map) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    // The shadow camera is left exactly as the last STATIC pass placed it — the frustum cannot have
    // moved without setting staticShadowDirty, so re-deriving it here would only risk drifting from it.
    const cam = this.dynamicShadowCamera;
    cam.copy(this.key.shadow.camera as THREE.OrthographicCamera);
    cam.layers.set(DYNAMIC_CASTER_LAYER);
    // The borrowed roots read their world transform off their REAL parents, which the beauty pass has
    // not refreshed yet on a composite-only frame — so the world matrices are settled here first.
    this.scene.updateMatrixWorld();
    this.dynamicScene.children = this.dynamicCasters;
    this.dynamicScene.overrideMaterial = this.dynamicDepthMaterial;
    r.autoClear = false;
    r.setRenderTarget(map as unknown as THREE.WebGLRenderTarget);
    r.render(this.dynamicScene, cam);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    this.dynamicScene.children = Renderer.NO_CHILDREN;
  }

  render(): void {
    this.renderer.info.reset();
    this.controls.update();
    this.constrain?.(); // camera-mode bounds get the last word on where the camera may be
    this.target.copy(this.controls.target); // panning moves the focus; GUI zoom/pitch then respect it
    this.updateShadowFrame();
    this.cull?.(); // room subtrees that cannot contribute to this frame drop out of every pass at once
    // THE SHADOW MAP IS SETTLED HERE, after culling and before anything is drawn — so the split pass
    // sees exactly the visibility this frame's beauty pass will see, and three's own shadow pass inside
    // composer.render() finds needsUpdate already cleared.
    this.updateShadowMaps();
    if (this.ssaoEnabled) {
      // AN ORTHO CAMERA'S PROJECTION MATRIX CHANGES WITH ZOOM, and SSAOPass only ever samples it in
      // setSize(). Two matrix copies a frame is the whole cost of AO that is correct at every zoom.
      const u = (this.ssao.ssaoMaterial as THREE.ShaderMaterial).uniforms;
      u.cameraProjectionMatrix.value.copy(this.active.projectionMatrix);
      u.cameraInverseProjectionMatrix.value.copy(this.active.projectionMatrixInverse);
      this.composer.render();
    } else this.renderer.render(this.scene, this.active);
  }
}
