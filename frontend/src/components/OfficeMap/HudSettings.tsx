import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import HudIcon from "../HudIcon";
import { HudGraphicsSettings } from "./HudGraphicsSettings";
import { HudPrivacySettings } from "./HudPrivacySettings";
import {
  HudAudioSettings,
  HudControlsSettings,
  HudDefaultViewSetting,
  HudInterfaceSettings,
} from "./HudWorldSettings";
import type { Phase } from "../../data/officePhase";
import styles from "./HudSettings.module.css";

// SETTINGS — a screen-owning dock tool (it used to be a flyout above the dock). Game/system
// preferences ONLY; product features are dock tiles and never hide in here.
//
// It wears the SAME cream modal shell as Tasks / Rewards / Notifications — same scrim, radius,
// border, shadow, entry animation and close button — and the dock, the Toucan and the minimized
// chat-head rail step aside for it through the EXISTING officeToolOpen path (OfficeMap.tsx).
//
// PHASE 7C — TWO PANES. The single scrolling column it used to be was fine at three sections and wrong
// at nine: an employee looking for one switch had to read the whole panel. It is now the layout every
// game settings menu uses — categories down the left, the chosen category's controls on the right —
// and NOTHING about the surface changed to get there. Same shell, same cards, same switches, same
// stores. Only the arrangement is new.
//
// A CATEGORY THAT HAS NOTHING REAL IN IT DOES NOT EXIST. That is this panel's oldest rule (it is why
// Graphics & Display was absent entirely until the V2 renderer gave it something to set), and the nav
// is built from it: CATEGORIES below is filtered by what the caller actually supplied before a single
// tab is drawn. So V1's 2D office shows General / Graphics / Audio / Privacy, the 3D world additionally
// shows Controls and Interface, and Developer appears only where a DEV caller passed its tools. Nobody
// ever sees a tab that opens onto a dead control.
//
// EVERY ROW IS A REAL, WORKING CONTROL:
//   General     the EXISTING day/night behaviour (useOfficePhase's overrideHour), plus the starting
//               view in the 3D world.
//   Controls    mouse look sensitivity and invert, read by player/PlayerCamera, plus an honest
//               reference for the bindings PlayerInput hard-codes.
//   Interface   whether nameplates and overhead chat are drawn, read by app/Vo3dOverheads.
//   Graphics    the V2 renderer's mode system — HudGraphicsSettings, unchanged.
//   Audio       the EXISTING music singleton (audio/backgroundMusic, the same one App.tsx keeps armed)
//               and the world's ambient bed (dev/vo3d/audio/EnvironmentalAudio), as two cards of the
//               same shape. Two sound systems, never merged; one control language.
//   Privacy     revoking the one exact-location share this product has — the existing team-map calls.
//   Developer   the DEV-only tools, kept apart from everything an employee sets. Room editing, seating,
//               navigation debugging and the stress rigs are NOT here and never were: they live in the
//               world's own inspection panel, which this section is merely the switch for (and which
//               ?gui=1 still opens directly).

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
   *  state at all — the Appearance rows then do not render rather than showing a dead row. */
  lighting?: HudSettingsLighting;
  /** TRUE ONLY WHERE THERE IS A 3D WORLD LISTENING. The Controls and Interface categories, the starting
   *  view and the ambience rows all write to services/settings/experiencePreferences, whose readers are
   *  dev/vo3d's PlayerCamera, Vo3dOverheads and world.ts. V1's 2D office has none of them, so it passes
   *  nothing and those rows are not offered there. */
  worldExperience?: boolean;
  /** DEV-only demo tool, kept in its own Developer category rather than mixed in with real
   *  preferences. Undefined in production builds. */
  onResetHubDemo?: () => void;
  /** DEV-only panels relocated off the office canvas into this menu — the day/night scrubber, the
   *  checkout debug panel, the 3D inspection rig's switch — passed through as the EXISTING components
   *  with their existing handlers (see OfficeMap.tsx, Vo3dHud.tsx). Undefined in production builds. */
  devTools?: ReactNode;
}

type CategoryId = "general" | "controls" | "interface" | "graphics" | "audio" | "privacy" | "developer";

interface Category {
  id: CategoryId;
  label: string;
  hint: string;
}

const CATEGORY_ORDER: readonly Category[] = [
  // General's hint is resolved per caller below — it holds the lighting row, the starting-view row, or
  // both, and a hint that named a row this caller does not have would be the same dead promise a dead
  // control is.
  { id: "general", label: "General", hint: "" },
  { id: "controls", label: "Controls", hint: "Mouse look, keys and movement" },
  { id: "interface", label: "Interface", hint: "What is drawn over the world" },
  { id: "graphics", label: "Graphics", hint: "How much work each frame spends" },
  { id: "audio", label: "Audio", hint: "Music and office ambience" },  // narrowed below without a world
  { id: "privacy", label: "Privacy", hint: "What you share with coworkers" },
  { id: "developer", label: "Developer", hint: "Testing and inspection tools" },
];

