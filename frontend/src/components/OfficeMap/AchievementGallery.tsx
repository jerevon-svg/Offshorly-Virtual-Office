import { useRef, useState, type ReactNode } from "react";
import styles from "./AchievementGallery.module.css";
import { BadgeMedallion } from "./BadgeMedallion";
import { ClaimButton, RewardTag } from "./RewardControls";
import { collectReward } from "./rewardFx";
import { badgeMasterUrl, emblemArtworkUrl, emblemFor } from "../../data/badgeEmblems";
import { badgeState, strongestBadges } from "../../services/quests/badgeView";
import { beginClaimSession, endClaimSession } from "../../services/quests/claimHudStore";
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

type CategoryFilter = BadgeCategory | "all";

const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
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

function Emblem({ badge, size }: { badge: Badge; size: "card" | "detail" }) {
  // A production master already IS the whole collectible — silhouette and tier material baked into
  // the render — so it is drawn bare. Wrapping it in the rim/plate construction below would put a
  // second, contradictory badge around it.
  const master = badgeMasterUrl(badge.emblem, badge.tier);
  if (master) {
    return (
      <span
        className={`${styles.master} ${styles[`master_${size}`]}`}
        aria-hidden="true"
        data-testid={`emblem-${badge.id}`}
        data-tier={badge.tier}
      >
        <img className={styles.masterArt} src={master} alt="" />
      </span>
    );
  }
  const emblem = emblemFor(badge.emblem);
  const art = emblemArtworkUrl(emblem);
  const cls = `${styles.emblem} ${styles[`emblem_${size}`]} ${TIER_CLASS[badge.tier]}`;
  return (
    <span className={cls} style={{ ["--accent" as string]: emblem.accent }} aria-hidden="true" data-testid={`emblem-${badge.id}`}>
      {art ? <img className={styles.emblemArt} src={art} alt="" /> : <span className={styles.emblemGlyph}>{emblem.glyph}</span>}
    </span>
  );
}

/** The ladder mark for one tier row. Where masters exist the row shows THAT TIER'S actual badge,
 *  so Bronze->Platinum reads as one collectible re-struck in four metals rather than four stars.
 *  Art stays at full colour even when the tier is locked — the material progression IS the thing
 *  being previewed; the row's own dimming already says "not yours yet". */
function TierMark({ badge, tier, earned }: { badge: Badge; tier: number; earned: boolean }) {
  const master = badgeMasterUrl(badge.emblem, tier);
  if (!master) {
    return (
      <span className={`${styles.tierMark} ${earned ? TIER_CLASS[tier] : styles.tier0}`} aria-hidden="true">
        {earned ? "\u2605" : "\u2606"}
      </span>
    );
  }
  return (
    <span className={styles.tierMarkArt} aria-hidden="true" data-testid={`tier-art-${badge.id}-${tier}`}>
      <img className={styles.masterArt} src={master} alt="" />
    </span>
  );
}

/** Pinned showcase artwork: the master where one exists, else the drawn medallion. Both keep the
 *  `medallion-<id>` hook and the tier attribute the profile's tests read. */
function PinnedArt({ badge }: { badge: Badge }) {
  const master = badgeMasterUrl(badge.emblem, badge.tier);
  if (!master) return <BadgeMedallion emblem={badge.emblem} tier={badge.tier} badgeId={badge.id} />;
  return (
    <img
      className={styles.masterArt}
      src={master}
      alt=""
      aria-hidden="true"
      data-testid={`medallion-${badge.id}`}
      data-tier={badge.tier}
    />
  );
}

