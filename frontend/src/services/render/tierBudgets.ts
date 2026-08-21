// Phase B — typed config constants only, no logic. Nothing in the app
// consumes these yet; they exist so Phase C/D have an agreed-upon shape to
// read from once real per-tier feature capping begins. Values reflect the
// approved plan as of Phase B, not measured field data (T1 launches at 0
// live-3D by design — promotion happens later, once telemetry from this
// phase justifies it).

import type { DeviceTier } from "./deviceTier";

/**
 * Max number of simultaneously-live-3D-rendered "crowd" characters (i.e.
 * anyone other than the viewer's own self, once self has its own allowance —
 * see LIVE_3D_SELF_MIN_TIER) allowed per device tier. T0 and T1 are 0 on
 * purpose: T0 can't run live 3D at all, and T1's crowd cap is intentionally
 * held at 0 until field data justifies promoting it. Only T2 gets any
 * crowd-budgeted live-3D at launch.
 *
 * NOTE: this cap is currently DORMANT for the only character in the
 * registry (bon) — see OfficeStage.tsx's size-gated relaxation, which lets
 * bon render live-3D for every T1+ viewer (self AND peer) while
 * LIVE_3D_CHARACTERS has exactly one entry, since there's no "crowd" to
 * budget against yet. This cap re-arms automatically — with no code change
 * needed here — the moment a second character is added to that registry;
 * OfficeStage.tsx then falls back to enforcing this cap for every character
 * that isn't the viewer's own self.
 */
export const LIVE_3D_CAP_BY_TIER: Record<DeviceTier, number> = {
  T0: 0,
  T1: 0,
  T2: 4,
};

/**
 * Minimum device tier at which a character is shown live-3D by default.
 * Originally scoped to just the account-holder's OWN character ("self"),
 * this now also gates PEER viewing of a character while its registry entry
 * is the only one in LIVE_3D_CHARACTERS (see OfficeStage.tsx's size-gated
 * relaxation) — bon is that lone entry today, so every T1+ viewer (self or
 * peer) sees him live-3D. Once a second character is registered, this
 * constant reverts to gating ONLY self; peers of that second character (and
 * any others beyond it) go back through the LIVE_3D_CAP_BY_TIER crowd cap
 * above. T0 is never eligible for anyone, self included (see
 * OfficeStage.tsx's gating: T0 is a hard, unconditional floor).
 */
export const LIVE_3D_SELF_MIN_TIER: DeviceTier = "T1";

export interface RealtimeLodBudget {
  /** Max triangle count for a live-3D character mesh at this tier. */
  maxTris: number;
  /** Max texture edge length (px, square) for a live-3D character at this tier. */
  textureSize: number;
}

/**
 * Placeholder LOD budgets for live-3D characters, per tier. T0 is omitted —
 * T0 never renders live 3D (see LIVE_3D_CAP_BY_TIER.T0 === 0). Not consumed
 * anywhere yet; for Phase C/D asset-loading code to read once it exists.
 */
export const REALTIME_LOD_BUDGETS: Record<Exclude<DeviceTier, "T0">, RealtimeLodBudget> = {
  T1: { maxTris: 6000, textureSize: 512 },
  T2: { maxTris: 12000, textureSize: 1024 },
};
