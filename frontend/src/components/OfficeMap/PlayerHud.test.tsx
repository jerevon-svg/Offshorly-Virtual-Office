import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimResult, Progression } from "../../services/quests/questsClient";

vi.mock("../../services/quests/questsClient", () => ({ fetchMyProgression: vi.fn(), fetchMyBadges: vi.fn() }));
vi.mock("../../auth/currentUserStore", () => ({
  useCurrentUser: () => ({ id: "1", email: "jerevon@offshorly.com", full_name: "Jerevon Bon", role: "", team: null }),
}));

import { fetchMyBadges, fetchMyProgression } from "../../services/quests/questsClient";
import type { Badge } from "../../services/quests/questsClient";
import { applyClaim, commitStaged, refreshBadges, resetProgressionForTests, stageClaim } from "../../services/quests/progressionStore";
import { PlayerHud } from "./PlayerHud";

const p = (over: Partial<Progression> = {}): Progression => ({ xp: 0, coins: 0, level: 1, levelStartXp: 0, nextLevelXp: 100, ...over });
const claim = (over: Partial<ClaimResult> = {}): ClaimResult => ({
  questId: "q",
  periodKey: "",
  grantedNow: true,
  reward: { xp: 50, coins: 10 },
  progression: p({ xp: 50, coins: 10 }),
  ...over,
});

describe("PlayerHud", () => {
  beforeEach(() => {
    resetProgressionForTests();
    vi.clearAllMocks();
    // jsdom has no matchMedia; opt into reduced motion so numbers settle instantly.
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("renders nothing until the server answers, then name, level, XP window, coins and FX targets", async () => {
    let resolve: (p: Progression) => void = () => {};
    vi.mocked(fetchMyProgression).mockImplementation(() => new Promise<Progression>((r) => (resolve = r)));
    render(<PlayerHud />);
    expect(screen.queryByTestId("player-hud")).toBeNull();
    await act(async () => resolve(p({ xp: 130, coins: 1250, level: 2, levelStartXp: 100, nextLevelXp: 300 })));
    expect(screen.getByTestId("player-hud")).toHaveTextContent("Jerevon");
    expect(screen.getByTestId("hud-level")).toHaveTextContent("Level 2");
    expect(screen.getByTestId("hud-xp")).toHaveTextContent("30 / 200");
    expect(screen.getByTestId("hud-coins")).toHaveTextContent("1,250");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30");
    expect(document.querySelector('[data-hud-target="xp"]')).not.toBeNull();
    expect(document.querySelector('[data-hud-target="coins"]')).not.toBeNull();
    expect(screen.queryByTestId("level-up")).toBeNull();
  });

  it("a staged claim shows nothing until each part is committed; XP arrival triggers Level Up", async () => {
    vi.mocked(fetchMyProgression).mockResolvedValue(p({ xp: 80, coins: 5 }));
    render(<PlayerHud />);
    await waitFor(() => expect(screen.getByTestId("hud-xp")).toHaveTextContent("80 / 100"));

    act(() => stageClaim(claim({ progression: p({ xp: 130, coins: 15, level: 2, levelStartXp: 100, nextLevelXp: 300 }) })));
    expect(screen.getByTestId("hud-xp")).toHaveTextContent("80 / 100"); // held until icons land
    expect(screen.getByTestId("hud-coins")).toHaveTextContent("5");
    expect(screen.queryByTestId("level-up")).toBeNull();

    act(() => commitStaged("coins"));
    expect(screen.getByTestId("hud-coins")).toHaveTextContent("15");
    expect(screen.getByTestId("hud-xp")).toHaveTextContent("80 / 100"); // XP still travelling

    act(() => commitStaged("xp"));
    await waitFor(() => expect(screen.getByTestId("hud-level")).toHaveTextContent("Level 2"));
    expect(screen.getByTestId("hud-xp")).toHaveTextContent("30 / 200");
    await waitFor(() => expect(screen.getByTestId("level-up")).toHaveTextContent("Level up"));
  });

  it("an idempotent replay changes nothing visible; a same-level grant shows no Level Up", async () => {
    vi.mocked(fetchMyProgression).mockResolvedValue(p({ xp: 10, coins: 0 }));
    render(<PlayerHud />);
    await waitFor(() => expect(screen.getByTestId("hud-xp")).toHaveTextContent("10 / 100"));
    act(() => applyClaim(claim({ grantedNow: false, progression: p({ xp: 10, coins: 0 }) })));
    expect(screen.getByTestId("hud-xp")).toHaveTextContent("10 / 100");
    act(() => applyClaim(claim({ reward: { xp: 20, coins: 5 }, progression: p({ xp: 30, coins: 5 }) })));
    expect(screen.getByTestId("hud-xp")).toHaveTextContent("30 / 100");
    expect(screen.getByTestId("hud-coins")).toHaveTextContent("5");
    expect(screen.queryByTestId("level-up")).toBeNull();
  });

  it("shows a restrained 'Badge · tier' caption when a badge refresh reports a newly crossed tier", async () => {
    const badge = (over: Partial<Badge> = {}): Badge => ({
      id: "connector", title: "Connector", description: "", category: "social", emblem: "connector", metricKind: "unique_targets", metric: 0, tier: 0, tierName: "none",
      thresholds: [3, 8, 15, 30], nextThreshold: 3, tiersAwardedAt: [null, null, null, null], tiersClaimedAt: [null, null, null, null],
      tierRewards: [{ xp: 25, coins: 10 }, { xp: 75, coins: 25 }, { xp: 150, coins: 50 }, { xp: 300, coins: 100 }], ...over,
    });
    vi.mocked(fetchMyProgression).mockResolvedValue(p({ xp: 10 }));
    vi.mocked(fetchMyBadges).mockResolvedValue([badge()]);
    render(<PlayerHud />);
    await waitFor(() => expect(screen.getByTestId("hud-xp")).toHaveTextContent("10 / 100"));
    expect(screen.queryByTestId("badge-earned")).toBeNull(); // first fetch never announces

    vi.mocked(fetchMyBadges).mockResolvedValue([badge({ metric: 3, tier: 1, tierName: "bronze", nextThreshold: 8 })]);
    await act(async () => {
      await refreshBadges();
    });
    expect(screen.getByTestId("badge-earned")).toHaveTextContent("Connector · bronze");
  });
});
