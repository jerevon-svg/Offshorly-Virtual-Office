import { useSyncExternalStore } from "react";
import HudIcon from "../HudIcon";
import {
  CUSTOM_CONTROLS,
  resolveGraphics,
  type CustomControlId,
  type GraphicsMode,
} from "../../services/render/graphicsQuality";
import {
  getGraphicsPreference,
  setCustomGraphicsControl,
  setGraphicsMode,
  subscribeGraphics,
} from "../../services/render/graphicsPreferences";
import styles from "./HudSettings.module.css";

// GRAPHICS & DISPLAY — the section of the EXISTING Settings modal that used to say, in a comment, that
// there was nothing real to put here yet (see HudSettings.tsx). There is now: the V2 renderer has a
// mode system and a set of genuinely safe switches behind it, so these rows are live controls rather
// than the dead toggles that comment was refusing to ship.
//
// It reuses the panel's own card/row/section classes verbatim — no second settings surface, no new
// visual language, and nothing here belongs in the Room Editor (that edits the office; this edits how
// the office is DRAWN for you).
//
// THE ONE PRODUCT RULE ENCODED HERE: touching an individual control switches the mode to Custom. It is
// enforced in the STORE rather than in this component (setCustomGraphicsControl), so it holds however
// the control is reached; the component only has to render the result.

const MODE_OPTIONS: readonly { value: GraphicsMode; label: string; hint: string }[] = [
  {
    value: "smooth",
    label: "Smooth — Recommended",
    hint: "Balances quality against your machine's measured performance",
  },
  { value: "full", label: "Full Graphics", hint: "Every effect at full quality, never adjusted" },
  { value: "custom", label: "Custom", hint: "Choose each setting yourself" },
];

/** The store, as a React source. useSyncExternalStore because the store is a plain module that the
 *  3D renderer also reads — the exact reason backgroundMusic.ts is shaped the same way. */
function useGraphicsPreference() {
  return useSyncExternalStore(subscribeGraphics, getGraphicsPreference, getGraphicsPreference);
}

export function HudGraphicsSettings() {
  const { mode, custom } = useGraphicsPreference();
  // What the renderer would run at RIGHT NOW in this mode, at the top rung. Smooth's live rung is a
  // property of the machine and the moment, so the panel describes the mode rather than pretending to
  // report a number that changes while it is open.
  const resolved = resolveGraphics(mode, 3, custom);

  return (
    <section className={styles.section} aria-label="Graphics and display">
      <h3 className={styles.sectionTitle}>Graphics &amp; Display</h3>

      <div className={styles.card}>
        <div className={styles.cardRow}>
          <span className={styles.cardIcon} aria-hidden="true">
            <HudIcon name="video" size="24px" />
          </span>
          <div className={styles.cardText}>
            <span className={styles.rowLabel}>Graphics mode</span>
            <span className={styles.rowHint}>How much work the office spends on each frame</span>
          </div>
        </div>
        <div className={styles.choiceList} role="radiogroup" aria-label="Graphics mode">
          {MODE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={styles.choice}
              data-selected={mode === option.value ? "true" : undefined}
            >
              <input
                type="radio"
                name="graphics-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setGraphicsMode(option.value)}
              />
              <span className={styles.choiceMark} aria-hidden="true" />
              <span className={styles.cardText}>
                <span className={styles.rowLabel}>{option.label}</span>
                <span className={styles.rowHint}>{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className={styles.cardStatus} data-testid="graphics-mode-status">
          {mode === "smooth"
            ? "Adjusts automatically while you work — it never changes the office itself."
            : mode === "full"
              ? "Held at the full quality benchmark. Nothing is adjusted automatically."
              : "Your own settings. Anything you have not changed stays at full quality."}
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.cardRow}>
          <div className={styles.cardText}>
            <span className={styles.rowLabel}>Individual settings</span>
            <span className={styles.rowHint}>Changing any of these switches the mode to Custom</span>
          </div>
        </div>
        {CUSTOM_CONTROLS.map((control) => {
          const current = resolved[control.id as keyof typeof resolved];
          const selected = control.options.find((o) => o.value === current) ?? control.options[0];
          return (
            <div className={styles.cardRow} key={control.id}>
              <div className={styles.cardText}>
                <span className={styles.rowLabel}>{control.label}</span>
                <span className={styles.rowHint}>{control.hint}</span>
              </div>
              <select
                className={styles.select}
                aria-label={control.label}
                value={String(selected.value)}
                onChange={(event) => {
                  const picked = control.options.find((o) => String(o.value) === event.target.value);
                  if (picked) setCustomGraphicsControl(control.id as CustomControlId, picked.value);
                }}
              >
                {control.options.map((option) => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default HudGraphicsSettings;
