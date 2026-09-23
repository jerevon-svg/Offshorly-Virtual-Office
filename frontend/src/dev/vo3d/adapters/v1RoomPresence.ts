// vo3d adapter — V1'S ROOM OCCUPANCY, PUBLISHED FROM V2'S BODY. Phase 8 follow-up.
//
// THE AUTHORITY IS services/presence/roomPresenceClient, AND THIS FILE CREATES NO SECOND ONE. It calls
// the same `emitRoomPresenceEnter` / `emitRoomPresenceLeave` V1's own office calls
// (components/OfficeMap/OfficeMap.tsx), on the same socket, in the same flat rects/teamRooms id
// namespace, against the same server-side `room_presence` registry. V2 reports where its body is
// standing; it decides nothing about locks, knocks or membership.
//
// WHY IT HAD TO EXIST. `room_presence` is what makes a room LOCKABLE: backend/app/routers/
// room_requests.py resolves a knock's eligible answerers as "the current DND occupants of this room".
// V2 published nothing, so a V2 employee was in no room as far as the server was concerned — their room
// could never be locked, and they could never be asked to let anybody in. Mounting V1's DndRequestQueue
// in V2 gave them somewhere to ANSWER a knock; this is what makes a knock reachable in the first place.
//
// THE NAMESPACE BRIDGE IS V1'S OWN, NOT A TABLE HERE. The world answers in its manifest room-layer id
// ("design-room"); `room_presence`, the door logic and DndRequestQueue's room names all speak V1's FLAT
// id ("design-team"). data/office-layout's `flatRoomIdForRoomLayer` is the existing translation between
// them — the same one app/roomDetails.ts already uses to join V2's room onto V1's roster — so there is
// one bridge in this app and this is not a second one. A room layer with no flat twin maps to null, and
// null is "not in a room", which is the honest answer rather than a made-up one.
//
// EDGE-TRIGGERED, WHICH IS THE CLIENT'S STATED CONTRACT. roomPresenceClient says enter/leave must fire
// once per real transition and never from a per-frame poll. V2 has no room-change event to subscribe to
// — `Vo3dWorld.currentRoomId()` is documented "read on demand, never polled" — so the position is SAMPLED
// on a slow timer and an event is emitted ONLY when the answer actually changes. Sampling is not
// publishing: walking across a room for a minute is zero events.
//
// WHAT IS DELIBERATELY NOT PUBLISHED, so membership is never false:
//   • no identity              the standalone dev rig has nobody to be an occupant.
//   • attendance not permitted a checked-out employee is not in the working office. V1's gate, asked
//                              through the record the host already holds — never re-decided here.
//   • no world / not ready     there is no body to be anywhere.
// Each of these is a LEAVE if something was previously published, not merely a silence — going quiet
// would leave a stale occupant holding a room locked behind them.
import { useEffect, useRef } from "react";
import {
  emitRoomPresenceEnter,
  emitRoomPresenceLeave,
} from "../../../services/presence/roomPresenceClient";
import { flatRoomIdForRoomLayer } from "../../../data/office-layout";
import type { Vo3dWorld } from "../app/world";
import type { OfficeAccess } from "../app/access";

/** How often the body's room is SAMPLED, ms.
 *
 *  A room transition is a person walking through a door, so it is noticed in well under a second either
 *  way; 700 ms is a sample the eye cannot beat and a cost nothing needs to justify. It is not how often
 *  anything is SENT — a sample that matches the last one sends nothing at all, and a person standing at
 *  their desk publishes exactly one event for the whole session.
 *
 *  Suspended while the tab is hidden, and re-sampled immediately when it comes back: a backgrounded
 *  office costs nothing, and the socket's own disconnect handler is what covers a tab that never does. */
export const SAMPLE_MS = 700;

/** V1's flat room id for wherever the body is standing, or null for the hall, the street, a room with no
 *  hand-drawn twin, and anywhere outside the modelled world. */
export function flatRoomForWorld(world: Vo3dWorld | null): string | null {
  const layerId = world?.currentRoomId?.() ?? null;
  return layerId ? flatRoomIdForRoomLayer(layerId) : null;
}

/** Should this session be an occupant of anything at all? */
export function mayPublish(selfEmail: string, access: OfficeAccess): boolean {
  // `unknown` is the answer before the first attendance read resolves and after a failed one. It is
  // treated as NOT permitted here for the same reason app/access.ts treats it that way at the office
  // boundary: nothing is granted on an answer V1 has not given. A room is not locked on a maybe.
  return Boolean(selfEmail) && access === "permitted";
}

/**
 * Publish this employee's room to V1's registry for as long as V2 is the office they are in.
 *
 * ONE EVENT PER REAL TRANSITION. The last published value is held in a ref and compared before anything
 * is sent, so a sample that agrees with it is silent. Crossing straight from one room into another sends
 * a single ENTER (V1's own rule — `emitRoomPresenceEnter` supersedes, `emitRoomPresenceLeave` is only for
 * leaving to open floor), and stepping into the hall sends a single LEAVE.
 *
 * IT ALWAYS LEAVES ON THE WAY OUT. Unmounting — which is what a switch to the Classic office, a reload or
 * a closed tab all are — emits a LEAVE if anything was published, so the room does not stay locked behind
 * somebody who is no longer in it. The backend's own disconnect handler is the backstop for the cases a
 * cleanup cannot run in (a killed tab), and it also cancels that room's stale knocks.
 */
export function useV1RoomPresence(
  worldRef: { current: Vo3dWorld | null },
  ready: boolean,
  selfEmail: string,
  access: OfficeAccess,
): void {
  /** The last value actually SENT: a flat room id, or null for "published as out of any room". Undefined
   *  means nothing has ever been published, which is not the same as having published a leave. */
  const publishedRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const allowed = mayPublish(selfEmail, access);

    const publish = (next: string | null): void => {
      if (publishedRef.current === next) return;
      // NOTHING TO GIVE UP YET. The first sample of a session that starts in the hall would otherwise
      // announce a leave from a room this client was never in — a wasted event, and a confusing one to
      // read in a socket log. Silence is the correct opening state; only a real room breaks it.
      if (publishedRef.current === undefined && next === null) {
        publishedRef.current = null;
        return;
      }
      publishedRef.current = next;
      if (next) emitRoomPresenceEnter(next);
      else emitRoomPresenceLeave();
    };

    if (!ready || !allowed) {
      // Not merely silent: if this session HAD published a room, it must give it up now — a checked-out
      // or unidentified session holding a room is exactly the stale occupant this guards against.
      if (publishedRef.current !== undefined && publishedRef.current !== null) publish(null);
      return;
    }

    const sample = (): void => publish(flatRoomForWorld(worldRef.current));
    sample();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") sample();
    }, SAMPLE_MS);
    const onVisible = (): void => {
      if (document.visibilityState === "visible") sample();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      // THE WAY OUT. Anything published is given up here, so leaving V2 — for Classic, for a reload, for
      // a closed tab — never leaves a room locked behind a body that is gone.
      if (publishedRef.current !== undefined && publishedRef.current !== null) {
        publishedRef.current = null;
        emitRoomPresenceLeave();
      }
    };
  }, [ready, selfEmail, access, worldRef]);
}
