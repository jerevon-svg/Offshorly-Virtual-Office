import { askMemory, ReceiptError, type OrgTwinAnswer } from "./meetingReceiptClient";
import { MAX_QUESTION, useTwinConversation, type Classify } from "./meetingTwin";

// PHASE 9B — the Organizational Twin's conversation ("Ask your Memory"). The same one-at-a-time machine as the
// Meeting Twin, but held by the Meetings panel rather than the view, so opening a source's Receipt and coming
// back keeps the conversation. Nothing is persisted: closing the panel starts fresh. Every question goes to the
// server, which retrieves through the caller's own Memory again — earlier answers are never evidence.

export type OrgTwinBlock = "generator_unavailable";

const TURN_ERRORS: Record<string, string> = {
  rate_limited: "That's a lot of questions at once. Give it a moment, then ask again.",
  answer_rejected: "The answer couldn't be backed by your meetings, so it isn't shown.",
  twin_failed: "Couldn't answer just now. Try again.",
  invalid_question: `Keep the question under ${MAX_QUESTION} characters.`,
};

const classify: Classify<OrgTwinBlock> = (err) => {
  const code = err instanceof ReceiptError ? err.message : "";
  return {
    block: code === "generator_unavailable" ? "generator_unavailable" : null,
    error: TURN_ERRORS[code] ?? "Couldn't reach your meetings. Try again.",
  };
};

export function useOrganizationalTwin() {
  return useTwinConversation<OrgTwinAnswer, OrgTwinBlock>(askMemory, classify);
}

export type OrganizationalTwinState = ReturnType<typeof useOrganizationalTwin>;
