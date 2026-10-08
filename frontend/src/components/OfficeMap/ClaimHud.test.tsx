import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimHud } from "./ClaimHud";
import { HUD_TARGET_ATTR, findHudTargets } from "./rewardFx";
import {
  CLAIM_HUD_HOLD_MS,
  beginClaimSession,
  endClaimSession,
  isClaimHudVisible,
  resetClaimHudForTests,
} from "../../services/quests/claimHudStore";
import {
  applyProgression,
  commitStaged,
  resetProgressionForTests,
  stageClaim,
} from "../../services/quests/progressionStore";
import type { ClaimResult, Progression } from "../../services/quests/questsClient";

const PROGRESSION = {
  level: 2,
  xp: 140,
  coins: 160,
  levelStartXp: 100,
  nextLevelXp: 300,
};

// The REAL progression store and claim-HUD visibility store — only the network client is stubbed.
// ClaimHud computes nothing the Player HUD doesn't (progressionMeter.ts is shared).
vi.mock("../../services/quests/questsClient", () => ({ fetchMyProgression: vi.fn(), fetchMyBadges: vi.fn() }));

const grant = (progression: Progression, reward = { xp: 50, coins: 10 }): ClaimResult => ({
  questId: "q",
  periodKey: "",
  grantedNow: true,
  reward,
  progression,
});

describe("ClaimHud", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetClaimHudForTests();
    resetProgressionForTests();
    applyProgression(PROGRESSION);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "matchMedia");
    resetClaimHudForTests();
  });

  it("stays hidden until a claim starts", () => {
    render(<ClaimHud />);
    expect(screen.queryByTestId("claim-hud")).toBeNull();
  });

  it("appears on claim and shows the live progression values", () => {
    render(<ClaimHud />);
    act(() => beginClaimSession());

    expect(screen.getByTestId("claim-hud")).toBeInTheDocument();
    expect(screen.getByTestId("claim-hud-coins").textContent).toBe("160");
    // 140 - 100 into a 300 - 100 span.
    expect(screen.getByTestId("claim-hud-xp").textContent).toBe("40 / 200 XP");
  });

  it("carries the reward FX targets, so particles land on it", () => {
    render(<ClaimHud />);
    act(() => beginClaimSession());

    const strip = screen.getByTestId("claim-hud");
    expect(strip.querySelector(`[${HUD_TARGET_ATTR}="coins"]`)).not.toBeNull();
    expect(strip.querySelector(`[${HUD_TARGET_ATTR}="xp"]`)).not.toBeNull();

    // What rewardFx itself resolves must be inside this strip.
    const targets = findHudTargets();
    expect(strip.contains(targets.coins)).toBe(true);
    expect(strip.contains(targets.xp)).toBe(true);
  });

  it("holds through the FX, then hides", () => {
    render(<ClaimHud />);
    act(() => beginClaimSession());
    act(() => endClaimSession());

    // Still up while the particles are in flight AND through the count-up that follows landing.
    act(() => void vi.advanceTimersByTime(CLAIM_HUD_HOLD_MS - 100));
    expect(screen.getByTestId("claim-hud")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByTestId("claim-hud")).toBeNull();
  });

  it("stays up across a whole Claim All run instead of flashing per item", () => {
    render(<ClaimHud />);
    act(() => beginClaimSession()); // the run

    for (let i = 0; i < 3; i++) {
      act(() => beginClaimSession()); // one item
      act(() => void vi.advanceTimersByTime(120));
      act(() => endClaimSession());
      act(() => void vi.advanceTimersByTime(120));
      expect(screen.getByTestId("claim-hud"), `hidden between items at ${i}`).toBeInTheDocument();
    }

    act(() => endClaimSession()); // the run ends
    expect(isClaimHudVisible()).toBe(true);
    act(() => void vi.advanceTimersByTime(CLAIM_HUD_HOLD_MS + 100));
    expect(screen.queryByTestId("claim-hud")).toBeNull();
  });

  it("a new claim during the hold cancels the exit", () => {
    render(<ClaimHud />);
    act(() => beginClaimSession());
    act(() => endClaimSession());
    act(() => void vi.advanceTimersByTime(900));

    act(() => beginClaimSession());
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByTestId("claim-hud")).toBeInTheDocument();
  });

  it("counts up as the icons land instead of showing the final value early", async () => {
    // Drive useAnimatedNumber's frames off the fake clock.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    render(<ClaimHud />);
    act(() => beginClaimSession());
    act(() => stageClaim(grant({ ...PROGRESSION, xp: 190, coins: 170 })));

    // Staged, not landed: the strip still shows the pre-claim balances.
    expect(screen.getByTestId("claim-hud-coins").textContent).toBe("160");
    expect(screen.getByTestId("claim-hud-xp").textContent).toBe("40 / 200 XP");

    act(() => commitStaged("xp"));
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    const mid = Number(screen.getByTestId("claim-hud-xp").textContent?.split(" ")[0]);
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThan(90);
    expect(screen.getByTestId("claim-hud-coins").textContent).toBe("160"); // coins have not landed

    act(() => commitStaged("coins"));
    await act(async () => void (await vi.advanceTimersByTimeAsync(1200)));
    expect(screen.getByTestId("claim-hud-xp").textContent).toBe("90 / 200 XP");
    expect(screen.getByTestId("claim-hud-coins").textContent).toBe("170");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("90");
  });

  it("rolls the bar over into the new level and shows Level up", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    // Lv 2 at 280 / window 100–300; a 50 XP claim lands at 330 in Lv 3 (300–500).
    act(() => applyProgression({ ...PROGRESSION, xp: 280 }));
    render(<ClaimHud />);
    act(() => beginClaimSession());
    act(() => stageClaim(grant({ level: 3, xp: 330, coins: 170, levelStartXp: 300, nextLevelXp: 500 })));
    expect(screen.getByTestId("claim-hud-level").textContent).toBe("Lv 2");
    expect(screen.queryByTestId("claim-hud-level-up")).toBeNull();

    act(() => commitStaged("xp"));
    // Early in the count-up the meter is still filling the OLD window.
    await act(async () => void (await vi.advanceTimersByTimeAsync(48)));
    expect(screen.getByTestId("claim-hud-level").textContent).toBe("Lv 2");

    await act(async () => void (await vi.advanceTimersByTimeAsync(1200)));
    expect(screen.getByTestId("claim-hud-level").textContent).toBe("Lv 3");
    expect(screen.getByTestId("claim-hud-xp").textContent).toBe("30 / 200 XP");
    expect(screen.getByTestId("claim-hud-level-up")).toBeInTheDocument();
  });

  it("reduced motion: lands on the confirmed values at once, no count-up", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
    render(<ClaimHud />);
    act(() => beginClaimSession());
    act(() => stageClaim(grant({ ...PROGRESSION, xp: 190, coins: 170 })));
    act(() => {
      commitStaged("xp");
      commitStaged("coins");
    });
    expect(screen.getByTestId("claim-hud-xp").textContent).toBe("90 / 200 XP");
    expect(screen.getByTestId("claim-hud-coins").textContent).toBe("170");
  });
});
