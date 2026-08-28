import { describe, expect, it } from "vitest";
import {
  activeMentionEmails,
  filterMentionCandidates,
  findMentionTrigger,
  insertMention,
  type MentionCandidate,
} from "./mentions";

describe("findMentionTrigger", () => {
  it("detects an in-progress @word at the cursor", () => {
    expect(findMentionTrigger("hi @al", 6)).toEqual({ query: "al", start: 3 });
  });

  it("detects a bare @ with no query yet", () => {
    expect(findMentionTrigger("@", 1)).toEqual({ query: "", start: 0 });
  });

  it("returns null when there is no @ before the cursor", () => {
    expect(findMentionTrigger("hello there", 5)).toBeNull();
  });

  it("returns null once a space breaks the mention attempt", () => {
    expect(findMentionTrigger("hi @al ex", 9)).toBeNull();
  });

  it("does not trigger mid-word (e.g. an email address)", () => {
    expect(findMentionTrigger("foo@bar.com", 7)).toBeNull();
  });

  it("triggers right after @ at the very start of the text", () => {
    expect(findMentionTrigger("@bon", 4)).toEqual({ query: "bon", start: 0 });
  });

  it("only considers text up to the cursor, not the whole string", () => {
    // cursor sits right after "@al" — the trailing " later" must not affect the trigger.
    expect(findMentionTrigger("hi @al later", 6)).toEqual({ query: "al", start: 3 });
  });
});

describe("filterMentionCandidates", () => {
  const candidates: MentionCandidate[] = [
    { email: "alex@example.com", displayName: "Alex" },
    { email: "alice@example.com", displayName: "Alice" },
    { email: "bon@example.com", displayName: "Bon" },
  ];

  it("returns everyone for an empty query", () => {
    expect(filterMentionCandidates(candidates, "")).toEqual(candidates);
  });

  it("filters case-insensitively by substring", () => {
    expect(filterMentionCandidates(candidates, "al")).toEqual([candidates[0], candidates[1]]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterMentionCandidates(candidates, "zzz")).toEqual([]);
  });
});

describe("insertMention", () => {
  it("replaces the @query span with @DisplayName plus a trailing space", () => {
    const result = insertMention("hi @al", 3, 6, "Alex");
    expect(result.text).toBe("hi @Alex ");
    expect(result.cursor).toBe(9);
  });

  it("preserves text after the query", () => {
    const result = insertMention("hi @al how are you", 3, 6, "Alex");
    expect(result.text).toBe("hi @Alex  how are you");
  });
});

describe("activeMentionEmails", () => {
  const alex: MentionCandidate = { email: "alex@example.com", displayName: "Alex" };
  const bon: MentionCandidate = { email: "bon@example.com", displayName: "Bon" };

  it("keeps candidates whose @DisplayName token is still present in the text", () => {
    expect(activeMentionEmails("hey @Alex and @Bon", [alex, bon])).toEqual([
      "alex@example.com",
      "bon@example.com",
    ]);
  });

  it("drops a candidate whose mention text was deleted/edited away", () => {
    expect(activeMentionEmails("hey Alex and @Bon", [alex, bon])).toEqual(["bon@example.com"]);
  });

  it("dedupes a candidate mentioned twice in the same text", () => {
    expect(activeMentionEmails("@Alex @Alex", [alex])).toEqual(["alex@example.com"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(activeMentionEmails("no mentions here", [alex, bon])).toEqual([]);
  });
});
