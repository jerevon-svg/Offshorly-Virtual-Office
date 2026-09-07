import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimResult, Progression } from "../../services/quests/questsClient";

vi.mock("../../services/quests/questsClient", () => ({ fetchMyProgression: vi.fn(), fetchMyBadges: vi.fn() }));

import { applyClaim, getProgressionSnapshot, resetProgressionForTests } from "../../services/quests/progressionStore";
import { HUD_TARGET_ATTR, collectReward, iconCount, playRewardCollection } from "./rewardFx";

const p = (over: Partial<Progression> = {}): Progression => ({ xp: 0, coins: 0, level: 1, levelStartXp: 0, nextLevelXp: 100, ...over });
const claim = (over: Partial<ClaimResult> = {}): ClaimResult => ({
  questId: "q",
  periodKey: "",
  grantedNow: true,
  reward: { xp: 50, coins: 10 },
  progression: p({ xp: 50, coins: 10 }),
  ...over,
});

function mountHud(): void {
  const coins = document.createElement("div");
  coins.setAttribute(HUD_TARGET_ATTR, "coins");
  const xp = document.createElement("div");
  xp.setAttribute(HUD_TARGET_ATTR, "xp");
  document.body.append(coins, xp);
}

describe("rewardFx", () => {
  beforeEach(() => {
    resetProgressionForTests();
    document.body.innerHTML = "";
    vi.useFakeTimers();
    // jsdom has no requestAnimationFrame; drive frames off the (fake) timer clock.
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => window.setTimeout(() => cb(Date.now()), 16));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("uses a handful of icons that scale gently with the reward", () => {
    expect(iconCount("coins", 0)).toBe(0);
    expect([5, 10, 15, 25].map((c) => iconCount("coins", c))).toEqual([3, 4, 5, 5]);
    expect([20, 50, 60, 100].map((x) => iconCount("xp", x))).toEqual([2, 3, 3, 4]);
  });

  it("bursts then travels, calling the coins and XP arrival hooks once each and cleaning up", async () => {
    mountHud();
    const onCoinsArrive = vi.fn();
    const onXpArrive = vi.fn();
    const done = playRewardCollection({
      source: new DOMRect(100, 100, 40, 20),
      coins: 10,
      xp: 50,
      targets: { coins: document.querySelector(`[${HUD_TARGET_ATTR}="coins"]`)!, xp: document.querySelector(`[${HUD_TARGET_ATTR}="xp"]`)! },
      onCoinsArrive,
      onXpArrive,
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelectorAll("span[aria-hidden]")).toHaveLength(4 + 3); // burst in progress
    expect(onCoinsArrive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2500);
    await done;
    expect(onCoinsArrive).toHaveBeenCalledTimes(1);
    expect(onXpArrive).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("span[aria-hidden]")).toHaveLength(0);
    expect(document.body.querySelectorAll("div").length).toBe(2); // only the HUD targets remain
  });

  it("collectReward stages the claim and commits coins then XP as the icons land", async () => {
    mountHud();
    applyClaim(claim({ grantedNow: false, progression: p({ xp: 80, coins: 5 }) }));
    const run = collectReward(claim({ progression: p({ xp: 130, coins: 15, level: 2, levelStartXp: 100, nextLevelXp: 300 }) }), new DOMRect(0, 0, 10, 10));
    await vi.advanceTimersByTimeAsync(100);
    expect(getProgressionSnapshot().progression).toEqual(p({ xp: 80, coins: 5 })); // held back
    expect(getProgressionSnapshot().staged?.xp).toBe(130);
    await vi.advanceTimersByTimeAsync(3000);
    await run;
    const s = getProgressionSnapshot();
    expect(s.progression?.level).toBe(2);
    expect(s.progression?.coins).toBe(15);
    expect(s.staged).toBeNull();
    expect(s.coinsPulse).toBe(1);
    expect(s.xpPulse).toBe(1);
  });

  it("grantedNow=false never bursts; no HUD or reduced motion applies confirmed values directly", async () => {
    await collectReward(claim({ grantedNow: false, progression: p({ xp: 80, coins: 5 }) }), new DOMRect());
    expect(getProgressionSnapshot()).toMatchObject({ progression: p({ xp: 80, coins: 5 }), lastClaim: null, coinsPulse: 0 });
    expect(document.querySelectorAll("span[aria-hidden]")).toHaveLength(0);

    // No HUD mounted → direct apply with pulses (subtle feedback), no icons.
    await collectReward(claim(), new DOMRect());
    expect(getProgressionSnapshot()).toMatchObject({ progression: p({ xp: 50, coins: 10 }), coinsPulse: 1, xpPulse: 1 });
    expect(document.querySelectorAll("span[aria-hidden]")).toHaveLength(0);

    // HUD present but reduced motion → same direct path.
    mountHud();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
    await collectReward(claim({ progression: p({ xp: 100, coins: 20, level: 2, levelStartXp: 100, nextLevelXp: 300 }) }), new DOMRect());
    expect(getProgressionSnapshot().progression?.level).toBe(2);
    expect(getProgressionSnapshot().staged).toBeNull();
    expect(document.querySelectorAll("span[aria-hidden]")).toHaveLength(0);
  });
});
