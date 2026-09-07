import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./RewardsPanel.module.css";
import { ProgressionStrip } from "./RewardControls";
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

// Rewards panel — Coins-based redemption over the code-defined demo catalog. Shell shared with
// the Quests/Missions panels. Two tabs: Catalog (cost, affordability, Redeem with an inline
// confirm) and History (status per redemption, Cancel while pending). Every balance shown is the
// server's: the redeem/cancel responses carry the post-ledger progression, folded into the shared
// store so the HUD's Coins counter eases down/up with a pulse. No new FX system.

const STATUS_LABEL: Record<Redemption["status"], string> = {
  pending: "Pending approval",
  approved: "Approved",
  fulfilled: "Fulfilled",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
const CATEGORY_LABEL: Record<CatalogItem["category"], string> = {
  voucher: "Voucher",
  perk: "Perk",
  time_off: "Time off",
  custom: "Custom",
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
  const [confirming, setConfirming] = useState<string | null>(null);
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
    setConfirming(null);
    try {
      const res = await redeemReward(item.id, newIdempotencyKey()); // one key per press
      applyProgression(res.progression);
      setHistory((prev) => (prev ? [res.redemption, ...prev.filter((r) => r.id !== res.redemption.id)] : [res.redemption]));
      setItems((prev) => prev?.map((i) => ({ ...i, affordable: res.progression.coins >= i.cost })) ?? prev);
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

  const pendingCount = history?.filter((r) => r.status === "pending").length ?? 0;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} role="dialog" aria-label="Rewards" onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close rewards">
          ✕
        </button>
        <header className={styles.header}>
          <h2 className={styles.title}>Rewards</h2>
          <p className={styles.muted}>Spend your Coins on demo rewards. Some need an approver.</p>
          <ProgressionStrip progression={progression} />
        </header>
        <div className={styles.tabs} role="tablist">
          <button role="tab" aria-selected={tab === "catalog"} className={tab === "catalog" ? styles.tabActive : styles.tab} onClick={() => setTab("catalog")}>
            Catalog
          </button>
          <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? styles.tabActive : styles.tab} onClick={() => setTab("history")}>
            History{pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
          </button>
        </div>
        <div className={styles.body}>
          {error && <p className={styles.error}>{error}</p>}
          {tab === "catalog" && !items && !error && <p className={styles.muted}>Loading…</p>}
          {tab === "catalog" && items && (
            <ul className={styles.grid} data-testid="reward-catalog">
              {items.map((item) => (
                <li key={item.id} className={item.affordable ? styles.card : styles.cardDim} data-testid={`reward-${item.id}`} data-affordable={item.affordable ? "true" : "false"}>
                  <div className={styles.cardTop}>
                    <span className={styles.category}>{CATEGORY_LABEL[item.category]}</span>
                    <span className={styles.cost} data-testid={`reward-${item.id}-cost`}>
                      🪙 {item.cost}
                    </span>
                  </div>
                  <span className={styles.cardTitle}>{item.title}</span>
                  <span className={styles.desc}>{item.description}</span>
                  {item.requiresApproval && <span className={styles.approval}>Needs approval</span>}
                  {confirming === item.id ? (
                    <div className={styles.confirm} data-testid={`reward-${item.id}-confirm`}>
                      <span>Redeem for 🪙 {item.cost}?</span>
                      <button className={styles.redeem} onClick={() => void redeem(item)} disabled={busy !== null} aria-label={`Confirm redeem ${item.title}`}>
                        {busy === item.id ? "Redeeming…" : "Confirm"}
                      </button>
                      <button className={styles.ghost} onClick={() => setConfirming(null)} aria-label={`Keep coins, do not redeem ${item.title}`}>
                        Keep coins
                      </button>
                    </div>
                  ) : (
                    <button
                      className={styles.redeem}
                      onClick={() => setConfirming(item.id)}
                      disabled={!item.affordable || busy !== null}
                      aria-label={`Redeem ${item.title}`}
                      title={item.affordable ? undefined : "Not enough Coins yet"}
                    >
                      {item.affordable ? "Redeem" : "Not enough Coins"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {tab === "history" && !history && <p className={styles.muted}>Loading…</p>}
          {tab === "history" && history && history.length === 0 && <p className={styles.muted}>No redemptions yet.</p>}
          {tab === "history" && history && history.length > 0 && (
            <ol className={styles.list} data-testid="reward-history">
              {history.map((r) => (
                <li key={r.id} className={styles.row} data-testid={`redemption-${r.id}`} data-status={r.status}>
                  <div className={styles.rowMain}>
                    <span className={styles.rowTitle}>{r.title}</span>
                    <span className={styles.rowMeta}>
                      🪙 {r.cost} · {new Date(r.createdAt).toLocaleDateString()}
                      {r.note ? ` · “${r.note}”` : ""}
                    </span>
                  </div>
                  <span className={`${styles.status} ${styles[`status_${r.status}`]}`} data-testid={`redemption-${r.id}-status`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                  {r.status === "pending" && (
                    <button className={styles.ghost} onClick={() => void cancel(r)} disabled={busy !== null} aria-label={`Cancel ${r.title}`}>
                      {busy === r.id ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

export default RewardsPanel;
