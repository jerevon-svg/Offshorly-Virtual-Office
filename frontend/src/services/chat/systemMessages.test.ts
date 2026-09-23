import { describe, expect, it } from "vitest";
import { isAuthoredMessage, type ChatMessage } from "./types";

// PHASE 7D — THE ONE TEST every consumer asks. The Phase 7D `messages` audit found eight call sites
// that assume a row has a body; all of them route through this, so the rule is defined once.

const base: Pick<ChatMessage, "kind"> = {};

describe("isAuthoredMessage", () => {
  it("treats a row with no kind as text — pre-7D rows and mock fixtures arrive that way", () => {
    expect(isAuthoredMessage(base)).toBe(true);
  });

  it("accepts an explicit text row", () => {
    expect(isAuthoredMessage({ kind: "text" })).toBe(true);
  });

  it("rejects a system record, which has no author and no body", () => {
    expect(isAuthoredMessage({ kind: "call_missed" })).toBe(false);
  });
});
