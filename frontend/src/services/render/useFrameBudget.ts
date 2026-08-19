// Phase B — runtime FPS watchdog skeleton. This phase does not evict or
// control any 3D characters (there are none yet); it only builds the
// FPS-tracking mechanism itself, correctly, as a reusable hook with a clear
// extension point (`onSustainedLowFps`) for Phase D to hook into once
// live-3D characters exist to actually evict/downgrade.
//
// Not wired into any rendering path in this phase — either left unused, or
// (see telemetry.ts) mounted purely to log periodic FPS samples.

import { useCallback, useEffect, useRef, useState } from "react";

/** EMA smoothing factor — higher = more weight on recent frames. */
const EMA_ALPHA = 0.1;

/** How long low FPS must persist before `onSustainedLowFps` fires. */
const SUSTAINED_LOW_FPS_MS = 3000;

export interface UseFrameBudgetOptions {
  /** FPS below which a frame counts as "low". Default 30. */
  lowFpsThreshold?: number;
  /**
   * Called at most once per sustained-low-FPS episode, when estimated FPS
   * has stayed below `lowFpsThreshold` continuously for
   * `SUSTAINED_LOW_FPS_MS`. Phase D's extension point — this phase has no
   * consumer for it.
   */
  onSustainedLowFps?: (fps: number) => void;
  /** Whether the watchdog should be running. Default true. */
  enabled?: boolean;
}

export interface UseFrameBudgetResult {
  /** Current EMA-smoothed estimated FPS. */
  fps: number;
  /** True while FPS has been continuously below threshold for >= 3s. */
  isSustainedLowFps: boolean;
}

/**
 * Tracks a rolling FPS EMA via requestAnimationFrame timestamps. Purely a
 * measurement mechanism in Phase B — no 3D content exists yet for it to
 * gate, so it's safe to mount anywhere (or not mount it at all) without any
 * visible/behavioral effect.
 */
export function useFrameBudget(options: UseFrameBudgetOptions = {}): UseFrameBudgetResult {
  const { lowFpsThreshold = 30, onSustainedLowFps, enabled = true } = options;

  const [fps, setFps] = useState(60);
  const [isSustainedLowFps, setIsSustainedLowFps] = useState(false);

  const lastTimeRef = useRef<number | null>(null);
  const emaFpsRef = useRef(60);
  const lowFpsSinceRef = useRef<number | null>(null);
  const hasFiredRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const onSustainedLowFpsRef = useRef(onSustainedLowFps);
  onSustainedLowFpsRef.current = onSustainedLowFps;

  const tick = useCallback(
    (time: number) => {
      const last = lastTimeRef.current;
      lastTimeRef.current = time;

      if (last !== null) {
        const deltaMs = time - last;
        if (deltaMs > 0) {
          const instantFps = 1000 / deltaMs;
          emaFpsRef.current = emaFpsRef.current + EMA_ALPHA * (instantFps - emaFpsRef.current);
          setFps(emaFpsRef.current);

          if (emaFpsRef.current < lowFpsThreshold) {
            if (lowFpsSinceRef.current === null) {
              lowFpsSinceRef.current = time;
            } else if (
              !hasFiredRef.current &&
              time - lowFpsSinceRef.current >= SUSTAINED_LOW_FPS_MS
            ) {
              hasFiredRef.current = true;
              setIsSustainedLowFps(true);
              onSustainedLowFpsRef.current?.(emaFpsRef.current);
            }
          } else {
            lowFpsSinceRef.current = null;
            hasFiredRef.current = false;
            setIsSustainedLowFps(false);
          }
        }
      }

      rafIdRef.current = requestAnimationFrame(tick);
    },
    [lowFpsThreshold],
  );

  useEffect(() => {
    if (!enabled) return;

    rafIdRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      lastTimeRef.current = null;
      lowFpsSinceRef.current = null;
      hasFiredRef.current = false;
    };
  }, [enabled, tick]);

  return { fps, isSustainedLowFps };
}
