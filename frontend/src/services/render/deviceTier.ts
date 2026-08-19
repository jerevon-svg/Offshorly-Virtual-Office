// Phase B — device capability tiering (measurement-only).
//
// This module is PURE: it never reads `navigator`/`window` itself inside
// `computeDeviceTier`. Real signal collection happens in `collectDeviceSignals`
// (which does the actual global reads and WebGL probing), and is injected into
// the pure function. This split is what makes `computeDeviceTier` unit-testable
// with mock signals, with no jsdom/WebGL stubbing required.
//
// Tiers:
//   T0 — no live-3D. Mobile/tablet, no working WebGL context (neither
//        WebGL2 nor a WebGL1 fallback), software renderer, or weak CPU/RAM.
//        Fail-safe default for anything ambiguous or erroring.
//   T1 — capable-but-modest desktop/laptop (e.g. integrated GPU, or a browser
//        that doesn't expose `deviceMemory`). Launches at 0 live-3D cap
//        (see tierBudgets.ts) until field data justifies promotion.
//   T2 — strong desktop signals (>=8 cores, >=8GB RAM when both are readable).
//        Only reachable from static signals as "T2-eligible"; an optional
//        microbench result (see deviceTierBenchmark.ts) can promote a
//        T1-eligible result to T2, or confirm a T2-eligible one. We never
//        auto-promote to T2 without at least the static signal thresholds.

export type DeviceTier = "T0" | "T1" | "T2";

/**
 * Raw signals `computeDeviceTier` reasons over. All fields are optional /
 * nullable because real browsers may not expose them (deviceMemory), and
 * because tests inject only the subset relevant to the case under test.
 */
export interface DeviceCapabilitySignals {
  /** navigator.userAgent */
  userAgent: string;
  /** navigator.hardwareConcurrency (logical cores) */
  hardwareConcurrency: number | undefined;
  /** navigator.deviceMemory in GB — Chrome/Edge only, undefined elsewhere */
  deviceMemory: number | undefined;
  /** navigator.maxTouchPoints */
  maxTouchPoints: number;
  /** window.innerWidth (CSS px) */
  viewportWidth: number;
  /** Whether a WebGL2 context could be created at all */
  hasWebGL2: boolean;
  /**
   * Whether a plain WebGL1 context (`webgl` / `experimental-webgl`) could be
   * created, as a fallback probe when WebGL2 creation fails. three.js's
   * `WebGLRenderer` (see SharedRenderer.ts) doesn't require WebGL2
   * specifically — it uses WebGL2 when available and falls back to WebGL1
   * transparently — so a WebGL1-only device is still capable of live-3D and
   * should NOT be hard-capped at T0 just because WebGL2 is unavailable.
   * Undefined/unset only in mocked test signals that don't care about this
   * fallback path; real signals always populate this.
   */
  hasWebGL1?: boolean;
  /**
   * UNMASKED_RENDERER_WEBGL string via WEBGL_debug_renderer_info, when the
   * extension is available and unblocked. `null` means the string could not
   * be read (extension missing/blocked); this is NOT treated as a software
   * renderer — it's just an unknown one. Read from whichever context
   * (WebGL2, or the WebGL1 fallback) actually succeeded, so the software-
   * renderer blocklist below (Rule 3) still catches a software-rendered
   * WebGL1 context exactly the same way it catches WebGL2.
   */
  unmaskedRenderer: string | null;
  /**
   * Optional pre-computed microbenchmark result (median ms/frame over a
   * short offscreen render). Supplied by the caller after running
   * `runDeviceTierMicrobench` — this function never runs it itself, since
   * that would make tiering async and could block early telemetry. See
   * deviceTierBenchmark.ts for how this is produced.
   */
  microbenchMs?: number;
}

const MOBILE_UA_RE = /Mobi|Android|iPhone|iPad|iPod|Tablet/i;

const SOFTWARE_RENDERER_RES = [
  /SwiftShader/i,
  /llvmpipe/i,
  /Software/i,
  /Microsoft Basic Render/i,
  /ANGLE\s*\(.*Software.*\)/i,
];

const WEAK_INTEGRATED_GPU_RES = [/Intel HD/i, /Intel\(R\) UHD/i, /Iris/i];

/** Narrow-viewport threshold (CSS px) used alongside touch/UA mobile checks. */
const NARROW_VIEWPORT_PX = 900;

/** Microbench promotion threshold: median ms/frame below this = fast enough for T2. */
export const MICROBENCH_T2_THRESHOLD_MS = 8;

function isMobileLike(signals: DeviceCapabilitySignals): boolean {
  if (MOBILE_UA_RE.test(signals.userAgent)) return true;
  if (signals.maxTouchPoints > 0 && signals.viewportWidth < NARROW_VIEWPORT_PX) return true;
  return false;
}

function isSoftwareRenderer(renderer: string | null): boolean {
  if (!renderer) return false;
  return SOFTWARE_RENDERER_RES.some((re) => re.test(renderer));
}

function isWeakIntegratedGpu(renderer: string | null): boolean {
  if (!renderer) return false;
  return WEAK_INTEGRATED_GPU_RES.some((re) => re.test(renderer));
}

