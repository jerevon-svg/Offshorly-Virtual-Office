// SMOOTH — the adaptive controller. Pure, deterministic, and deliberately ignorant of three.js, of the
// DOM and of the clock: every decision is a function of the frame times pushed into it and the
// timestamp pushed with them. That is what makes it testable to the millisecond (adaptiveQuality.test)
// rather than "watchable on a laptop".
//
// WHAT IT IS NOT. It is not a fixed low preset, and it is not an FPS counter wired to a switch. The
// three properties that separate a usable adaptive mode from an annoying one are all here:
//
//   1. IT MEASURES SUSTAINED PERFORMANCE, NOT FRAMES. The decision input is the MEDIAN frame time of a
//      rolling window, so one 90 ms hitch — a GLB finishing its upload, a room coming into view, the
//      browser collecting garbage — moves the median by nothing at all. A mean would have been moved
//      by it, which is how adaptive modes end up dropping quality every time a door opens.
//   2. HYSTERESIS. The threshold to drop and the threshold to climb back are different numbers with a
//      dead band between them, so a machine sitting exactly on the line stays where it is instead of
//      oscillating. The band is placed around the 60 Hz vsync floor (16.7 ms) on purpose: a machine
//      that is comfortably holding vsync reads as "recover", one that is missing it reads as "degrade",
//      and everything in between reads as "leave it alone".
//   3. COOLDOWNS, AND ASYMMETRY. Quality drops after 2.5 s of sustained trouble and climbs back only
//      after 8 s of sustained headroom, never more than one rung at a time, and never within 6 s of the
//      last change. Degrading is cheap to be wrong about; upgrading into a stutter is not.
//
// Plus an anti-relapse rule (see RELAPSE_BLOCK_MS): a rung that we had to leave because it did not hold
// is barred from being climbed back to for a while. Without it, a machine that sits just under a rung's
// cost walks up and down that one step forever, which is exactly the visible pumping this mode exists
// to avoid.

import { MAX_QUALITY_LEVEL, MIN_QUALITY_LEVEL, type QualityLevel } from "./graphicsQuality";

/** Length of the rolling measurement window, in ms of wall clock. */
export const WINDOW_MS = 2000;
/** Fewest frames the window must hold before it is allowed to decide anything. */
export const MIN_SAMPLES = 24;

/** Median frame time above which the window counts as "struggling" (~48 fps). */
export const DEGRADE_MS = 20.8;
/** Median frame time below which the window counts as "comfortable" (~57 fps, i.e. holding vsync). */
export const RECOVER_MS = 17.5;

/** How long the median must stay above DEGRADE_MS before quality drops a rung. */
export const DEGRADE_SUSTAIN_MS = 2500;
/** How long the median must stay below RECOVER_MS before quality climbs a rung. Deliberately much
 *  longer than the degrade side: a brief lull is not evidence a machine can afford more work. */
export const RECOVER_SUSTAIN_MS = 8000;
/** No change of any kind within this long of the last one. */
export const COOLDOWN_MS = 6000;
/** How long a rung we had to abandon is barred from being climbed back to, the FIRST time. */
export const RELAPSE_BLOCK_MS = 45000;
/** Each further relapse onto the same rung doubles its block, up to this many doublings.
 *
 *  WHY IT HAS TO BACK OFF RATHER THAN BE A FIXED BAR. A machine whose load genuinely swings — a call
 *  starting, a big room coming into view, another app waking up — alternates around a rung's cost for
 *  as long as that swing lasts. With a fixed bar it re-climbs and re-falls once per swing, forever,
 *  which is precisely the visible pumping this mode exists to prevent. Doubling makes each failed
 *  attempt buy a longer quiet period, so the controller converges on the rung that actually holds
 *  instead of re-litigating it every minute. Capped so it can still recover eventually. */
export const RELAPSE_BACKOFF_MAX_DOUBLINGS = 3;
/** Grace period after start/reset before the controller may act at all — lets load settle. */
export const WARMUP_MS = 3000;

export type AdaptiveAction = "degraded" | "recovered";

export interface AdaptiveChange {
  action: AdaptiveAction;
  from: QualityLevel;
  to: QualityLevel;
  atMs: number;
  /** Median frame time (ms) of the window that triggered it — what the decision was actually made on. */
  medianMs: number;
}

export interface AdaptiveQualityOptions {
  /** Rung to start on. Defaults to the top — Smooth starts at the approved look and earns its way down. */
  startLevel?: QualityLevel;
  /** Wall clock of the first sample. Only used to anchor warm-up; sample() carries its own timestamps. */
  startedAtMs?: number;
  /** Called on every rung change. The applier uses it to push new settings at the renderer. */
  onChange?: (change: AdaptiveChange) => void;
}

interface Sample {
  atMs: number;
  frameMs: number;
}

/**
 * Rolling-window frame watchdog with hysteresis, cooldowns and one-rung-at-a-time movement.
 *
 * Drive it with `sample(frameMs, nowMs)` once per rendered frame. It allocates nothing per frame beyond
 * the sample it stores, and it drops samples off the front of the window as they age out.
 */
export class AdaptiveQuality {
  private readonly samples: Sample[] = [];
  private readonly onChange?: (change: AdaptiveChange) => void;
  private currentLevel: QualityLevel;
  private startedAtMs: number | null;
  /** when the median first went above DEGRADE_MS in the current unbroken run (null = not struggling) */
  private struggleSinceMs: number | null = null;
  /** when the median first went below RECOVER_MS in the current unbroken run (null = not comfortable) */
  private comfortSinceMs: number | null = null;
  private lastChangeAtMs: number | null = null;
  /** level → wall clock before which it may not be climbed back to (see RELAPSE_BLOCK_MS) */
  private readonly blockedUntilMs = new Map<QualityLevel, number>();
  /** level → how many times it has been abandoned this session, for the backoff above */
  private readonly relapseCount = new Map<QualityLevel, number>();
  private lastChange: AdaptiveChange | null = null;

