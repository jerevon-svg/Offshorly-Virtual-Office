import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimResult, Progression } from "../../services/quests/questsClient";

vi.mock("../../services/quests/questsClient", () => ({ fetchMyProgression: vi.fn(), fetchMyBadges: vi.fn() }));

import { applyClaim, getProgressionSnapshot, resetProgressionForTests } from "../../services/quests/progressionStore";
import { HUD_TARGET_ATTR, collectReward, findHudTargets, iconCount, playRewardCollection } from "./rewardFx";

const p = (over: Partial<Progression> = {}): Progression => ({ xp: 0, coins: 0, level: 1, levelStartXp: 0, nextLevelXp: 100, ...over });
const claim = (over: Partial<ClaimResult> = {}): ClaimResult => ({
  questId: "q",
  periodKey: "",
  grantedNow: true,
  reward: { xp: 50, coins: 10 },
  progression: p({ xp: 50, coins: 10 }),
  ...over,
});

function mountHud(parent: HTMLElement = document.body): { coins: HTMLElement; xp: HTMLElement } {
  const coins = document.createElement("div");
  coins.setAttribute(HUD_TARGET_ATTR, "coins");
  const xp = document.createElement("div");
  xp.setAttribute(HUD_TARGET_ATTR, "xp");
  parent.append(coins, xp);
  return { coins, xp };
}

/** A HUD stepped aside the way HudDock's `hidden` prop does it: inert + aria-hidden. */
function mountHiddenDock(): { coins: HTMLElement; xp: HTMLElement } {
  const dock = document.createElement("div");
  dock.setAttribute("inert", "");
  dock.setAttribute("aria-hidden", "true");
  document.body.append(dock);
  return mountHud(dock);
}

function placeAt(el: HTMLElement, top: number): void {
  el.getBoundingClientRect = () => new DOMRect(100, top, 80, 24);
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

describe("rewardFx target selection (V2 parity)", () => {
  beforeEach(() => {
    resetProgressionForTests();
    document.body.innerHTML = "";
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => window.setTimeout(() => cb(Date.now()), 16));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("never selects a hidden/inert dock's targets, even when it comes first in the DOM", () => {
    mountHiddenDock(); // V2: the dock stays mounted, and is earlier in document order
    const strip = mountHud();
    const t = findHudTargets();
    expect(t.coins).toBe(strip.coins);
    expect(t.xp).toBe(strip.xp);
  });

  it("never selects a laid-out target that sits outside the viewport", () => {
    const offscreen = mountHud();
    placeAt(offscreen.coins, window.innerHeight + 40);
    placeAt(offscreen.xp, window.innerHeight + 40);
    const visible = mountHud();
    placeAt(visible.coins, window.innerHeight - 60);
    placeAt(visible.xp, window.innerHeight - 60);
    expect(findHudTargets()).toEqual({ coins: visible.coins, xp: visible.xp });
  });

  it("with only a hidden dock, nothing flies below the viewport: confirmed values apply directly", async () => {
    mountHiddenDock();
    expect(findHudTargets()).toEqual({ coins: null, xp: null });
    await collectReward(claim(), new DOMRect(0, 0, 10, 10));
    expect(document.querySelectorAll("span[aria-hidden]")).toHaveLength(0);
    expect(getProgressionSnapshot()).toMatchObject({ progression: p({ xp: 50, coins: 10 }), staged: null, coinsPulse: 1, xpPulse: 1 });
  });

  it("commits XP when its icons land and Coins when theirs land — each part on its own arrival", async () => {
    mountHiddenDock();
    mountHud();
    applyClaim(claim({ grantedNow: false, progression: p({ xp: 80, coins: 5 }) }));
    // reward 50 XP / 10 coins → 3 XP icons (last lands ~1160ms) and 4 coin icons (~1230ms).
    const run = collectReward(claim({ progression: p({ xp: 130, coins: 15, level: 2, levelStartXp: 100, nextLevelXp: 300 }) }), new DOMRect(0, 0, 10, 10));
    await vi.advanceTimersByTimeAsync(1000);
    expect(getProgressionSnapshot().progression).toMatchObject({ xp: 80, coins: 5 }); // nothing landed yet
    await vi.advanceTimersByTimeAsync(195);
    expect(getProgressionSnapshot().progression).toMatchObject({ xp: 130, level: 2, coins: 5 }); // XP landed only
    expect(getProgressionSnapshot().xpPulse).toBe(1);
    expect(getProgressionSnapshot().coinsPulse).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    await run;
    expect(getProgressionSnapshot()).toMatchObject({ progression: { xp: 130, coins: 15 }, staged: null, coinsPulse: 1 });
    // lastClaim carries the rollover the meter needs (from Lv1 → Lv2).
    expect(getProgressionSnapshot().lastClaim).toMatchObject({ leveledUp: true, from: { level: 1 }, to: { level: 2 } });
  });

  it("Claim All: back-to-back claims each fly to the strip and settle on the last confirmed balances", async () => {
    mountHiddenDock();
    mountHud();
    const snapshots = [p({ xp: 20, coins: 5 }), p({ xp: 40, coins: 10 }), p({ xp: 60, coins: 15 })];
    const runs: Promise<void>[] = [];
    for (const progression of snapshots) {
      runs.push(collectReward(claim({ reward: { xp: 20, coins: 5 }, progression }), new DOMRect(0, 0, 10, 10)));
      await vi.advanceTimersByTimeAsync(150); // the next POST resolves while earlier icons are in flight
    }
    expect(document.querySelectorAll("span[aria-hidden]").length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(runs);
    expect(getProgressionSnapshot()).toMatchObject({ progression: snapshots[2], staged: null });
    expect(document.querySelectorAll("span[aria-hidden]")).toHaveLength(0);
  });

  it("reduced motion with the V2 strip mounted: no travel, confirmed values and pulses at once", async () => {
    mountHiddenDock();
    mountHud();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
    await collectReward(claim(), new DOMRect(0, 0, 10, 10));
    expect(document.querySelectorAll("span[aria-hidden]")).toHaveLength(0);
    expect(getProgressionSnapshot()).toMatchObject({ progression: p({ xp: 50, coins: 10 }), staged: null, coinsPulse: 1, xpPulse: 1 });
  });
});
