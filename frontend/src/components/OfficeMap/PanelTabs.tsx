import type { ReactNode } from "react";
import styles from "./PanelTabs.module.css";

// THE panel tab bar. Extracted verbatim from TasksPanel's Quests | Missions bar (styles moved,
// not re-authored — PanelTabs.module.css is the former TasksPanel.module.css) so every panel that
// needs tabs gets byte-identical typography, spacing, active state and hover.
//
// Callers today: TasksPanel (Quests | Missions), NotificationCenter (All | Unread) and RewardsPanel
// (Catalog | History, whose History label carries its pending-count badge). It owns no
// state — the caller keeps the selected value, exactly as TasksPanel always did.

export interface PanelTabsProps<T extends string> {
  /** Accessible name for the tablist, e.g. "Tasks" / "Notifications". */
  ariaLabel: string;
  /** Usually a string; a node when a tab carries a badge (Rewards' pending count). */
  tabs: readonly { value: T; label: ReactNode }[];
  active: T;
  onChange: (value: T) => void;
}

export function PanelTabs<T extends string>({ ariaLabel, tabs, active, onChange }: PanelTabsProps<T>) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={ariaLabel}>
      {tabs.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={active === value}
          className={active === value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default PanelTabs;
