// Phase B — typed config constants only, no logic. Nothing in the app
// consumes these yet; they exist so Phase C/D have an agreed-upon shape to
// read from once real per-tier feature capping begins. Values reflect the
// approved plan as of Phase B, not measured field data (T1 launches at 0
// live-3D by design — promotion happens later, once telemetry from this
// phase justifies it).

import type { DeviceTier } from "./deviceTier";

/**
 * Max number of simultaneously-live-3D-rendered characters allowed per
 * device tier. T0 and T1 are 0 on purpose: T0 can't run live 3D at all, and
 * T1 is intentionally held at 0 until field data (from this phase's
 * telemetry) justifies promoting it. Only T2 gets any live-3D budget at
 * launch.
 */
export const LIVE_3D_CAP_BY_TIER: Record<DeviceTier, number> = {
  T0: 0,
  T1: 0,
  T2: 4,
};

/**
 * Phase C — minimum device tier at which the account-holder's OWN character
 * (not the crowd) is shown live-3D by default. Confirmed product decision:
 * "self" gets a separate, more generous allowance than the crowd caps
 * above — starting at T1 (integrated-GPU laptop), not gated behind the T2
 * "dedicated desktop" bar that LIVE_3D_CAP_BY_TIER still holds every OTHER
 * character to. Does not change/relax LIVE_3D_CAP_BY_TIER itself — that
 * still stays at 0 for T1 until future field telemetry justifies promoting
 * the crowd cap too. T0 is never eligible for anyone, self included (see
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
