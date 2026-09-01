import {
  callParticipantsFor,
  leaveCall,
  setCameraEnabled,
  setMicEnabled,
  startOrJoinCall,
  useCallState,
} from "../../services/call/callStore";
import styles from "./SpatialCallControls.module.css";

type SpatialCallControlsProps = {
  /** The spatial session (conversation) id this chat panel is open for. */
  sessionId: string | null;
};

// ACTIVE-CALL controls for the SPATIAL chat window. STARTING a call is deliberately NOT here —
// that stays the character action menu's "Call" item (see OfficeMap's handleChoose "call"
// branch), which keeps this compact header at its original width.
//
// What IS here is JOINING a call that is already running in this session. The server already
// broadcasts that fact (spatial_calls -> callStore.calls); before this, nothing consumed it for a
// viewer who wasn't already connected, so the second participant had no way to discover the call.
//
// Stage B adds ONE control here — camera on/off, between mic and leave. Nothing else about this
// component changed: Join and Connecting behave exactly as they did in Stage A.
//
// Renders nothing at all when this session has no call and the viewer isn't in one — so an
// ordinary spatial chat looks exactly as it did before Stage A.
//
// Mounted exclusively by OfficeMap's two spatial slots; remote Global Chat windows never receive
// it, so no DM, remote group, or non-spatial conversation can show call controls.
export function SpatialCallControls({ sessionId }: SpatialCallControlsProps) {
  const call = useCallState();

  if (!sessionId) return null;

  // Not connected here: offer Join ONLY when a call is genuinely live in THIS session. Scoped by
  // sessionId, so a call running in some other conversation never surfaces a Join button here.
  if (call.connectedSessionId !== sessionId) {
    if (callParticipantsFor(call, sessionId).length === 0) return null;
    return (
      <div className={styles.wrap}>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.join}`}
          onClick={() => void startOrJoinCall(sessionId)}
          aria-label="Join call"
          title="Join call"
        >
          📞 Join
        </button>
      </div>
    );
  }

  if (call.status === "connecting") {
    return (
      <div className={styles.wrap}>
        <span className={styles.connecting}>Connecting…</span>
      </div>
    );
  }

  if (call.status !== "connected") return null;

  return (
    <div className={styles.wrap}>
      {/* Icon-only so the two controls fit the existing header without widening the panel. */}
      <button
        type="button"
        className={call.micEnabled ? styles.iconButton : `${styles.iconButton} ${styles.muted}`}
        onClick={() => void setMicEnabled(!call.micEnabled)}
        aria-label={call.micEnabled ? "Mute microphone" : "Unmute microphone"}
        title={call.micEnabled ? "Mute" : "Unmute"}
      >
        {call.micEnabled ? "🎙" : "🔇"}
      </button>
      {/* Stage B camera. Same icon-only treatment as the mic beside it, so adding video costs the
          header no width. OFF is the default for every call — this button is the ONLY thing in
          the app that turns a camera on. cameraError is surfaced as a title rather than a banner:
          a camera that fails must not push the call controls around. */}
      <button
        type="button"
        className={call.cameraEnabled ? styles.iconButton : `${styles.iconButton} ${styles.cameraOff}`}
        onClick={() => void setCameraEnabled(!call.cameraEnabled)}
        aria-label={call.cameraEnabled ? "Turn camera off" : "Turn camera on"}
        title={call.cameraError ?? (call.cameraEnabled ? "Turn camera off" : "Turn camera on")}
      >
        {call.cameraEnabled ? "📹" : "🚫"}
      </button>
      <button
        type="button"
        className={`${styles.iconButton} ${styles.leave}`}
        onClick={() => leaveCall()}
        aria-label="Leave call"
        title="Leave call"
      >
        ⏻
      </button>
    </div>
  );
}

export default SpatialCallControls;