/** Profile tab showcase: the three strongest earned badges. No user pinning yet — derived only. */
export function PinnedBadges({ badges, action }: { badges: Badge[] | null; action?: ReactNode }) {
  if (!badges) return null;
  const pinned = strongestBadges(badges, 3);
  const unclaimed = unclaimedTierCount(badges);
  return (
    <div className={styles.pinned} data-testid="pinned-badges">
      <div className={styles.pinnedHeader}>
        <span className={styles.pinnedTitle}>Pinned badges</span>
        <span className={styles.pinnedMeta} data-testid="pinned-summary">
          {badges.filter((b) => b.tier > 0).length}/{badges.length} earned{unclaimed > 0 ? ` · ${unclaimed} to claim` : ""}
        </span>
        {/* Optional trailing control (the profile sidebar's Edit). This component owns the ONE
            header — the caller adding a second one is what produced a duplicated title. */}
        {action}
      </div>
      {pinned.length === 0 ? (
        <p className={styles.pinnedEmpty}>No badges yet — check in, chat with coworkers, give someone Kudos.</p>
      ) : (
        <ul className={styles.pinnedRow}>
          {pinned.map((b) => (
            <li key={b.id} className={styles.pinnedItem} data-testid={`pinned-${b.id}`}>
              <span className={styles.pinnedArt}>
                <PinnedArt badge={b} />
              </span>
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
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const claimingRef = useRef<string | null>(null); // synchronous guard: a double-click is one claim
  const [error, setError] = useState<string | null>(null);

  const selected = badges?.find((b) => b.id === selectedId) ?? null;
  const visible = badges?.filter((b) => category === "all" || b.category === category) ?? [];

  const claim = async (badge: Badge, tier: number, source: DOMRect) => {
    if (claimingRef.current) return;
    const key = `${badge.id}@${tier}`;
    claimingRef.current = key;
    setClaiming(key);
    // Show the claim-time progression strip so the reward FX has a visible destination. The
    // Profile modal sets officeToolOpen, which hides the dock the particles normally land on —
    // without this the coins and XP fly at an off-screen target, exactly as they did for Tasks.
    beginClaimSession();
    try {
      const res = await claimReward(badge.id, badgeTierPeriodKey(tier));
      void collectReward(res, source); // server-confirmed only; replays sync silently
      await refreshBadges(); // flips the tier to Claimed from the server's truth
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't claim that reward");
    } finally {
      claimingRef.current = null;
      setClaiming(null);
      endClaimSession();
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
  return (
    <div className={styles.gallery} data-testid="achievement-gallery">
      {/* The primary nav is icon-only now, so this heading is what names the page. It also
          absorbed the old summary BAR — the same two numbers, read as a sentence under the
          title instead of as a separate green strip. */}
      <header className={styles.head}>
        <h3 className={styles.headTitle}>Your achievements</h3>
        <p className={styles.headSubtitle}>Small milestones. A growing collection.</p>
        <p className={styles.headMeta} data-testid="gallery-summary">
          <span className={styles.headCount}>
            {earnedHere}/{visible.length}
          </span>
          {" earned · "}
          {unclaimedTierCount(badges) > 0 ? `${unclaimedTierCount(badges)} rewards to claim` : "All rewards claimed"}
        </p>
      </header>
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
          </button>
        ))}
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
        {nextReward ? <RewardTag xp={nextReward.xp} coins={nextReward.coins} /> : "All tiers earned"}
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
  const { pct } = bandProgress(b);
  return (
    <div className={styles.detail} data-testid={`achievement-detail-${b.id}`} data-state={badgeState(b)}>
      {/* Two columns: the collectible on the left, the ladder it climbs on the right. The old
          stacked layout put the hero on one line and left the tier rows running the full panel
          width, which wasted the horizontal space this panel actually has. */}
      <section className={styles.showcase}>
        <Emblem badge={b} size="detail" />
        <h3 className={styles.showcaseTitle}>{b.title}</h3>
        <span className={`${styles.showcaseTier} ${TIER_CLASS[b.tier]}`}>{TIER_LABEL[b.tier]}</span>
        <p className={styles.showcaseDesc}>{b.description}</p>
        <div className={styles.showcaseStats}>
          <span className={styles.stat}>
            <span className={styles.statValue}>
              {b.nextThreshold !== null ? `${b.metric} / ${b.nextThreshold}` : b.metric}
            </span>
            <span className={styles.statLabel}>Progress</span>
          </span>
          <span className={styles.stat}>
            <span className={styles.statValue}>{b.nextThreshold !== null ? `${pct}%` : "100%"}</span>
            <span className={styles.statLabel}>To next tier</span>
          </span>
        </div>
      </section>

      <section className={styles.ladder}>
        <h4 className={styles.ladderTitle}>Progression tiers</h4>
        <p className={styles.ladderSubtitle}>Reach each milestone to earn rewards.</p>
        <ol className={styles.tiers}>
          {b.thresholds.map((threshold, i) => {
            const tier = i + 1;
            const earned = b.tier >= tier;
            const claimed = b.tiersClaimedAt[i] !== null;
            const reward = b.tierRewards[i];
            const state = claimed ? "claimed" : earned ? "earned" : "locked";
            return (
              <li key={tier} className={styles.tierRow} data-testid={`tier-${b.id}-${tier}`} data-state={state}>
                {/* The rail marker: a filled tick once reached. The connecting line is drawn by
                    the rail's ::before so it never crosses the first or last marker. */}
                <span className={styles.tierRail} aria-hidden="true">
                  <span className={styles.tierDot}>{earned ? "\u2713" : ""}</span>
                </span>
                <TierMark badge={b} tier={tier} earned={earned} />
                <div className={styles.tierText}>
                  <span className={`${styles.tierName} ${earned ? TIER_CLASS[tier] : ""}`}>{TIER_LABEL[tier]}</span>
                  <span className={styles.tierReq}>
                    {b.metric >= threshold ? `${threshold} reached` : `${Math.min(b.metric, threshold)} / ${threshold}`}
                  </span>
                </div>
                <span className={styles.tierReward}>
                  <RewardTag xp={reward.xp} coins={reward.coins} />
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
      </section>
    </div>
  );
}

export default AchievementGallery;
