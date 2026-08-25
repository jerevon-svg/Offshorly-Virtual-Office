import { useState } from "react";
import {
  resolveRequest,
  usePendingRequests,
  type RequestOut,
} from "../../services/chat/requestsClient";
import styles from "./JoinRequestPrompt.module.css";

type Props = {
  // Resolves a requester's email to a display name — OfficeMap owns the roster lookup
  // (roster.people), so it's passed in rather than duplicated here.
  resolveDisplayName: (email: string) => string;
  // Fired after a request is successfully resolved (accept or decline), so OfficeMap can
  // react — e.g. transitioning the currently-open chat panel to `resultConversationId` when
  // an "accept" lands on a different conversation than the one the approver already has
  // open. Not fired on failure.
  onResolved?: (req: RequestOut) => void;
};

// One prompt per pending "ask to join" request targeting a conversation the signed-in user
// participates in. Allow/Decline call the REST resolve endpoint; the pending list itself
// updates via requestsClient's live request_created/request_resolved/request_cancelled
// pushes (usePendingRequests), so no local removal bookkeeping is needed here beyond the
// busy-state per button while a resolve is in flight.
export function JoinRequestPrompt({ resolveDisplayName, onResolved }: Props) {
  const requests = usePendingRequests();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  if (requests.length === 0) return null;

  async function handleDecision(req: RequestOut, decision: "accept" | "decline") {
    setBusyIds((prev) => new Set(prev).add(req.id));
    try {
      const out = await resolveRequest(req.id, decision);
      onResolved?.(out);
    } catch (err) {
      console.error("[requests] failed to resolve join request", err);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(req.id);
        return next;
      });
    }
  }

  return (
    <div className={styles.container}>
      {requests.map((req) => {
        const busy = busyIds.has(req.id);
        return (
          <div key={req.id} className={styles.prompt}>
            <span className={styles.text}>
              {resolveDisplayName(req.requesterEmail)} wants to join the conversation
            </span>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.declineButton}
                disabled={busy}
                onClick={() => handleDecision(req, "decline")}
              >
                Decline
              </button>
              <button
                type="button"
                className={styles.allowButton}
                disabled={busy}
                onClick={() => handleDecision(req, "accept")}
              >
                Allow
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default JoinRequestPrompt;
