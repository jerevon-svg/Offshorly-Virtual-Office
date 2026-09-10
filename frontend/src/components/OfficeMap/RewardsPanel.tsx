import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./RewardsPanel.module.css";
import HudIcon from "../HudIcon";
import { rewardArtFor } from "./rewardArt";
import { applyProgression, refreshProgression, useProgression } from "../../services/quests/progressionStore";
import {
  cancelRedemption,
  fetchMyRedemptions,
  fetchRewardCatalog,
  newIdempotencyKey,
  redeemReward,
  type CatalogItem,
  type Redemption,
} from "../../services/quests/questsClient";

// Rewards panel — Coins-based redemption over the code-defined demo catalog. Two tabs: Catalog
// (select a card, then confirm from the sticky summary) and History (status per redemption,
// Cancel while pending). Every balance shown is the server's: the redeem/cancel responses carry
// the post-ledger progression, folded into the shared store so the HUD's Coins counter eases
// down/up with a pulse. No new FX system.
//
// PRESENTATION-ONLY REDESIGN. The two-step confirm is intact, not bypassed: `selectedId` IS the
// old `confirming` state — picking a card is the first step (it commits nothing), and the summary
// bar's Redeem is the second, calling the same redeem() with one idempotency key per press.
// Affordability, the busy guard, the ledger-authoritative balances and Cancel are all unchanged.

