import { useEffect, useState } from "react";
import styles from "./DndRequestUI.module.css";

// Corner toast shown when the viewer tries to Chat/Call/Approach a DND person from outside
// (feature spec section 7) — mirrors RoomLockedToast's shape/behavior for the analogous
// room-lock gate, but for person-level DND. Stacked above RoomLockedToast (see
// DndRequestUI.module.css) so the two can coexist without visually overlapping in the rare case
// both gates are active at once.

type Props = {
  // Display name of the DND person the viewer tried to reach, or null when there is nothing to
  // show (not gated, and no just-declined message pending dismissal).
  targetName: string | null;
  pendingRequestId: string | null;
  declined: boolean;
  // Non-null only right after a decline — server-authoritative moment the 15-minute cooldown
  // lifts (feature spec section 9), used to derive a local countdown without polling.
  cooldownUntil: string | null;
  onRequest: () => void;
  onCancel: () => void;
};

function useCountdownLabel(untilIso: string | null): string | null {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!untilIso) {
      setLabel(null);
      return;
    }
    const until = new Date(untilIso).getTime();

    function tick() {
      const remainingMs = until - Date.now();
      if (remainingMs <= 0) {
        setLabel(null);
        return;
      }
      const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
      setLabel(`${minutes} min`);
    }

    tick();
    const interval = setInterval(tick, 15_000);
    return () => clearInterval(interval);
  }, [untilIso]);

  return label;
}

export function TalkRequestToast({ targetName, pendingRequestId, declined, cooldownUntil, onRequest, onCancel }: Props) {
  const cooldownLabel = useCountdownLabel(declined ? cooldownUntil : null);

  if (declined) {
    return (
      <div className={styles.toast}>
        <div className={styles.toastText}>
          Request declined{cooldownLabel ? ` · Try again in ${cooldownLabel}` : ""}
        </div>
      </div>
    );
  }

  if (!targetName) return null;

  if (pendingRequestId) {
    return (
      <div className={styles.toast}>
        <div className={styles.toastText}>Waiting for {targetName} to respond…</div>
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
      <div className={styles.toastText}>🔴 {targetName} is in Do Not Disturb</div>
      <div className={styles.actionsRow}>
        <button className={styles.primary} onClick={onRequest}>
          Request Permission to Talk
        </button>
      </div>
    </div>
  );
}

export default TalkRequestToast;
