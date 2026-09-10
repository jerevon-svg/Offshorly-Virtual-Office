import { act, fireEvent, render, screen, within } from "@testing-library/react";
// @ts-expect-error node:fs is untyped under tsconfig.app.json (types: ["vite/client"] only) —
// same exemption HudDock.layering.test.ts takes. vitest runs in Node with cwd = frontend/.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Badge, ClaimResult } from "../../services/quests/questsClient";

vi.mock("../../services/quests/questsClient", () => ({
  fetchMyProgression: vi.fn(),
  fetchMyBadges: vi.fn(),
  claimReward: vi.fn(),
  badgeTierPeriodKey: (tier: number) => `t:${tier}`,
}));
vi.mock("./rewardFx", () => ({ collectReward: vi.fn(async () => {}) }));
vi.mock("../../services/quests/claimHudStore", () => ({ beginClaimSession: vi.fn(), endClaimSession: vi.fn() }));

import { claimReward, fetchMyBadges } from "../../services/quests/questsClient";
import { refreshBadges, resetProgressionForTests } from "../../services/quests/progressionStore";
import { collectReward } from "./rewardFx";
import { beginClaimSession, endClaimSession } from "../../services/quests/claimHudStore";
import { badgeState, strongestBadges } from "../../services/quests/badgeView";
import { AchievementGallery, PinnedBadges } from "./AchievementGallery";

const rewards = [{ xp: 25, coins: 10 }, { xp: 75, coins: 25 }, { xp: 150, coins: 50 }, { xp: 300, coins: 100 }];
const badge = (over: Partial<Badge> = {}): Badge => ({
  id: "regular",
  title: "Regular",
  description: "Check in to the office",
  category: "engagement",
  emblem: "regular",
  metricKind: "event_count",
  metric: 0,
  tier: 0,
  tierName: "none",
  thresholds: [5, 20, 60, 150],
  nextThreshold: 5,
  tiersAwardedAt: [null, null, null, null],
  tiersClaimedAt: [null, null, null, null],
  tierRewards: rewards,
  ...over,
});

const list = (): Badge[] => [
  badge({ metric: 3 }), // progressing
  badge({ id: "hub_regular", title: "Hub Regular" }), // locked
  badge({ id: "streak", title: "Streak", thresholds: [3, 7, 14, 30], metric: 4, tier: 1, tierName: "bronze", nextThreshold: 7 }), // claimable
  badge({
    id: "connector", title: "Connector", category: "social", emblem: "connector", thresholds: [3, 8, 15, 30], metric: 9, tier: 2, tierName: "silver", nextThreshold: 15,
    tiersClaimedAt: ["2026-09-01T01:00:00Z", null, null, null],
  }), // claimable (silver unclaimed)
  badge({ id: "approachable", title: "Approachable", category: "social", emblem: "approachable", thresholds: [3, 8, 15, 30], metric: 5, tier: 1, tierName: "bronze", nextThreshold: 8, tiersClaimedAt: ["x", null, null, null] }), // earned
  badge({ id: "cheerleader", title: "Cheerleader", category: "contribution", emblem: "cheerleader", thresholds: [3, 10, 30, 75], nextThreshold: 3 }),
  badge({ id: "pathfinder", title: "Pathfinder", category: "growth", emblem: "pathfinder", thresholds: [3, 6, 9, 11], metric: 11, tier: 4, tierName: "platinum", nextThreshold: null, tiersClaimedAt: ["a", "b", "c", "d"] }), // complete
];

async function load(badges: Badge[]) {
  vi.mocked(fetchMyBadges).mockResolvedValue(badges);
  await act(async () => {
    await refreshBadges();
  });
}

describe("AchievementGallery helpers", () => {
  it("derives one visual state per badge", () => {
    const by = Object.fromEntries(list().map((b) => [b.id, badgeState(b)]));
    expect(by).toEqual({
      regular: "progressing", hub_regular: "locked", streak: "claimable", connector: "claimable",
      approachable: "earned", cheerleader: "locked", pathfinder: "complete",
    });
  });

  it("picks the strongest earned badges: tier first, then closeness to the next tier", () => {
    expect(strongestBadges(list(), 3).map((b) => b.id)).toEqual(["pathfinder", "connector", "approachable"]);
    expect(strongestBadges(list().filter((b) => b.tier === 0), 3)).toEqual([]);
  });
});

