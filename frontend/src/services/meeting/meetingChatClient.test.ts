import { beforeEach, describe, expect, it, vi } from "vitest";

// PHASE 7D — the meeting chat client. What is pinned here is the SCOPING: messages belong to one
// meeting, a rejoin does not duplicate a subscription, and a reaction is a moment rather than a record.

const handlers = new Map<string, (p: unknown) => void>();
const emitted: Array<{ event: string; payload: unknown }> = [];
let disconnects = 0;

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: (event: string, cb: (p: unknown) => void) => { handlers.set(event, cb); },
    emit: (event: string, payload?: unknown) => { emitted.push({ event, payload }); },
    disconnect: () => { disconnects += 1; },
  }),
}));
vi.mock("../api/client", () => ({ getAuthToken: () => "token" }));

const M = "cave-all-hands";
const fire = (event: string, payload: unknown) => handlers.get(event)?.(payload);
const msg = (id: string, email: string, text: string, atMs = 1000) => ({ meetingId: M, id, email, text, atMs });

async function load() {
  const mod = await import("./meetingChatClient");
  mod.resetMeetingChatForTests();
  return mod;
}

beforeEach(() => {
  handlers.clear();
  emitted.length = 0;
  disconnects = 0;
  vi.resetModules();
});

describe("meeting chat scoping", () => {
  it("asks for the history on joining, and holds nothing before that", async () => {
    const m = await load();
    expect(m.getMeetingChatSnapshot().meetingId).toBeNull();
    m.joinMeetingChat(M);
    expect(m.getMeetingChatSnapshot().meetingId).toBe(M);
    expect(emitted.filter((e) => e.event === "meeting_chat_history")).toHaveLength(1);
  });

  it("does not resubscribe when the SAME meeting is joined again", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    m.joinMeetingChat(M);
    m.joinMeetingChat(M);
    // Leaving the Cave and walking back into the same live meeting must not ask three times.
    expect(emitted.filter((e) => e.event === "meeting_chat_history")).toHaveLength(1);
  });

  it("clears the previous meeting's messages when joining a different one", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    fire("meeting_chat", msg("a1", "a@x.com", "in the cave"));
    expect(m.getMeetingChatSnapshot().messages).toHaveLength(1);

    m.joinMeetingChat("all-hands");
    expect(m.getMeetingChatSnapshot().messages).toEqual([]);
    expect(m.getMeetingChatSnapshot().meetingId).toBe("all-hands");
  });

  it("ignores anything addressed to a meeting this client is not in", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    fire("meeting_chat", { ...msg("x1", "a@x.com", "elsewhere"), meetingId: "another" });
    fire("meeting_reaction", { meetingId: "another", email: "a@x.com", token: "🔥" });
    expect(m.getMeetingChatSnapshot().messages).toEqual([]);
    expect(m.getMeetingChatSnapshot().reactions).toEqual([]);
  });

  it("shows one message once, however many times the server mentions it", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    fire("meeting_chat", msg("a1", "a@x.com", "hello"));
    // The same id arriving again — live feed overlapping the history — must not double up.
    fire("meeting_chat", msg("a1", "a@x.com", "hello"));
    fire("meeting_chat_history", { meetingId: M, messages: [msg("a1", "a@x.com", "hello")] });
    expect(m.getMeetingChatSnapshot().messages).toHaveLength(1);
  });

  it("merges a late joiner's history in front of what has already arrived, in time order", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    fire("meeting_chat", msg("c", "a@x.com", "third", 3000));
    fire("meeting_chat_history", {
      meetingId: M,
      messages: [msg("a", "a@x.com", "first", 1000), msg("b", "b@x.com", "second", 2000)],
    });
    expect(m.getMeetingChatSnapshot().messages.map((x) => x.text)).toEqual(["first", "second", "third"]);
  });

  it("forgets everything when the meeting is left", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    fire("meeting_chat", msg("a1", "a@x.com", "said in the meeting"));
    m.leaveMeetingChat();
    expect(m.getMeetingChatSnapshot()).toEqual({ meetingId: null, messages: [], reactions: [] });
  });

  it("sends nothing when not in a meeting", async () => {
    const m = await load();
    m.sendMeetingChat("nobody to hear it");
    m.sendMeetingReaction("🔥");
    expect(emitted.filter((e) => e.event === "meeting_chat_send")).toEqual([]);
    expect(emitted.filter((e) => e.event === "meeting_reaction")).toEqual([]);
  });

  it("trims an empty message rather than sending whitespace", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    m.sendMeetingChat("   ");
    expect(emitted.filter((e) => e.event === "meeting_chat_send")).toEqual([]);
    m.sendMeetingChat("  real  ");
    expect(emitted.filter((e) => e.event === "meeting_chat_send")[0].payload).toEqual({ text: "real" });
  });
});

describe("reactions are a moment, not a record", () => {
  it("caps one person so they cannot fill the screen", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    for (let i = 0; i < 8; i++) fire("meeting_reaction", { meetingId: M, email: "a@x.com", token: "🔥" });
    expect(m.getMeetingChatSnapshot().reactions.filter((r) => r.email === "a@x.com").length).toBeLessThanOrEqual(3);
  });

  it("caps the total, so a crowd cannot bury the presentation", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    for (let i = 0; i < 12; i++) {
      fire("meeting_reaction", { meetingId: M, email: `p${i}@x.com`, token: "👏" });
    }
    expect(m.getMeetingChatSnapshot().reactions.length).toBeLessThanOrEqual(8);
  });

  it("keeps one person's burst from pushing everybody else off", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    fire("meeting_reaction", { meetingId: M, email: "quiet@x.com", token: "👍" });
    for (let i = 0; i < 8; i++) fire("meeting_reaction", { meetingId: M, email: "loud@x.com", token: "🔥" });
    const emails = m.getMeetingChatSnapshot().reactions.map((r) => r.email);
    expect(emails).toContain("quiet@x.com");
  });

  it("expires on its own clock and reports whether anything changed", async () => {
    const m = await load();
    m.joinMeetingChat(M);
    fire("meeting_reaction", { meetingId: M, email: "a@x.com", token: "🎉" });
    expect(m.expireReactions(Date.now())).toBe(false);
    expect(m.expireReactions(Date.now() + m.REACTION_TTL_MS + 1)).toBe(true);
    expect(m.getMeetingChatSnapshot().reactions).toEqual([]);
    // Nothing to do on an empty meeting — the caller's frame loop pays nothing.
    expect(m.expireReactions(Date.now())).toBe(false);
  });
});

describe("the dev identity", () => {
  it("does not drop the socket when the same address is seeded again", async () => {
    const m = await load();
    m.setDevIdentity("a@x.com");
    m.joinMeetingChat(M); // opens the socket
    m.setDevIdentity("a@x.com");
    m.setDevIdentity("  A@X.com ");
    expect(disconnects).toBe(0);
  });
});
