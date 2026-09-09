import type { ReactNode } from "react";
import { BackgroundMusicControl } from "../../audio/BackgroundMusicControl";
import styles from "./HudSettings.module.css";

// SETTINGS — what the dock's ••• opens. Game/system preferences ONLY; product features are dock
// tiles and never hide in here.
//
// Every row below is a REAL, working control. Display and Graphics deliberately have no rows yet:
// this build has no user-settable display or graphics preference to expose (motion reduction comes
// from the OS via prefers-reduced-motion, and renderer quality is derived from device pixel ratio),
// and shipping dead toggles would be worse than shipping none. The sections land here when a real
// setting exists behind them.
//
// Sound is the existing BackgroundMusicControl, mounted a second time. That is safe and
// intentional: the audio itself lives in a singleton outside the component
// (audio/backgroundMusic.ts), so both instances read and write the same mute/volume store. The
// instance in App.tsx stays mounted (hidden) purely so autoplay is still armed at app start
// rather than only once somebody opens this panel.

export interface HudSettingsProps {
  /** DEV-only demo tool, kept in its own DEV-gated section rather than mixed in with real
   *  preferences. Undefined in production builds. */
  onResetHubDemo?: () => void;
  /** DEV-only panels relocated off the office canvas into this menu — the day/night scrubber and
   *  the checkout debug panel, passed through as the EXISTING components with their existing
   *  handlers (see OfficeMap.tsx). Undefined in production builds. */
  devTools?: ReactNode;
}

export function HudSettings({ onResetHubDemo, devTools }: HudSettingsProps) {
  return (
    <div className={styles.panel} data-testid="hud-settings">
      <h2 className={styles.title}>Settings</h2>

      <section className={styles.section} aria-label="Sound">
        <h3 className={styles.sectionTitle}>Sound</h3>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Music</span>
          <BackgroundMusicControl />
        </div>
      </section>

      {(onResetHubDemo || devTools) && (
        <section className={styles.section} aria-label="Developer">
          <h3 className={styles.sectionTitle}>Developer</h3>
          {onResetHubDemo && (
            <button type="button" className={styles.devButton} onClick={onResetHubDemo}>
              ♻️ Reset Hub demo state
            </button>
          )}
          {devTools && <div className={styles.devTools}>{devTools}</div>}
        </section>
      )}
    </div>
  );
}

export default HudSettings;
