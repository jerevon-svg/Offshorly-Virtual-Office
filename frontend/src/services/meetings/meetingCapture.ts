import { useSyncExternalStore } from "react";

// PHASE 6B — the client-side seam for meeting CAPTURE + CONSENT state. No recording UI lives here and
// nothing here touches audio: this is only what the server tells a PARTICIPANT about their meeting's
// capture (`capture_state`, pushed to that person alone) so a future consent prompt / indicator can read it.
//
// The server decides everything — who may start/stop (`canControl`), whether a capture is active, and this
// viewer's OWN consent state. The client only displays it and sends the viewer's own decision (callStore's
// startMeetingCapture / stopMeetingCapture / decideMeetingCapture). Other people's consent is never sent.
//
// SCOPED TO THE CONNECTED MEETING: a state for any other meeting is ignored, and leaving the call clears it.

export type CaptureConsentState = "pending" | "granted" | "declined";

export interface MeetingCaptureInfo {
  captureId: string;
  active: boolean;
  startedBy: string;
  startedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  source: string;
}

export interface MeetingCaptureState {
  meetingId: string;
  /** The durable Meeting Session this capture belongs to (never the room). */
  sessionId: string;
  /** The session's latest capture — active, or the one that just stopped — or null if none yet. */
  capture: MeetingCaptureInfo | null;
  /** THIS viewer's decision on that capture; null when they have no consent record for it. */
  myConsent: CaptureConsentState | null;
  /** Whether the server would let this viewer start/stop capture right now (host / organizer). */
  canControl: boolean;
}

const CONSENTS: readonly string[] = ["pending", "granted", "declined"];

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Defensive parse of a `capture_state` payload; null for anything malformed. */
export function parseCaptureState(raw: unknown): MeetingCaptureState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const meetingId = str(r.meetingId);
  const sessionId = str(r.sessionId);
  if (!meetingId || !sessionId) return null;
  let capture: MeetingCaptureInfo | null = null;
  if (r.capture && typeof r.capture === "object") {
    const c = r.capture as Record<string, unknown>;
    const captureId = str(c.captureId);
    if (!captureId || typeof c.active !== "boolean") return null;
    capture = {
      captureId,
      active: c.active,
      startedBy: str(c.startedBy) ?? "",
      startedAt: str(c.startedAt),
      stoppedAt: str(c.stoppedAt),
      stopReason: str(c.stopReason),
      source: str(c.source) ?? "",
    };
  }
  const myConsent =
    typeof r.myConsent === "string" && CONSENTS.includes(r.myConsent) ? (r.myConsent as CaptureConsentState) : null;
  return { meetingId, sessionId, capture, myConsent, canControl: r.canControl === true };
}

/** True when the viewer is being captured-or-asked and has not decided: the future consent prompt's cue. */
export function needsConsentDecision(state: MeetingCaptureState | null): boolean {
  return !!state?.capture?.active && state.myConsent === "pending";
}

// ---- module store (same idiom as the other services/* stores) -------------------------------------------

let current: MeetingCaptureState | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Called by callStore for every `capture_state`; kept only if it is for the meeting this client is in. */
export function receiveCaptureState(raw: unknown, connectedMeetingId: string | null): void {
  const next = parseCaptureState(raw);
  if (!next || !connectedMeetingId || next.meetingId !== connectedMeetingId) return;
  current = next;
  emit();
}

export function clearCaptureState(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function getCaptureState(): MeetingCaptureState | null {
  return current;
}

export function subscribeToCaptureState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMeetingCaptureState(): MeetingCaptureState | null {
  return useSyncExternalStore(subscribeToCaptureState, getCaptureState, getCaptureState);
}
