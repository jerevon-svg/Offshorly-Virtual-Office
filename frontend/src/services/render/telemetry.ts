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

import {
  collectDeviceSignals,
  detectDeviceTier,
  hasWorkingWebGl,
  isMobileLike,
  isSoftwareRendererSignal,
  type DeviceTier,
} from "./deviceTier";
import { getSharedDeviceTierMicrobench } from "./deviceTierBenchmark";
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
  let signals: ReturnType<typeof collectDeviceSignals> | undefined;
  try {
    signals = collectDeviceSignals();
    staticTier = detectDeviceTier(signals);
  } catch {
    staticTier = "T0";
  }

  // eslint-disable-next-line no-console
  console.info(`${LOG_PREFIX} static tier: ${staticTier}`);
  // Log the raw signals too — the tier alone doesn't say WHICH rule fired
  // (mobile UA, no WebGL context, software renderer, weak cores/RAM, weak
  // integrated GPU), which is exactly what's needed to tell a genuine
  // hardware limitation apart from an overly-conservative read on capable
  // hardware. Wrapped in try/catch since collectDeviceSignals itself is
  // defensive but this is a diagnostic nice-to-have, never worth a throw.
  try {
    // eslint-disable-next-line no-console
    console.info(`${LOG_PREFIX} raw signals`, signals ?? collectDeviceSignals());
  } catch {
    // ignore — diagnostic only
  }

  // Microbench matters for: T1/T2 (confirm/promote to T2, existing path),
  // AND now also a weak-static T0 device that still has working WebGL and
  // isn't a software renderer (the rescue-to-T1 path, see deviceTier.ts's
  // MICROBENCH_T1_RESCUE_MS) — logged here the same way so the rescue
  // attempt is diagnosable exactly like a T1->T2 promotion attempt already
  // is. Mobile/no-WebGL/software-renderer devices never benefit from the
  // microbench (per D-C/D-E in the approved plan) so it's skipped for them
  // even when staticTier is T0 for one of those reasons.
  const isRescueCandidate =
    staticTier === "T0" &&
    !!signals &&
    !isMobileLike(signals) &&
    hasWorkingWebGl(signals) &&
    !isSoftwareRendererSignal(signals);

  if (staticTier === "T1" || staticTier === "T2" || isRescueCandidate) {
    // Shared with OfficeStage.tsx's own microbench-rescue trigger (see
    // deviceTierBenchmark.ts's getSharedDeviceTierMicrobench doc comment) —
    // whichever of the two call sites runs first actually starts the
    // bench; this always gets the same settled result, never a second
    // independent run.
    void getSharedDeviceTierMicrobench()
      .then((result) => {
        const finalTier = detectDeviceTier({
          ...signals,
          microbenchMs: result.medianFrameMs,
        });
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
