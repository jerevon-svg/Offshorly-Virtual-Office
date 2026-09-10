import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimHud } from "./ClaimHud";
import { HUD_TARGET_ATTR, findHudTargets } from "./rewardFx";
import {
  beginClaimSession,
  endClaimSession,
  isClaimHudVisible,
  resetClaimHudForTests,
} from "../../services/quests/claimHudStore";

const PROGRESSION = {
  level: 2,
  xp: 140,
  coins: 160,
  levelStartXp: 100,
  nextLevelXp: 300,
};

// Only the progression READ is stubbed — the claim-HUD visibility store under test is the real
// one, and ClaimHud computes nothing the Player HUD doesn't already compute from these fields.
vi.mock("../../services/quests/progressionStore", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useProgression: () => PROGRESSION,
}));

describe("ClaimHud", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    resetClaimHudForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
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

    // Still up while the particles are in flight.
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByTestId("claim-hud")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(800));
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
    act(() => void vi.advanceTimersByTime(1800));
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
});
