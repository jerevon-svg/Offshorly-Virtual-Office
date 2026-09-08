import { useRef, useState } from "react";
import styles from "./AchievementGallery.module.css";
import { ClaimButton } from "./RewardControls";
import { collectReward } from "./rewardFx";
import { emblemArtworkUrl, emblemFor } from "../../data/badgeEmblems";
import { badgeState, strongestBadges } from "../../services/quests/badgeView";
import { refreshBadges, unclaimedTierCount, useProgressionStore } from "../../services/quests/progressionStore";
import { badgeTierPeriodKey, claimReward, type Badge, type BadgeCategory } from "../../services/quests/questsClient";

// Achievements — Badge Progression's collectible view, rendered INSIDE the Employee Profile's
// Achievements tab (no modal of its own). Reads the shared store (server-computed tiers, rewards,
// claimed state). The ONE write is claiming an earned tier's XP/Coins bonus, through the same
// POST /progression/claim as quests and missions (questId=<badge_id>, periodKey="t:<tier>"), then
// the same staged collection FX from the clicked ClaimButton to the HUD.
//
// Information hierarchy (game achievement screens, adapted to VO's dark language, no borrowed
// art): prominent category nav → category summary → card grid with the emblem as the focus, tier,
// progress and next reward on every card → card detail with the Bronze→Platinum ladder.

const CATEGORIES: { id: BadgeCategory; label: string }[] = [
  { id: "engagement", label: "Engagement" },
  { id: "social", label: "Social" },
  { id: "contribution", label: "Contribution" },
  { id: "growth", label: "Growth" },
];
const TIER_LABEL = ["Locked", "Bronze", "Silver", "Gold", "Platinum"] as const;
const TIER_CLASS = [styles.tier0, styles.tier1, styles.tier2, styles.tier3, styles.tier4] as const;

function bandProgress(b: Badge): { into: number; span: number; pct: number } {
  const floor = b.tier > 0 ? b.thresholds[b.tier - 1] : 0;
  if (b.nextThreshold === null) return { into: 1, span: 1, pct: 100 };
  const span = Math.max(1, b.nextThreshold - floor);
  const into = Math.max(0, Math.min(span, b.metric - floor));
  return { into, span, pct: Math.round((into / span) * 100) };
}

function Emblem({ badge, size }: { badge: Badge; size: "card" | "pinned" | "detail" }) {
  const emblem = emblemFor(badge.emblem);
  const art = emblemArtworkUrl(emblem);
  const cls = `${styles.emblem} ${styles[`emblem_${size}`]} ${TIER_CLASS[badge.tier]}`;
  return (
    <span className={cls} style={{ ["--accent" as string]: emblem.accent }} aria-hidden="true" data-testid={`emblem-${badge.id}`}>
      {art ? <img className={styles.emblemArt} src={art} alt="" /> : <span className={styles.emblemGlyph}>{emblem.glyph}</span>}
    </span>
  );
}