describe("PinnedBadges", () => {
  it("shows the top 3 earned badges with tier labels and a summary", async () => {
    render(<PinnedBadges badges={list()} />);
    expect(screen.getByTestId("pinned-summary")).toHaveTextContent("4/7 earned · 2 to claim");
    const items = screen.getAllByTestId(/^pinned-/).filter((el) => el.getAttribute("data-testid") !== "pinned-summary" && el.getAttribute("data-testid") !== "pinned-badges");
    expect(items.map((el) => el.getAttribute("data-testid"))).toEqual(["pinned-pathfinder", "pinned-connector", "pinned-approachable"]);
    expect(screen.getByTestId("pinned-pathfinder")).toHaveTextContent("Platinum");
    // The showcase draws the collectible medallion, struck at the badge's own tier — not the
    // gallery's card emblem, which is what made these read as ordinary icons.
    expect(screen.getByTestId("medallion-pathfinder")).toHaveAttribute("data-tier", "4");
    expect(screen.getByTestId("medallion-connector")).toHaveAttribute("data-tier", "2");
  });

  it("renders nothing before the first fetch and an empty hint with no earned badges", () => {
    const { rerender } = render(<PinnedBadges badges={null} />);
    expect(screen.queryByTestId("pinned-badges")).toBeNull();
    rerender(<PinnedBadges badges={[badge()]} />);
    expect(screen.getByTestId("pinned-badges")).toHaveTextContent("No badges yet");
  });
});

