import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mission, MyMissions, Progression, Quest } from "../../services/quests/questsClient";

vi.mock("../../services/quests/questsClient", () => ({
  fetchMyQuests: vi.fn(),
  fetchMyMissions: vi.fn(),
  fetchMyProgression: vi.fn(),
  fetchMyBadges: vi.fn(),
  claimReward: vi.fn(),
}));

import { fetchMyMissions, fetchMyProgression, fetchMyQuests } from "../../services/quests/questsClient";
import { resetProgressionForTests } from "../../services/quests/progressionStore";
import { TasksPanel, type TasksTab } from "./TasksPanel";

// TASKS is UI consolidation only: one dock control, a tab bar, and the two EXISTING panels behind
// it. These tests are about that boundary — that each tab really mounts the real panel, that the
// two systems stay separate (their own endpoint, their own data), and that the caller owns the
// tab so a notification can land on the right one and the choice survives a reopen.

const progression = (over: Partial<Progression> = {}): Progression => ({
  xp: 0,
  coins: 0,
  level: 1,
  levelStartXp: 0,
  nextLevelXp: 100,
  ...over,
});

const quest = (over: Partial<Quest> = {}): Quest => ({
  id: "q1",
  title: "Say hello to a coworker",
  eventType: "x",
  mode: "once",
  target: 1,
  order: 0,
  count: 0,
  completed: false,
  completedAt: null,
  rewardXp: 50,
  rewardCoins: 10,
  claimed: false,
  claimedAt: null,
  ...over,
});

const mission = (over: Partial<Mission> = {}): Mission => ({
  id: "m1",
  title: "Visit three rooms",
  eventType: "y",
  mode: "once",
  target: 3,
  cadence: "daily",
  count: 0,
  completed: false,
  completedAt: null,
  rewardXp: 20,
  rewardCoins: 5,
  claimed: false,
  claimedAt: null,
  ...over,
});

const missions = (): MyMissions => ({
  daily: {
    cadence: "daily",
    periodKey: "2026-09-08",
    startsAt: "2026-09-08T00:00:00+00:00",
    endsAt: "2026-09-09T00:00:00+00:00",
    missions: [mission()],
  },
  weekly: {
    cadence: "weekly",
    periodKey: "2026-W37",
    startsAt: "2026-09-07T00:00:00+00:00",
    endsAt: "2026-09-14T00:00:00+00:00",
    missions: [],
  },
  serverTime: "2026-09-08T09:00:00+00:00",
});

function renderPanel(tab: TasksTab = "quests") {
  const onTabChange = vi.fn();
  const onClose = vi.fn();
  const view = render(<TasksPanel tab={tab} onTabChange={onTabChange} onClose={onClose} />);
  return { ...view, onTabChange, onClose };
}

describe("TasksPanel", () => {
  beforeEach(() => {
    resetProgressionForTests();
    vi.clearAllMocks();
    vi.mocked(fetchMyProgression).mockResolvedValue(progression());
    vi.mocked(fetchMyQuests).mockResolvedValue([quest()]);
    vi.mocked(fetchMyMissions).mockResolvedValue(missions());
  });

  it("defaults to the real Questline panel, fetching quests and NOT missions", async () => {
    renderPanel();
    expect(await screen.findByRole("dialog", { name: "Onboarding Questline" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("quest-q1")).toBeInTheDocument());
    expect(fetchMyQuests).toHaveBeenCalledTimes(1);
    // The two systems stay separate: showing Quests must not touch the missions endpoint.
    expect(fetchMyMissions).not.toHaveBeenCalled();
  });

  it("renders the real Missions panel on the missions tab, fetching missions and NOT quests", async () => {
    renderPanel("missions");
    expect(await screen.findByRole("dialog", { name: "Missions" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("mission-m1")).toBeInTheDocument());
    // Count is left to MissionsPanel, which owns its own rollover/visibility refetches.
    expect(fetchMyMissions).toHaveBeenCalled();
    expect(fetchMyQuests).not.toHaveBeenCalled();
  });

  it("shows both tabs on either surface, marking the shown one selected", async () => {
    const { unmount } = renderPanel();
    await screen.findByRole("dialog", { name: "Onboarding Questline" });
    expect(screen.getByRole("tab", { name: "Quests" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Missions" })).toHaveAttribute("aria-selected", "false");
    unmount();

    renderPanel("missions");
    await screen.findByRole("dialog", { name: "Missions" });
    expect(screen.getByRole("tab", { name: "Missions" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Quests" })).toHaveAttribute("aria-selected", "false");
  });

  it("reports a tab press to the caller rather than owning the choice itself", async () => {
    const { onTabChange } = renderPanel();
    await screen.findByRole("dialog", { name: "Onboarding Questline" });
    fireEvent.click(screen.getByRole("tab", { name: "Missions" }));
    expect(onTabChange).toHaveBeenCalledWith("missions");
  });

  it("keeps each panel's own close action wired to the caller", async () => {
    const { onClose } = renderPanel();
    await screen.findByRole("dialog", { name: "Onboarding Questline" });
    fireEvent.click(screen.getByLabelText("Close quests"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves each panel's own header, summary and progression strip intact", async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("questline-summary")).toHaveTextContent("0 of 1 complete"));
    expect(screen.getByRole("heading", { name: "Onboarding Questline" })).toBeInTheDocument();
  });
});
