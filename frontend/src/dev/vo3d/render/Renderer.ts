// vo3d render — ONE WebGLRenderer, ONE Scene, ONE orthographic camera, lights and environment.
// Promoted from designRoom3d/main.ts.
//
// SSAO: CORRECTED, TUNED, GRADED — AND ON BY DEFAULT. It is the V2 FULL GRAPHICS BASELINE, which means it
// is the state every later optimisation pass measures against, the 70-avatar stress scenarios included.
// Benchmarking this world with AO switched off no longer measures the product.
//
//   WHAT IT COSTS TODAY, measured on the ground floor at 1440x810 on an M1: 16.7 ms/frame without AO,
//   34.3 ms with it. Rendering the AO at a QUARTER of the pixels changed that by nothing at all (34.3 ms),
//   which rules out fill cost entirely. The scene draws 15,611 CALLS over 13,464 objects per frame, and
//   SSAOPass re-draws every one of them into a normal buffer before it can compute anything. The AO does
//   not cost pixels, it costs A SECOND FULL SCENE TRAVERSAL — so the lever that will move this number is
//   batching/instancing the world, not anything inside this pass. (The shadow map already dodges it: that
//   is drawn on demand, not per frame. A normal buffer cannot — it is view-dependent, and the view moves.)
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
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Rect, Vec2 } from "../core/coords";

export type CameraParams = { pitch: number; yaw: number; zoom: number };
export type LightParams = { azimuth: number; elevation: number; keyIntensity: number; ambientIntensity: number; envIntensity: number; exposure: number };
export const DEFAULT_CAMERA: CameraParams = { pitch: 52, yaw: 0, zoom: 1.32 };
/** The DAY grade, duplicated here because the renderer has to stand up before the environment exists.
 *  It must stay byte-for-byte equal to ENV_PRESETS.day's light fields — env.test asserts exactly that. */
export const DEFAULT_LIGHT: LightParams = { azimuth: -48, elevation: 54, keyIntensity: 3.05, ambientIntensity: 0.92, envIntensity: 0.38, exposure: 1.06 };

/** Resolution the AO and its feeding normal pass are rendered at, as a fraction of the drawing buffer. */
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
  private readonly ssao: SSAOPass;
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
  private readonly lightDir = new THREE.Vector3(0, 1, 0);
  private shadowKey = "";

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
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.ssao = new SSAOPass(this.scene, this.camera, Math.round(window.innerWidth * AO_SCALE), Math.round(window.innerHeight * AO_SCALE), 16);
    // A CONTACT radius, not an ambient one. 14 units spread the darkening a third of a metre up a wall,
    // which is what made cream architecture read as grubby; 7 keeps it in the crease where two surfaces
    // actually meet — under a desk, behind a chair leg, where a wall lands on a floor.
    this.ssao.kernelRadius = 7;
    // SSAO's min/max are FRACTIONS of the camera's depth range. The range grew with the world (see FAR),
    // so these are rescaled by the same factor to preserve the world-space distances they used to mean
    // (2 units and 320 units) — AO looks identical to the single-room build, it just still costs too much
    // at DPR 2, which is why it stays off by default.
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
    this.renderer.shadowMap.needsUpdate = true; // the sun moved
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
    this.renderer.shadowMap.needsUpdate = true; // the frustum moved: everything in it must be redrawn
  }
  /** Redraw the shadow map on the next frame. Cheap to call — three.js clears the flag once it has run,
   *  so calling it every frame while the avatar walks simply restores per-frame behaviour for that stretch. */
  invalidateShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }
  setShadows(on: boolean): void {
    this.renderer.shadowMap.enabled = on;
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
  render(): void {
    this.renderer.info.reset();
    this.controls.update();
    this.constrain?.(); // camera-mode bounds get the last word on where the camera may be
    this.target.copy(this.controls.target); // panning moves the focus; GUI zoom/pitch then respect it
    this.updateShadowFrame();
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
