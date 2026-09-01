// Checkout flow state machine. Pure — no React/DOM deps.

export type CheckoutState =
  | "IDLE"
  | "REMINDER_SHOWN"
  | "CHECKOUT_CONFIRMATION"
  | "SAYING_GOODBYE"
  | "WALKING_TO_RECEPTION"
  | "AT_RECEPTION"
  | "EDITING_TIME_LOG"
  | "REVIEWING"
  | "SUBMITTING"
  | "SUBMISSION_FAILED"
  | "CHECKOUT_SUCCESS"
  | "WALKING_TO_EXIT"
  | "CHECKED_OUT";

// Adjacency list encoding the legal flow order from the spec, including the
// "Later"/"Not yet"/cancel escape hatches and the retry loop on failure.
const TRANSITIONS: Record<CheckoutState, CheckoutState[]> = {
  // CHECKOUT_CONFIRMATION is reachable directly from IDLE (not just via the
  // 8h reminder) so checkout can be triggered on demand from the reception
  // room's action menu at any time, not only after the reminder fires.
  IDLE: ["REMINDER_SHOWN", "CHECKOUT_CONFIRMATION"],
  REMINDER_SHOWN: ["CHECKOUT_CONFIRMATION", "IDLE"], // "Later" -> IDLE, re-triggerable after snooze
  CHECKOUT_CONFIRMATION: ["SAYING_GOODBYE", "IDLE"], // "Not yet" -> IDLE
  SAYING_GOODBYE: ["WALKING_TO_RECEPTION"],
  WALKING_TO_RECEPTION: ["AT_RECEPTION", "IDLE"], // cancel only allowed pre-arrival
  AT_RECEPTION: ["EDITING_TIME_LOG"],
  EDITING_TIME_LOG: ["REVIEWING"],
  REVIEWING: ["SUBMITTING", "EDITING_TIME_LOG"],
  SUBMITTING: ["CHECKOUT_SUCCESS", "SUBMISSION_FAILED"],
  // Retry (EDITING_TIME_LOG/REVIEWING) plus "Save and return later" (IDLE) —
  // SubmissionFailedPanel's only other action, previously missing here,
  // which made useCheckoutFlow.saveAndReturnLater() throw
  // "Illegal checkout state transition: SUBMISSION_FAILED -> IDLE" the
  // moment a real submission failure occurred (its only call site).
  SUBMISSION_FAILED: ["EDITING_TIME_LOG", "REVIEWING", "IDLE"],
  CHECKOUT_SUCCESS: ["WALKING_TO_EXIT"],
  WALKING_TO_EXIT: ["CHECKED_OUT"],
  CHECKED_OUT: [],
};

export function canTransition(from: CheckoutState, to: CheckoutState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// Throws if the transition is illegal — useful for callers (the hook) that
// want a hard failure rather than silently ignoring a bad transition.
export function assertTransition(from: CheckoutState, to: CheckoutState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal checkout state transition: ${from} -> ${to}`);
  }
}