/** Profile tab showcase: the three strongest earned badges. No user pinning yet — derived only. */
export function PinnedBadges({ badges }: { badges: Badge[] | null }) {
  if (!badges) return null;
  const pinned = strongestBadges(badges, 3);
  const unclaimed = unclaimedTierCount(badges);
  return (
    <div className={styles.pinned} data-testid="pinned-badges">
      <div className={styles.pinnedHeader}>
        <span className={styles.pinnedTitle}>Pinned Badges</span>
        <span className={styles.pinnedMeta} data-testid="pinned-summary">
          {badges.filter((b) => b.tier > 0).length}/{badges.length} earned{unclaimed > 0 ? ` · ${unclaimed} to claim` : ""}
        </span>
      </div>
      {pinned.length === 0 ? (
        <p className={styles.pinnedEmpty}>No badges yet — check in, chat with coworkers, give someone Kudos.</p>
      ) : (
        <ul className={styles.pinnedRow}>
          {pinned.map((b) => (
            <li key={b.id} className={styles.pinnedItem} data-testid={`pinned-${b.id}`}>
              <Emblem badge={b} size="pinned" />
              <span className={styles.pinnedName}>{b.title}</span>
              <span className={`${styles.tierLabel} ${TIER_CLASS[b.tier]}`}>{TIER_LABEL[b.tier]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AchievementGallery() {
  const { badges } = useProgressionStore();
  const [category, setCategory] = useState<BadgeCategory>("engagement");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const claimingRef = useRef<string | null>(null); // synchronous guard: a double-click is one claim
  const [error, setError] = useState<string | null>(null);

  const selected = badges?.find((b) => b.id === selectedId) ?? null;
  const visible = badges?.filter((b) => b.category === category) ?? [];
  const claimableIn = (c: BadgeCategory) => unclaimedTierCount(badges?.filter((b) => b.category === c) ?? null);

  const claim = async (badge: Badge, tier: number, source: DOMRect) => {
    if (claimingRef.current) return;
    const key = `${badge.id}@${tier}`;
    claimingRef.current = key;
    setClaiming(key);
    try {
      const res = await claimReward(badge.id, badgeTierPeriodKey(tier));
      void collectReward(res, source); // server-confirmed only; replays sync silently
      await refreshBadges(); // flips the tier to Claimed from the server's truth
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't claim that reward");
    } finally {
      claimingRef.current = null;
      setClaiming(null);
    }
  };

  if (!badges) return <p className={styles.muted}>Loading…</p>;

  if (selected) {
    return (
      <div className={styles.gallery} data-testid="achievement-gallery">
        <button className={styles.back} onClick={() => setSelectedId(null)} aria-label="Back to all achievements">
          ‹ All achievements
        </button>
        {error && <p className={styles.error}>{error}</p>}
        <BadgeDetail badge={selected} claiming={claiming} onClaim={claim} />
      </div>
    );
  }

  const earnedHere = visible.filter((b) => b.tier > 0).length;
  const label = CATEGORIES.find((c) => c.id === category)?.label ?? "";
  return (
    <div className={styles.gallery} data-testid="achievement-gallery">
      <div className={styles.tabs} role="tablist" aria-label="Achievement categories">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={category === c.id}
            className={category === c.id ? styles.tabActive : styles.tab}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
            {claimableIn(c.id) > 0 && <span className={styles.tabDot} aria-label="Rewards to claim" />}
          </button>
        ))}
      </div>
      <div className={styles.summary} data-testid="gallery-summary">
        <span className={styles.summaryLabel}>{label}</span>
        <span className={styles.summaryCount}>
          {earnedHere}/{visible.length}
        </span>
        <span className={styles.summaryMeta}>
          {unclaimedTierCount(badges) > 0 ? `${unclaimedTierCount(badges)} rewards to claim` : "All rewards claimed"}
        </span>
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <ul className={styles.grid} data-testid="achievement-grid">
        {visible.map((b) => (
          <li key={b.id}>
            <BadgeCard badge={b} onOpen={() => setSelectedId(b.id)} />
          </li>
        ))}
        {visible.length === 0 && <li className={styles.muted}>Nothing in this category yet.</li>}
      </ul>
    </div>
  );
}

function BadgeCard({ badge: b, onOpen }: { badge: Badge; onOpen: () => void }) {
  const { into, span, pct } = bandProgress(b);
  const state = badgeState(b);
  const nextReward = b.nextThreshold !== null ? b.tierRewards[b.tier] : null;
  return (
    <button
      className={styles.card}
      onClick={onOpen}
      data-testid={`achievement-${b.id}`}
      data-tier={b.tier}
      data-state={state}
      aria-label={`${b.title}, ${TIER_LABEL[b.tier]}, ${state}`}
    >
      <span className={styles.cardTop}>
        <span className={`${styles.cardTierTag} ${TIER_CLASS[b.tier]}`}>{TIER_LABEL[b.tier]}</span>
        {state === "claimable" && (
          <span className={styles.cardClaimTag} data-testid={`achievement-${b.id}-unclaimed`}>
            Claim
          </span>
        )}
        {state === "complete" && <span className={styles.cardDoneTag}>✓</span>}
      </span>
      <Emblem badge={b} size="card" />
      <span className={styles.cardTitle}>{b.title}</span>
      <span className={styles.cardBar} role="progressbar" aria-valuemin={0} aria-valuemax={span} aria-valuenow={into}>
        <span className={`${styles.cardFill} ${TIER_CLASS[Math.min(4, b.tier + 1)]}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={styles.cardProgress}>
        {b.nextThreshold !== null ? `${b.metric} / ${b.nextThreshold}` : "Complete"}
      </span>
      <span className={styles.cardReward} data-testid={`achievement-${b.id}-reward`}>
        {nextReward ? `+${nextReward.xp} XP · +${nextReward.coins} 🪙` : "All tiers earned"}
      </span>
    </button>
  );
}

interface BadgeDetailProps {
  badge: Badge;
  claiming: string | null;
  onClaim: (badge: Badge, tier: number, source: DOMRect) => void;
}

function BadgeDetail({ badge: b, claiming, onClaim }: BadgeDetailProps) {
  return (
    <div className={styles.detail} data-testid={`achievement-detail-${b.id}`} data-state={badgeState(b)}>
      <div className={styles.detailHero}>
        <Emblem badge={b} size="detail" />
        <div className={styles.detailText}>
          <h3 className={styles.detailTitle}>{b.title}</h3>
          <p className={styles.detailDesc}>{b.description}</p>
          <p className={`${styles.tierLabel} ${TIER_CLASS[b.tier]}`}>{TIER_LABEL[b.tier]}</p>
        </div>
      </div>
      <ol className={styles.tiers}>
        {b.thresholds.map((threshold, i) => {
          const tier = i + 1;
          const earned = b.tier >= tier;
          const claimed = b.tiersClaimedAt[i] !== null;
          const reward = b.tierRewards[i];
          const state = claimed ? "claimed" : earned ? "earned" : "locked";
          return (
            <li key={tier} className={styles.tierRow} data-testid={`tier-${b.id}-${tier}`} data-state={state}>
              <span className={`${styles.tierMark} ${earned ? TIER_CLASS[tier] : styles.tier0}`} aria-hidden="true">
                {earned ? "★" : "☆"}
              </span>
              <div className={styles.tierText}>
                <span className={`${styles.tierName} ${earned ? TIER_CLASS[tier] : ""}`}>{TIER_LABEL[tier]}</span>
                <span className={styles.tierReq}>
                  {b.metric >= threshold ? `${threshold} reached` : `${Math.min(b.metric, threshold)} / ${threshold}`}
                </span>
              </div>
              <span className={styles.tierReward}>
                +{reward.xp} XP · +{reward.coins} 🪙
              </span>
              <ClaimButton
                completed={earned}
                claimed={claimed}
                pending={claiming === `${b.id}@${tier}`}
                onClaim={(source) => onClaim(b, tier, source)}
                label={`${b.title} ${TIER_LABEL[tier]}`}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default AchievementGallery;
