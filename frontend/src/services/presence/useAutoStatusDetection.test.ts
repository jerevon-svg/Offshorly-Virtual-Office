import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSelfStatusSnapshot, resetSelfStatusForTests } from "./selfStatusStore";
import { useAutoStatusDetection } from "./useAutoStatusDetection";

// Focused coverage for the ONE seam Stage A added: the inCall flag reaching the shared
// self-status store. The IN_CALL > IN_CONVERSATION precedence itself is status.ts's and is
// already covered by status.test.ts — this only pins that the hook forwards the new input, since
// participants in a spatial conversation render a TalkingBubble instead of a nameplate, so the
// resolved status is not readable from the DOM.

beforeEach(() => {
  vi.useFakeTimers();
  resetSelfStatusForTests();
});

afterEach(() => {
  vi.useRealTimers();
  resetSelfStatusForTests();
});

describe("useAutoStatusDetection inCall wiring", () => {
  it("stays IN_CONVERSATION for a spatial conversation with no media", () => {
    renderHook(() => useAutoStatusDetection({ inConversation: true, offline: false, inCall: false }));
    expect(getSelfStatusSnapshot().currentStatus).toBe("IN_CONVERSATION");
  });

  it("becomes IN_CALL once connected to media", () => {
    renderHook(() => useAutoStatusDetection({ inConversation: true, offline: false, inCall: true }));
    expect(getSelfStatusSnapshot().currentStatus).toBe("IN_CALL");
  });

  it("returns to IN_CONVERSATION when leaving media while still spatial", () => {
    const { rerender } = renderHook(
      (props: { inConversation: boolean; offline: boolean; inCall: boolean }) =>
        useAutoStatusDetection(props),
      { initialProps: { inConversation: true, offline: false, inCall: true } },
    );
    expect(getSelfStatusSnapshot().currentStatus).toBe("IN_CALL");

    rerender({ inConversation: true, offline: false, inCall: false });
    expect(getSelfStatusSnapshot().currentStatus).toBe("IN_CONVERSATION");
  });

  it("offline still outranks IN_CALL", () => {
    renderHook(() => useAutoStatusDetection({ inConversation: true, offline: true, inCall: true }));
    expect(getSelfStatusSnapshot().currentStatus).toBe("OFFLINE");
  });
});
