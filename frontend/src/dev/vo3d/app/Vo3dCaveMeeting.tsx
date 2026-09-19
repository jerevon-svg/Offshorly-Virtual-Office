// vo3d app — PHASE 7C: THE CAVE MEETING ENTRY POINT.
//
// WHAT THIS IS. The Championship Cave is a room you walk into; a meeting is the thing you do in it. Until
// now the only way to start or join one was the dev GUI's "Championship Cave" folder, which no employee
// can reach. This is that same meeting, offered where somebody standing in the Cave can see it.
//
// IT IS NOT A CALL SYSTEM. Every button here goes world.caveMeeting -> media/CaveLiveShare ->
// services/call/callStore — V1's own LiveKit room, V1's own /meetings/{id}/token endpoint, V1's own
// mic / camera / screen-share publications. Nothing is mocked, nothing is duplicated, and there is no
// second signalling path. If a button is not backed by one of those calls it is not on screen.
//
// THE ONE THING IT DOES NOT DO, STATED HONESTLY. The panel cannot say "Start" versus "Join" before you
// are in the room, because nothing tells it. The backend's meeting endpoint is deliberately
// create-or-reuse (routers/calls.py: "the first caller mints the room, everyone after joins the same
// one") and the socket's active-call broadcast carries SPATIAL conversations only — callStore says so on
// the field itself: "A meeting never announces call_joined/call_left". So there is no meeting-presence
// signal to read, and a button that guessed would be lying half the time. It says what is true of both
// cases — you open the Cave meeting, and whoever else opens it is in there with you — and the
// participant count appears the moment there is a real one to show. A real Start/Join split needs a
// backend meeting-presence signal; that is Phase 7D work, listed as such.
//
// INVITE is likewise absent rather than fake: there is no meeting-invite service. sendCallInvite is the
// SPATIAL ring (it invites somebody to a conversation between two avatars, not to a room), so wiring it
// to this button would send the wrong thing.
import { useCallback, useEffect, useState } from "react";
import type { Vo3dWorld, Vo3dCaveMeetingState } from "./world";
import styles from "./Vo3dCaveMeeting.module.css";

export interface Vo3dCaveMeetingProps {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  /** The viewer's own identity, as the rest of the HUD knows it. Handed to the call store so this page
   *  joins as the signed-in employee rather than as the dev default. */
  selfId: string;
}

const EMPTY: Vo3dCaveMeetingState = {
  inside: false, status: "off", session: "", kind: "—",
  mic: false, camera: false, sharing: false, cameras: 0, presenter: "", note: "",
};

export function Vo3dCaveMeeting({ worldRef, ready, selfId }: Vo3dCaveMeetingProps) {
  const [state, setState] = useState<Vo3dCaveMeetingState>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world?.caveMeeting) return;
    return world.caveMeeting.subscribe(setState);
  }, [ready, worldRef]);

  const run = useCallback(async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }, []);

  // Outside the Cave there is nothing to offer. A meeting that is still connected while its attendee
  // walks out is not torn down here — leaving the room is not leaving the call, exactly as it is not in
  // V1 — so the panel simply stops being the thing on screen.
  if (!state.inside) return null;

  const meeting = worldRef.current?.caveMeeting;
  const connected = state.status === "connected";
  const connecting = state.status === "connecting";

  return (
    <div className={styles.panel} data-testid="vo3d-cave-meeting" data-status={state.status}>
      <div className={styles.head}>
        <span className={styles.title}>Championship Cave</span>
        <span className={styles.sub}>
          {connected
            ? state.cameras > 0
              ? `In the meeting · ${state.cameras} camera${state.cameras === 1 ? "" : "s"} on`
              : "In the meeting"
            : connecting
              ? "Connecting…"
              : "Open the Cave meeting — everyone who opens it lands in the same room"}
        </span>
      </div>

      {!connected ? (
        <button
          type="button"
          className={styles.primary}
          disabled={busy || connecting || !selfId}
          data-testid="cave-meeting-start"
          onClick={() => meeting && void run(() => meeting.start(selfId))}
        >
          {connecting ? "Connecting…" : "Start or join meeting"}
        </button>
      ) : (
        <div className={styles.controls}>
          <button
            type="button"
            className={state.mic ? `${styles.control} ${styles.on}` : styles.control}
            aria-pressed={state.mic}
            disabled={busy}
            data-testid="cave-meeting-mic"
            onClick={() => meeting && void run(() => meeting.setMic(!state.mic))}
          >
            {state.mic ? "🎤 Mic on" : "🎤 Mic off"}
          </button>
          <button
            type="button"
            className={state.camera ? `${styles.control} ${styles.on}` : styles.control}
            aria-pressed={state.camera}
            disabled={busy}
            data-testid="cave-meeting-camera"
            onClick={() => meeting && void run(() => meeting.setCamera(!state.camera))}
          >
            {state.camera ? "📹 Camera on" : "📹 Camera off"}
          </button>
          <button
            type="button"
            className={state.sharing ? `${styles.control} ${styles.on}` : styles.control}
            aria-pressed={state.sharing}
            disabled={busy}
            data-testid="cave-meeting-share"
            onClick={() => meeting && void run(() => meeting.setSharing(!state.sharing))}
          >
            {state.sharing ? "🖥 Stop sharing" : "🖥 Share screen"}
          </button>
          <button
            type="button"
            className={`${styles.control} ${styles.leave}`}
            disabled={busy}
            data-testid="cave-meeting-leave"
            onClick={() => meeting && void run(() => meeting.leave())}
          >
            Leave meeting
          </button>
        </div>
      )}

      {connected && state.presenter && (
        <p className={styles.note} data-testid="cave-meeting-presenter">
          {state.sharing ? "You are sharing your screen." : `${state.presenter} is sharing a screen.`}
        </p>
      )}
      {state.note && (
        <p className={`${styles.note} ${styles.problem}`} data-testid="cave-meeting-note">
          {state.note}
        </p>
      )}
    </div>
  );
}

export default Vo3dCaveMeeting;
