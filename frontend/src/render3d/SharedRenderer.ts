import * as THREE from "three";

// ---------------------------------------------------------------------------
// Phase C — single shared WebGL context for ALL live-3D character canvases.
//
// Browsers cap simultaneous WebGL contexts (~8-16 depending on browser/GPU),
// so every `CharacterCanvas` must NOT allocate its own `THREE.WebGLRenderer`.
// Instead they all share the one renderer created here (module-level
// singleton, lazily constructed on first use since it needs a real
// offscreen `<canvas>` + WebGL context, which don't exist in non-DOM/test
// environments) and render into its internal canvas, then blit the result
// into their own 2D-context `<canvas>` element via `drawImage`. This is the
// standard three.js "one renderer, many logical views" pattern.
//
// Callers are expected to invoke `renderToCanvas` sequentially (once per
// character per animation frame) — safe because JS is single-threaded, so
// there's no risk of two renders stomping the shared framebuffer
// concurrently, only ever one-after-another.
// ---------------------------------------------------------------------------

let sharedRenderer: THREE.WebGLRenderer | null = null;
// Current size of the shared WebGL surface. Quality pass 2026-08-29: the
// surface is GROW-ONLY — several CharacterCanvas instances of different sizes
// (bon 210x298, alex 160x276, micah 172x276, and now DPR-scaled variants)
// render through this one renderer every frame, so re-sizing to each caller's
// exact size used to reallocate the framebuffer on EVERY render call. Now the
// surface only grows to the largest size ever requested and each render is
// drawn into a viewport/scissor sub-rectangle, copied out with a source-rect
// drawImage.
let surfaceWidth = 0;
let surfaceHeight = 0;

function getRenderer(): THREE.WebGLRenderer {
  if (!sharedRenderer) {
    const offscreenCanvas = document.createElement("canvas");
    sharedRenderer = new THREE.WebGLRenderer({
      canvas: offscreenCanvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true, // required so drawImage() can read back the frame
    });
    sharedRenderer.setClearColor(0x000000, 0);
    // Calibrated color management (see threejs-calibration/calibration.html) —
    // ACES desaturates this model's baked warm skin tones too much, plain
    // linear + emissiveIntensity on the materials is the real brightness
    // control (see CharacterCanvas.tsx).
    sharedRenderer.outputColorSpace = THREE.SRGBColorSpace;
    sharedRenderer.toneMapping = THREE.NoToneMapping;
    sharedRenderer.toneMappingExposure = 1;
    // CharacterCanvas passes explicit device-pixel sizes (renderScale.ts);
    // the renderer must not apply its own DPR on top.
    sharedRenderer.setPixelRatio(1);
    sharedRenderer.setScissorTest(true);
  }
  return sharedRenderer;
}

// Grow-only surface sizing helper (pure; unit-tested). Returns the surface
// size that fits both the current surface and the requested render size.
export function growSurface(
  current: { width: number; height: number },
  requestedWidth: number,
  requestedHeight: number,
): { width: number; height: number; grew: boolean } {
  const width = Math.max(current.width, requestedWidth);
  const height = Math.max(current.height, requestedHeight);
  return { width, height, grew: width !== current.width || height !== current.height };
}

// Largest anisotropic-filtering level the GPU supports, capped (quality pass
// 2026-08-29): 8 already removes the seam/sparkle at the grazing angles the
// 35deg office camera produces; 16 costs bandwidth for no visible gain here.
export const MAX_ANISOTROPY_CAP = 8;
export function getMaxAnisotropy(): number {
  try {
    return Math.max(1, Math.min(MAX_ANISOTROPY_CAP, getRenderer().capabilities.getMaxAnisotropy()));
  } catch {
    return 1;
  }
}

/**
 * Renders `scene`/`camera` at `width`x`height` using the single shared WebGL
 * context, then copies the result into `targetCanvas` (a plain 2D-context
 * canvas owned by the calling `CharacterCanvas`). Resizes the shared
 * renderer's internal canvas only when the requested size actually changes,
 * to avoid reallocating the WebGL framebuffer on every frame.
 */
export function renderToCanvas(
  scene: THREE.Scene,
  camera: THREE.Camera,
  targetCanvas: HTMLCanvasElement,
  width: number,
  height: number,
): void {
  const renderer = getRenderer();
  // Grow-only surface (see surfaceWidth/Height): the frame is rendered into
  // the bottom-left width x height viewport and copied out below.
  const grown = growSurface({ width: surfaceWidth, height: surfaceHeight }, width, height);
  if (grown.grew) {
    renderer.setSize(grown.width, grown.height, false);
    surfaceWidth = grown.width;
    surfaceHeight = grown.height;
  }
  renderer.setViewport(0, 0, width, height);
  renderer.setScissor(0, 0, width, height);
  renderer.render(scene, camera);

  const ctx = targetCanvas.getContext("2d");
  if (!ctx) return;
  if (targetCanvas.width !== width || targetCanvas.height !== height) {
    targetCanvas.width = width;
    targetCanvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  // GL viewport origin is bottom-left; in canvas-element pixel space that
  // region sits at (0, surfaceHeight - height).
  ctx.drawImage(renderer.domElement, 0, surfaceHeight - height, width, height, 0, 0, width, height);
}

/**
 * The shared renderer's own offscreen `<canvas>` element (the one actually
 * holding the WebGL context) — exposed ONLY so callers (CharacterCanvas)
 * can attach a `webglcontextlost` listener to detect a lost context and
 * fall back to the 2D sprite. Lazily constructs the renderer (same as
 * `renderToCanvas`) if it doesn't exist yet, since a losable context has to
 * exist first.
 */
export function getSharedCanvasElement(): HTMLCanvasElement {
  return getRenderer().domElement;
}

/**
 * The shared `THREE.WebGLRenderer` instance itself — exposed ONLY for
 * `glbCache.ts`'s `KTX2Loader.detectSupport(renderer)` call, which needs a
 * real renderer (not just its canvas) to query which GPU texture formats
 * are supported before picking a Basis transcode target. Lazily constructs
 * the renderer (same as `renderToCanvas`) if it doesn't exist yet — callers
 * in non-DOM/test environments must wrap this in a try/catch, same as
 * `getSharedCanvasElement()`.
 */
export function getSharedRenderer(): THREE.WebGLRenderer {
  return getRenderer();
}

// Test/dev-only escape hatch: lets tests reset the singleton between runs
// instead of leaking a WebGL context across test files.
export function __resetSharedRendererForTests(): void {
  sharedRenderer?.dispose();
  sharedRenderer = null;
  surfaceWidth = 0;
  surfaceHeight = 0;
}