describe("AchievementGallery", () => {
  beforeEach(() => {
    resetProgressionForTests();
    vi.clearAllMocks();
  });

  it("category nav filters cards; cards expose state, tier, progress and next reward", async () => {
    await load(list());
    render(<AchievementGallery />);
    // "All" is the landing view: every category's badges in one grid, nothing filtered out.
    // The category name lives on the selected tab now; the heading meta carries only the counts.
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("gallery-summary")).toHaveTextContent("4/7 earned");
    expect(within(screen.getByTestId("achievement-grid")).getAllByRole("button")).toHaveLength(7);

    fireEvent.click(screen.getByRole("tab", { name: /Engagement/ }));
    expect(screen.getByRole("tab", { name: "Engagement" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("gallery-summary")).toHaveTextContent("1/3 earned");
    expect(screen.getByTestId("gallery-summary")).toHaveTextContent("2 rewards to claim");
    const grid = screen.getByTestId("achievement-grid");
    expect(within(grid).getAllByRole("button").map((b) => b.getAttribute("data-testid"))).toEqual([
      "achievement-regular", "achievement-hub_regular", "achievement-streak",
    ]);
    expect(screen.getByTestId("achievement-regular")).toHaveAttribute("data-state", "progressing");
    expect(screen.getByTestId("achievement-regular")).toHaveTextContent("3 / 5");
    expect(screen.getByTestId("achievement-regular-reward")).toHaveTextContent("+25 XP+10");
    expect(screen.getByTestId("achievement-hub_regular")).toHaveAttribute("data-state", "locked");
    expect(screen.getByTestId("achievement-streak")).toHaveAttribute("data-state", "claimable");
    expect(screen.getByTestId("achievement-streak-unclaimed")).toHaveTextContent("Claim");
    expect(screen.getByTestId("achievement-streak-reward")).toHaveTextContent("+75 XP+25"); // next tier (silver)

    fireEvent.click(screen.getByRole("tab", { name: /Growth/ }));
    expect(screen.getByTestId("achievement-pathfinder")).toHaveAttribute("data-state", "complete");
    expect(screen.getByTestId("achievement-pathfinder-reward")).toHaveTextContent("All tiers earned");
    fireEvent.click(screen.getByRole("tab", { name: /Social/ }));
    expect(screen.getByTestId("achievement-approachable")).toHaveAttribute("data-state", "earned");
    expect(screen.getByTestId("achievement-connector")).toHaveAttribute("data-tier", "2");
  });

  it("detail view lists Bronze→Platinum with locked / earned / claimed rows and claims via the shared claim + FX path", async () => {
    await load(list());
    vi.mocked(claimReward).mockResolvedValue({
      questId: "connector",
      periodKey: "t:2",
      grantedNow: true,
      reward: { xp: 75, coins: 25 },
      progression: { xp: 100, coins: 35, level: 2, levelStartXp: 100, nextLevelXp: 300 },
    } satisfies ClaimResult);
    render(<AchievementGallery />);
    fireEvent.click(screen.getByRole("tab", { name: /Social/ }));
    fireEvent.click(screen.getByTestId("achievement-connector"));

    expect(screen.getByTestId("achievement-detail-connector")).toHaveAttribute("data-state", "claimable");
    expect(screen.getByTestId("tier-connector-1")).toHaveAttribute("data-state", "claimed");
    expect(screen.getByTestId("tier-connector-2")).toHaveAttribute("data-state", "earned");
    expect(screen.getByTestId("tier-connector-3")).toHaveAttribute("data-state", "locked");
    expect(screen.getByTestId("tier-connector-2")).toHaveTextContent("+75 XP+25");
    expect(screen.getByTestId("tier-connector-3")).toHaveTextContent("9 / 15");
    expect(within(screen.getByTestId("tier-connector-1")).getByTestId("claimed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Claim reward for Connector Gold/ })).toBeNull();

    vi.mocked(fetchMyBadges).mockResolvedValue(
      list().map((b) => (b.id === "connector" ? { ...b, tiersClaimedAt: ["2026-09-01T01:00:00Z", "2026-09-03T00:00:00Z", null, null] } : b)),
    );
    const btn = screen.getByRole("button", { name: "Claim reward for Connector Silver" });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn); // double-click → one claim
    });
    expect(claimReward).toHaveBeenCalledTimes(1);
    expect(claimReward).toHaveBeenCalledWith("connector", "t:2");
    expect(collectReward).toHaveBeenCalledTimes(1);
    expect(vi.mocked(collectReward).mock.calls[0][0].grantedNow).toBe(true);
    expect(screen.getByTestId("tier-connector-2")).toHaveAttribute("data-state", "claimed");
    expect(screen.getByTestId("achievement-detail-connector")).toHaveAttribute("data-state", "earned");

    fireEvent.click(screen.getByRole("button", { name: "Back to all achievements" }));
    expect(screen.getByTestId("achievement-grid")).toBeInTheDocument();
    expect(screen.getByTestId("achievement-connector")).toBeInTheDocument(); // still on Social
  });


  // The Profile modal hides the dock the reward particles land on, so an Achievements claim has to
  // raise the SAME claim-time strip Quests and Missions raise — otherwise the XP and Coins fly at
  // an off-screen target and the viewer sees nothing. Reuses the existing store; no new FX.
  it("raises the shared claim HUD session around a successful tier claim", async () => {
    await load(list());
    vi.mocked(claimReward).mockResolvedValue({
      questId: "connector",
      periodKey: "t:2",
      grantedNow: true,
      reward: { xp: 75, coins: 25 },
      progression: { xp: 100, coins: 35, level: 2, levelStartXp: 100, nextLevelXp: 300 },
    } satisfies ClaimResult);
    render(<AchievementGallery />);
    fireEvent.click(screen.getByRole("tab", { name: /Social/ }));
    fireEvent.click(screen.getByTestId("achievement-connector"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Claim reward for Connector Silver" }));
    });
    expect(beginClaimSession).toHaveBeenCalledTimes(1);
    expect(endClaimSession).toHaveBeenCalledTimes(1);
    expect(collectReward).toHaveBeenCalledTimes(1);
  });

  it("closes the claim HUD session and plays no FX when the claim fails", async () => {
    await load(list());
    vi.mocked(claimReward).mockRejectedValue(new Error("Claim failed (409)"));
    render(<AchievementGallery />);
    fireEvent.click(screen.getByRole("tab", { name: /Social/ }));
    fireEvent.click(screen.getByTestId("achievement-connector"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Claim reward for Connector Silver" }));
    });
    expect(beginClaimSession).toHaveBeenCalledTimes(1);
    expect(endClaimSession).toHaveBeenCalledTimes(1);
    expect(collectReward).not.toHaveBeenCalled();
  });

// REGRESSION — an earlier edit sliced this stylesheet from ".emblem {" to a later marker and
// destroyed 11 rules, and left a comment INSIDE a selector list
// (`.card[data-state="locked"] /* … */ .emblem {`). CSS strips the comment, so that parsed as a
// DESCENDANT selector and the whole medallion construction applied only to locked cards — which
// is why badges rendered as bare icons. Neither failure shows up in a render test.
describe("AchievementGallery.module.css integrity", () => {
  const css = readFileSync("src/components/OfficeMap/AchievementGallery.module.css", "utf8");

  it("has balanced braces", () => {
    expect((css.match(/\{/g) ?? []).length).toBe((css.match(/\}/g) ?? []).length);
  });

  it("never embeds a comment inside a selector list", () => {
    const offenders: string[] = [];
    for (const m of css.matchAll(/(^|\})\s*([^{}@]*?)\{/g)) {
      const sel = m[2] ?? "";
      if (sel.includes("/*") && sel.split("/*")[0].trim()) offenders.push(sel.trim().slice(0, 60));
    }
    expect(offenders).toEqual([]);
  });

  it("styles the medallion globally, not only inside locked cards", () => {
    expect(css).toMatch(/\n\.emblem\s*\{/);
  });

  it.each([
    "cardTitle", "cardTop", "cardBar", "cardFill", "cardProgress", "cardReward",
    "cardTierTag", "cardClaimTag", "cardDoneTag", "tierLabel", "tierName",
    "emblem", "emblem_card", "emblem_detail", "pinnedTitle", "pinnedName", "pinnedArt",
  ])("still declares .%s", (name) => {
    expect(css).toMatch(new RegExp(`\\.${name}[\\s,{]`));
  });

  it("gives every tier its own medallion material", () => {
    const tiers = ["tier0", "tier1", "tier2", "tier3", "tier4"].map((t) => {
      const m = new RegExp(`\\.${t}\\s*\\{([^}]*)\\}`).exec(css);
      return /color:\s*(#[0-9a-f]{3,8})/i.exec(m?.[1] ?? "")?.[1] ?? "";
    });
    expect(tiers.every(Boolean)).toBe(true);
    expect(new Set(tiers).size).toBe(5);
  });
});
});
