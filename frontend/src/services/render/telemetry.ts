// Phase B — telemetry bootstrap.
//
// This codebase has no existing analytics/telemetry/logging-endpoint
// mechanism (searched for an analytics service, console wrapper, backend
// logging endpoint — none found). Per the Phase B scope, this module does
// NOT build a new backend/analytics pipeline; it logs clearly-labeled
// `console.info`/`console.debug` lines as a placeholder sink. A real
// telemetry sink would need separate scoping/approval before this should
// call out to any backend.
//
// `initDeviceTierTelemetry()` is meant to be called ONCE, near app startup,
// from a non-blocking context (e.g. a `useEffect` with an empty dependency
// array in the app's root component) — it must never block first paint.
// It only measures and logs; it does not change rendering/UI/behavior.

import { detectDeviceTier, type DeviceTier } from "./deviceTier";
import { runDeviceTierMicrobench } from "./deviceTierBenchmark";
import { useFrameBudget } from "./useFrameBudget";

const LOG_PREFIX = "[device-tier]";

let hasInitialized = false;

/**
 * Runs static-signal tiering synchronously, logs it, then (only when the
 * static result is T2-eligible-but-unconfirmed, i.e. T1 or T2 from static
 * signals alone) runs the async microbench and logs a possibly-promoted
 * final tier. Safe to call multiple times — no-ops after the first call.
 */
export function initDeviceTierTelemetry(): void {
  if (hasInitialized) return;
  hasInitialized = true;

  let staticTier: DeviceTier;
  try {
    staticTier = detectDeviceTier();
  } catch {
    staticTier = "T0";
  }

  // eslint-disable-next-line no-console
  console.info(`${LOG_PREFIX} static tier: ${staticTier}`);

  // Microbench only matters for T1/T2 (T0 is hard-capped regardless of
  // benchmark result, so don't spend the cycles running it).
  if (staticTier === "T1" || staticTier === "T2") {
    void runDeviceTierMicrobench()
      .then((result) => {
        const finalTier = detectDeviceTier({ microbenchMs: result.medianFrameMs });
        // eslint-disable-next-line no-console
        console.debug(`${LOG_PREFIX} microbench`, {
          medianFrameMs: result.medianFrameMs,
          sampleCount: result.sampleCount,
          promoteToT2: result.promoteToT2,
          finalTier,
        });
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.debug(`${LOG_PREFIX} microbench failed`, err);
      });
  }
}

/**
 * Optional React hook: mounts the FPS watchdog purely to log periodic FPS
 * samples to the same placeholder sink. Not called anywhere in the app yet
 * in this phase — provided so a future call site (or Phase D) has a
 * ready-made "log FPS to telemetry" wiring without duplicating the
 * console-logging convention above.
 */
export function useFrameBudgetTelemetry(): void {
  useFrameBudget({
    onSustainedLowFps: (fps) => {
      // eslint-disable-next-line no-console
      console.debug(`${LOG_PREFIX} sustained low fps`, { fps });
    },
  });
}

/** Test-only: resets the module-level init guard between test cases. */
export function __resetDeviceTierTelemetryForTests(): void {
  hasInitialized = false;
}
