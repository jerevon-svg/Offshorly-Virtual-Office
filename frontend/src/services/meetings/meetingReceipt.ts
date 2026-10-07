import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLatest,
  fetchRuns,
  fetchSession,
  generateIntelligence,
  ReceiptError,
  reviewItem,
  type IntelligenceItem,
  type ItemContent,
  type ItemType,
  type LatestIntelligence,
  type MeetingSessionInfo,
  type ReviewAction,
  type RunSummary,
} from "./meetingReceiptClient";

// PHASE 7C — the Meeting Receipt's state and the rules for what it SHOWS. Keyed by Meeting Session id only;
// nothing here reads the room or any call/travel store. The server decides everything that matters —
// who may read (404 otherwise), who may curate (`viewer.mayCurate`), what an item says and its review
// state — and this module only chooses how to present it:
//
//   EFFECTIVE CONTENT: suggested/confirmed → the generated content; edited → the human's reviewed content
//   (the AI original stays on the item, shown only on request); rejected → shown as rejected, never as an
//   active conclusion.
//   VERSION: the latest SUCCEEDED run only. A newer failed/running attempt is a note, never a replacement.
//   STALE: the server's fingerprint comparison, shown calmly. Nothing regenerates automatically.

export const OPEN_LOOP_LABELS: Record<string, string> = {
  unanswered_question: "Unanswered question",
  deferred_decision: "Deferred decision",
  unresolved_issue: "Unresolved issue",
  unowned_action: "Needs an owner",
  pending_dependency: "Waiting on something",
};

export const openLoopLabel = (kind: string | null | undefined): string =>
  (kind && OPEN_LOOP_LABELS[kind]) || "Open";

/** The version a person should read: the human's wording once edited, otherwise what was generated. */
export function effectiveContent(item: IntelligenceItem): ItemContent {
  return item.reviewState === "edited" && item.reviewedContent ? item.reviewedContent : item.content;
}

export const isActive = (item: IntelligenceItem): boolean => item.reviewState !== "rejected";

/** Items of one type in generated order, active before rejected. */
export function itemsOf(items: IntelligenceItem[], type: ItemType): IntelligenceItem[] {
  const own = items.filter((i) => i.type === type).sort((a, b) => a.position - b.position);
  return [...own.filter(isActive), ...own.filter((i) => !isActive(i))];
}

/** The structured fields a reviewer may edit per type (the Phase 7B content contract). */
export const EDIT_FIELDS: Record<ItemType, { key: string; label: string; multiline?: boolean; required?: boolean }[]> = {
  summary: [{ key: "text", label: "Summary", multiline: true, required: true }],
  topic: [{ key: "text", label: "Topic", required: true }],
  decision: [
    { key: "text", label: "Decision", multiline: true, required: true },
    { key: "rationale", label: "Why it counts as decided", multiline: true },
  ],
  commitment: [
    { key: "text", label: "Commitment", multiline: true, required: true },
    { key: "action", label: "Action" },
    { key: "ownerEmail", label: "Owner" },
    { key: "deadline", label: "When (as said)" },
  ],
  open_loop: [
    { key: "text", label: "What's open", multiline: true, required: true },
    { key: "kind", label: "Kind", required: true },
    { key: "rationale", label: "Context", multiline: true },
  ],
  key_point: [{ key: "text", label: "Key point", multiline: true, required: true }],
};

/** A draft from the form → the content the review endpoint takes: trimmed, blanks omitted. Fields the
 *  form does not show (e.g. a commitment's rationale) are carried over from the starting content. */
export function editPayload(type: ItemType, start: ItemContent, draft: Record<string, string>): ItemContent {
  const shown = new Set(EDIT_FIELDS[type].map((f) => f.key));
  const out: ItemContent = {};
  for (const [k, v] of Object.entries(start)) if (!shown.has(k) && typeof v === "string" && v.trim()) out[k] = v;
  for (const key of shown) {
    const v = (draft[key] ?? "").trim();
    if (v) out[key] = v;
  }
  return out;
}

/** mm:ss into the capture — where in the meeting a cited line was said. */
export function offsetLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** A newer attempt than the latest success, if it failed or is still running. */
export function newerAttempt(runs: RunSummary[], latestVersion: number | null): RunSummary | null {
  const newest = [...runs].sort((a, b) => b.version - a.version)[0];
  if (!newest || newest.status === "succeeded") return null;
  return latestVersion === null || newest.version > latestVersion ? newest : null;
}

export interface ReceiptState {
  loading: boolean;
  /** The caller may not read this Meeting Session (or it does not exist) — the server's 404. */
  unavailable: boolean;
  error: string | null;
  session: MeetingSessionInfo | null;
  latest: LatestIntelligence | null;
  runs: RunSummary[];
}

const INITIAL: ReceiptState = { loading: true, unavailable: false, error: null, session: null, latest: null, runs: [] };

export function useMeetingReceipt(sessionId: string) {
  const [state, setState] = useState<ReceiptState>(INITIAL);
  const alive = useRef(true);
  // Re-armed on every mount: StrictMode's simulated unmount/remount must not leave it false.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      // The session read goes first: it is the gate, so nothing else is requested for an unreadable id.
      const session = await fetchSession(sessionId);
      const [latest, runs] = await Promise.all([fetchLatest(sessionId), fetchRuns(sessionId)]);
      if (alive.current) setState({ loading: false, unavailable: false, error: null, session, latest, runs: runs.runs });
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ReceiptError && err.status === 404) setState({ ...INITIAL, loading: false, unavailable: true });
      else setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Could not load" }));
    }
  }, [sessionId]);

  useEffect(() => {
    setState(INITIAL);
    void load();
  }, [load]);

  /** One human review through the existing endpoint; the server's answer replaces the item. */
  const review = useCallback(
    async (itemId: string, action: ReviewAction, content?: ItemContent) => {
      const updated = await reviewItem(sessionId, itemId, action, content);
      if (!alive.current) return;
      setState((s) => {
        const run = s.latest?.run;
        if (!s.latest || !run) return s;
        return { ...s, latest: { ...s.latest, run: { ...run, items: run.items.map((i) => (i.itemId === itemId ? updated : i)) } } };
      });
    },
    [sessionId],
  );

  /** Curator-requested generation (never automatic); reloads so the latest-success rule stays the server's. */
  const generate = useCallback(async () => {
    await generateIntelligence(sessionId);
    await load();
  }, [sessionId, load]);

  return { ...state, review, generate, reload: load };
}
