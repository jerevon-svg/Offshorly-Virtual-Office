// Client-side-only auto-walk trigger for the local viewer's manual status
// changes (see the confirmed plan: Break/Lunch auto-walks the viewer's OWN
// avatar to Central Hub; returning to Available auto-walks back to their
// assigned desk). Pure transition-matrix function — no DOM/walk-hook
// dependencies — so OfficeMap.tsx's effect can stay a thin caller and this
// logic is fully unit-testable in isolation.

import type { OfficeStatus } from "./status";

export type StatusMovementAction = "HUB" | "DESK" | null;

// Statuses that count as "the viewer is parked in Central Hub" for movement
// purposes. BREAK<->LUNCH transitions are both "already in hub" -> no-op,
// matching the confirmed spec.
const HUB_STATUSES = new Set<OfficeStatus>(["BREAK", "LUNCH"]);

// Decides what (if any) auto-walk should fire when the LOCAL viewer's
// manualStatus transitions from `prev` to `next`. Only two triggers exist:
//   - Entering Break/Lunch from a non-hub status -> walk to Central Hub.
//   - Returning to Available FROM a hub status -> walk back to assigned desk.
// Every other transition (including Busy/DND, which the spec explicitly
// excludes from movement) is a no-op.
export function resolveManualStatusMovement(
  prev: OfficeStatus,
  next: OfficeStatus,
): StatusMovementAction {
  const wasInHub = HUB_STATUSES.has(prev);
  const isInHub = HUB_STATUSES.has(next);

  if (isInHub && !wasInHub) return "HUB";
  if (next === "AVAILABLE" && wasInHub) return "DESK";
  return null;
}
