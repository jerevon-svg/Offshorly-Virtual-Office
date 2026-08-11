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
  ] as [CheckoutState, CheckoutState][])("%s -> %s is legal", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["IDLE", "AT_RECEPTION"],
    ["AT_RECEPTION", "WALKING_TO_RECEPTION"],
    ["EDITING_TIME_LOG", "AT_RECEPTION"],
    ["CHECKED_OUT", "IDLE"],
    ["SUBMITTING", "EDITING_TIME_LOG"],
    ["WALKING_TO_EXIT", "IDLE"],
  ] as [CheckoutState, CheckoutState][])("%s -> %s is illegal", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("has no outgoing transitions from CHECKED_OUT", () => {
    expect(canTransition("CHECKED_OUT", "IDLE")).toBe(false);
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
