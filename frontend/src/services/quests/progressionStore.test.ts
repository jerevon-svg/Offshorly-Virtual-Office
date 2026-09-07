import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimResult, Progression } from "./questsClient";

vi.mock("./questsClient", () => ({ fetchMyProgression: vi.fn(), fetchMyBadges: vi.fn() }));

import { fetchMyBadges, fetchMyProgression } from "./questsClient";
import type { Badge } from "./questsClient";
import {
  applyClaim,
  commitStaged,
  getProgressionSnapshot,
  refreshBadges,
  refreshProgression,
  resetProgressionForTests,
  stageClaim,
} from "./progressionStore";

const badge = (over: Partial<Badge> = {}): Badge => ({
  id: "regular",
  title: "Regular",
  description: "Check in",
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
  tierRewards: [{ xp: 25, coins: 10 }, { xp: 75, coins: 25 }, { xp: 150, coins: 50 }, { xp: 300, coins: 100 }],
  ...over,
});

const p = (over: Partial<Progression> = {}): Progression => ({
  xp: 0,
  coins: 0,
  level: 1,
  levelStartXp: 0,
  nextLevelXp: 100,
  ...over,
});
const claim = (over: Partial<ClaimResult> = {}): ClaimResult => ({
  questId: "q",
  periodKey: "",
  grantedNow: true,
  reward: { xp: 50, coins: 10 },
  progression: p({ xp: 50, coins: 10 }),
  ...over,
});

describe("progressionStore", () => {
  beforeEach(() => {
    resetProgressionForTests();
    vi.clearAllMocks();
  });

  it("refresh shares one in-flight request and swallows failures without losing the last value", async () => {
    vi.mocked(fetchMyProgression).mockResolvedValue(p({ xp: 30 }));
    const [a, b] = await Promise.all([refreshProgression(), refreshProgression()]);
    expect(fetchMyProgression).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(getProgressionSnapshot().progression?.xp).toBe(30);

    vi.mocked(fetchMyProgression).mockRejectedValue(new Error("offline"));
    expect(await refreshProgression()).toBeNull();
    expect(getProgressionSnapshot().progression?.xp).toBe(30);
  });

  it("applyClaim records feedback and pulses only for grantedNow, and detects a level crossing", () => {
    applyClaim(claim({ grantedNow: false, progression: p({ xp: 80, coins: 5 }) }));
    expect(getProgressionSnapshot()).toMatchObject({ progression: p({ xp: 80, coins: 5 }), lastClaim: null, coinsPulse: 0, xpPulse: 0 });

    applyClaim(claim({ progression: p({ xp: 130, coins: 15, level: 2, levelStartXp: 100, nextLevelXp: 300 }) }));
    const s = getProgressionSnapshot();
    expect(s.progression?.level).toBe(2);
    expect(s.lastClaim).toMatchObject({ id: 1, xp: 50, coins: 10, leveledUp: true });
    expect(s.lastClaim?.from.xp).toBe(80);
    expect((s.coinsPulse, s.xpPulse)).toBe(1);

    applyClaim(claim({ progression: p({ xp: 180, coins: 25, level: 2, levelStartXp: 100, nextLevelXp: 300 }) }));
    expect(getProgressionSnapshot().lastClaim).toMatchObject({ id: 2, leveledUp: false });
  });

  it("staging holds the confirmed balances until each part is committed, then pulses that part", () => {
    applyClaim(claim({ grantedNow: false, progression: p({ xp: 80, coins: 5 }) }));
    stageClaim(claim({ progression: p({ xp: 130, coins: 15, level: 2, levelStartXp: 100, nextLevelXp: 300 }) }));
    let s = getProgressionSnapshot();
    expect(s.progression).toEqual(p({ xp: 80, coins: 5 })); // nothing shown yet
    expect(s.staged?.coins).toBe(15);
    expect(s.lastClaim?.leveledUp).toBe(true);
    expect((s.coinsPulse, s.xpPulse)).toBe(0);

    commitStaged("coins");
    s = getProgressionSnapshot();
    expect(s.progression).toEqual(p({ xp: 80, coins: 15 })); // coins only
    expect(s.coinsPulse).toBe(1);
    expect(s.xpPulse).toBe(0);
    expect(s.staged).not.toBeNull();

    commitStaged("coins"); // duplicate arrival: no second pulse
    expect(getProgressionSnapshot().coinsPulse).toBe(1);

    commitStaged("xp");
    s = getProgressionSnapshot();
    expect(s.progression).toEqual(p({ xp: 130, coins: 15, level: 2, levelStartXp: 100, nextLevelXp: 300 }));
    expect(s.xpPulse).toBe(1);
    expect(s.staged).toBeNull();

    commitStaged("xp"); // nothing staged any more
    expect(getProgressionSnapshot().xpPulse).toBe(1);
  });

  it("staging a grantedNow=false response applies it plainly with no feedback", () => {
    stageClaim(claim({ grantedNow: false }));
    const s = getProgressionSnapshot();
    expect(s.staged).toBeNull();
    expect(s.lastClaim).toBeNull();
    expect(s.progression?.xp).toBe(50);
  });

  it("refreshBadges stores the server list and reports an award only when a tier rose since the last fetch", async () => {
    vi.mocked(fetchMyBadges).mockResolvedValue([badge({ metric: 4 }), badge({ id: "connector", title: "Connector", tier: 1, tierName: "bronze" })]);
    await refreshBadges();
    expect(getProgressionSnapshot().badges?.length).toBe(2);
    expect(getProgressionSnapshot().lastAward).toBeNull(); // first fetch: nothing to compare against

    vi.mocked(fetchMyBadges).mockResolvedValue([badge({ metric: 4 }), badge({ id: "connector", title: "Connector", tier: 1, tierName: "bronze" })]);
    await refreshBadges();
    expect(getProgressionSnapshot().lastAward).toBeNull(); // unchanged tiers

    vi.mocked(fetchMyBadges).mockResolvedValue([
      badge({ metric: 5, tier: 1, tierName: "bronze", nextThreshold: 20 }),
      badge({ id: "connector", title: "Connector", tier: 3, tierName: "gold" }),
    ]);
    await refreshBadges();
    // Two badges rose; the highest tier is surfaced.
    expect(getProgressionSnapshot().lastAward).toMatchObject({ badgeId: "connector", tier: 3, tierName: "gold" });

    vi.mocked(fetchMyBadges).mockRejectedValue(new Error("offline"));
    expect(await refreshBadges()).toBeNull();
    expect(getProgressionSnapshot().badges?.length).toBe(2); // last good list kept
  });
});
