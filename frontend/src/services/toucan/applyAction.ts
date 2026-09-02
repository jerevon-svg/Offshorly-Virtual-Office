import {
  getDndAllowanceSnapshot,
  setManualStatus,
  startDnd,
} from "../presence/selfStatusStore";
import { MANUAL_STATUSES, type OfficeStatus } from "../presence/status";

// T8 — applying a CONFIRMED set_status action to the viewer's own client.
//
// WHY THE CLIENT APPLIES IT: the office status is a client-owned product concept
// (selfStatusStore + localStorage; only the DND bit reaches the server, via the
// dnd_set socket event OfficeMap already emits on every manualStatus transition).
// The server therefore owns everything it CAN own — validation, the one-time
// confirmation gate, the audit line, the transcript — and hands back the frozen
// validated effect, which this module routes through the EXACT same functions the
// StatusPicker uses. Every existing side effect (DND broadcast, room locks, the
// DND daily allowance, lunch/break behaviour) stays consistent because it is the
// same code path, not a parallel one.
//
// SELF-SCOPED BY CONSTRUCTION: these functions can only ever touch the local
// viewer's own store — there is no email parameter anywhere, so "apply to someone
// else" is unrepresentable here just as it is in the backend action schema.

/** Mirrors backend/app/services/toucan/actions.py's DND_DEFAULT_MINUTES — the
 *  backend always sends explicit minutes for DND, so this is a belt-and-braces
 *  fallback, not a second policy. */
export const TOUCAN_DND_DEFAULT_MINUTES = 30;

export type ToucanApplyResult = { ok: true } | { ok: false; reason: string };

const DND_ALLOWANCE_EXHAUSTED_TEXT =
  "Squawk — I couldn't set DND: you've used up today's DND allowance. Your status is unchanged.";
const UNKNOWN_STATUS_TEXT =
  "Squawk — that status isn't one I can set, so I left your status unchanged.";

/** The status/dndMinutes pair both a proposal and a confirm result carry — apply
 *  works from the CONFIRM RESULT's fields (the server-frozen args), never from a
 *  locally cached proposal that could have drifted. */
export interface ToucanStatusEffect {
  status: string;
  dndMinutes?: number | null;
}

/** Pre-confirmation check: is this effect applyable at all right now? Used by the
 *  panel BEFORE consuming the one-time confirm, so a DND request with an exhausted
 *  daily allowance is refused honestly instead of "executing" into nothing. */
export function canApplyToucanStatus(effect: ToucanStatusEffect): ToucanApplyResult {
  if (!MANUAL_STATUSES.includes(effect.status as OfficeStatus)) {
    return { ok: false, reason: UNKNOWN_STATUS_TEXT };
  }
  if (effect.status === "DND" && getDndAllowanceSnapshot().remainingMs <= 0) {
    return { ok: false, reason: DND_ALLOWANCE_EXHAUSTED_TEXT };
  }
  return { ok: true };
}

/** Apply one confirmed effect through the existing product paths. DND goes through
 *  startDnd (duration captured, allowance enforced and possibly CLAMPING the
 *  session shorter — product policy stays authoritative over the proposal);
 *  everything else through setManualStatus, exactly as the StatusPicker does. */
export function applyToucanStatus(effect: ToucanStatusEffect): ToucanApplyResult {
  const check = canApplyToucanStatus(effect);
  if (!check.ok) return check;
  if (effect.status === "DND") {
    const minutes = effect.dndMinutes ?? TOUCAN_DND_DEFAULT_MINUTES;
    const started = startDnd({ durationMs: minutes * 60_000, reason: "Set via Toucan" });
    return started ? { ok: true } : { ok: false, reason: DND_ALLOWANCE_EXHAUSTED_TEXT };
  }
  setManualStatus(effect.status as OfficeStatus);
  return { ok: true };
}
