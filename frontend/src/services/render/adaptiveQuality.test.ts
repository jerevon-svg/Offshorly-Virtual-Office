// SMOOTH's adaptation, held to the millisecond.
//
// Every test here drives the controller with a synthetic frame clock rather than a real one, which is
// the whole reason the controller takes `nowMs` as an argument: the behaviour that matters — sustained
// windows, hysteresis, cooldowns, one rung at a time — is time-shaped, and timing assertions made
// against a real rAF loop are assertions about the machine running CI.
import { describe, expect, it, vi } from "vitest";
import {
  AdaptiveQuality,
  COOLDOWN_MS,
  DEGRADE_MS,
  DEGRADE_SUSTAIN_MS,
  RECOVER_MS,
  RECOVER_SUSTAIN_MS,
  RELAPSE_BLOCK_MS,
  WARMUP_MS,
} from "./adaptiveQuality";

/** Feed `ms` of wall clock at a steady `frameMs`, starting at `from`. Returns the clock afterwards. */
function run(a: AdaptiveQuality, frameMs: number, durationMs: number, from: number): number {
  let t = from;
  const end = from + durationMs;
  while (t < end) {
    t += frameMs;
    a.sample(frameMs, t);
  }
  return t;
}

const SLOW = 33; // ~30 fps — comfortably above DEGRADE_MS
const FAST = 8; // ~120 fps — comfortably below RECOVER_MS
const VSYNC = 16.7; // a machine holding 60 Hz

describe("the thresholds themselves", () => {
  it("leaves a dead band around the 60 Hz vsync floor", () => {
    // If they ever cross, or the band closes, the controller oscillates by construction.
    expect(RECOVER_MS).toBeLessThan(DEGRADE_MS);
    expect(RECOVER_MS).toBeGreaterThan(VSYNC);
  });

  it("is slower to give quality back than to take it away", () => {
    expect(RECOVER_SUSTAIN_MS).toBeGreaterThan(DEGRADE_SUSTAIN_MS);
  });
});

describe("degrading", () => {
  it("does not move during warm-up, however bad the frames are", () => {
    const a = new AdaptiveQuality({ startedAtMs: 0 });
    run(a, SLOW, WARMUP_MS - 200, 0);
    expect(a.level).toBe(3);
  });

  it("drops exactly one rung once poor performance is sustained", () => {
    const changes: string[] = [];
    const a = new AdaptiveQuality({ startedAtMs: 0, onChange: (c) => changes.push(`${c.action} ${c.from}->${c.to}`) });
    run(a, SLOW, WARMUP_MS + DEGRADE_SUSTAIN_MS + 500, 0);
    expect(a.level).toBe(2);
    expect(changes).toEqual(["degraded 3->2"]);
  });

  it("walks down gradually rather than jumping to the floor", () => {
    const a = new AdaptiveQuality({ startedAtMs: 0 });
    // Long enough for three separate degrade decisions, each behind its own cooldown.
    run(a, SLOW, WARMUP_MS + 3 * (DEGRADE_SUSTAIN_MS + COOLDOWN_MS) + 4000, 0);
    expect(a.level).toBe(0);
    // ...and then stops: there is no rung below the floor.
    run(a, SLOW, 60000, 200000);
    expect(a.level).toBe(0);
  });

  it("spaces consecutive drops by at least the cooldown", () => {
    // Sustained trouble SHOULD keep costing rungs — what must not happen is two rungs falling out of
    // one window, back to back, before the previous drop has had a chance to help.
    const at: number[] = [];
    const a = new AdaptiveQuality({ startedAtMs: 0, onChange: (c) => at.push(c.atMs) });
    run(a, SLOW, WARMUP_MS + 3 * (DEGRADE_SUSTAIN_MS + COOLDOWN_MS) + 4000, 0);
    expect(at.length).toBe(3);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(COOLDOWN_MS);
  });

  it("re-measures after a drop instead of re-spending the window that caused it", () => {
    // The samples that justified a drop describe a world that no longer exists — a rung change is
    // exactly a change in what a frame costs. They are dropped AT the change, so the next decision
    // needs a whole new window's worth of evidence rather than inheriting the old one's.
    const atChange: (number | null)[] = [];
    const a = new AdaptiveQuality({
      startedAtMs: 0,
      onChange: () => atChange.push(a.sampleCount, a.medianFrameMs),
    });
    run(a, SLOW, WARMUP_MS + DEGRADE_SUSTAIN_MS + 500, 0);
    expect(a.level).toBe(2);
    expect(atChange).toEqual([0, null]);
  });
});

