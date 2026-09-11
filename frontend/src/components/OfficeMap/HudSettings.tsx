import type { ReactNode } from "react";
import HudIcon from "../HudIcon";
import { BackgroundMusicControl } from "../../audio/BackgroundMusicControl";
import type { Phase } from "../../data/officePhase";
import styles from "./HudSettings.module.css";

// SETTINGS — a screen-owning dock tool (it used to be a flyout above the dock). Game/system
// preferences ONLY; product features are dock tiles and never hide in here.
//
// It wears the SAME cream modal shell as Tasks / Rewards / Notifications — same scrim, radius,
// border, shadow, entry animation and close button — and the dock, the Toucan and the minimized
// chat-head rail step aside for it through the EXISTING officeToolOpen path (OfficeMap.tsx).
//
// EVERY ROW IS A REAL, WORKING CONTROL. Display and Graphics deliberately still have no rows:
// this build has no user-settable display or graphics preference to expose (motion reduction
// comes from the OS via prefers-reduced-motion, and renderer quality is derived from device pixel
// ratio), and shipping dead toggles would be worse than shipping none.
//
// Sound is the existing BackgroundMusicControl, mounted a second time. That is safe and
// intentional: the audio itself lives in a singleton outside the component
// (audio/backgroundMusic.ts), so both instances read and write the same mute/volume store. The
// instance in App.tsx stays mounted (hidden) purely so autoplay is still armed at app start
// rather than only once somebody opens this panel.
//
// Appearance is the EXISTING day/night behavior, not a new one: useOfficePhase already owns an
// `overrideHour` that is null for real time and a pinned hour otherwise (it is even seeded from
// the ?time= query param in production). "Follow the time of day" is exactly that flag, so the
// toggle is genuinely functional rather than decorative, and the line under it quotes the real
// phase and hour the office is being lit by.

const PHASE_LABEL: Record<Phase, string> = {
  morning: "Morning",
  day: "Daytime",
  sunset: "Sunset",
  night: "Night",
};

function formatHour(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export interface HudSettingsLighting {
  phase: Phase;
  /** The hour the office is actually being lit by — already the effective one. */
  hourDecimal: number;
  /** True while the office follows real Manila time (useOfficePhase's overrideHour === null). */
  followingRealTime: boolean;
  /** Turns following on (real time) or off (pin the hour showing now). The caller passes
   *  useOfficePhase's own setter — no new lighting mechanism. */
  onFollowRealTimeChange: (following: boolean) => void;
}

export interface HudSettingsProps {
  onClose: () => void;
  /** Office lighting / day-night, from useOfficePhase. Omitted only where a caller has no phase
   *  state at all — the Appearance section then does not render rather than showing a dead row. */
  lighting?: HudSettingsLighting;
  /** DEV-only demo tool, kept in its own DEV-gated section rather than mixed in with real
   *  preferences. Undefined in production builds. */
  onResetHubDemo?: () => void;
  /** DEV-only panels relocated off the office canvas into this menu — the day/night scrubber and
   *  the checkout debug panel, passed through as the EXISTING components with their existing
   *  handlers (see OfficeMap.tsx). Undefined in production builds. */
  devTools?: ReactNode;
}

export function HudSettings({ onClose, lighting, onResetHubDemo, devTools }: HudSettingsProps) {
  return (
    <div
      className={styles.backdrop}
      data-testid="hud-settings-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="Settings" data-testid="hud-settings">
        <div className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <HudIcon name="settings" size="26px" />
          </span>
          <h2 className={styles.title}>Settings</h2>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className={styles.body}>
          <section className={styles.section} aria-label="Sound">
            <h3 className={styles.sectionTitle}>Sound</h3>
            <div className={styles.card}>
              <div className={styles.cardRow}>
                <div className={styles.cardText}>
                  <span className={styles.rowLabel}>Music</span>
                  <span className={styles.rowHint}>Office background music</span>
                </div>
                {/* The EXISTING control — its own mute button and volume slider, unforked. */}
                <BackgroundMusicControl />
              </div>
            </div>
          </section>

          {lighting && (
            <section className={styles.section} aria-label="Appearance">
              <h3 className={styles.sectionTitle}>Appearance</h3>
              <div className={styles.card}>
                <div className={styles.cardRow}>
                  <span className={styles.cardIcon} aria-hidden="true">
                    <HudIcon name="lighting" size="24px" />
                  </span>
                  <div className={styles.cardText}>
                    <span className={styles.rowLabel}>Office lighting</span>
                    <span className={styles.rowHint}>Follow the time of day</span>
                  </div>
                  <label className={styles.switch}>
                    <input
                      type="checkbox"
                      checked={lighting.followingRealTime}
                      onChange={(event) => lighting.onFollowRealTimeChange(event.target.checked)}
                      aria-label="Office lighting follows the time of day"
                    />
                    <span className={styles.switchTrack} aria-hidden="true">
                      <span className={styles.switchKnob} />
                    </span>
                  </label>
                </div>
                <p className={styles.cardStatus} data-testid="lighting-status">
                  {PHASE_LABEL[lighting.phase]} · {formatHour(lighting.hourDecimal)} ·{" "}
                  {lighting.followingRealTime ? "Real time" : "Held"}
                </p>
              </div>
            </section>
          )}

          {(onResetHubDemo || devTools) && (
            <details className={styles.devSection}>
              <summary className={styles.devSummary}>
                <span className={styles.cardText}>
                  <span className={styles.rowLabel}>Developer tools</span>
                  <span className={styles.rowHint}>Testing and demo controls</span>
                </span>
              </summary>
              <div className={styles.devBody}>
                {onResetHubDemo && (
                  <button type="button" className={styles.devButton} onClick={onResetHubDemo}>
                    ♻️ Reset Hub demo state
                  </button>
                )}
                {devTools && <div className={styles.devTools}>{devTools}</div>}
              </div>
            </details>
          )}
        </div>

        <p className={styles.footer}>
          <span className={styles.footerCheck} aria-hidden="true">
            ✓
          </span>
          Changes apply immediately
        </p>
      </div>
    </div>
  );
}

export default HudSettings;
