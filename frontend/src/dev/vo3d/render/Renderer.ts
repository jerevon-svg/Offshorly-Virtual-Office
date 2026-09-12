// vo3d render — ONE WebGLRenderer, ONE Scene, ONE orthographic camera, lights and environment.
// Promoted from designRoom3d/main.ts. SSAO is available but OFF by default (measured too costly at DPR 2).
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
export const DEFAULT_LIGHT: LightParams = { azimuth: -48, elevation: 62, keyIntensity: 2.3, ambientIntensity: 1.25, envIntensity: 0.45, exposure: 1.12 };

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  readonly controls: OrbitControls;
  readonly key: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly composer: EffectComposer;
  private readonly ssao: SSAOPass;
  /** the world-space focus rect (a room today; the whole office later) */
  focus: Rect;
  readonly target = new THREE.Vector3();
  camParams: CameraParams = { ...DEFAULT_CAMERA };
  lightParams: LightParams = { ...DEFAULT_LIGHT };
  ssaoEnabled = false;
  private readonly CAM_DIST = 1500;
  private readonly lightDir = new THREE.Vector3(0, 1, 0);
  private shadowKey = "";

  constructor(canvas: HTMLCanvasElement, focus: Rect) {
    this.focus = focus;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.6;
    this.key.shadow.radius = 4;
    const fill = new THREE.DirectionalLight(0xe4ecff, 0.35);
    this.scene.add(this.hemi, this.key, this.key.target, fill);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.minZoom = 0.12; // whole ground floor (1440 × 1244) fits at the default frustum
    this.controls.maxZoom = 6;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ssao = new SSAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
    this.ssao.kernelRadius = 14;
    this.ssao.minDistance = 0.0005;
    this.ssao.maxDistance = 0.08;
    this.composer.addPass(this.ssao);
    this.composer.addPass(new OutputPass());
    this.setFocus(focus);
    fill.position.set(focus.x + focus.w, 300, focus.z + focus.d * 1.6);
    this.placeLight();
    this.resize();
    window.addEventListener("resize", () => this.resize());
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
    this.camera.position.copy(this.target).addScaledVector(dir, this.CAM_DIST);
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
  placeLight(): void {
    const l = this.lightParams;
    const az = THREE.MathUtils.degToRad(l.azimuth), el = THREE.MathUtils.degToRad(l.elevation);
    this.lightDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    this.key.intensity = l.keyIntensity;
    this.hemi.intensity = l.ambientIntensity;
    this.scene.environmentIntensity = l.envIntensity;
    this.renderer.toneMappingExposure = l.exposure;
    this.updateShadowFrame(true);
  }
  /** The shadow frustum follows what is being looked at: centred on the orbit target, sized to the visible
   *  height (clamped). Keeps Design-Room-scale shadow resolution while zoomed in on a 1440-unit floor. */
  private updateShadowFrame(force = false): void {
    const halfVisible = this.camera.top / Math.max(this.camera.zoom, 1e-6);
    const s = Math.round(THREE.MathUtils.clamp(halfVisible * 1.7, 180, 760));
    const t: Vec2 = { x: Math.round(this.target.x / 8) * 8, z: Math.round(this.target.z / 8) * 8 };
    const key = `${s}:${t.x}:${t.z}`;
    if (!force && key === this.shadowKey) return;
    this.shadowKey = key;
    this.key.target.position.set(t.x, 0, t.z);
    this.key.position.copy(this.key.target.position).addScaledVector(this.lightDir, 800);
    const sc = this.key.shadow.camera;
    sc.left = -s; sc.right = s; sc.top = s; sc.bottom = -s;
    sc.updateProjectionMatrix();
    this.key.shadow.needsUpdate = true;
  }
  setShadows(on: boolean): void {
    this.renderer.shadowMap.enabled = on;
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
  }
  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.ssao.setSize(window.innerWidth, window.innerHeight);
    this.placeCamera();
  }
  render(): void {
    this.renderer.info.reset();
    this.controls.update();
    this.target.copy(this.controls.target); // panning moves the focus; GUI zoom/pitch then respect it
    this.updateShadowFrame();
    if (this.ssaoEnabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
