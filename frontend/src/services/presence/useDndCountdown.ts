import { useEffect, useState } from "react";
import { endDnd, useSelfStatus } from "./selfStatusStore";

// Poll cadence for the DND countdown — same cadence as useStatusOvertime.ts's POLL_INTERVAL_MS,
// cheap Date.now() diff, no need for anything tighter (feature spec: "do not continuously
// broadcast countdown ticks if unnecessary" — this is a purely local re-render, not a
// broadcast, but the same conservative cadence keeps it consistent with the rest of the app).
const POLL_INTERVAL_MS = 15_000;

/** Polls the local self-status store while manualStatus === "DND" and derives remaining time
 * from the stored expiry timestamp (never a server-pushed tick). The moment remaining time hits
 * zero, calls endDnd() itself — this is the ONE place DND auto-expiry actually fires; the
 * resulting manualStatus/currentStatus change then flows through OfficeMap.tsx's existing
 * prevSelfOfficeStatusRef effect to broadcast dnd_set(false) and unlock any protected room,
 * exactly as a manual cancellation would. Returns null whenever DND isn't active. */
export function useDndRemainingMs(): number | null {
  const { manualStatus, dndExpiresAt } = useSelfStatus();
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (manualStatus !== "DND" || dndExpiresAt === null) {
      setRemainingMs(null);
      return;
    }

    function check() {
      const remaining = (dndExpiresAt as number) - Date.now();
      if (remaining <= 0) {
        endDnd();
        return;
      }
      setRemainingMs(remaining);
    }

    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [manualStatus, dndExpiresAt]);

  return remainingMs;
}
