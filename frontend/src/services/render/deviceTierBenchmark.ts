// Phase B — optional microbenchmark used to promote a T1-eligible device to
// T2. This is intentionally isolated from `deviceTier.ts`'s pure logic:
// it's async, touches three.js + an offscreen canvas, and is meant to run
// AFTER first paint (never awaited during initial app render). Call it from
// an "after mount" effect, then feed `medianFrameMs` back into
// `computeDeviceTier`/`detectDeviceTier` via the `microbenchMs` signal.
//
// This does NOT render anything visible — it renders to a throwaway,
// never-attached canvas purely to time frame cost, and disposes everything
// when done. It has no relationship to Phase C's real character rendering.

import * as THREE from "three";
import { MICROBENCH_T2_THRESHOLD_MS } from "./deviceTier";

const BENCH_FRAME_COUNT = 30;
const BENCH_CANVAS_SIZE = 256;

export interface DeviceTierBenchmarkResult {
  /** Median frame time in ms across the sampled frames. */
  medianFrameMs: number;
  /** Whether the result is fast enough to promote a T1-eligible device to T2. */
  promoteToT2: boolean;
  /** Number of frames actually sampled (may be < requested if bench errors early). */
  sampleCount: number;
}

/**
 * Renders `BENCH_FRAME_COUNT` frames of a throwaway animated mesh to an
 * off-DOM canvas and returns the median per-frame render cost. Never throws:
 * on any failure (no WebGL, three.js error, etc.) it resolves with a
 * conservative (slow) result so callers never accidentally promote a device
 * that can't actually run the benchmark.
 *
 * Structured to be called from a non-blocking "after initial render" hook —
 * e.g. a `useEffect(() => { void runDeviceTierMicrobench().then(...) }, [])`
 * fired once near app startup, well after the office map has painted. It is
 * NOT wired into any such hook by this module itself — Phase B leaves that
 * call site to the app's telemetry bootstrap (see telemetry.ts).
 */
export async function runDeviceTierMicrobench(): Promise<DeviceTierBenchmarkResult> {
  const fallback: DeviceTierBenchmarkResult = {
    medianFrameMs: Number.POSITIVE_INFINITY,
    promoteToT2: false,
    sampleCount: 0,
  };

  try {
    const canvas = document.createElement("canvas");
    canvas.width = BENCH_CANVAS_SIZE;
    canvas.height = BENCH_CANVAS_SIZE;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    renderer.setSize(BENCH_CANVAS_SIZE, BENCH_CANVAS_SIZE, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
    camera.position.set(0, 0, 3);

    // Representative render cost: a moderately high-poly mesh with a
    // skeleton, rotated each frame — stands in for an animated character
    // without depending on any real character asset.
    const geometry = new THREE.SphereGeometry(1, 64, 64);
    const material = new THREE.MeshStandardMaterial({ color: 0x8888ff });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(1, 1, 1);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404040));

    const frameTimes: number[] = [];

    for (let i = 0; i < BENCH_FRAME_COUNT; i++) {
      mesh.rotation.y += 0.05;
      mesh.rotation.x += 0.03;

      const start = performance.now();
      renderer.render(scene, camera);
      const elapsed = performance.now() - start;
      frameTimes.push(elapsed);

      // Yield to the event loop between frames so this never monopolizes
      // the main thread in one synchronous burst.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    geometry.dispose();
    material.dispose();
    renderer.dispose();

    frameTimes.sort((a, b) => a - b);
    const medianFrameMs = frameTimes[Math.floor(frameTimes.length / 2)] ?? Number.POSITIVE_INFINITY;

    return {
      medianFrameMs,
      promoteToT2: medianFrameMs < MICROBENCH_T2_THRESHOLD_MS,
      sampleCount: frameTimes.length,
    };
  } catch {
    return fallback;
  }
}
