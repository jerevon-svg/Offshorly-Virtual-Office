// vo3d adapter — V1'S ATTENDANCE, ASKED NOT RE-DECIDED. Phase 5.
//
// THE AUTHORITY IS services/attendance, AND THIS FILE CREATES NO SECOND ONE. It calls the same
// `attendanceService.getMine()` V1's own office calls, against the same backend row
// (`employee_attendance`, backend/app/routers/attendance.py), for the same employee id V1 resolved. It
// never writes: no check-in, no check-out, no time log. V2 asks a question and maps the answer onto the
// boundary contract in app/access.ts.
//
// WHAT V1 ACTUALLY OFFERS, AND WHY THIS HAS TO POLL AT ALL. Both halves were checked before anything was
// built here:
//
//   • THERE IS NO ATTENDANCE EVENT. backend/app/routers/attendance.py emits exactly one thing on a
//     check-in or a check-out — `offline_lineup` — and backend/app/realtime/socket.py has no attendance
//     event of any kind. So there is no change feed to subscribe to.
//   • V1'S OWN OFFICE DOES NOT NEED ONE. components/OfficeMap/OfficeMap.tsx reads GET /attendance/me ONCE
//     per resolved identity and is otherwise correct because it OWNS the transitions: check-in and
//     check-out happen through its own UI, and it applies the response it got back (applyAttendance). V2
//     is an observer of a session it never changes, so "read it once" is not a mechanism it can borrow.
//
// SO THE LINEUP IS A DOORBELL AND THE POLL IS THE FALLBACK, and the distinction is the whole design:
//
//   • `offline_lineup` IS attendance-triggered — the backend broadcasts it from inside both endpoints —
//     so a confirmed check-out revokes office access within one round trip, with no unrelated socket
//     traffic needed. The caller passes it as `refreshKey`. It is a HINT THAT SOMETHING HAPPENED, never
//     the answer: the lineup is in-memory and per-process (backend/app/services/offline_lineup.py says
//     so) and is empty after a restart while people are still checked out, so "absent from the lineup"
//     does NOT mean "checked in". Using it as the gate would fail OPEN — the exact bypass the boundary
//     exists to prevent.
//   • The BOUNDED REFRESH below exists for the one case the doorbell cannot cover: a transition that
//     happened while this client's socket was down, so the broadcast was never delivered. Window focus
//     and tab visibility catch the common shape of that (check out in another tab, come back to this
//     one); the interval catches the rest. Both are visible-only and coalesced — see REFRESH_MS.
//
// WHY A FAILED READ DOES NOT REVOKE ANYTHING. `unknown` is fail-closed for ENTRY and that is correct
// while nothing is known yet. But downgrading a CONFIRMED `permitted` to `unknown` because one request
// timed out would shut a checked-in employee out of their own office over a network blip — so a failed
// REFRESH keeps the last answer V1 actually gave, and only a failed FIRST read leaves `unknown`. A real
// check-out is still caught by the doorbell immediately, or by the next successful poll.
import { useEffect, useRef, useState } from "react";
import { attendanceService } from "../../../services/attendance";
import { getCurrentUserId } from "../../../auth/useAuthGate";
import { getCurrentUser } from "../../../auth/currentUserStore";
import type { OfficeAccess } from "../app/access";

/** V1's own mapping, restated nowhere: CHECKED_IN is the only status that opens the working office.
 *  `canSelfFreeWalk` (components/OfficeMap/spawnPlacement.ts) asks the same question of the same value. */
export function accessForStatus(status: string | null | undefined): OfficeAccess {
  if (status === "CHECKED_IN") return "permitted";
  if (status === "CHECKED_OUT") return "denied";
  return "unknown";
}

/** How often the fallback poll runs while the tab is VISIBLE.
 *
 *  60 s is chosen against what it is actually for. It is not the mechanism that notices a check-out —
 *  the lineup broadcast does that in one round trip — it is the backstop for a transition whose broadcast
 *  was never delivered, which needs to be noticed eventually rather than immediately. One request a
 *  minute per open V2 tab is a cost that does not need justifying; one every few seconds would be.
 *
 *  It is suspended entirely while the tab is hidden, and a hidden tab that comes back is refreshed by the
 *  focus/visibility handlers instead — so a backgrounded preview costs nothing at all. */
