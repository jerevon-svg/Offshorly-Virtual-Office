import {
  clearBoardError,
  leaveCall,
  resumeAudioPlayback,
  setMicEnabled,
  startOrJoinBoardVoice,
  useCallState,
} from "../../services/call/callStore";
import styles from "./Whiteboard.module.css";

// W5-B board voice controls, rendered in the whiteboard editor header. Reads the ONE call store
// (services/call/callStore.ts) and renders buttons — no media, token or socket work happens here.
//  - Join Voice is explicit; nothing auto-joins. It is disabled while this client is connected (or
//    connecting) to ANY other media room — a spatial call or another board — because there is a
//    single LiveKit Room and joining here would silently tear the other call down.
//  - Joined: Mute/Unmute + Leave, same semantics as SpatialCallControls (LiveKit is the source of
//    truth; the mic boolean only drives the button). No camera: board voice is audio-only.
//  - A failure to join is shown HERE, scoped to this board (snapshot.boardError), never as a
//    spatial toast or overlay.

export type BoardVoiceControlsProps = {
  boardId: string;
  /** The board's realtime room is live — voice presence rides on that socket, so no join before. */
  live: boolean;
  /** Collaborators (self included) currently in this board's voice, per whiteboard_presence. */
  voiceCount: number;
};

export function BoardVoiceControls({ boardId, live, voiceCount }: BoardVoiceControlsProps) {
  const call = useCallState();
  const here = call.connectedBoardId === boardId && (call.status === "connecting" || call.status === "connected");
  const busyElsewhere = !here && (call.status === "connecting" || call.status === "connected");
  const boardError = call.boardError?.boardId === boardId ? call.boardError.message : null;

  if (!here) {
    const title = busyElsewhere
      ? "Leave your current call first"
      : !live
        ? "Waiting for the board connection…"
        : voiceCount > 0
          ? `Join voice (${voiceCount} talking)`
          : "Join voice";
    return (
      <div className={styles.voiceWrap} data-testid="board-voice">
        {boardError && (
          <span className={styles.voiceError} role="alert">
            {boardError}
            <button type="button" className={styles.voiceErrorDismiss} onClick={clearBoardError} aria-label="Dismiss voice error">
              ×
            </button>
          </span>
        )}
        <button
          type="button"
          className={`${styles.voiceButton} ${styles.voiceJoin}`}
          onClick={() => void startOrJoinBoardVoice(boardId)}
          disabled={busyElsewhere || !live}
          aria-label="Join voice"
          title={title}
        >
          🎧 Join Voice{voiceCount > 0 ? ` · ${voiceCount}` : ""}
        </button>
      </div>
    );
  }

  if (call.status === "connecting") {
    return (
      <div className={styles.voiceWrap} data-testid="board-voice">
        <span className={styles.voiceConnecting}>Connecting voice…</span>
      </div>
    );
  }

  return (
    <div className={styles.voiceWrap} data-testid="board-voice">
      <span className={styles.voiceLive} title="You are in this board's voice">
        🎧 In voice{voiceCount > 1 ? ` · ${voiceCount}` : ""}
      </span>
      {call.audioPlaybackBlocked && (
        <button type="button" className={styles.voiceButton} onClick={() => void resumeAudioPlayback()} title="Your browser blocked audio until you click">
          🔈 Enable audio
        </button>
      )}
      <button
        type="button"
        className={call.micEnabled ? styles.voiceButton : `${styles.voiceButton} ${styles.voiceMuted}`}
        onClick={() => void setMicEnabled(!call.micEnabled)}
        aria-label={call.micEnabled ? "Mute microphone" : "Unmute microphone"}
        aria-pressed={!call.micEnabled}
        title={call.micEnabled ? "Mute" : "Unmute"}
      >
        {call.micEnabled ? "🎙 Mute" : "🔇 Unmute"}
      </button>
      <button
        type="button"
        className={`${styles.voiceButton} ${styles.voiceLeave}`}
        onClick={() => leaveCall()}
        aria-label="Leave voice"
        title="Leave voice"
      >
        ⏻ Leave
      </button>
    </div>
  );
}

export default BoardVoiceControls;
