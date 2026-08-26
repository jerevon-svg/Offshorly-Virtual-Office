import { useState } from "react";
import styles from "./CompanyHub.module.css";
import {
  acknowledgeItem,
  actOnItem,
  closeCompanyHub,
  dismissItem,
  hasBlockingRequiredItems,
  useCompanyHub,
} from "../../services/hub/companyHubStore";
import type { HubItem, HubItemType } from "../../services/hub/hubClient";

const TYPE_EMOJI: Record<HubItemType, string> = {
  announcement: "📢",
  birthday: "🎂",
  recognition: "🏆",
  survey: "📊",
  whatsnew: "✨",
};

const DEFAULT_CTA_LABEL: Record<HubItemType, string> = {
  announcement: "Read More",
  birthday: "Wish Happy Birthday",
  recognition: "Congratulate",
  survey: "Answer Survey",
  whatsnew: "See What's New",
};

// "Game login / What's New" screen shown after check-in (mode "checkin") and reopenable
// anytime via the Hub button (mode "manual") — see services/hub/companyHubStore.ts. Full-screen
// takeover, not a dashboard: one card stack, one way out (the primary button), no backdoor
// close while a required item is still unacknowledged.
function isHandled(item: HubItem): boolean {
  return item.myStatus === "dismissed" || item.myStatus === "acknowledged";
}

function stateBadge(item: HubItem): { label: string; className: string } {
  if (item.myStatus === "acknowledged") {
    return { label: "✓ Acknowledged", className: styles.stateAcknowledged };
  }
  if (item.myStatus === "dismissed") {
    return { label: "Dismissed", className: styles.stateDismissed };
  }
  return { label: "New", className: styles.stateNew };
}

export function CompanyHub() {
  const { mode, items, loading, error } = useCompanyHub();
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Check-in (the attention flow) keeps showing only items still needing action — same
  // behavior as before. Manually reopening via the 🏠 Hub button ("manual") is a review view:
  // it shows every currently active item, including already-dismissed/acknowledged ones, each
  // labeled with its state (see stateBadge) — reusing the same HubItemState persistence, no
  // separate history system.
  const visibleItems = mode === "checkin" ? items.filter((item) => !isHandled(item)) : items;
  const isEmpty = mode === "checkin" ? visibleItems.length === 0 : items.length === 0;
  const blocked = hasBlockingRequiredItems(items);
  const primaryLabel = mode === "checkin" ? "Enter Office" : "Close";

  async function handleRequiredAction(item: HubItem) {
    setPendingId(item.id);
    try {
      await actOnItem(item.id);
      await acknowledgeItem(item.id);
    } finally {
      setPendingId(null);
    }
  }

  async function handleCta(item: HubItem) {
    setPendingId(item.id);
    try {
      await actOnItem(item.id);
    } finally {
      setPendingId(null);
    }
  }

  async function handleDismiss(item: HubItem) {
    setPendingId(item.id);
    try {
      await dismissItem(item.id);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>Company Hub</div>
        </div>

        <div className={styles.body}>
          {loading && items.length === 0 && <div className={styles.empty}>Loading…</div>}
          {error && <div className={styles.errorBanner}>{error}</div>}
          {!loading && isEmpty && !error && (
            <div className={styles.empty}>You're all caught up! 🎉</div>
          )}
          {visibleItems.map((item) => {
            const isRequired = item.priority === "required";
            const isPending = pendingId === item.id;
            const ctaLabel = item.ctaLabel || DEFAULT_CTA_LABEL[item.type];
            const handled = isHandled(item);
            const badge = stateBadge(item);
            return (
              <div
                key={item.id}
                className={[
                  styles.card,
                  item.priority === "important" ? styles.cardImportant : "",
                  isRequired ? styles.cardRequired : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {item.imageUrl && (
                  <img className={styles.cardImage} src={item.imageUrl} alt="" />
                )}
                <div className={styles.cardHeader}>
                  <span className={styles.cardEmoji}>{TYPE_EMOJI[item.type]}</span>
                  <span className={styles.cardTitle}>{item.title}</span>
                  {isRequired && <span className={styles.requiredBadge}>Required</span>}
                  {mode === "manual" && (
                    <span className={badge.className}>{badge.label}</span>
                  )}
                </div>
                <div className={styles.cardDescription}>{item.description}</div>
                {/* Reviewing an already-handled item in the manual reopen view is read-only —
                    its action buttons are gone so re-clicking can't re-trigger a Hub-generated
                    Feed activity or need to re-acknowledge a required item to stop blocking. */}
                {!handled && (
                  <div className={styles.cardActions}>
                    {isRequired ? (
                      <button
                        className={styles.primaryAction}
                        disabled={isPending}
                        onClick={() => void handleRequiredAction(item)}
                      >
                        {ctaLabel} &amp; Acknowledge
                      </button>
                    ) : (
                      <>
                        <button
                          className={styles.primaryAction}
                          disabled={isPending}
                          onClick={() => void handleCta(item)}
                        >
                          {item.myActed ? `${ctaLabel} ✓` : ctaLabel}
                        </button>
                        <button
                          className={styles.dismissAction}
                          disabled={isPending}
                          onClick={() => void handleDismiss(item)}
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className={styles.footer}>
          {blocked && (
            <div className={styles.blockedHint}>
              Acknowledge required items above to continue.
            </div>
          )}
          <button
            className={styles.enterOfficeButton}
            disabled={blocked}
            onClick={closeCompanyHub}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CompanyHub;
