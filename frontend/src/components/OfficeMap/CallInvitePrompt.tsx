import {
  acceptCallInvite,
  acceptMeetingInvite,
  cancelCallInvite,
  cancelMeetingInvite,
  declineCallInvite,
  declineMeetingInvite,
  dismissInviteOutcome,
  dismissMeetingInviteOutcome,
  useCallState,
} from "../../services/call/callStore";
import styles from "./CallInvitePrompt.module.css";

type Props = {
  resolveDisplayName: (email: string) => string;
  /** PHASE 7D. Join the meeting this viewer was invited to. Supplied by whichever office can actually
   *  join one — today only the V2 world, which owns the Cave. Omitted elsewhere, in which case no
   *  meeting invitation is shown at all rather than an offer that cannot be taken up. */
  onAcceptMeeting?: (meetingId: string) => void;
};

// THE CALL NOTICE. Top-level ringing UI, mounted beside DndRequestQueue / JoinRequestPrompt —
// deliberately NOT inside the Spatial Chat panel, so an incoming call reaches the recipient with chat
// completely closed and no character clicked.
//
// SIX STATES, ONE CARD (Phase 7D). Ringing in, ringing out, and the four ways a ring can end used to be
// drawn as three different-looking popups; they are now one card with one hierarchy — a state name, the
// sentence about this person, and that state's actions — in the branded top-centre position the call bar
// shares. Only the accent dot's colour and the words change between them; the surface, the placement,
// the type scale and the button shapes never do. See CallInvitePrompt.module.css for why that placement.
//
// AT MOST ONE CARD AT A TIME, and the order below is the store's own precedence: an incoming ring
// outranks an outgoing one, which outranks the outcome of a ring that has already ended. Renders nothing
// when there is no ring and no unread outcome.
//
// NO CALL LOGIC LIVES HERE, and Phase 7D changed none of it. No media, token, or microphone is touched:
// Accept only emits the acceptance; the existing approach -> spatial-session -> eligibility-gated LiveKit
// path does the rest (see the acceptedPeerEmail effect in OfficeMap.tsx and Vo3dOverlay.tsx). Every
// state below is a real store state and every button is the store function that already backed it —
// there is no synthesised "timed out", no fabricated error and no new action.
export function CallInvitePrompt({ resolveDisplayName, onAcceptMeeting }: Props) {
  const call = useCallState();

  // PHASE 7D — MEETING INVITATIONS, first and in the same card. A ROOM you are being offered, not a
  // ring: Accept joins the meeting and nothing else — no approach, no spatial session, no chat panel.
  // It is checked ahead of the spatial ring only because at most one card shows at a time and an offer
  // in flight is the newer thing; the two never resolve each other (separate store slots, separate
  // server registry).
  if (call.incomingMeetingInvite && onAcceptMeeting) {
    const inv = call.incomingMeetingInvite;
    const name = resolveDisplayName(inv.fromEmail);
    return (
      <Notice
        tone="ringing"
        title="Meeting invitation"
        body={
          <>
            <span className={styles.name}>{name}</span> invited you to a meeting
          </>
        }
        role="alert"
        actions={
          <>
            <button
              type="button"
              className={`${styles.action} ${styles.decline}`}
              onClick={() => declineMeetingInvite()}
            >
              Decline
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.accept}`}
              onClick={() => {
                // Two separate things, both needed: resolve the invitation server-side so the
                // inviter's "waiting" card clears, and join the room. The store does NOT join on
                // accept — the recipient's own client owns that, exactly as it owns its own token.
                acceptMeetingInvite();
                onAcceptMeeting?.(inv.meetingId ?? "");
              }}
            >
              Join
            </button>
          </>
        }
      />
    );
  }

  if (call.outgoingMeetingInvite) {
    const name = resolveDisplayName(call.outgoingMeetingInvite.toEmail);
    return (
      <Notice
        tone="waiting"
        title="Invitation sent"
        body={
          <>
            Waiting for <span className={styles.name}>{name}</span> to join
          </>
        }
        actions={
          <button type="button" className={styles.action} onClick={() => cancelMeetingInvite()}>
            Cancel
          </button>
        }
      />
    );
  }

  if (call.meetingInviteOutcome) {
    const { kind, peerEmail, reason } = call.meetingInviteOutcome;
    const name = peerEmail ? resolveDisplayName(peerEmail) : "They";
    const body =
      kind === "declined"
        ? `${name} declined the invitation.`
        : kind === "timeout"
          ? `${name} didn't respond.`
          : kind === "cancelled"
            ? "The invitation was withdrawn."
            : reason === "offline"
              ? `${name} is offline.`
              : reason === "dnd"
                ? `${name} is in Do Not Disturb.`
                : reason === "already_in"
                  ? `${name} is already in the meeting.`
                  : reason === "busy"
                    ? `${name} is currently in another call.`
                    : `Couldn't invite ${name}.`;
    return (
      <Notice
        tone="ended"
        title="Meeting invitation"
        body={body}
        actions={
          <button type="button" className={styles.action} onClick={() => dismissMeetingInviteOutcome()}>
            Dismiss
          </button>
        }
      />
    );
  }

  if (call.incoming) {
    const name = resolveDisplayName(call.incoming.fromEmail);
    return (
      <Notice
        tone="ringing"
        title="Incoming call"
        body={
          <>
            <span className={styles.name}>{name}</span> is calling…
          </>
        }
        role="alert"
        actions={
          <>
            <button
              type="button"
              className={`${styles.action} ${styles.decline}`}
              onClick={() => declineCallInvite()}
            >
              Decline
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.accept}`}
              onClick={() => acceptCallInvite()}
            >
              Accept
            </button>
          </>
        }
      />
    );
  }

  if (call.outgoing) {
    const name = resolveDisplayName(call.outgoing.toEmail);
    return (
      <Notice
        tone="waiting"
        title="Calling…"
        body={
          <>
            Waiting for <span className={styles.name}>{name}</span> to answer
          </>
        }
        actions={
          <button type="button" className={styles.action} onClick={() => cancelCallInvite()}>
            Cancel
          </button>
        }
      />
    );
  }

  if (call.inviteOutcome) {
    const { kind, peerEmail, reason } = call.inviteOutcome;
    const name = peerEmail ? resolveDisplayName(peerEmail) : "They";
    // The SAME words the store's own outcomes have always produced, re-split into the card's two lines.
    // Nothing new is claimed: every branch here is a reason the server or the ring itself reported.
    let title: string;
    let body: string;
    if (kind === "failed") {
      title = peerEmail ? `Can't reach ${name}` : "Call failed";
      body =
        reason === "offline"
          ? `${name} is offline.`
          : reason === "dnd"
            ? `${name} is in Do Not Disturb.`
            : reason === "busy"
              // PHASE 7D. "another call" rather than "a call": the recipient may be in a Cave meeting
              // rather than a one-to-one, and the caller does not need to know which — only that the
              // person is occupied, and that the attempt has been left in their DM to find.
              ? `${name} is currently in another call.`
              : reason === "already_ringing"
                ? `You're already ringing ${name}.`
                : `Couldn't call ${name}.`;
    } else if (kind === "declined") {
      title = "Call declined";
      body = `${name} declined the call.`;
    } else if (kind === "timeout") {
      title = "No answer";
      body = `${name} didn't answer.`;
    } else {
      title = "Call cancelled";
      body = "The call ended before it connected.";
    }
    return (
      <Notice
        tone="ended"
        title={title}
        body={body}
        actions={
          <button type="button" className={styles.action} onClick={() => dismissInviteOutcome()}>
            Dismiss
          </button>
        }
      />
    );
  }

  return null;
}

/** THE ONE SHAPE. Every state above renders this and differs only in tone, words and buttons, which is
 *  what makes "the same card" true by construction rather than by matching two stylesheets by eye. */
function Notice({
  tone,
  title,
  body,
  actions,
  role,
}: {
  tone: "ringing" | "waiting" | "ended";
  title: string;
  body: React.ReactNode;
  actions: React.ReactNode;
  role?: string;
}) {
  return (
    <div
      className={`${styles.card} ${styles[tone]}`}
      data-testid="call-notice"
      data-tone={tone}
      role={role}
    >
      <div className={styles.head}>
        <span className={styles.title}>
          <span className={styles.dot} aria-hidden="true" />
          {title}
        </span>
        <span className={styles.body}>{body}</span>
      </div>
      <div className={styles.actions}>{actions}</div>
    </div>
  );
}

export default CallInvitePrompt;
