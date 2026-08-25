import { useEffect, useRef } from "react";
import { setAutoCondition } from "./selfStatusStore";

// 5 minutes of no mouse/keyboard/pointer activity -> Away. Reset on any
// activity or a visibilitychange back to visible.
const IDLE_THRESHOLD_MS = 5 * 60_000;

export interface UseAutoStatusDetectionParams {
  /** Whether the local viewer is currently in an active chat conversation
   *  (e.g. their layer id is in talkingIds) — drives the IN_CONVERSATION
   *  auto condition. */
  inConversation: boolean;
  /** Whether the local viewer has hard-disconnected (checked out) — drives
   *  the OFFLINE auto condition, which always wins over everything else. */
  offline: boolean;
}

// Mounted once in OfficeMap. Owns idle (Away) detection via DOM listeners +
// a debounce timer, and syncs the caller-computed inConversation/offline
// flags into the shared self-status store. inCall has no real
// call/WebRTC system in this repo yet — it stays a settable store flag
// nothing currently sets for self (forward-compatible), so it is not wired
// here.
export function useAutoStatusDetection({
  inConversation,
  offline,
}: UseAutoStatusDetectionParams): void {
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function clearIdleTimer() {
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    }

    function armIdleTimer() {
      clearIdleTimer();
      idleTimerRef.current = setTimeout(() => {
        setAutoCondition("away", true);
      }, IDLE_THRESHOLD_MS);
    }

    function markActive() {
      setAutoCondition("away", false);
      armIdleTimer();
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        markActive();
      }
    }

    const activityEvents: Array<keyof WindowEventMap> = [
      "mousemove",
      "keydown",
      "pointerdown",
      "wheel",
    ];
    activityEvents.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));
    document.addEventListener("visibilitychange", handleVisibility);

    armIdleTimer();

    return () => {
      activityEvents.forEach((evt) => window.removeEventListener(evt, markActive));
      document.removeEventListener("visibilitychange", handleVisibility);
      clearIdleTimer();
    };
  }, []);

  useEffect(() => {
    setAutoCondition("inConversation", inConversation);
  }, [inConversation]);

  useEffect(() => {
    setAutoCondition("offline", offline);
  }, [offline]);
}
