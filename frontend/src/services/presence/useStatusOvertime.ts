import { useCallback, useEffect, useRef, useState } from "react";
import { getStatusTimeLimitMs, type OfficeStatus } from "./status";
import { useSelfStatus } from "./selfStatusStore";

// Poll cadence for the overtime check. Cheap Date.now() diff — no need for
// anything tighter than this per the confirmed spec.
const POLL_INTERVAL_MS = 15_000;

// After "Keep going", suppress the popup for this long before it can
// re-surface (still gated on still being over the limit at re-check time).
const SNOOZE_MS = 5 * 60_000;

export interface StatusOvertime {
  status: OfficeStatus;
  overMs: number;
}

export interface UseStatusOvertimeResult {
  overtime: StatusOvertime | null;
  dismiss: () => void;
}

// Polls the local self-status store for BREAK/LUNCH statuses that have run
// past their configured time limit (see STATUS_TIME_LIMITS_MS in status.ts)
// and surfaces an overtime nudge. Fully independent from the auto-walk
// manualStatus-transition effect in OfficeMap.tsx — no shared state, no
// coupling. Keys ONLY on manualStatus (never currentStatus/resolveCurrentStatus)
// so a DND/Away/InCall overlay never disturbs the overtime clock.
export function useStatusOvertime(): UseStatusOvertimeResult {
  const { manualStatus, manualStatusSince } = useSelfStatus();
  const [overtime, setOvertime] = useState<StatusOvertime | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snoozeUntilRef = useRef<number>(0);

  useEffect(() => {
    function clearTimer() {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    const limit = getStatusTimeLimitMs(manualStatus);
    if (limit === undefined) {
      // Not a bounded status (or moved away from one) — fully reset state,
      // no lingering overtime/snooze from a previous Break/Lunch stint.
      clearTimer();
      snoozeUntilRef.current = 0;
      setOvertime(null);
      return clearTimer;
    }

    function check() {
      const elapsed = Date.now() - manualStatusSince;
      const overMs = elapsed - (limit as number);
      if (overMs >= 0 && Date.now() >= snoozeUntilRef.current) {
        setOvertime({ status: manualStatus, overMs });
      } else if (Date.now() < snoozeUntilRef.current) {
        // Still snoozed — keep it hidden even if technically over.
        setOvertime(null);
      } else {
        // Not yet over the limit.
        setOvertime(null);
      }
    }

    // Check immediately on (re)arm, then on the poll cadence.
    check();
    intervalRef.current = setInterval(check, POLL_INTERVAL_MS);

    return clearTimer;
  }, [manualStatus, manualStatusSince]);

  const dismiss = useCallback(() => {
    snoozeUntilRef.current = Date.now() + SNOOZE_MS;
    setOvertime(null);
  }, []);

  return { overtime, dismiss };
}
