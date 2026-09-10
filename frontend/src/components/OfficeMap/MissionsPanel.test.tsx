import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mission, MyMissions, Progression } from "../../services/quests/questsClient";

vi.mock("../../services/quests/questsClient", () => ({
  fetchMyMissions: vi.fn(),
  fetchMyProgression: vi.fn(),
  fetchMyBadges: vi.fn(),
  claimReward: vi.fn(),
}));

import { claimReward, fetchMyMissions, fetchMyProgression } from "../../services/quests/questsClient";

const progression = (over: Partial<Progression> = {}): Progression => ({
  xp: 0,
  coins: 0,
  level: 1,
  levelStartXp: 0,
  nextLevelXp: 100,
  ...over,
});
import { resetProgressionForTests } from "../../services/quests/progressionStore";
import { MissionsPanel } from "./MissionsPanel";
import { formatResetsIn } from "./formatResetsIn";

const mission = (over: Partial<Mission>): Mission => ({
  id: "m",
  title: "Mission",
  eventType: "x",
  mode: "once",
  target: 1,
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

const NOW = new Date("2026-09-02T09:00:00Z").getTime();

const payload = (): MyMissions => ({
  serverTime: "2026-09-02T09:00:00.000Z",
  daily: {
    cadence: "daily",
    periodKey: "d:2026-09-02",
    startsAt: "2026-09-02T00:00:00.000Z",
    endsAt: "2026-09-03T00:00:00.000Z",
    missions: [
      mission({ id: "daily_check_in", title: "Check in today", completed: true, count: 1, completedAt: "2026-09-02T08:00:00Z" }),
      mission({ id: "daily_dm_two_coworkers", title: "Message 2 different coworkers", mode: "unique_count", target: 2, count: 1 }),
      mission({ id: "daily_ask_toucan", title: "Ask Toucan something" }),
    ],
  },
  weekly: {
    cadence: "weekly",
    periodKey: "w:2026-W36",
    startsAt: "2026-08-31T00:00:00.000Z",
    endsAt: "2026-09-07T00:00:00.000Z",
    missions: [
      mission({ id: "weekly_check_in_days", title: "Check in on 3 different days", cadence: "weekly", mode: "unique_days", target: 3, count: 2, rewardXp: 60, rewardCoins: 15 }),
    ],
  },
});

describe("formatResetsIn", () => {
  it("renders days, hours and minutes and never goes negative", () => {
    expect(formatResetsIn("2026-09-03T00:00:00Z", NOW)).toBe("Resets in 15h 0m");
    expect(formatResetsIn("2026-09-07T00:00:00Z", NOW)).toBe("Resets in 4d 15h");
    expect(formatResetsIn("2026-09-02T09:00:30Z", NOW)).toBe("Resets in 1m");
    expect(formatResetsIn("2026-09-01T00:00:00Z", NOW)).toBe("Resets in 1m");
  });
});

describe("MissionsPanel", () => {
  beforeEach(() => {
    resetProgressionForTests();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
    vi.mocked(fetchMyProgression).mockResolvedValue(progression({ xp: 20, coins: 5 }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders daily and weekly sections in server order with progress and reset timing", async () => {
    vi.mocked(fetchMyMissions).mockResolvedValue(payload());
    render(<MissionsPanel onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("missions-daily-summary")).toHaveTextContent("1/3 complete"));
    // The reset timing moved to its own chip beside the count; same formatResetsIn output.
    expect(screen.getByTestId("missions-daily")).toHaveTextContent("Resets in 15h");
    expect(screen.getByTestId("missions-weekly-summary")).toHaveTextContent("0/1 complete");
    // The reset timing moved to its own chip beside the count; same formatResetsIn output.
    expect(screen.getByTestId("missions-weekly")).toHaveTextContent("Resets in 4d 15h");

    const daily = screen.getByTestId("missions-daily");
    const rows = Array.from(daily.querySelectorAll("li"));
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "mission-daily_check_in",
      "mission-daily_dm_two_coworkers",
      "mission-daily_ask_toucan",
    ]);
    expect(rows[0]).toHaveAttribute("data-completed", "true");
    expect(rows[1]).toHaveTextContent("1/2");
    // Per-row bars were replaced by a compact count chip; it carries the same progress, and the
    // panel's single progressbar is now the OVERALL daily+weekly completion in the hero.
    expect(screen.getByTestId("mission-count-weekly_check_in_days").textContent).toBe("2/3");
    // Overall completion spans BOTH periods: 3 daily (1 done) + 1 weekly (0 done) = 1 of 4.
    expect(screen.getByTestId("missions-summary")).toHaveTextContent("1 of 4 missions complete");
    expect(screen.getByLabelText("Missions complete")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByLabelText("Missions complete")).toHaveAttribute("aria-valuemax", "4");
    expect(screen.getByTestId("mission-weekly_check_in_days")).toHaveTextContent("2/3");
    expect(fetchMyMissions).toHaveBeenCalledTimes(1);
    // Reward amounts unchanged; the XP/🪙 glyphs are now the locked HUD assets beside the text.
    expect(rows[1]).toHaveTextContent("+20 XP");
    expect(rows[1]).toHaveTextContent("+5");
    expect(screen.getByTestId("mission-weekly_check_in_days")).toHaveTextContent("+60 XP");
    // The Level/XP/Coins strip is deliberately no longer rendered inside Tasks — the main HUD
    // owns progression display. The store itself is untouched (progressionStore.test.ts covers
    // the data path); this only asserts Tasks stops painting it.
    expect(screen.queryByTestId("progression-strip")).toBeNull();
  });

  it("claims a completed mission with its period key and flips the row to Claimed", async () => {
    vi.mocked(fetchMyMissions).mockResolvedValue(payload());
    vi.mocked(claimReward).mockResolvedValue({
      questId: "daily_check_in",
      periodKey: "d:2026-09-02",
      grantedNow: true,
      reward: { xp: 20, coins: 5 },
      progression: progression({ xp: 40, coins: 10 }),
    });
    render(<MissionsPanel onClose={() => {}} />);
    const btn = await screen.findByRole("button", { name: "Claim reward for Check in today" });
    // Only the completed mission offers Claim.
    expect(screen.getAllByRole("button", { name: /Claim reward/ })).toHaveLength(1);
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(claimReward).toHaveBeenCalledTimes(1);
    expect(claimReward).toHaveBeenCalledWith("daily_check_in", "d:2026-09-02");
    expect(screen.getByTestId("mission-daily_check_in")).toHaveTextContent("Claimed");
  });

  it("refetches when the tab becomes visible again and when the browser comes back online", async () => {
    vi.mocked(fetchMyMissions).mockResolvedValue(payload());
    render(<MissionsPanel onClose={() => {}} />);
    await waitFor(() => expect(fetchMyMissions).toHaveBeenCalledTimes(1));

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange")); // jsdom reports "visible"
    });
    expect(fetchMyMissions).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(fetchMyMissions).toHaveBeenCalledTimes(3);
  });

  it("refetches once the daily period rolls over while open", async () => {
    vi.mocked(fetchMyMissions).mockResolvedValue(payload());
    render(<MissionsPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("missions-daily")).toBeInTheDocument());
    expect(fetchMyMissions).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(15 * 60 * 60 * 1000 + 2000); // past endsAt + 1s grace
    });
    expect(fetchMyMissions).toHaveBeenCalledTimes(2);
  });

  it("shows the error instead of sections when the fetch fails", async () => {
    vi.mocked(fetchMyMissions).mockRejectedValue(new Error("Missions request failed (401)"));
    render(<MissionsPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Missions request failed (401)")).toBeInTheDocument());
    expect(screen.queryByTestId("missions-daily")).toBeNull();
  });
});
