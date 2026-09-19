// THE PERSON-LEVEL DND GATE, as one hook.
//
// Feature spec section 7: Chat / Call / Approach must not auto-walk to, or open a conversation with, a
// person who is in Do Not Disturb — they are gated behind Request Permission to Talk instead. This file
// holds the whole of that gate's CLIENT lifecycle and nothing else:
//
//   • which target is gated, for which verb, and what to re-run once permission lands (`resume`);
//   • the outstanding talk request's id, so it can be cancelled;
//   • the decline/cooldown display state, which is server-authoritative (talkRequestsClient's
//     TalkRequestCooldownError carries the moment the 15-minute cooldown lifts) and therefore never polled.
//
// IT WAS EXTRACTED, NOT WRITTEN. Every line below came out of OfficeMap.tsx unchanged — the same
// services/chat/talkRequestsClient calls, the same one-shot accept rule, the same "target turned DND off
// while we waited" fallback, the same 3s declined banner. It lives here because Phase 6D needs the SAME
// gate in the V2 world (dev/vo3d/app/Vo3dHost.tsx), and a second copy of a permission rule is how two
// surfaces end up disagreeing about who may interrupt whom.
//
// It owns no UI. `toastProps` is spread straight onto the existing TalkRequestToast by both callers, so
// the gate still looks and behaves like one thing wherever it appears.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelTalkRequest,
  createTalkRequest,
  onTalkRequestCancelled,
  onTalkRequestResolved,
  TalkRequestCooldownError,
} from "../../services/chat/talkRequestsClient";

/** The backend's CreateTalkRequestIn enum, untouched: a "call" attempt rides "chat" — it IS a request to
 *  talk — and the call intent itself is remembered by the caller's own `resume`. */
export type TalkGateKind = "chat" | "approach";

export interface TalkGate {
  targetEmail: string;
  targetName: string;
  kind: TalkGateKind;
  /** re-runs the exact action the gate short-circuited, once permission is granted */
  resume: () => void;
  pendingRequestId: string | null;
}

export interface TalkPermissionGate {
  gate: TalkGate | null;
  /** Gate an attempt. Replaces any gate already open. */
  open(g: Omit<TalkGate, "pendingRequestId">): void;
  /** Abandon a stale gate aimed at anybody OTHER than `targetEmail`, cancelling its outstanding request —
   *  any new interaction supersedes the old one (the same rule cancelPendingDoorWalks applies to the
   *  room-entry gate). A no-op when the open gate is already this target's. */
  supersede(targetEmail: string): void;
  clear(): void;
  /** Spread onto <TalkRequestToast /> — the gate owns no UI of its own. */
  toastProps: {
    targetName: string | null;
    pendingRequestId: string | null;
    declined: boolean;
    cooldownUntil: string | null;
    onRequest: () => void;
    onCancel: () => void;
  };
}

export function useTalkPermissionGate(dndEmails: ReadonlySet<string>): TalkPermissionGate {
  const [gate, setGate] = useState<TalkGate | null>(null);
  const gateRef = useRef(gate);
  gateRef.current = gate;
  const dndEmailsRef = useRef(dndEmails);
  dndEmailsRef.current = dndEmails;
  const [declined, setDeclined] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<string | null>(null);
  const declinedTimerRef = useRef<number | undefined>(undefined);

  const showDeclined = useCallback((until: string | null) => {
    setGate(null);
    setDeclined(true);
    setCooldownUntil(until);
    window.clearTimeout(declinedTimerRef.current);
    declinedTimerRef.current = window.setTimeout(() => setDeclined(false), 3000);
  }, []);

  useEffect(() => {
    const offResolved = onTalkRequestResolved((req) => {
      const g = gateRef.current;
      if (!g || g.pendingRequestId !== req.id) return;
      if (req.state === "accepted") {
        // One-shot: consume the permission immediately, then clear — a future interruption while the
        // target remains DND requires another request (feature spec sections 8/9).
        setGate(null);
        g.resume();
      } else if (req.state === "declined") {
        // This decline's own cooldown isn't known client-side until the NEXT create attempt 429s.
        showDeclined(null);
      }
    });
    const offCancelled = onTalkRequestCancelled((req) => {
      const g = gateRef.current;
      if (!g || g.pendingRequestId !== req.id) return;
      // Target turned DND off (or otherwise went stale) while waiting — same "fall back to the resting
      // gate state" reasoning as room-entry's onCancelled handler. If they're no longer DND at all, drop
      // the gate entirely and let the original action proceed normally.
      if (!dndEmailsRef.current.has(g.targetEmail)) {
        setGate(null);
        g.resume();
        return;
      }
      setGate({ ...g, pendingRequestId: null });
    });
    return () => {
      offResolved();
      offCancelled();
      window.clearTimeout(declinedTimerRef.current);
    };
  }, [showDeclined]);

  const handleRequest = useCallback(async () => {
    const g = gateRef.current;
    if (!g || g.pendingRequestId) return;
    try {
      const req = await createTalkRequest(g.targetEmail, g.kind);
      setGate((current) => (current && current.targetEmail === g.targetEmail ? { ...current, pendingRequestId: req.id } : current));
    } catch (err) {
      if (err instanceof TalkRequestCooldownError) {
        showDeclined(err.cooldownUntil);
        return;
      }
      console.error("[talkRequests] failed to send talk request", err);
    }
  }, [showDeclined]);

  const handleCancel = useCallback(() => {
    const g = gateRef.current;
    if (!g?.pendingRequestId) return;
    void cancelTalkRequest(g.pendingRequestId).catch(() => {});
    setGate({ ...g, pendingRequestId: null });
  }, []);

  const open = useCallback((g: Omit<TalkGate, "pendingRequestId">) => {
    setGate({ ...g, pendingRequestId: null });
  }, []);

  const supersede = useCallback((targetEmail: string) => {
    const stale = gateRef.current;
    if (!stale || stale.targetEmail === targetEmail) return;
    if (stale.pendingRequestId) void cancelTalkRequest(stale.pendingRequestId).catch(() => {});
    setGate(null);
  }, []);

  const clear = useCallback(() => setGate(null), []);

  return {
    gate,
    open,
    supersede,
    clear,
    toastProps: {
      targetName: gate?.targetName ?? null,
      pendingRequestId: gate?.pendingRequestId ?? null,
      declined,
      cooldownUntil,
      onRequest: () => void handleRequest(),
      onCancel: handleCancel,
    },
  };
}
