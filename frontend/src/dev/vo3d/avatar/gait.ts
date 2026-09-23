// vo3d avatar — ONE ANSWER TO "WHICH LOCOMOTION CLIP, AND HOW FAST". Shared by the signed-in employee's
// own body (player/PlayerMode) and by every replicated coworker (world/Coworkers), because a peer whose
// feet are paced by a different rule from the local body's is exactly the divergence Phase 6B set out to
// remove — and the two files were carrying a copy of these numbers each.
//
// NOT EVERY CHARACTER PACKAGE HAS A RUN CLIP, AND THAT IS A FACT ABOUT THE ASSETS, NOT A BUG TO ROUTE
// AROUND. Of the five shipped consolidated GLBs (render3d/live3dCharacters), only bon-v3 carries
// `running`; alex-v2, micah-v5, gelo-v1 and jan-v1 were built before the pipeline required it
// (scripts/avatar-pipeline/lod-policy.mjs REQUIRED_CLIP_NAMES lists it today) and carry `walking` alone.
// So the fallback is a shipping path, not an edge case, and it has to look like something.
//
// THE FALLBACK'S ONE REAL DEFECT, AND WHY THE CEILING IS PER CLIP. Playback rate is "how fast am I
// actually travelling / how fast does this clip think it is travelling", which keeps feet planted at
// every speed. A sprint is 100 u/s; `walking` is authored for 30, so standing in for a run needs 3.33x.
// A single MAX_CLIP_RATE of 2.5 clamped that to 40 u/s of stride under 100 u/s of travel — the body
// skating along the floor at a walking cadence, which is precisely the "they look like they are walking
// instead of running" report. The ceiling is a SPIKE GUARD for a pathological frame, so it is raised for
// the clip that has to cover the gap and left alone for the one that does not: `running` at 2.5x already
// covers 120 u/s, comfortably past the fastest the player can move.
import { CLIP_RUN, CLIP_WALK } from "../adapters/v1Avatar";

/** The ground speed each locomotion clip was authored for, units/s.
 *
 *  `walking` = 30 is the figure the navigation controller has always used. `running` is derived from the
 *  clips themselves: the run cycle is 0.667 s against the walk's 1.067 s, so its cadence is 1.6x the
 *  walk's and it covers ground at about 30 x 1.6. Both verified against the shipped bon-v3 GLB. */
export const CLIP_GROUND_SPEED: Record<string, number> = { [CLIP_WALK]: 30, [CLIP_RUN]: 48 };

/** Ceiling on locomotion playback rate, per clip — a spike guard, not a look choice. See the header for
 *  why `walking` gets the higher one: PLAYER_SPRINT_SPEED (100) / CLIP_GROUND_SPEED.walking (30) = 3.34,
 *  which is what the walk cycle must reach when it is the only locomotion a package ships. */
const MAX_CLIP_RATE: Record<string, number> = { [CLIP_WALK]: 3.4, [CLIP_RUN]: 2.5 };
/** For any clip not named above — nothing drives one today; stated so the lookup can never be undefined. */
const DEFAULT_MAX_CLIP_RATE = 2.5;
/** Below this the mixer is effectively paused; a long stall must not freeze a body mid-stride. */
const MIN_CLIP_RATE = 0.15;

/**
 * WHICH LOCOMOTION CLIP A MOVING BODY PLAYS.
 *
 * `running` is what the movement says (the local player's Shift, a peer's replayed mean speed);
 * `hasRun` is what the RIG can actually do. A package with no run clip walks — faster, per the rate
 * below — rather than freezing on whatever pose it was already in, which is what `play()` does for a
 * clip name the mixer never bound.
 */
export function locomotionClip(running: boolean, hasRun: boolean): string {
  return running && hasRun ? CLIP_RUN : CLIP_WALK;
}

/**
 * HOW FAST TO PLAY IT, from the ground ACTUALLY covered rather than from the input: a player scraping
 * along a wall slows his own stride down instead of moonwalking on the spot, and a replay that runs a
 * little fast or slow still lands its feet.
 */
export function locomotionRate(clip: string, groundSpeed: number): number {
  const authored = CLIP_GROUND_SPEED[clip];
  if (!authored) return 1;
  const ceiling = MAX_CLIP_RATE[clip] ?? DEFAULT_MAX_CLIP_RATE;
  return Math.min(ceiling, Math.max(MIN_CLIP_RATE, groundSpeed / authored));
}
