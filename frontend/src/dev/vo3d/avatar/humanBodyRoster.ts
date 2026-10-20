// vo3d avatar — WHO WEARS A HUMANBASE BODY, as a LEAF (no three.js, no runtime): the enabled cast ids and the
// `?humanbase=0` session switch. avatar/humanBody re-exports both; the V1-side adapters (adapters/v1Identity,
// adapters/v1Coworkers) read this file directly so "does this person have a body?" never drags the 3D runtime in.

import GENERATED_MOUNTS from "./humanMounts.generated.json";
import { runtimeAvatar } from "./characterRuntime";

/** One PIPELINE-VALIDATED identity (written ONLY by build-employees.mjs promoteCandidate after a passing final gate): the
 *  exact artifact hash and the exact head mount the mounted gate measured, bound together by bindingHash. The runtime
 *  renders that artifact with THAT mount — never a hand-entered constant. */
export type ValidatedHead = { artifactHash: string; pipelineVersion: string; mount: { scale: number; pitchDeg: number }; bindingHash: string; validatedAt: string; bodyPreset?: "standard" | "feminine" };   // bodyPreset: from the recipe, for a promoted NEW employee
export const VALIDATED_HEADS: Readonly<Record<string, ValidatedHead>> = GENERATED_MOUNTS as Record<string, ValidatedHead>;

/** The approved HumanBase employees: the frozen first five (hand-approved V1.4) + every gate-promoted identity. */
// FAIL-CLOSED (2026-10-06): jona / kael / lui / nicole were built by the pre-audit, ungated pipeline — known-broken, so NOT
// enabled until a V2 candidate passes the final gate (their files stay on disk; Lui has no legacy body → missing avatar).
export const HUMANBASE_ENABLED: ReadonlySet<string> = new Set(["bon", "micah", "angelo", "clang", "france", ...Object.keys(VALIDATED_HEADS)]);

/** Is the HumanBase body switched on for this page? (`?humanbase=0` turns it off for the session.) */
export function humanBaseOn(search: string = typeof location !== "undefined" ? location.search : ""): boolean {
  return new URLSearchParams(search).get("humanbase") !== "0";
}

/** Does this cast id get a HumanBase body on this page? The other half of "has a body" next to the legacy registry
 *  (adapters/v1Avatar hasCastLods): an employee with NO legacy GLB at all (Lui) has a body only through this, and
 *  `?humanbase=0` returns them to the honest missing-avatar state — never to somebody else's character. */
export function hasHumanBody(castId: string | null | undefined, search?: string): boolean {
  // …or an approved, unpromoted head Character Studio delivered at runtime (dev-only; empty in production — avatar/characterRuntime)
  return !!castId && (HUMANBASE_ENABLED.has(castId) || runtimeAvatar(castId) !== null) && humanBaseOn(search);
}
