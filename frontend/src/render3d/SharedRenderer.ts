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
let lastWidth = 0;
let lastHeight = 0;

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
  }
  return sharedRenderer;
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
  if (width !== lastWidth || height !== lastHeight) {
    renderer.setSize(width, height, false);
    lastWidth = width;
    lastHeight = height;
  }
  renderer.render(scene, camera);

  const ctx = targetCanvas.getContext("2d");
  if (!ctx) return;
  if (targetCanvas.width !== width || targetCanvas.height !== height) {
    targetCanvas.width = width;
    targetCanvas.height = height;
  }
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(renderer.domElement, 0, 0, width, height);
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

// Test/dev-only escape hatch: lets tests reset the singleton between runs
// instead of leaking a WebGL context across test files.
export function __resetSharedRendererForTests(): void {
  sharedRenderer?.dispose();
  sharedRenderer = null;
  lastWidth = 0;
  lastHeight = 0;
}
