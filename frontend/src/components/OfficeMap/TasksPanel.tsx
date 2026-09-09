import { MissionsPanel } from "./MissionsPanel";
import { OnboardingQuestline } from "./OnboardingQuestline";
import styles from "./TasksPanel.module.css";

// TASKS — the bottom dock's single progression entry point (it replaced the separate 🎯 Quests
// and 📅 Missions tiles). This is UI CONSOLIDATION ONLY: it is a tab bar plus a switch, and the
// selected tab renders the EXISTING panel, unchanged and whole.
//
// Deliberately NOT a merge: Quests and Missions keep separate models, separate endpoints
// (GET /quests/me vs GET /missions/me), separate claim calls, separate progress and separate
// refresh rules. Neither panel's logic is reimplemented, wrapped or lifted out — each still owns
// its own fetch-on-open, its own claim + reward FX, and (for Missions) its own
// visibility/online/period-rollover refetches. All this file adds is the header slot they render
// the tab bar into.
//
// One tab is mounted at a time, exactly as opening one of the two panels always was: switching
// tabs is the same thing as closing one panel and opening the other, so each tab shows fresh
// server data rather than a stale snapshot. `tab` is owned by the caller (OfficeMap.tsx) so the
// choice survives closing and reopening, and so a notification for a quest or a mission can open
// this surface on the right tab.

export type TasksTab = "quests" | "missions";

export interface TasksPanelProps {
  tab: TasksTab;
  onTabChange: (tab: TasksTab) => void;
  onClose: () => void;
}

export function TasksPanel({ tab, onTabChange, onClose }: TasksPanelProps) {
  const tabs = (
    <div className={styles.tabs} role="tablist" aria-label="Tasks">
      {(["quests", "missions"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          className={tab === value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => onTabChange(value)}
        >
          {value === "quests" ? "Quests" : "Missions"}
        </button>
      ))}
    </div>
  );

  return tab === "missions" ? (
    <MissionsPanel onClose={onClose} tabs={tabs} />
  ) : (
    <OnboardingQuestline onClose={onClose} tabs={tabs} />
  );
}

export default TasksPanel;
