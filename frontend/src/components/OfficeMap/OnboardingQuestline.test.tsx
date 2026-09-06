import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimResult, Progression, Quest } from "../../services/quests/questsClient";

vi.mock("../../services/quests/questsClient", () => ({
  fetchMyQuests: vi.fn(),
  fetchMyProgression: vi.fn(),
  claimReward: vi.fn(),
}));

import { claimReward, fetchMyProgression, fetchMyQuests } from "../../services/quests/questsClient";
import { OnboardingQuestline } from "./OnboardingQuestline";

const progression = (over: Partial<Progression> = {}): Progression => ({
  xp: 0,
  coins: 0,
  level: 1,
  levelStartXp: 0,
  nextLevelXp: 100,
  ...over,
});

const quest = (over: Partial<Quest>): Quest => ({
  id: "q",
  title: "Quest",
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

describe("OnboardingQuestline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchMyProgression).mockResolvedValue(progression({ xp: 50, coins: 10 }));
  });

  it("renders quests in the server's order with done state and unique_count progress", async () => {
    // Deliberately NOT sorted client-side: the server owns ordering (GET /quests/me).
    vi.mocked(fetchMyQuests).mockResolvedValue([
      quest({ id: "first_check_in", title: "Check in", completed: true, count: 1, completedAt: "2026-09-05T00:00:00Z" }),
      quest({ id: "visit_central_hub", title: "Visit the Hub" }),
      quest({ id: "chat_unique_coworkers", title: "Chat with 3", mode: "unique_count", target: 3, count: 2 }),
    ]);
    render(<OnboardingQuestline onClose={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("questline-summary")).toHaveTextContent("1 of 3 complete"));
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "quest-first_check_in",
      "quest-visit_central_hub",
      "quest-chat_unique_coworkers",
    ]);
    expect(rows[0]).toHaveAttribute("data-completed", "true");
    expect(rows[1]).toHaveAttribute("data-completed", "false");
    expect(rows[2]).toHaveTextContent("2/3");
    expect(fetchMyQuests).toHaveBeenCalledTimes(1);
    // Reward amounts come from the server; the strip shows Level / XP / Coins.
    expect(rows[1]).toHaveTextContent("+50 XP · +10 🪙");
    expect(screen.getByTestId("progression-strip")).toHaveTextContent("Lv 1");
    expect(screen.getByTestId("progression-xp")).toHaveTextContent("50 XP · 50/100 to next");
    expect(screen.getByTestId("progression-coins")).toHaveTextContent("🪙 10");
  });

  it("offers Claim only on completed unclaimed quests, claims once, then shows Claimed with new balances", async () => {
    vi.mocked(fetchMyQuests).mockResolvedValue([
      quest({ id: "first_check_in", title: "Check in", completed: true, count: 1, completedAt: "2026-09-05T00:00:00Z" }),
      quest({ id: "first_dm", title: "DM", completed: true, count: 1, completedAt: "2026-09-05T00:00:00Z", claimed: true, claimedAt: "2026-09-05T01:00:00Z" }),
      quest({ id: "visit_central_hub", title: "Visit the Hub" }),
    ]);
    let resolveClaim: (r: ClaimResult) => void = () => {};
    vi.mocked(claimReward).mockImplementation(() => new Promise<ClaimResult>((res) => (resolveClaim = res)));
    render(<OnboardingQuestline onClose={() => {}} />);

    const claimBtn = await screen.findByRole("button", { name: "Claim reward for Check in" });
    expect(screen.getByTestId("quest-first_dm")).toHaveTextContent("Claimed");
    expect(screen.queryByRole("button", { name: /Claim reward for Visit the Hub/ })).toBeNull(); // not completed

    // Double-click while in flight is ONE claim; the button is disabled meanwhile.
    fireEvent.click(claimBtn);
    fireEvent.click(claimBtn);
    expect(claimReward).toHaveBeenCalledTimes(1);
    expect(claimReward).toHaveBeenCalledWith("first_check_in", "");
    expect(claimBtn).toBeDisabled();
    expect(claimBtn).toHaveTextContent("Claiming…");

    await act(async () => {
      resolveClaim({
        questId: "first_check_in",
        periodKey: "",
        grantedNow: true,
        reward: { xp: 50, coins: 10 },
        progression: progression({ xp: 100, coins: 20, level: 2, levelStartXp: 100, nextLevelXp: 300 }),
      });
    });
    expect(screen.getByTestId("quest-first_check_in")).toHaveTextContent("Claimed");
    expect(screen.queryByRole("button", { name: "Claim reward for Check in" })).toBeNull();
    expect(screen.getByTestId("progression-strip")).toHaveTextContent("Lv 2");
    expect(screen.getByTestId("progression-xp")).toHaveTextContent("100 XP · 0/200 to next");
    expect(screen.getByTestId("progression-coins")).toHaveTextContent("🪙 20");
  });

  it("shows the error instead of a list when the fetch fails", async () => {
    vi.mocked(fetchMyQuests).mockRejectedValue(new Error("Quests request failed (401)"));
    render(<OnboardingQuestline onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Quests request failed (401)")).toBeInTheDocument());
    expect(screen.queryByRole("list")).toBeNull();
  });
});
