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
// PHASE 7D CLOSED THE TWO GAPS 7C LISTED. The panel now says Start versus Join before you are in the
// room, because the server finally tells it: `meeting_presence` carries who is in each meeting and who
// hosts it, and callStore keeps it in `meetings` (see the backend's socket.py call_joined, which now
// accepts a meetingId). `live` is the SERVER's answer and exists before this client joins anything;
// `people` is LiveKit's and exists only once it has. The button reads the first, the head-count the
// second, and neither guesses.
//
// INVITE is now real, and is the MEETING invitation — a separate ring from the spatial one on purpose.
// sendCallInvite invites somebody to a conversation between two avatars; this offers them a room.
//
// ENTERING THE CAVE STILL STARTS NOTHING. Everything below is behind an explicit press; walking in
// connects to nothing, publishes nothing, and asks for no token. Start and Join then behave exactly as
// every other call in this app does, microphone included (V1's mic-on-connect, deliberately unchanged).
import { useCallback, useEffect, useState } from "react";
import type { Vo3dWorld, Vo3dCaveMeetingState } from "./world";
import styles from "./Vo3dCaveMeeting.module.css";

export interface Vo3dCaveMeetingProps {
  worldRef: { current: Vo3dWorld | null };
  ready: boolean;
  /** The viewer's own identity, as the rest of the HUD knows it. Handed to the call store so this page
   *  joins as the signed-in employee rather than as the dev default. */
  selfId: string;
  /** PHASE 7D — open the employee picker to invite somebody to THIS meeting. The picker itself is the
   *  HUD's (components/Chat/EmployeePickerModal, the same one New Message uses), because it is a
   *  screen-owning modal and every one of those joins the dock's single visibility rule — see
   *  Vo3dHud.tsx. This panel only says WHEN to open it; it neither owns the roster nor sends the
   *  invitation. Omitted where nothing can host a picker, in which case no Invite row appears. */
  onInvite?: () => void;
}

const EMPTY: Vo3dCaveMeetingState = {
  inside: false, status: "off", session: "", kind: "—",
  mic: false, camera: false, sharing: false, cameras: 0, people: 0, live: false, host: "", isHost: false, presenter: "", note: "",
};

export function Vo3dCaveMeeting({ worldRef, ready, selfId, onInvite }: Vo3dCaveMeetingProps) {
  const [state, setState] = useState<Vo3dCaveMeetingState>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const world = worldRef.current;
    if (!ready || !world?.caveMeeting) return;
    return world.caveMeeting.subscribe(setState);
  }, [ready, worldRef]);

  // WALKING IN IS WATCHING, NOT JOINING. Entering the Cave opens the call store's socket so this
  // client hears which meeting is running and who hosts it — and that is all it does: no token, no
  // room, no microphone, no camera. Without it the panel offers "Start" to somebody standing in a
  // live meeting, because a lazy bridge has nothing to read (see world.ts's observe).
  //
  // Idempotent: connect() returns immediately once the store is loaded, so re-entering costs nothing.
  useEffect(() => {
    if (!state.inside || !selfId) return;
    void worldRef.current?.caveMeeting?.observe(selfId);
  }, [state.inside, selfId, worldRef]);

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
        <span className={styles.sub} data-testid="cave-meeting-sub">
          {connected
            ? describeRoom(state.people, state.cameras)
            : connecting
              ? "Connecting…"
              : state.live
                ? describeRunning(state.host, selfId)
                : "No meeting yet — start one and others can join you"}
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
          {connecting ? "Connecting…" : state.live ? "Join meeting" : "Start meeting"}
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
          {/* INVITE. Offered only to somebody who is actually IN the meeting — you cannot invite
              anybody into a room you have not joined, and the server refuses it anyway. Pressing it
              opens the picker; the confirmation the inviter sees afterwards is the existing meeting
              notice card ("Waiting for X to join"), driven by real store state rather than by a
              second toast of this panel's own. */}
          {onInvite && (
            <button
              type="button"
              className={styles.control}
              disabled={busy}
              data-testid="cave-meeting-invite"
              onClick={onInvite}
            >
              ＋ Invite
            </button>
          )}
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

      {connected && state.host && (
        <p className={styles.note} data-testid="cave-meeting-host">
          {state.isHost ? "You are hosting." : `${shortName(state.host)} is hosting.`}
        </p>
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

/** Who is hosting a meeting this viewer has not joined yet. The server's own answer. */
function describeRunning(host: string, selfId: string): string {
  if (!host) return "A meeting is running — join it";
  if (host === selfId) return "Your meeting is running — join it";
  return `${shortName(host)} is hosting — join them`;
}

/** The local part of an email, capitalised. The Cave panel has no roster of its own (it is driven by
 *  the world, not by React's people list), and an email is what the server reports a host as. */
function shortName(email: string): string {
  const local = email.split("@")[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** PHASE 7D — THE HEAD-COUNT, and exactly how far it goes. Once connected, LiveKit tells this client
 *  who else is in the room, so "in the meeting" can finally say whether anybody else is. It still
 *  cannot say Start versus Join BEFORE connecting, because nothing tells it then: see this file's
 *  header and the backend contract in the Phase 7D report. A count shown after joining is a fact; a
 *  label guessed before joining would not be. */
function describeRoom(people: number, cameras: number): string {
  const others = Math.max(0, people - 1);
  const who =
    others <= 0 ? "In the meeting · you're the only one here" : `In the meeting · ${people} people`;
  return cameras > 0 ? `${who} · ${cameras} camera${cameras === 1 ? "" : "s"} on` : who;
}

export default Vo3dCaveMeeting;
