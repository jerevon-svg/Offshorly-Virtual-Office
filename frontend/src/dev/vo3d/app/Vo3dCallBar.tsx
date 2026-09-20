// vo3d app — PHASE 7D: THE CALL, WHEREVER YOU ARE.
//
// WHAT WAS MISSING. Every control for a live spatial call lived in ONE place: the spatial chat panel's
// header (components/OfficeMap/SpatialCallControls, mounted by Vo3dOverlay as `headerExtra`). Close that
// panel — or minimise it, or walk into PLAYER view where it is not what you are looking at — and a
// connected call had no mute, no camera, no share and no leave anywhere on screen. The call itself was
// fine; it was simply unreachable.
//
// WHAT THIS IS. The SAME SpatialCallControls component, mounted a second time against the SAME
// connected session id, in a band of the screen that survives all three views. It is a stateless
// useSyncExternalStore reader over the one callStore snapshot — which is exactly why two instances of it
// may coexist (V1 already relies on that: the chat header and CallOverlay's footer both mount one). No
// call lifecycle lives here: no token, no Room, no socket emit, no spatial-session write. The only thing
// this file decides is WHERE the controls are and WHEN they are worth showing.
//
// IT IS NOT A SECOND CALL UI. When the spatial chat panel is on screen its header already carries these
// controls, so the bar stands down rather than showing the same four buttons twice.
//
// THE POINTER LOCK IS NOT FOUGHT. A pointer-locked player cannot click any DOM element, by browser
// design, and this bar does not steal the lock to make itself clickable — that would take the mouse out
// of a player's hands every time somebody spoke to them. It stays VISIBLE while locked (call state is
// exactly what you want to see mid-walk) and says which key gets the mouse back. The two moments where
// the lock IS released are the ones where an answer is required of the user, and they are released by
// Vo3dOverlay, not here: an incoming ring, and the expanded call view.
import { useEffect, useState } from "react";
import {
  callParticipantsFor,
  resumeAudioPlayback,
  useCallState,
} from "../../../services/call/callStore";
import { SpatialCallControls } from "../../../components/OfficeMap/SpatialCallControls";
import { isPointerLocked } from "./keyGuard";
import styles from "./Vo3dCallBar.module.css";

export interface Vo3dCallBarProps {
  /** The viewer's own email key — the same LiveKit identity callStore publishes under. */
  selfId: string;
  /** V1's roster-backed resolver, already held by the overlay. */
  resolveDisplayName: (email: string) => string;
  /** Open the expanded call view (components/OfficeMap/CallOverlay). PURE UI STATE — touches no media. */
  onExpand: () => void;
  /** True when the spatial chat panel is on screen and unminimised: its header is already showing these
   *  controls, so the bar steps aside rather than duplicating them. */
  controlsShownElsewhere: boolean;
}

/** THE LOCK, read from the browser rather than inferred — the same read Vo3dHud makes for the dock. */
function usePointerLocked(): boolean {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const onChange = () => setLocked(isPointerLocked());
    document.addEventListener("pointerlockchange", onChange);
    onChange();
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, []);
  return locked;
}

export function Vo3dCallBar({
  selfId,
  resolveDisplayName,
  onExpand,
  controlsShownElsewhere,
}: Vo3dCallBarProps) {
  const call = useCallState();
  const locked = usePointerLocked();

  const sessionId = call.connectedSessionId;
  const connecting = call.status === "connecting";
  const connected = call.status === "connected";

  // SPATIAL ONLY. A whiteboard's voice room has its own controls (BoardVoiceControls) and the Cave's
  // meeting has its own panel (Vo3dCaveMeeting) — both are already reachable where they belong, and a
  // bar that claimed all three would be a fourth opinion about which call you are in.
  if (!sessionId || !(connecting || connected)) return null;

  // WHO IS IN IT. LiveKit's own room membership once connected (Phase 7D's `participants`), falling back
  // to the server broadcast while the handshake is still running — the same broadcast CallOverlay and
  // SpatialCallControls read, so no third notion of "who is in this call" is introduced.
  const others = (call.participants.length ? call.participants : callParticipantsFor(call, sessionId))
    .filter((identity) => identity && identity !== selfId);
  const names = others.map((identity) => resolveDisplayName(identity));
  const who =
    names.length === 0
      ? connected
        ? "Waiting for them to join"
        : "Connecting…"
      : names.length <= 2
        ? names.join(" and ")
        : `${names[0]} and ${names.length - 1} others`;

  // ONE COLUMN, NEVER TWO CARDS ON TOP OF EACH OTHER. The call notice (CallInvitePrompt) owns the same
  // top-centre slot and outranks the bar — a ring needs answering, a live call only needs reaching — so
  // the bar drops below it for exactly as long as a notice is up. They are never merged: one is about a
  // call that has not started, the other about the one you are in, and they can legitimately coexist.
  const noticeShowing = Boolean(call.incoming || call.outgoing || call.inviteOutcome);

  return (
    <div
      className={[styles.bar, connected ? "" : styles.connecting, noticeShowing ? styles.belowNotice : ""]
        .filter(Boolean)
        .join(" ")}
      data-testid="vo3d-call-bar"
      data-status={call.status}
      role="status"
    >
      <div className={styles.who}>
        <span className={styles.title}>
          <span className={styles.dot} aria-hidden="true" />
          {connected ? "In a call" : "Connecting…"}
        </span>
        <span className={styles.sub} data-testid="vo3d-call-bar-who">
          {who}
        </span>
      </div>
      {call.audioPlaybackBlocked && (
        <button
          type="button"
          className={styles.unblock}
          onClick={() => void resumeAudioPlayback()}
          data-testid="vo3d-call-bar-unblock"
          title="Your browser blocked call audio until you click"
        >
          Enable sound
        </button>
      )}
      {locked && <span className={styles.lockHint}>Press Esc for controls</span>}
      {!controlsShownElsewhere && (
        <div className={styles.controls}>
          {/* V1's OWN controls, mounted verbatim against the session this client is connected to. */}
          <SpatialCallControls sessionId={sessionId} onExpand={onExpand} />
        </div>
      )}
    </div>
  );
}

export default Vo3dCallBar;
