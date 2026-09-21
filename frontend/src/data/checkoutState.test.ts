import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, type CheckoutState } from "./checkoutState";

describe("canTransition", () => {
  it.each([
    ["IDLE", "REMINDER_SHOWN"],
    ["IDLE", "CHECKOUT_CONFIRMATION"],
    ["REMINDER_SHOWN", "CHECKOUT_CONFIRMATION"],
    ["REMINDER_SHOWN", "IDLE"],
    ["CHECKOUT_CONFIRMATION", "SAYING_GOODBYE"],
    ["CHECKOUT_CONFIRMATION", "IDLE"],
    ["SAYING_GOODBYE", "WALKING_TO_RECEPTION"],
    ["WALKING_TO_RECEPTION", "AT_RECEPTION"],
    ["WALKING_TO_RECEPTION", "IDLE"],
    ["AT_RECEPTION", "EDITING_TIME_LOG"],
    ["EDITING_TIME_LOG", "REVIEWING"],
    ["REVIEWING", "SUBMITTING"],
    ["REVIEWING", "EDITING_TIME_LOG"],
    ["SUBMITTING", "CHECKOUT_SUCCESS"],
    ["SUBMITTING", "SUBMISSION_FAILED"],
    ["SUBMISSION_FAILED", "EDITING_TIME_LOG"],
    ["SUBMISSION_FAILED", "REVIEWING"],
    ["CHECKOUT_SUCCESS", "WALKING_TO_EXIT"],
    ["WALKING_TO_EXIT", "CHECKED_OUT"],
    // Same-day re-check-in: a confirmed attendance Check In starts a new session.
    ["CHECKED_OUT", "IDLE"],
    // PHASE 7E — THE TWO WAYS OUT. Every other state in the flow had an escape; these two did not, so an
    // employee in the time-log form had no transition to make and nothing to press. Both land on IDLE,
    // the same destination "Not yet" and "Save and return later" already use.
    ["AT_RECEPTION", "IDLE"],
    ["EDITING_TIME_LOG", "IDLE"],
    ["EDITING_TIME_LOG", "AT_RECEPTION"],
    ["REVIEWING", "IDLE"],
  ] as [CheckoutState, CheckoutState][])("%s -> %s is legal", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("NOTHING escapes a submission in flight or a completed checkout", () => {
    // The two states that deliberately carry no way back: a request is in the air, and a recorded time
    // log is not un-doable from a button. Adding an escape to either would be the dangerous kind.
    for (const to of ["IDLE", "AT_RECEPTION", "EDITING_TIME_LOG", "REVIEWING"] as CheckoutState[]) {
      expect(canTransition("SUBMITTING", to), `SUBMITTING -> ${to}`).toBe(false);
      expect(canTransition("CHECKOUT_SUCCESS", to), `CHECKOUT_SUCCESS -> ${to}`).toBe(false);
    }
  });

  it.each([
    ["IDLE", "AT_RECEPTION"],
    ["AT_RECEPTION", "WALKING_TO_RECEPTION"],
    ["CHECKED_OUT", "AT_RECEPTION"],
    ["CHECKED_OUT", "WALKING_TO_EXIT"],
    ["SUBMITTING", "EDITING_TIME_LOG"],
    ["WALKING_TO_EXIT", "IDLE"],
  ] as [CheckoutState, CheckoutState][])("%s -> %s is illegal", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("IDLE is the only outgoing transition from CHECKED_OUT (same-day re-check-in)", () => {
    const all: CheckoutState[] = [
      "IDLE",
      "REMINDER_SHOWN",
      "CHECKOUT_CONFIRMATION",
      "SAYING_GOODBYE",
      "WALKING_TO_RECEPTION",
      "AT_RECEPTION",
      "EDITING_TIME_LOG",
      "REVIEWING",
      "SUBMITTING",
      "SUBMISSION_FAILED",
      "CHECKOUT_SUCCESS",
      "WALKING_TO_EXIT",
      "CHECKED_OUT",
    ];
    expect(all.filter((to) => canTransition("CHECKED_OUT", to))).toEqual(["IDLE"]);
  });
});

describe("assertTransition", () => {
  it("does not throw for a legal transition", () => {
    expect(() => assertTransition("IDLE", "REMINDER_SHOWN")).not.toThrow();
  });

  it("throws for an illegal transition", () => {
    expect(() => assertTransition("IDLE", "CHECKED_OUT")).toThrow(/Illegal checkout state transition/);
  });
});
