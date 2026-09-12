// vo3d devtools — promoted verbatim from designRoom3d/bench.ts (statistics + overlay). Never imported by world/nav/interact.
// Design Room true-3D POC — lightweight GPU benchmark instrumentation.
// Pure sampling/statistics helpers (unit-tested) plus a tiny DOM overlay.
// Measurement only: nothing here changes what is rendered.
import type * as THREE from "three";

export type FrameSample = { dt: number; calls: number; triangles: number };

export type CaptureSummary = {
  seconds: number;
  frames: number;
  avgFps: number;
  avgFrameMs: number;
  medianFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  worstFrameMs: number;
  onePercentLowFps: number;
  avgDrawCalls: number;
  avgTriangles: number;
};

export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

export function summarize(samples: readonly FrameSample[], seconds: number): CaptureSummary {
  const n = samples.length;
  if (n === 0) {
    return { seconds, frames: 0, avgFps: 0, avgFrameMs: 0, medianFrameMs: 0, p95FrameMs: 0, p99FrameMs: 0, worstFrameMs: 0, onePercentLowFps: 0, avgDrawCalls: 0, avgTriangles: 0 };
  }
  const dts = samples.map((s) => s.dt).sort((a, b) => a - b);
  const total = dts.reduce((a, b) => a + b, 0);
  const p99 = percentile(dts, 99);
  return {
    seconds,
    frames: n,
    avgFps: round(n / (total / 1000), 1),
    avgFrameMs: round(total / n, 2),
    medianFrameMs: round(percentile(dts, 50), 2),
    p95FrameMs: round(percentile(dts, 95), 2),
    p99FrameMs: round(p99, 2),
    worstFrameMs: round(dts[n - 1], 2),
    onePercentLowFps: round(p99 > 0 ? 1000 / p99 : 0, 1),
    avgDrawCalls: Math.round(samples.reduce((a, s) => a + s.calls, 0) / n),
    avgTriangles: Math.round(samples.reduce((a, s) => a + s.triangles, 0) / n),
  };
}

function round(v: number, d: number): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

/** Rolling window of recent frames for the live overlay. */
export class FrameWindow {
  private samples: FrameSample[] = [];
  private readonly maxMs: number;
  constructor(maxMs = 3000) {
    this.maxMs = maxMs;
  }
  push(s: FrameSample): void {
    this.samples.push(s);
    let total = this.samples.reduce((a, x) => a + x.dt, 0);
    while (total > this.maxMs && this.samples.length > 2) {
      total -= this.samples[0].dt;
      this.samples.shift();
    }
  }
  summary(): CaptureSummary {
    return summarize(this.samples, this.maxMs / 1000);
  }
}

/** Timed capture: collects frames until `seconds` elapsed, then resolves a summary. */
export class Capture {
  private samples: FrameSample[] = [];
  private elapsed = 0;
  private resolve: ((s: CaptureSummary) => void) | null = null;
  readonly done: Promise<CaptureSummary>;
  readonly seconds: number;
  constructor(seconds: number) {
    this.seconds = seconds;
    this.done = new Promise((r) => (this.resolve = r));
  }
  get running(): boolean {
    return this.resolve !== null;
  }
  push(s: FrameSample): void {
    if (!this.resolve) return;
    this.samples.push(s);
    this.elapsed += s.dt;
    if (this.elapsed >= this.seconds * 1000) {
      const r = this.resolve;
      this.resolve = null;
      r(summarize(this.samples, this.seconds));
    }
  }
}

export type PresetId = "A" | "B" | "C" | "D";
export type Preset = { id: PresetId; label: string; shadows: boolean; ao: boolean; sway: boolean };
export const PRESETS: readonly Preset[] = [
  { id: "A", label: "A · full (shadows + SSAO + sway)", shadows: true, ao: true, sway: true },
  { id: "B", label: "B · SSAO off", shadows: true, ao: false, sway: true },
  { id: "C", label: "C · SSAO off + shadows off", shadows: false, ao: false, sway: true },
  { id: "D", label: "D · SSAO off + sway off", shadows: true, ao: false, sway: false },
];

