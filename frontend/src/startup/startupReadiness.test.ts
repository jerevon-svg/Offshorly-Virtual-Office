import { afterEach, describe, expect, it } from "vitest";
import {
  __resetStartupSignalsForTest,
  deriveStartupProgress,
  getStartupSignals,
  setStartupSignal,
  STARTUP_STAGES,
  subscribeStartupSignals,
} from "./startupReadiness";

afterEach(() => {
  __resetStartupSignalsForTest();
});

describe("startupReadiness", () => {
  it("starts with nothing ready and the auth step active", () => {
    const progress = deriveStartupProgress(getStartupSignals());
    expect(progress.ready).toBe(false);
    expect(progress.fraction).toBe(0);
    expect(progress.activeIndex).toBe(0);
    expect(progress.status).toBe(STARTUP_STAGES[0].status);
  });

  it("advances progress as signals resolve, in any order", () => {
    setStartupSignal("selfPlaced", true);
    setStartupSignal("auth", true);
    const progress = deriveStartupProgress(getStartupSignals());
    expect(progress.fraction).toBeCloseTo(2 / STARTUP_STAGES.length);
    // First unfinished stage is "transform" (index 1), not selfPlaced.
    expect(progress.activeIndex).toBe(1);
    expect(progress.ready).toBe(false);
  });

  it("is ready only when every critical signal is true", () => {
    for (const stage of STARTUP_STAGES) setStartupSignal(stage.signal, true);
    const progress = deriveStartupProgress(getStartupSignals());
    expect(progress.ready).toBe(true);
    expect(progress.fraction).toBe(1);
    expect(progress.activeIndex).toBe(STARTUP_STAGES.length);
  });

  it("notifies subscribers only on actual changes", () => {
    let calls = 0;
    const unsubscribe = subscribeStartupSignals(() => {
      calls += 1;
    });
    setStartupSignal("roster", true);
    setStartupSignal("roster", true); // no-op
    setStartupSignal("roster", false);
    unsubscribe();
    setStartupSignal("roster", true);
    expect(calls).toBe(2);
  });
});
