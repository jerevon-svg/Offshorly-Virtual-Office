import { useCallback, useEffect, useRef, useState } from "react";
import { askTwin, ReceiptError, type TwinAnswer, type TwinTurnContext } from "./meetingReceiptClient";

// PHASE 8B — the open Meeting Twin view's state: the questions asked since it opened and their answers, for
// ONE Meeting Session. Local to the view (no global store, nothing persisted — reopening starts fresh). The
// server grounds every answer on its own; the last few answered turns ride along only so a follow-up like
// "Who proposed that?" has a referent. One question at a time: a second send while one is in flight is dropped.
//
// Some refusals describe the MEETING rather than the question (not shared with you, no transcript, no Twin
// here, still running): those become `blocked` and replace the conversation. Anything else fails only its turn.
//
// PHASE 9B — the same conversation machine serves the Organizational Twin (organizationalTwin.ts), with its
// own request and refusal wording: `useTwinConversation` below.

export const HISTORY_TURNS = 3;
export const MAX_QUESTION = 500;

export type TwinBlock = "unavailable" | "no_transcript" | "generator_unavailable" | "meeting_active";

export interface TwinTurn<A = TwinAnswer> {
  id: number;
  question: string;
  state: "asking" | "answered" | "failed";
  answer?: A;
  error?: string;
}

/** How a refusal lands: the whole view (`block`) or only its turn (`error`). */
export type Classify<B> = (err: unknown) => { block: B | null; error: string };

export function useTwinConversation<A extends { answer: string }, B extends string>(
  send: (question: string, history: TwinTurnContext[]) => Promise<A>,
  classify: Classify<B>,
) {
  const [turns, setTurns] = useState<TwinTurn<A>[]>([]);
  const [blocked, setBlocked] = useState<B | null>(null);
  const [asking, setAsking] = useState(false);
  const inFlight = useRef(false);
  const nextId = useRef(1);
  const turnsRef = useRef<TwinTurn<A>[]>([]);
  turnsRef.current = turns;
  const io = useRef({ send, classify });
  io.current = { send, classify };
  const alive = useRef(true);
  // Re-armed on every mount: StrictMode's simulated unmount/remount must not leave it false.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const ask = useCallback(async (raw: string): Promise<boolean> => {
    const question = raw.trim();
    if (!question || question.length > MAX_QUESTION || inFlight.current) return false;
    inFlight.current = true;
    setAsking(true);
    const turnId = nextId.current++;
    const history = turnsRef.current
      .filter((t) => t.state === "answered" && t.answer)
      .slice(-HISTORY_TURNS)
      .map((t) => ({ question: t.question, answer: t.answer!.answer }));
    setTurns((ts) => [...ts, { id: turnId, question, state: "asking" }]);
    const settle = (patch: Partial<TwinTurn<A>>) =>
      setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, ...patch } : t)));
    try {
      const answer = await io.current.send(question, history);
      if (alive.current) settle({ state: "answered", answer });
    } catch (err) {
      if (!alive.current) return true;
      const { block, error } = io.current.classify(err);
      if (block) setBlocked(block);
      settle({ state: "failed", error });
    } finally {
      inFlight.current = false;
      if (alive.current) setAsking(false);
    }
    return true;
  }, []);

  return { turns, blocked, asking, ask };
}

const TURN_ERRORS: Record<string, string> = {
  rate_limited: "That's a lot of questions at once. Give it a moment, then ask again.",
  answer_rejected: "The answer couldn't be backed by this meeting's transcript, so it isn't shown.",
  twin_failed: "Couldn't answer just now. Try again.",
  invalid_question: `Keep the question under ${MAX_QUESTION} characters.`,
};

const BLOCKS: Record<string, TwinBlock> = {
  no_transcript: "no_transcript",
  generator_unavailable: "generator_unavailable",
  meeting_active: "meeting_active",
};

const classifyMeeting: Classify<TwinBlock> = (err) => {
  const code = err instanceof ReceiptError ? err.message : "";
  const block = err instanceof ReceiptError && err.status === 404 ? "unavailable" : (BLOCKS[code] ?? null);
  return { block, error: TURN_ERRORS[code] ?? "Couldn't reach the meeting. Try again." };
};

export function useMeetingTwin(sessionId: string) {
  return useTwinConversation<TwinAnswer, TwinBlock>(
    (question, history) => askTwin(sessionId, question, history),
    classifyMeeting,
  );
}