describe("spikes and stalls", () => {
  it("ignores an isolated hitch inside an otherwise healthy window", () => {
    const a = new AdaptiveQuality({ startedAtMs: 0 });
    let t = 0;
    // 20 s of good frames with a 90 ms hitch every 30 frames — a median-based window never notices.
    for (let i = 0; i < 2000; i++) {
      const frame = i % 30 === 0 ? 90 : FAST;
      t += frame;
      a.sample(frame, t);
    }
    expect(a.level).toBe(3);
  });

  it("discards a stall rather than counting it as a slow frame", () => {
    const a = new AdaptiveQuality({ startedAtMs: 0 });
    run(a, FAST, 5000, 0);
    const before = a.sampleCount;
    a.sample(4000, 9000); // a backgrounded tab coming back
    expect(a.sampleCount).toBe(before); // not stored at all
  });

  it("holds quality steady in the dead band", () => {
    const a = new AdaptiveQuality({ startedAtMs: 0 });
    const between = (DEGRADE_MS + RECOVER_MS) / 2;
    run(a, between, 60000, 0);
    expect(a.level).toBe(3);
    expect(a.lastAdaptation).toBeNull();
  });
});

describe("recovering", () => {
  it("climbs back one rung after sustained headroom, and only after the longer window", () => {
    const a = new AdaptiveQuality({ startLevel: 1, startedAtMs: 0 });
    let t = run(a, FAST, WARMUP_MS + DEGRADE_SUSTAIN_MS + 500, 0);
    expect(a.level).toBe(1); // the degrade window is not long enough to recover on
    t = run(a, FAST, RECOVER_SUSTAIN_MS, t);
    expect(a.level).toBe(2);
    expect(a.lastAdaptation?.action).toBe("recovered");
  });

  it("gives up a rung again if the machine cannot hold it", () => {
    const a = new AdaptiveQuality({ startLevel: 2, startedAtMs: 0 });
    let t = run(a, FAST, WARMUP_MS + RECOVER_SUSTAIN_MS + 500, 0);
    expect(a.level).toBe(3);
    t = run(a, SLOW, COOLDOWN_MS + DEGRADE_SUSTAIN_MS + 500, t);
    expect(a.level).toBe(2);
  });
});

describe("anti-oscillation", () => {
  it("will not re-climb a rung it had to abandon, until the relapse block expires", () => {
    const a = new AdaptiveQuality({ startedAtMs: 0 });
    // Fall off rung 3.
    let t = run(a, SLOW, WARMUP_MS + DEGRADE_SUSTAIN_MS + 500, 0);
    expect(a.level).toBe(2);
    // Now the machine looks fine again — but rung 3 is barred, so nothing happens however long we wait.
    t = run(a, FAST, RELAPSE_BLOCK_MS - COOLDOWN_MS, t);
    expect(a.level).toBe(2);
    // Past the block, the same good frames are allowed to promote.
    t = run(a, FAST, RECOVER_SUSTAIN_MS + COOLDOWN_MS + 2000, t);
    expect(a.level).toBe(3);
  });

  it("settles instead of pumping when performance alternates around the band", () => {
    const at: number[] = [];
    const a = new AdaptiveQuality({ startedAtMs: 0, onChange: (c) => at.push(c.atMs) });
    let t = 0;
    // Twenty minutes of 20 s good / 20 s bad — a machine whose load genuinely swings. The property
    // that matters is not "it never moves" (it should track a real swing at first) but that the
    // backoff makes it move LESS as the swing continues, rather than once per cycle forever.
    for (let i = 0; i < 30; i++) {
      t = run(a, FAST, 20000, t);
      t = run(a, SLOW, 20000, t);
    }
    const half = t / 2;
    const first = at.filter((x) => x < half).length;
    const second = at.filter((x) => x >= half).length;
    expect(second).toBeLessThan(first);
    expect(a.level).toBeLessThan(3);
  });
});

describe("the measurement window", () => {
  it("reports no median until it holds enough frames", () => {
    const a = new AdaptiveQuality({ startedAtMs: 0 });
    a.sample(FAST, 8);
    expect(a.medianFrameMs).toBeNull();
    run(a, FAST, 3000, 8);
    expect(a.medianFrameMs).toBeCloseTo(FAST, 1);
  });

  it("clears on reset without changing quality", () => {
    const a = new AdaptiveQuality({ startLevel: 1, startedAtMs: 0 });
    run(a, FAST, 4000, 0);
    a.resetWindow(50000);
    expect(a.sampleCount).toBe(0);
    expect(a.medianFrameMs).toBeNull();
    expect(a.level).toBe(1);
  });

  it("re-arms warm-up on reset, so a resize cannot immediately drop quality", () => {
    const a = new AdaptiveQuality({ startedAtMs: 0 });
    a.resetWindow(100000);
    run(a, SLOW, WARMUP_MS - 200, 100000);
    expect(a.level).toBe(3);
  });

  it("does not fire onChange for a level it did not move to", () => {
    const onChange = vi.fn();
    const a = new AdaptiveQuality({ startedAtMs: 0, onChange });
    run(a, VSYNC - 0.1, 30000, 0); // inside the band, on the fast side of DEGRADE but above RECOVER?
    // VSYNC - 0.1 is below RECOVER_MS, so this is a legitimate recovery case at the top rung:
    // there is nowhere to climb to, so nothing is emitted.
    expect(onChange).not.toHaveBeenCalled();
    expect(a.level).toBe(3);
  });
});
