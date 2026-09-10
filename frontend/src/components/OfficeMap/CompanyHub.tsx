import { useEffect, useState } from "react";
import HudIcon from "../HudIcon";
import styles from "./CompanyHub.module.css";
import announcementArt from "../../assets/hub-art/announcement.png";
import birthdayArt from "../../assets/hub-art/birthday.png";
import recognitionArt from "../../assets/hub-art/recognition.png";
import surveyArt from "../../assets/hub-art/survey.png";
import whatsnewArt from "../../assets/hub-art/whatsnew.png";
import {
  acknowledgeItem,
  actOnItem,
  closeCompanyHub,
  dismissItem,
  hasBlockingRequiredItems,
  useCompanyHub,
} from "../../services/hub/companyHubStore";
import type { HubItem, HubItemType } from "../../services/hub/hubClient";

// One REUSABLE illustration per Hub type — never one per post. A post's own `imageUrl`, when the
// data carries one, still wins (see heroFor), so nothing existing is overridden.
// Every type now has its own art; none is shared.
const TYPE_ART: Record<HubItemType, string> = {
  announcement: announcementArt,
  birthday: birthdayArt,
  recognition: recognitionArt,
  survey: surveyArt,
  whatsnew: whatsnewArt,
};

/** Editorial eyebrow above the headline, per the Hub mock's "TEAM SPOTLIGHT". */
const TYPE_EYEBROW: Record<HubItemType, string> = {
  announcement: "Announcement",
  birthday: "Celebration",
  recognition: "Team spotlight",
  survey: "Your input",
  whatsnew: "What's new",
};

const DEFAULT_CTA_LABEL: Record<HubItemType, string> = {
  announcement: "Read More",
  birthday: "Wish Happy Birthday",
  recognition: "Give Kudos",
  survey: "Answer Survey",
  whatsnew: "See What's New",
};

// "Game login / What's New" screen shown after check-in (mode "checkin") and reopenable anytime
// via the Hub button (mode "manual") — see services/hub/companyHubStore.ts.
//
// PRESENTATION ONLY. This is now a one-item-at-a-time editorial carousel instead of a scrolling
// list, but every rule below is the one that was already here: which items are visible per mode,
// which are read-only once handled, the required-item block on leaving, and each action's own
// store call. No Hub business logic lives in this file.
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

function heroFor(item: HubItem): string {
  return item.imageUrl || TYPE_ART[item.type];
}

