import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mission, MyMissions } from "../../services/quests/questsClient";

vi.mock("../../services/quests/questsClient", () => ({
  fetchMyMissions: vi.fn(),
}));

import { fetchMyMissions } from "../../services/quests/questsClient";
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
      mission({ id: "weekly_check_in_days", title: "Check in on 3 different days", cadence: "weekly", mode: "unique_days", target: 3, count: 2 }),
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
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders daily and weekly sections in server order with progress and reset timing", async () => {
    vi.mocked(fetchMyMissions).mockResolvedValue(payload());
    render(<MissionsPanel onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("missions-daily-summary")).toHaveTextContent("1/3 · Resets in 15h"));
    expect(screen.getByTestId("missions-weekly-summary")).toHaveTextContent("0/1 · Resets in 4d 15h");

    const daily = screen.getByTestId("missions-daily");
    const rows = Array.from(daily.querySelectorAll("li"));
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "mission-daily_check_in",
      "mission-daily_dm_two_coworkers",
      "mission-daily_ask_toucan",
    ]);
    expect(rows[0]).toHaveAttribute("data-completed", "true");
    expect(rows[1]).toHaveTextContent("1/2");
    expect(rows[1].querySelector('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByTestId("mission-weekly_check_in_days")).toHaveTextContent("2/3");
    expect(fetchMyMissions).toHaveBeenCalledTimes(1);
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