  constructor(options: AdaptiveQualityOptions = {}) {
    this.currentLevel = options.startLevel ?? MAX_QUALITY_LEVEL;
    this.startedAtMs = options.startedAtMs ?? null;
    this.onChange = options.onChange;
  }

  get level(): QualityLevel {
    return this.currentLevel;
  }

  /** The most recent rung change, or null while the controller has never moved. */
  get lastAdaptation(): AdaptiveChange | null {
    return this.lastChange;
  }

  /** Frames currently inside the rolling window. */
  get sampleCount(): number {
    return this.samples.length;
  }

  /** Median frame time (ms) of the window, or null while it is too short to mean anything. */
  get medianFrameMs(): number | null {
    if (this.samples.length < MIN_SAMPLES) return null;
    const sorted = this.samples.map((s) => s.frameMs).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Forget every measurement and every timer, keeping the current rung.
   *
   * Called whenever the thing being measured stops being comparable to what came before: the mode was
   * switched, the tab came back from the background (where rAF stops and the first frame after is
   * enormous), the window was resized. Measuring across that boundary is measuring nothing.
   */
  resetWindow(nowMs: number): void {
    this.samples.length = 0;
    this.struggleSinceMs = null;
    this.comfortSinceMs = null;
    this.startedAtMs = nowMs;
  }

  /** Push one rendered frame. Returns the rung in force AFTER this sample. */
  sample(frameMs: number, nowMs: number): QualityLevel {
    if (this.startedAtMs === null) this.startedAtMs = nowMs;
    // A frame long enough to be a stall rather than a slow frame (tab backgrounded, breakpoint hit,
    // the OS descheduling the renderer) is not evidence about quality — it is evidence the clock
    // stopped. It is dropped rather than fed to the median.
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return this.currentLevel;

    this.samples.push({ atMs: nowMs, frameMs });
    const cutoff = nowMs - WINDOW_MS;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].atMs < cutoff) drop++;
    if (drop > 0) this.samples.splice(0, drop);

    const median = this.medianFrameMs;
    if (median === null) return this.currentLevel;

    // Run bookkeeping first, and unconditionally: a run has to keep accumulating through warm-up and
    // cooldown, otherwise every cooldown would also reset the evidence that outlasted it.
    if (median > DEGRADE_MS) {
      if (this.struggleSinceMs === null) this.struggleSinceMs = nowMs;
      this.comfortSinceMs = null;
    } else if (median < RECOVER_MS) {
      if (this.comfortSinceMs === null) this.comfortSinceMs = nowMs;
      this.struggleSinceMs = null;
    } else {
      // THE DEAD BAND. Neither run advances and neither is broken: a machine hovering between the two
      // thresholds holds whatever quality it has, which is the entire point of the band.
      return this.currentLevel;
    }

    if (nowMs - (this.startedAtMs ?? nowMs) < WARMUP_MS) return this.currentLevel;
    if (this.lastChangeAtMs !== null && nowMs - this.lastChangeAtMs < COOLDOWN_MS) return this.currentLevel;

    if (this.struggleSinceMs !== null && nowMs - this.struggleSinceMs >= DEGRADE_SUSTAIN_MS && this.currentLevel > MIN_QUALITY_LEVEL) {
      // The rung being left did not hold. Bar it from being climbed back to, for longer each time it
      // fails — the count is never cleared, so a rung that keeps failing stops being retried.
      const relapses = (this.relapseCount.get(this.currentLevel) ?? 0) + 1;
      this.relapseCount.set(this.currentLevel, relapses);
      const doublings = Math.min(relapses - 1, RELAPSE_BACKOFF_MAX_DOUBLINGS);
      this.blockedUntilMs.set(this.currentLevel, nowMs + RELAPSE_BLOCK_MS * 2 ** doublings);
      this.apply(((this.currentLevel - 1) as QualityLevel), "degraded", nowMs, median);
      return this.currentLevel;
    }

    if (this.comfortSinceMs !== null && nowMs - this.comfortSinceMs >= RECOVER_SUSTAIN_MS && this.currentLevel < MAX_QUALITY_LEVEL) {
      const next = (this.currentLevel + 1) as QualityLevel;
      const blockedUntil = this.blockedUntilMs.get(next);
      if (blockedUntil !== undefined && nowMs < blockedUntil) return this.currentLevel;
      this.blockedUntilMs.delete(next);
      this.apply(next, "recovered", nowMs, median);
    }
    return this.currentLevel;
  }

  private apply(to: QualityLevel, action: AdaptiveAction, nowMs: number, medianMs: number): void {
    const change: AdaptiveChange = { action, from: this.currentLevel, to, atMs: nowMs, medianMs };
    this.currentLevel = to;
    this.lastChangeAtMs = nowMs;
    this.lastChange = change;
    // A rung change changes what a frame COSTS, so every measurement taken at the old rung is now
    // about a world that no longer exists. Clearing the window is what stops one bad stretch from
    // being counted twice and walking the ladder down two rungs in a row.
    this.samples.length = 0;
    this.struggleSinceMs = null;
    this.comfortSinceMs = null;
    this.onChange?.(change);
  }
}
