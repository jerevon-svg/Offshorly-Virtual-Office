import { afterEach, describe, expect, it } from "vitest";
import {
  isMeaningfulReturn,
  readBriefedSince,
  resetBriefedSinceForTests,
  shouldBriefOnReturn,
  writeBriefedSince,
} from "./toucanReturnBriefing";
import type { ToucanCatchUp } from "../../services/toucan";

// A5 follow-up — the trigger rule for the proactive return briefing, in isolation. The server
// decides what the window means; this decides only whether that result earns a summon, and
// whether this viewer has already been briefed about this exact absence boundary.

const base = (over: Partial<ToucanCatchUp["activity"]> = {}, extra: Partial<ToucanCatchUp> = {}): ToucanCatchUp => ({
  activity: {
    since: "2026-09-04T17:00:00.000Z",
    sinceReason: "last_active",
    until: "2026-09-05T09:00:00.000Z",
    chatCount: 0,
    mentionCount: 0,
    missedCallCount: 0,
    hubCount: 0,
    pressingHubCount: 0,
    importantCount: 0,
    ...over,
  },
  delegatedUrgentCount: 0,
  coveredCount: 0,
  conversations: [],
  ...extra,
});

const ROW = {
  conversationId: "c1",
  type: "dm" as const,
  label: "Micah",
  newCount: 1,
  mentionCount: 0,
  urgent: false,
  toucanCovered: false,
};

describe("isMeaningfulReturn", () => {
  it("needs a real observed absence AND something to say", () => {
    expect(isMeaningfulReturn(null)).toBe(false);
    expect(isMeaningfulReturn(base())).toBe(false); // last_active but empty
    expect(isMeaningfulReturn(base({}, { conversations: [ROW] }))).toBe(true);
    expect(isMeaningfulReturn(base({ importantCount: 1, missedCallCount: 1 }))).toBe(true);
    expect(isMeaningfulReturn(base({}, { delegatedUrgentCount: 1 }))).toBe(true);
    // Ordinary Hub volume alone is not a reason to summon the bird.
    expect(isMeaningfulReturn(base({ hubCount: 6 }))).toBe(false);
  });

  it("never fires for tracking_started or no_history, however busy", () => {
    expect(isMeaningfulReturn(base({ sinceReason: "tracking_started", importantCount: 3 }, { conversations: [ROW] }))).toBe(false);
    expect(isMeaningfulReturn(base({ sinceReason: "no_history" }, { conversations: [ROW] }))).toBe(false);
  });
});

describe("shouldBriefOnReturn + the remembered boundary", () => {
  afterEach(resetBriefedSinceForTests);

  it("briefs a new boundary once and never the same boundary twice", () => {
    const catchUp = base({}, { conversations: [ROW] });
    expect(shouldBriefOnReturn(catchUp, null)).toBe(true);
    expect(shouldBriefOnReturn(catchUp, catchUp.activity.since)).toBe(false);
    // A later, different absence is a new boundary.
    const later = base({ since: "2026-09-06T17:00:00.000Z" }, { conversations: [ROW] });
    expect(shouldBriefOnReturn(later, catchUp.activity.since)).toBe(true);
    // An empty result is never briefed, even for a boundary nobody has seen.
    expect(shouldBriefOnReturn(base(), null)).toBe(false);
  });

  it("remembers the boundary per viewer in localStorage, case-insensitively", () => {
    expect(readBriefedSince("bon@example.com")).toBeNull();
    writeBriefedSince("Bon@Example.com", "2026-09-04T17:00:00.000Z");
    expect(readBriefedSince("bon@example.com")).toBe("2026-09-04T17:00:00.000Z");
    expect(readBriefedSince("micah@example.com")).toBeNull();
  });
});
