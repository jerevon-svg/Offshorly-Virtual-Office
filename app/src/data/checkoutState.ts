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
  IDLE: ["REMINDER_SHOWN"],
  REMINDER_SHOWN: ["CHECKOUT_CONFIRMATION", "IDLE"], // "Later" -> IDLE, re-triggerable after snooze
  CHECKOUT_CONFIRMATION: ["SAYING_GOODBYE", "IDLE"], // "Not yet" -> IDLE
  SAYING_GOODBYE: ["WALKING_TO_RECEPTION"],
  WALKING_TO_RECEPTION: ["AT_RECEPTION", "IDLE"], // cancel only allowed pre-arrival
  AT_RECEPTION: ["EDITING_TIME_LOG"],
  EDITING_TIME_LOG: ["REVIEWING"],
  REVIEWING: ["SUBMITTING", "EDITING_TIME_LOG"],
  SUBMITTING: ["CHECKOUT_SUCCESS", "SUBMISSION_FAILED"],
  SUBMISSION_FAILED: ["EDITING_TIME_LOG", "REVIEWING"], // retry
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