/**
 * Pure tiering decision from a fully-populated (or partially-mocked) signal
 * set. Never throws — any error thrown by a caller-supplied getter should be
 * caught by `collectDeviceSignals`, not here; this function assumes signals
 * are already resolved and just reasons over them, failing safe to T0 for
 * anything unrecognized.
 */
export function computeDeviceTier(signals: DeviceCapabilitySignals): DeviceTier {
  try {
    // Rule 1: mobile is hard-capped at T0, unconditionally, regardless of
    // any GPU string — thermal/battery risk can't be measured from JS.
    if (isMobileLike(signals)) return "T0";

    // Rule 2: no working WebGL context at all (neither WebGL2 nor a WebGL1
    // fallback) => T0. WebGL2 is preferred when available, but three.js's
    // WebGLRenderer falls back to WebGL1 transparently, so WebGL1-only
    // devices are still live-3D-capable and must not be forced to T0 here.
    if (!signals.hasWebGL2 && !signals.hasWebGL1) return "T0";

    // Rule 3: known software-renderer strings => T0.
    if (isSoftwareRenderer(signals.unmaskedRenderer)) return "T0";

    // Rule 4: weak CPU, or weak RAM when RAM is readable => T0.
    const cores = signals.hardwareConcurrency;
    if (cores === undefined || cores < 4) return "T0";
    const memory = signals.deviceMemory;
    if (memory !== undefined && memory < 4) return "T0";

    // From here on we have a real WebGL2 context, non-software renderer,
    // >=4 cores, and (if known) >=4GB RAM.

    if (isWeakIntegratedGpu(signals.unmaskedRenderer)) return "T1";

    // Safari/Firefox don't expose deviceMemory — never auto-promote to T2
    // without that signal, cap at T1.
    if (memory === undefined) return "T1";

    const t2Eligible = cores >= 8 && memory >= 8;
    if (!t2Eligible) return "T1";

    // T2-eligible on static signals. If a microbench result is present,
    // let it confirm/demote; a fast result confirms T2, a slow one
    // demotes to T1 despite otherwise-strong static signals.
    if (signals.microbenchMs !== undefined) {
      return signals.microbenchMs < MICROBENCH_T2_THRESHOLD_MS ? "T2" : "T1";
    }

    return "T2";
  } catch {
    // Fail safe, never fail open to a higher tier.
    return "T0";
  }
}

/**
 * Reads real browser/DOM globals to build a `DeviceCapabilitySignals`. This
 * is the only place in the module that touches `navigator`/`window`/WebGL —
 * kept separate from `computeDeviceTier` so tests never need to stub globals.
 * Any individual signal read that throws is swallowed and treated as
 * "unknown", which `computeDeviceTier` then resolves conservatively (fail
 * safe to T0 for the signals rules 2-4 depend on).
 */
export function collectDeviceSignals(): DeviceCapabilitySignals {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const win = typeof window !== "undefined" ? window : undefined;

  let hasWebGL2 = false;
  let hasWebGL1 = false;
  let unmaskedRenderer: string | null = null;

  function readUnmaskedRenderer(gl: WebGL2RenderingContext | WebGLRenderingContext): string | null {
    try {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (!ext) return null;
      const raw = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      return typeof raw === "string" ? raw : null;
    } catch {
      return null;
    }
  }

  try {
    const canvas = document.createElement("canvas");
    const gl2 = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (gl2) {
      hasWebGL2 = true;
      unmaskedRenderer = readUnmaskedRenderer(gl2);
    }
  } catch {
    hasWebGL2 = false;
  }

  // WebGL1 fallback probe: only matters when WebGL2 creation failed, but we
  // still run the software-renderer string read the same way as the WebGL2
  // path above, so Rule 3 (software renderer => T0) applies identically to
  // a WebGL1-only context (e.g. SwiftShader/llvmpipe exposed only via
  // 'webgl') and doesn't accidentally slip through as "supported".
  if (!hasWebGL2) {
    try {
      const canvas = document.createElement("canvas");
      const gl1 = (canvas.getContext("webgl") ??
        canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
      if (gl1) {
        hasWebGL1 = true;
        unmaskedRenderer = readUnmaskedRenderer(gl1);
      }
    } catch {
      hasWebGL1 = false;
    }
  }

  return {
    userAgent: nav?.userAgent ?? "",
    hardwareConcurrency: nav?.hardwareConcurrency,
    // deviceMemory is a Chrome/Edge-only, non-standard Navigator extension.
    deviceMemory: (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory,
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    viewportWidth: win?.innerWidth ?? 0,
    hasWebGL2,
    hasWebGL1,
    unmaskedRenderer,
  };
}

/**
 * Convenience entry point: collects real signals (unless overridden) and
 * computes the tier. `overrides` lets a caller (or a test that DOES want to
 * exercise the real-global path partially) patch individual signals without
 * mocking every global.
 */
export function detectDeviceTier(overrides?: Partial<DeviceCapabilitySignals>): DeviceTier {
  const base = collectDeviceSignals();
  const signals: DeviceCapabilitySignals = { ...base, ...overrides };
  return computeDeviceTier(signals);
}