export function CompanyHub() {
  const { mode, items, loading, error } = useCompanyHub();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  // Check-in (the attention flow) keeps showing only items still needing action — same behavior
  // as before. Manually reopening via the Hub button ("manual") is a review view: every currently
  // active item, including already-dismissed/acknowledged ones, each labeled with its state.
  const visibleItems = mode === "checkin" ? items.filter((item) => !isHandled(item)) : items;
  const isEmpty = mode === "checkin" ? visibleItems.length === 0 : items.length === 0;
  const blocked = hasBlockingRequiredItems(items);
  const primaryLabel = mode === "checkin" ? "Enter Office" : "Close";

  // Acting on an item can shorten the list under the carousel (check-in mode drops handled
  // items), so the cursor is clamped rather than left pointing past the end.
  const count = visibleItems.length;
  useEffect(() => {
    if (index > count - 1) setIndex(Math.max(0, count - 1));
  }, [count, index]);
  const safeIndex = Math.min(index, Math.max(0, count - 1));
  const current: HubItem | undefined = visibleItems[safeIndex];
  const next = count > 1 ? visibleItems[(safeIndex + 1) % count] : undefined;

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

  const isRequired = current?.priority === "required";
  const isPending = current ? pendingId === current.id : false;
  const handled = current ? isHandled(current) : false;

  return (
    <div className={styles.backdrop}>
      <div className={styles.panel} role="dialog" aria-label="Company Hub">
        <div className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <HudIcon name="hub" size="30px" />
          </span>
          <div className={styles.headerTitle}>Company Hub</div>
          {/* The one way out, unchanged: still disabled while a required item is unacknowledged,
              and still the button the check-in flow's "Enter Office" contract refers to. */}
          <button
            className={styles.closeButton}
            aria-label={primaryLabel}
            title={blocked ? "Acknowledge required items to continue" : primaryLabel}
            disabled={blocked}
            onClick={closeCompanyHub}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className={styles.body}>
          {loading && items.length === 0 && <div className={styles.empty}>Loading…</div>}
          {error && <div className={styles.errorBanner}>{error}</div>}
          {!loading && isEmpty && !error && (
            <div className={styles.empty}>You're all caught up! 🎉</div>
          )}

          {current && (
            /* `key` restarts the slide/fade on every item change — the whole transition, no
               animation library and nothing to tear down. */
            <div className={styles.slide} key={current.id}>
              <div className={styles.hero}>
                <span className={styles.heroGlow} aria-hidden="true" />
                <img className={styles.heroArt} src={heroFor(current)} alt="" />
              </div>

              <div className={styles.content}>
                <div className={styles.eyebrowRow}>
                  <span className={styles.eyebrow}>{TYPE_EYEBROW[current.type]}</span>
                  {isRequired && <span className={styles.requiredBadge}>Required</span>}
                  {mode === "manual" && (
                    <span className={stateBadge(current).className}>{stateBadge(current).label}</span>
                  )}
                </div>
                <h2 className={styles.headline}>{current.title}</h2>
                <p className={styles.description}>{current.description}</p>

                {/* Reviewing an already-handled item in the manual reopen view stays read-only —
                    its action buttons are gone so re-clicking can't re-trigger a Hub-generated
                    Feed activity or need to re-acknowledge a required item to stop blocking. */}
                {!handled && (
                  <div className={styles.cardActions}>
                    {isRequired ? (
                      <button
                        className={styles.primaryAction}
                        disabled={isPending}
                        onClick={() => void handleRequiredAction(current)}
                      >
                        {(current.ctaLabel || DEFAULT_CTA_LABEL[current.type]) + " & Acknowledge"}
                      </button>
                    ) : (
                      <>
                        <button
                          className={styles.primaryAction}
                          disabled={isPending}
                          onClick={() => void handleCta(current)}
                        >
                          {current.myActed
                            ? `${current.ctaLabel || DEFAULT_CTA_LABEL[current.type]} ✓`
                            : current.ctaLabel || DEFAULT_CTA_LABEL[current.type]}
                        </button>
                        <button
                          className={styles.dismissAction}
                          disabled={isPending}
                          onClick={() => void handleDismiss(current)}
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {blocked && (
          <div className={styles.blockedHint}>Acknowledge required items above to continue.</div>
        )}

        {count > 1 && (
          <div className={styles.nav}>
            <button
              className={styles.navButton}
              aria-label="Previous item"
              onClick={() => setIndex((i) => (i - 1 + count) % count)}
            >
              <span aria-hidden="true">‹</span>
            </button>

            <div className={styles.navCenter}>
              <div className={styles.dots} role="tablist" aria-label="Hub items">
                {visibleItems.map((item, i) => (
                  <button
                    key={item.id}
                    role="tab"
                    aria-selected={i === safeIndex}
                    aria-label={`Item ${i + 1} of ${count}`}
                    className={i === safeIndex ? `${styles.dot} ${styles.dotActive}` : styles.dot}
                    onClick={() => setIndex(i)}
                  />
                ))}
              </div>
              <div className={styles.navCount}>{`${safeIndex + 1} of ${count}`}</div>
              {next && <div className={styles.navNext}>{`Next: ${next.title}`}</div>}
            </div>

            <button
              className={styles.navButton}
              aria-label="Next item"
              onClick={() => setIndex((i) => (i + 1) % count)}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default CompanyHub;