export function HudSettings({
  onClose,
  lighting,
  worldExperience = false,
  onResetHubDemo,
  devTools,
}: HudSettingsProps) {
  const hasDeveloper = Boolean(onResetHubDemo || devTools);

  // Only the categories that have something real behind them, in the fixed order above.
  const categories = useMemo(
    () =>
      CATEGORY_ORDER.filter((category) => {
        switch (category.id) {
          case "general":
            return Boolean(lighting) || worldExperience;
          case "controls":
          case "interface":
            return worldExperience;
          case "developer":
            return hasDeveloper;
          default:
            // Graphics, Audio and Privacy are backed everywhere this panel is mounted.
            return true;
        }
      }).map((category) =>
        category.id === "general"
          ? {
              ...category,
              hint:
                lighting && worldExperience
                  ? "Lighting and how the office opens"
                  : lighting
                    ? "Office lighting"
                    : "How the office opens",
            }
          : category.id === "audio" && !worldExperience
            ? { ...category, hint: "Office background music" }
            : category,
      ),
    [hasDeveloper, lighting, worldExperience],
  );

  const [active, setActive] = useState<CategoryId>(() => categories[0]?.id ?? "graphics");
  // A caller can stop supplying a category while the panel is open (DEV hot-reload, a lighting prop
  // that goes away). Landing on a tab that no longer exists would render an empty pane.
  useEffect(() => {
    if (!categories.some((c) => c.id === active)) setActive(categories[0]?.id ?? "graphics");
  }, [active, categories]);

  // Esc closes, as it does for every other modal in this family — and it is the key a player pressed to
  // get their pointer back in the first place, so it is the one they reach for.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Arrow keys walk the category list, which is what a tablist is expected to do and what a person
  // driving this from the keyboard will try.
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const onTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const index = categories.findIndex((c) => c.id === active);
      const last = categories.length - 1;
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? last
            : event.key === "ArrowUp" || event.key === "ArrowLeft"
              ? (index - 1 + categories.length) % categories.length
              : (index + 1) % categories.length;
      const id = categories[next]?.id;
      if (!id) return;
      setActive(id);
      tabsRef.current?.querySelector<HTMLButtonElement>(`[data-category="${id}"]`)?.focus();
    },
    [active, categories],
  );

  const activeCategory = categories.find((c) => c.id === active) ?? categories[0];

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

        <div className={styles.layout}>
          <div
            className={styles.nav}
            role="tablist"
            aria-orientation="vertical"
            aria-label="Settings categories"
            ref={tabsRef}
            onKeyDown={onTabKeyDown}
          >
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                role="tab"
                id={`settings-tab-${category.id}`}
                aria-selected={category.id === active}
                aria-controls={`settings-pane-${category.id}`}
                tabIndex={category.id === active ? 0 : -1}
                data-category={category.id}
                data-dev={category.id === "developer" ? "true" : undefined}
                className={styles.navItem}
                onClick={() => setActive(category.id)}
              >
                <span className={styles.navLabel}>{category.label}</span>
                <span className={styles.navHint}>{category.hint}</span>
              </button>
            ))}
          </div>

          <div
            className={styles.body}
            role="tabpanel"
            id={`settings-pane-${active}`}
            aria-labelledby={`settings-tab-${active}`}
            tabIndex={0}
            data-testid={`settings-pane-${active}`}
          >
            <p className={styles.paneHint}>{activeCategory?.hint}</p>

            {active === "general" && (
              <>
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
                {worldExperience && <HudDefaultViewSetting />}
              </>
            )}

            {active === "controls" && <HudControlsSettings />}
            {active === "interface" && <HudInterfaceSettings />}
            {active === "graphics" && <HudGraphicsSettings />}

            {active === "audio" && <HudAudioSettings world={worldExperience} />}

            {active === "privacy" && <HudPrivacySettings />}

            {active === "developer" && (
              <section className={styles.section} aria-label="Developer">
                <h3 className={styles.sectionTitle}>Developer tools</h3>
                <p className={styles.cardStatus}>
                  Testing and inspection controls. Not part of anyone's settings — they are here so they
                  are off the office canvas.
                </p>
                {onResetHubDemo && (
                  <button type="button" className={styles.devButton} onClick={onResetHubDemo}>
                    ♻️ Reset Hub demo state
                  </button>
                )}
                {devTools && <div className={styles.devTools}>{devTools}</div>}
              </section>
            )}
          </div>
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