export type DeviceInfo = {
  userAgent: string;
  gpuVendor: string;
  gpuRenderer: string;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
  devicePixelRatio: number;
};

export function describeDevice(renderer: THREE.WebGLRenderer): DeviceInfo {
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: navigator.userAgent,
    gpuVendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
    gpuRenderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: nav.deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
  };
}

export type RendererSnapshot = {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  drawingBuffer: string;
  cssSize: string;
  pixelRatio: number;
  jsHeapMb: number | null;
};

export function snapshotRenderer(renderer: THREE.WebGLRenderer): RendererSnapshot {
  const gl = renderer.getContext();
  const c = renderer.domElement;
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  return {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    drawingBuffer: `${gl.drawingBufferWidth}×${gl.drawingBufferHeight}`,
    cssSize: `${c.clientWidth}×${c.clientHeight}`,
    pixelRatio: renderer.getPixelRatio(),
    jsHeapMb: perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : null,
  };
}

export type SceneStats = { meshes: number; instancedMeshes: number; instances: number; triangles: number; geometries: number; materials: number; lights: number };
/** Static complexity of a scene graph (independent of culling): counts unique geometries/materials, triangles incl. instances. */
export function sceneStats(root: THREE.Object3D): SceneStats {
  const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
  let meshes = 0, instancedMeshes = 0, instances = 0, triangles = 0, lights = 0;
  root.traverse((o) => {
    if ((o as THREE.Light).isLight) lights++;
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    geos.add(m.geometry);
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm);
    const idx = m.geometry.getIndex();
    const tris = idx ? idx.count / 3 : (m.geometry.getAttribute("position")?.count ?? 0) / 3;
    const im = m as THREE.InstancedMesh;
    if (im.isInstancedMesh) { instancedMeshes++; instances += im.count; triangles += tris * im.count; }
    else triangles += tris;
  });
  return { meshes, instancedMeshes, instances, triangles: Math.round(triangles), geometries: geos.size, materials: mats.size, lights };
}

/** Minimal fixed overlay; updated by the page loop a few times per second. */
export class Overlay {
  readonly el: HTMLDivElement;
  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "bench-overlay";
    this.el.style.cssText =
      "position:fixed;left:12px;top:12px;z-index:10;padding:8px 10px;background:rgba(30,24,20,0.72);color:#f4ede4;font:11px/1.45 ui-monospace,Menlo,monospace;border-radius:8px;white-space:pre;pointer-events:none;min-width:260px";
    parent.appendChild(this.el);
  }
  set visible(v: boolean) {
    this.el.style.display = v ? "block" : "none";
  }
  update(live: CaptureSummary, snap: RendererSnapshot, dev: DeviceInfo, status: string): void {
    this.el.textContent = [
      `fps ${live.avgFps.toFixed(0).padStart(4)}   avg ${live.avgFrameMs.toFixed(1)} ms   p95 ${live.p95FrameMs.toFixed(1)} ms`,
      `1% low ${live.onePercentLowFps.toFixed(0)} fps   worst ${live.worstFrameMs.toFixed(1)} ms`,
      `draw calls ${snap.calls}   tris ${snap.triangles.toLocaleString()}`,
      `geometries ${snap.geometries}   textures ${snap.textures}   programs ${snap.programs}`,
      `dpr ${dev.devicePixelRatio} (render ${snap.pixelRatio})   buffer ${snap.drawingBuffer}   css ${snap.cssSize}`,
      `js heap ${snap.jsHeapMb === null ? "n/a" : snap.jsHeapMb + " MB"}`,
      `gpu ${snap.jsHeapMb === null ? "" : ""}${dev.gpuRenderer.slice(0, 60)}`,
      status,
    ].join("\n");
  }
}
