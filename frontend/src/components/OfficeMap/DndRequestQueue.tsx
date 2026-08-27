import { useState } from "react";
import { rooms } from "../../data/office-layout";
import {
  resolveRoomEntryRequest,
  usePendingRoomRequests,
  type RoomRequestOut,
} from "../../services/chat/roomRequestsClient";
import {
  resolveTalkRequest,
  usePendingTalkRequests,
  type TalkRequestOut,
} from "../../services/chat/talkRequestsClient";
import styles from "./DndRequestUI.module.css";

type Props = {
  resolveDisplayName: (email: string) => string;
};

function roomNameFor(roomId: string): string {
  return rooms.find((r) => r.id === roomId)?.name ?? roomId;
}

type QueueItem =
  | { type: "room"; req: RoomRequestOut }
  | { type: "talk"; req: TalkRequestOut };

// Compact, lightweight recipient-side queue combining pending Room-Entry Knocks (existing) and
// pending Talk-permission requests (DND V1) into one list — feature spec section 10: "Reuse/
// extend the existing request UI into a compact DND request queue" with a "DND Requests · N"
// header once there's more than one. Each row still resolves independently through its own
// underlying request lifecycle (room_requests vs talk_requests stay logically separate — only
// the presentation is merged here). Replaces the standalone KnockPrompt component, which this
// supersedes.
export function DndRequestQueue({ resolveDisplayName }: Props) {
  const roomRequests = usePendingRoomRequests();
  const talkRequests = usePendingTalkRequests();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const items: QueueItem[] = [
    ...roomRequests.map((req): QueueItem => ({ type: "room", req })),
    ...talkRequests.map((req): QueueItem => ({ type: "talk", req })),
  ].sort((a, b) => a.req.createdAt.localeCompare(b.req.createdAt));

  if (items.length === 0) return null;

  async function handleDecision(item: QueueItem, decision: "accept" | "decline") {
    setBusyIds((prev) => new Set(prev).add(item.req.id));
    try {
      if (item.type === "room") {
        await resolveRoomEntryRequest(item.req.id, decision);
      } else {
        await resolveTalkRequest(item.req.id, decision);
      }
    } catch (err) {
      console.error("[dndRequestQueue] failed to resolve request", err);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(item.req.id);
        return next;
      });
    }
  }

  function describe(item: QueueItem): string {
    const name = resolveDisplayName(item.type === "room" ? item.req.requesterEmail : item.req.requesterEmail);
    if (item.type === "room") return `${name} wants to enter ${roomNameFor(item.req.roomId)}`;
    if (item.req.kind === "approach") return `${name} wants to approach you`;
    return `${name} wants to talk to you`;
  }

  return (
    <div className={styles.queue}>
      {items.length > 1 && <div className={styles.queueHeader}>DND Requests · {items.length}</div>}
      {items.map((item) => {
        const busy = busyIds.has(item.req.id);
        return (
          <div key={`${item.type}:${item.req.id}`} className={styles.row}>
            <span className={styles.rowText}>{describe(item)}</span>
            <div className={styles.rowActions}>
              <button
                type="button"
                className={styles.declineButton}
                disabled={busy}
                onClick={() => handleDecision(item, "decline")}
              >
                Decline
              </button>
              <button
                type="button"
                className={styles.allowButton}
                disabled={busy}
                onClick={() => handleDecision(item, "accept")}
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

export default DndRequestQueue;
