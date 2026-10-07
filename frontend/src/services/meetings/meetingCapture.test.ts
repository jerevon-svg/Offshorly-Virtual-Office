import { afterEach, describe, expect, it } from "vitest";
import {
  clearCaptureState,
  getCaptureState,
  needsConsentDecision,
  parseCaptureState,
  receiveCaptureState,
} from "./meetingCapture";

// PHASE 6B — the capture-state seam: a defensive parse of the server's per-participant `capture_state`, kept
// only for the meeting this client is connected to.

const active = {
  meetingId: "mf-foxtrot",
  sessionId: "s-1",
  capture: { captureId: "c-1", active: true, startedBy: "bon@example.com", startedAt: "2026-09-28T01:00:00+00:00", stoppedAt: null, stopReason: null, source: "fake" },
  myConsent: "pending",
  canControl: false,
};

afterEach(() => clearCaptureState());

describe("meetingCapture", () => {
  it("parses a well-formed state and flags an undecided active capture", () => {
    const s = parseCaptureState(active);
    expect(s?.capture?.captureId).toBe("c-1");
    expect(s?.myConsent).toBe("pending");
    expect(needsConsentDecision(s)).toBe(true);
    expect(needsConsentDecision(parseCaptureState({ ...active, myConsent: "granted" }))).toBe(false);
    expect(needsConsentDecision(parseCaptureState({ ...active, capture: { ...active.capture, active: false } }))).toBe(false);
  });

  it("rejects malformed payloads and unknown consent values", () => {
    expect(parseCaptureState(null)).toBeNull();
    expect(parseCaptureState({ meetingId: "mf-foxtrot" })).toBeNull();
    expect(parseCaptureState({ ...active, capture: { captureId: "c-1" } })).toBeNull();
    expect(parseCaptureState({ ...active, myConsent: "yes" })?.myConsent).toBeNull();
    expect(parseCaptureState({ ...active, canControl: "true" })?.canControl).toBe(false);
    expect(parseCaptureState({ ...active, capture: null })?.capture).toBeNull();
  });

  it("keeps state only for the connected meeting and clears it", () => {
    receiveCaptureState(active, "mf-alpha");
    expect(getCaptureState()).toBeNull();
    receiveCaptureState(active, null);
    expect(getCaptureState()).toBeNull();
    receiveCaptureState(active, "mf-foxtrot");
    expect(getCaptureState()?.sessionId).toBe("s-1");
    clearCaptureState();
    expect(getCaptureState()).toBeNull();
  });
});
