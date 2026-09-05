import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Quest } from "../../services/quests/questsClient";

vi.mock("../../services/quests/questsClient", () => ({
  fetchMyQuests: vi.fn(),
}));

import { fetchMyQuests } from "../../services/quests/questsClient";
import { OnboardingQuestline } from "./OnboardingQuestline";

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
  ...over,
});

describe("OnboardingQuestline", () => {
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
  });

  it("shows the error instead of a list when the fetch fails", async () => {
    vi.mocked(fetchMyQuests).mockRejectedValue(new Error("Quests request failed (401)"));
    render(<OnboardingQuestline onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Quests request failed (401)")).toBeInTheDocument());
    expect(screen.queryByRole("list")).toBeNull();
  });
});
