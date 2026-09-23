import { useCallback, useEffect, useState } from "react";
import HudIcon from "../HudIcon";
import { teamMapService, type WorkingTodayShare } from "../../services/teamMap";
import styles from "./HudSettings.module.css";

// PRIVACY — where an employee REVOKES what they shared.
//
// There is exactly one thing this product ever learns about somebody that is not derived from Atlas:
// the exact point they chose to publish with "Working today" on the Global Team Map. Everything else on
// that map is the backend's coarse projection (see services/teamMap/types.ts, which says so on the type).
// So this section has one subject, and it is that share.
//
// IT IS NOT A SECOND SHARING UI. Starting a share needs a browser geolocation prompt and a map to see
// the result on, and TeamMapPanel already owns both. What a settings panel is for is the other
// direction: the place people look when they want something they turned on turned off. Both buttons are
// the EXISTING service calls the map panel makes — stopWorkingToday and forgetWorkingToday — not a new
// path to the backend.
//
// IT FETCHES ONLY WHEN OPENED. The component is mounted by the Privacy category and by nothing else, so
// a person who never opens Privacy never makes this request.

type Load = { status: "loading" } | { status: "ready"; share: WorkingTodayShare | null } | { status: "error" };

function formatExpiry(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function HudPrivacySettings() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (signal?: { cancelled: boolean }) => {
    try {
      const snapshot = await teamMapService.getPeople();
      if (signal?.cancelled) return;
      setLoad({ status: "ready", share: snapshot.me ?? null });
    } catch {
      if (signal?.cancelled) return;
      setLoad({ status: "error" });
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void refresh(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [refresh]);

  const run = useCallback(
    async (action: "stop" | "forget") => {
      setBusy(true);
      try {
        if (action === "stop") await teamMapService.stopWorkingToday();
        else await teamMapService.forgetWorkingToday();
        await refresh();
      } catch {
        setLoad({ status: "error" });
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const share = load.status === "ready" ? load.share : null;
  const sharing = share?.active === true;

  return (
    <section className={styles.section} aria-label="Privacy">
      <h3 className={styles.sectionTitle}>Location sharing</h3>
      <div className={styles.card}>
        <div className={styles.cardRow}>
          <span className={styles.cardIcon} aria-hidden="true">
            <HudIcon name="map" size="24px" />
          </span>
          <div className={styles.cardText}>
            <span className={styles.rowLabel}>Working today</span>
            <span className={styles.rowHint}>
              The one place your exact location is ever shared. Everywhere else on the map, coworkers see
              only the city your profile is in.
            </span>
          </div>
        </div>
        <p className={styles.cardStatus} data-testid="privacy-share-status">
          {load.status === "loading"
            ? "Checking…"
            : load.status === "error"
              ? "Could not check your sharing status right now."
              : sharing
                ? `Sharing ${share!.location_label} until ${formatExpiry(share!.expires_at)}.`
                : share
                  ? `Not sharing. Your last shared location (${share.location_label}) is still saved.`
                  : "Not sharing. Nothing of yours is saved."}
        </p>
        {(sharing || share) && (
          <div className={styles.buttonRow}>
            {sharing && (
              <button
                type="button"
                className={styles.actionButton}
                disabled={busy}
                onClick={() => void run("stop")}
              >
                Stop sharing
              </button>
            )}
            {share && (
              <button
                type="button"
                className={`${styles.actionButton} ${styles.actionDanger}`}
                disabled={busy}
                onClick={() => void run("forget")}
              >
                Remove saved location
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default HudPrivacySettings;
