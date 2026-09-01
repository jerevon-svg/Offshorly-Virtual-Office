import {
  acceptCallInvite,
  cancelCallInvite,
  declineCallInvite,
  dismissInviteOutcome,
  useCallState,
} from "../../services/call/callStore";
import styles from "./CallInvitePrompt.module.css";

type Props = {
  resolveDisplayName: (email: string) => string;
};

// Top-level ringing UI, mounted beside DndRequestQueue / JoinRequestPrompt — deliberately NOT
// inside the Spatial Chat panel, so an incoming call reaches the recipient with chat completely
// closed and no character clicked.
//
// Three mutually exclusive states, at most one card at a time:
//   incoming  -> "{name} is calling"  [Decline] [Accept]
//   outgoing  -> "Calling {name}…"    [Cancel]
//   outcome   -> why the ring ended (declined / cancelled / timed out / offline / DND / busy)
//
// Renders nothing otherwise. No media, token, or microphone is touched here — Accept only emits
// the acceptance; the existing approach -> spatial-session -> eligibility-gated LiveKit path does
// the rest (see OfficeMap's acceptedPeerEmail effect).
export function CallInvitePrompt({ resolveDisplayName }: Props) {
  const call = useCallState();

  if (call.incoming) {
    const name = resolveDisplayName(call.incoming.fromEmail);
    return (
      <div className={styles.toast} role="alert">
        <div className={styles.text}>
          📞 <span className={styles.name}>{name}</span> is calling…
        </div>
        <div className={styles.actionsRow}>
          <button type="button" className={styles.decline} onClick={() => declineCallInvite()}>
            Decline
          </button>
          <button type="button" className={styles.accept} onClick={() => acceptCallInvite()}>
            Accept
          </button>
        </div>
      </div>
    );
  }

  if (call.outgoing) {
    return (
      <div className={styles.toast}>
        <div className={styles.text}>
          📞 Calling <span className={styles.name}>{resolveDisplayName(call.outgoing.toEmail)}</span>…
        </div>
        <div className={styles.actionsRow}>
          <button type="button" className={styles.secondary} onClick={() => cancelCallInvite()}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (call.inviteOutcome) {
    const { kind, peerEmail, reason } = call.inviteOutcome;
    const name = peerEmail ? resolveDisplayName(peerEmail) : "They";
    let text: string;
    if (kind === "failed") {
      text =
        reason === "offline"
          ? `${name} is offline.`
          : reason === "dnd"
            ? `${name} is in Do Not Disturb.`
            : reason === "busy"
              ? `${name} is already in a call.`
              : reason === "already_ringing"
                ? `Already ringing ${name}.`
                : `Couldn't call ${name}.`;
    } else if (kind === "declined") {
      text = `${name} declined the call.`;
    } else if (kind === "timeout") {
      text = `${name} didn't answer.`;
    } else {
      text = "Call cancelled.";
    }
    return (
      <div className={styles.toast}>
        <div className={styles.text}>{text}</div>
        <div className={styles.actionsRow}>
          <button type="button" className={styles.secondary} onClick={() => dismissInviteOutcome()}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default CallInvitePrompt;
