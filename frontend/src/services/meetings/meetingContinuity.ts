import { useEffect, useState } from "react";
import { fetchContinuity, type Continuity, type ContinuityEvent } from "./meetingReceiptClient";

// PHASE 8C — MEETING CONTINUITY state for one open Receipt. The server decides which sessions are related
// and readable (services/meeting_continuity.py); this only holds its answer. Local to the Receipt — no global
// store — and a failure is silent: continuity is context, and the Receipt stands on its own without it.

export function useMeetingContinuity(sessionId: string, refreshKey = "") {
  const [data, setData] = useState<Continuity | null>(null);
  useEffect(() => {
    let live = true;
    fetchContinuity(sessionId)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [sessionId, refreshKey]);
  return data;
}

/** Only worth a section when there is something besides this meeting. */
export const hasContinuity = (c: Continuity | null): c is Continuity => Boolean(c && c.events.length > 1);

export type LineTag = "decided" | "committed" | "open" | "raised";

export interface EventLine {
  itemId: string;
  tag: LineTag;
  text: string;
  reviewed: boolean;
  ownerEmail?: string | null;
}

/** At most `max` lines for an event, in the order that says the most: an open loop raised again, then
 *  decisions, commitments, and whatever else is still open. */
export function eventLines(e: ContinuityEvent, max = 2): EventLine[] {
  const i = e.intelligence;
  if (!i) return [];
  const again = new Set((e.change?.raisedAgain ?? []).map((r) => r.itemId));
  const out: EventLine[] = [
    ...(e.change?.raisedAgain ?? []).map((r) => ({
      itemId: r.itemId,
      tag: "raised" as const,
      text: r.text,
      reviewed: i.openLoops.find((o) => o.itemId === r.itemId)?.reviewState !== "suggested",
    })),
    ...i.decisions.map((d) => ({ itemId: d.itemId, tag: "decided" as const, text: d.text, reviewed: d.reviewState !== "suggested" })),
    ...i.commitments.map((c) => ({
      itemId: c.itemId,
      tag: "committed" as const,
      text: c.text,
      reviewed: c.reviewState !== "suggested",
      ownerEmail: c.ownerEmail,
    })),
    ...i.openLoops
      .filter((o) => !again.has(o.itemId))
      .map((o) => ({ itemId: o.itemId, tag: "open" as const, text: o.text, reviewed: o.reviewState !== "suggested" })),
  ];
  return out.slice(0, max);
}

/** Who stands behind an event's intelligence: all human-reviewed, some, or none. */
export function eventReview(e: ContinuityEvent): "reviewed" | "partly" | "suggested" | null {
  const c = e.intelligence?.counts;
  if (!c) return null;
  const active = c.decisions + c.commitments + c.openLoops;
  const reviewed = c.decisionsReviewed + c.commitmentsReviewed + c.openLoopsReviewed;
  if (!active) return null;
  if (reviewed >= active) return "reviewed";
  return reviewed ? "partly" : "suggested";
}