const STATUS_LABEL: Record<Redemption["status"], string> = {
  pending: "Pending approval",
  approved: "Approved",
  fulfilled: "Fulfilled",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** A short line under each status. Derived from the status alone — no new fields, no new data. */
const STATUS_HINT: Record<Redemption["status"], string> = {
  pending: "Waiting for your approver",
  approved: "Fulfilment being arranged",
  fulfilled: "Fulfilled by an approver",
  rejected: "Coins were returned",
  cancelled: "Coins were returned",
};

export interface RewardsPanelProps {
  onClose: () => void;
}

export function RewardsPanel({ onClose }: RewardsPanelProps) {
  const progression = useProgression();
  const [tab, setTab] = useState<"catalog" | "history">("catalog");
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [history, setHistory] = useState<Redemption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The pre-confirm selection — what `confirming` always was, now surfaced as a picked card.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null); // synchronous guard: a double-click is one request

  const load = useCallback(() => {
    let cancelled = false;
    fetchRewardCatalog()
      .then((c) => {
        if (cancelled) return;
        setItems(c.items);
        applyProgression(c.progression);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load rewards");
      });
    fetchMyRedemptions()
      .then((r) => {
        if (!cancelled) setHistory(r);
      })
      .catch(() => {});
    void refreshProgression();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const redeem = async (item: CatalogItem) => {
    if (busyRef.current) return;
    busyRef.current = item.id;
    setBusy(item.id);
    try {
      const res = await redeemReward(item.id, newIdempotencyKey()); // one key per press
      applyProgression(res.progression);
      setHistory((prev) => (prev ? [res.redemption, ...prev.filter((r) => r.id !== res.redemption.id)] : [res.redemption]));
      setItems((prev) => prev?.map((i) => ({ ...i, affordable: res.progression.coins >= i.cost })) ?? prev);
      setSelectedId(null);
      setTab("history");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't redeem that reward");
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  };

  const cancel = async (r: Redemption) => {
    if (busyRef.current) return;
    busyRef.current = r.id;
    setBusy(r.id);
    try {
      const res = await cancelRedemption(r.id);
      applyProgression(res.progression);
      setHistory((prev) => prev?.map((x) => (x.id === r.id ? res.redemption : x)) ?? prev);
      setItems((prev) => prev?.map((i) => ({ ...i, affordable: res.progression.coins >= i.cost })) ?? prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't cancel that redemption");
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  };

  const selected = useMemo(
    () => items?.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );
  const coins = progression?.coins ?? 0;
  // Kept from the previous design: how many redemptions are still awaiting an approver. The tab
  // label itself is plain per the mock, so this rides as a small count badge rather than text.
  const pendingCount = history?.filter((r) => r.status === "pending").length ?? 0;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-label="Rewards" onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <HudIcon name="rewards" size="34px" />
          </span>
          <div className={styles.headerText}>
            <h2 className={styles.title}>Rewards</h2>
            <p className={styles.subtitle}>Little perks, earned by you.</p>
          </div>
          {/* The real balance, straight from the shared progression store. */}
          <span className={styles.balance} data-testid="rewards-balance">
            <HudIcon name="coin" size="20px" />
            {`${coins.toLocaleString()} Coins`}
          </span>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close rewards">
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div className={styles.tabRow}>
          <div className={styles.tabs} role="tablist" aria-label="Rewards">
            {(["catalog", "history"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={tab === value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => setTab(value)}
              >
                {value === "catalog" ? "Catalog" : "History"}
                {value === "history" && pendingCount > 0 && (
                  <span className={styles.tabBadge} data-testid="rewards-pending-count">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          <span className={styles.tabRule} aria-hidden="true" />
          {tab === "catalog" && <span className={styles.tabNote}>Demo catalog</span>}
        </div>

        <div className={styles.body}>
          {error && <p className={styles.error}>{error}</p>}

          {tab === "catalog" && !items && !error && <p className={styles.muted}>Loading…</p>}
          {tab === "catalog" && items && (
            <ul className={styles.grid} data-testid="reward-catalog">
              {items.map((item) => {
                const short = coins < item.cost ? item.cost - coins : 0;
                const isSelected = selectedId === item.id;
                return (
                  <li key={item.id} className={styles.gridCell}>
                    <button
                      type="button"
                      className={[
                        styles.card,
                        item.affordable ? "" : styles.cardDim,
                        isSelected ? styles.cardSelected : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-testid={`reward-${item.id}`}
                      data-affordable={item.affordable ? "true" : "false"}
                      data-selected={isSelected ? "true" : "false"}
                      aria-pressed={isSelected}
                      aria-label={`Select ${item.title}`}
                      onClick={() => setSelectedId(isSelected ? null : item.id)}
                    >
                      <span className={styles.thumb}>
                        <img className={styles.thumbArt} src={rewardArtFor(item.id)} alt="" />
                        {isSelected && (
                          <span className={styles.thumbCheck} aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </span>
                      <span className={styles.cardTitle}>{item.title}</span>
                      <span className={styles.desc}>{item.description}</span>
                      {item.requiresApproval && (
                        <span className={styles.approval}>
                          <HudIcon name="profile" size="14px" />
                          Approval needed
                        </span>
                      )}
                      <span className={styles.costRow}>
                        <span className={styles.cost} data-testid={`reward-${item.id}-cost`}>
                          <HudIcon name="coin" size="18px" />
                          {item.cost}
                        </span>
                        {short > 0 && <span className={styles.short}>{`${short} more Coins`}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {tab === "history" && !history && <p className={styles.muted}>Loading…</p>}
          {tab === "history" && history && history.length === 0 && (
            <p className={styles.muted}>No redemptions yet.</p>
          )}
          {tab === "history" && history && history.length > 0 && (
            <>
              <div className={styles.historyHead}>
                <span className={styles.historyLabel}>Your redemptions</span>
                <span className={styles.historyNote}>Newest first</span>
              </div>
              <ol className={styles.list} data-testid="reward-history">
                {history.map((r) => (
                  <li key={r.id} className={styles.row} data-testid={`redemption-${r.id}`} data-status={r.status}>
                    <span className={styles.rowThumb}>
                      <img className={styles.rowArt} src={rewardArtFor(r.itemId)} alt="" />
                    </span>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{r.title}</span>
                      <span className={styles.rowMeta}>
                        {`Requested ${new Date(r.createdAt).toLocaleDateString()}`}
                        {r.note ? ` · “${r.note}”` : ""}
                      </span>
                    </div>
                    <div className={styles.rowRight}>
                      <span className={styles.rowCost}>
                        <HudIcon name="coin" size="18px" />
                        {r.cost}
                      </span>
                      <span
                        className={`${styles.status} ${styles[`status_${r.status}`]}`}
                        data-testid={`redemption-${r.id}-status`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                      <span className={styles.statusHint}>{STATUS_HINT[r.status]}</span>
                      {r.status === "pending" && (
                        <button
                          className={styles.ghost}
                          onClick={() => void cancel(r)}
                          disabled={busy !== null}
                          aria-label={`Cancel ${r.title}`}
                        >
                          {busy === r.id ? "Cancelling…" : "Cancel"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        {/* Sticky selection summary — the CONFIRM step. Empty-state copy until a card is picked. */}
        {tab === "catalog" && (
          <footer className={styles.footer}>
            {selected ? (
              <div className={styles.summary} data-testid="reward-selection">
                <span className={styles.summaryThumb}>
                  <img className={styles.summaryArt} src={rewardArtFor(selected.id)} alt="" />
                </span>
                <div className={styles.summaryText}>
                  <span className={styles.summaryTitle}>{selected.title}</span>
                  <span className={styles.summaryMeta}>
                    {`${selected.cost} Coins`}
                    {selected.requiresApproval ? " · Fulfilled by an approver" : ""}
                  </span>
                </div>
                <button
                  className={styles.redeem}
                  onClick={() => void redeem(selected)}
                  disabled={!selected.affordable || busy !== null}
                  aria-label={`Confirm redeem ${selected.title}`}
                  title={selected.affordable ? undefined : "Not enough Coins yet"}
                >
                  {busy === selected.id
                    ? "Redeeming…"
                    : selected.affordable
                      ? `Redeem · ${selected.cost}`
                      : "Not enough Coins"}
                  {selected.affordable && busy !== selected.id && <HudIcon name="coin" size="17px" />}
                </button>
              </div>
            ) : (
              <div className={styles.empty}>
                <HudIcon name="rewards" size="26px" />
                <span className={styles.emptyTitle}>Choose a reward to see its details</span>
                <span className={styles.emptyHint}>Your Coins stay yours until you confirm.</span>
              </div>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

export default RewardsPanel;