export const REFRESH_MS = 60_000;

/** The shortest gap between two FOCUS/VISIBILITY-driven reads.
 *
 *  Focus is the one trigger a person can generate as fast as they can alt-tab, and a browser fires it for
 *  window focus as well as tab focus — a two-session run showed several reads arriving from nothing but
 *  the OS moving focus between windows. So that path, and only that path, is floored.
 *
 *  A skipped focus read costs nothing that matters: a real check-out is delivered by the lineup doorbell
 *  in the same round trip, the interval is still running, and the next focus after the gap reads again.
 *  The doorbell and the interval are deliberately NOT floored — the doorbell is the attendance-triggered
 *  path that has to stay immediate, and the interval already is a floor. */
export const FOCUS_MIN_GAP_MS = 5_000;

/**
 * V1's answer for the signed-in employee: read on mount, on every `refreshKey` change, on window focus,
 * on the tab becoming visible, and every REFRESH_MS while visible.
 *
 * `unknown` until the first read resolves, and `unknown` forever for a session V1 could not identify —
 * the standalone case, where there is nobody to ask about and the world is never handed an access answer
 * at all (app/Vo3dHost.tsx only pushes it for a real identity).
 *
 * AT MOST ONE REQUEST IN FLIGHT. A trigger that arrives while a read is running does not start a second
 * one; it sets a flag and the read is repeated once the first settles, so a burst of triggers (a lineup
 * broadcast landing at the same moment as a focus event) collapses into one extra request rather than
 * several. Responses carry a generation so a slow one can never overwrite a newer answer.
 *
 * Every listener and the interval are removed on unmount, and a response that lands afterwards is
 * dropped — this route is mounted and unmounted repeatedly (StrictMode alone does it twice).
 */
export function useV1OfficeAccess(refreshKey: unknown): OfficeAccess {
  const [access, setAccess] = useState<OfficeAccess>("unknown");
  /** The live read, owned by the mount effect and called by the refreshKey effect below. */
  const readRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!getCurrentUser()?.email) return;
    let cancelled = false;
    let inFlight = false;
    let again = false;
    let generation = 0;
    /** When the last read was ISSUED — the floor below measures request spacing, not answer spacing. */
    let lastAt = 0;

    const read = (): void => {
      if (cancelled) return;
      // COALESCE rather than drop: a trigger during a read is a real signal, so it is honoured once the
      // read in flight settles instead of being thrown away or starting a second request.
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      lastAt = Date.now();
      const gen = ++generation;
      attendanceService
        .getMine(getCurrentUserId() ?? "")
        .then((record) => {
          if (!cancelled && gen === generation) setAccess(accessForStatus(record?.status));
        })
        .catch(() => {
          // Deliberately nothing. See the header: a failed refresh keeps the last answer V1 gave, and a
          // failed first read leaves the initial `unknown`, which is already fail-closed for entry.
        })
        .finally(() => {
          inFlight = false;
          if (!cancelled && again) {
            again = false;
            read();
          }
        });
    };
    readRef.current = read;
    read();

    /** A focus/visibility read, floored — see FOCUS_MIN_GAP_MS. */
    const readOnFocus = (): void => {
      if (Date.now() - lastAt < FOCUS_MIN_GAP_MS) return;
      read();
    };
    const onFocus = (): void => readOnFocus();
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") readOnFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, REFRESH_MS);

    return () => {
      cancelled = true;
      readRef.current = () => {};
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // THE DOORBELL. `refreshKey` is the caller's live attendance-triggered signal (the offline lineup the
  // backend broadcasts from inside both attendance endpoints). It asks for a read; it never supplies an
  // answer. Skipped on the first run, because the mount effect above has already read.
  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    readRef.current();
  }, [refreshKey]);

  return access;
}
