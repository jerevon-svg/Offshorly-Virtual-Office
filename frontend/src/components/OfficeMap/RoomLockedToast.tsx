import styles from "./checkout/checkout.module.css";

// Corner toast shown when the viewer's walk into a DND-locked room stops at the door's outside
// stand point instead of continuing through (see OfficeMap.tsx's roomEntryGate state, set from
// the door-approach gate inserted into walkToSeat/approachCharacter/handleMapRightClick). Reuses
// checkout.module.css's toast/actionsRow/primary/secondary look for visual consistency with the
// rest of the office UI, per the feature spec's "keep it visually consistent" guidance.

type Props = {
  // Name of the locked room the viewer is standing outside of, or null when there is nothing to
  // show (not gated, or the declined message has already been dismissed).
  roomName: string | null;
  // Non-null while this viewer's own Knock is outstanding for the room above.
  pendingRequestId: string | null;
  // True for a few seconds right after this viewer's Knock was declined (feature spec section 7:
  // "show a small non-intrusive result", auto-dismissed by the caller — see
  // roomLockedToastRef timer in OfficeMap.tsx).
  declined: boolean;
  onKnock: () => void;
  onCancel: () => void;
};

export function RoomLockedToast({ roomName, pendingRequestId, declined, onKnock, onCancel }: Props) {
  if (declined) {
    return (
      <div className={styles.toast}>
        <div className={styles.toastText}>Entry request declined</div>
      </div>
    );
  }

  if (!roomName) return null;

  if (pendingRequestId) {
    return (
      <div className={styles.toast}>
        <div className={styles.toastText}>Waiting for {roomName} to respond to your Request Entry…</div>
        <div className={styles.actionsRow}>
          <button className={styles.secondary} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.toast}>
      <div className={styles.toastText}>🔒 {roomName} is DND — knock to ask for entry.</div>
      <div className={styles.actionsRow}>
        <button className={styles.primary} onClick={onKnock}>
          🔔 Request Entry
        </button>
      </div>
    </div>
  );
}

export default RoomLockedToast;
