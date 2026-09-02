import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealToucanService, setDevIdentity } from "./RealToucanService";
import { ToucanConversationGoneError } from "./types";

// Wire-contract coverage for the live Toucan client. `fetch` is stubbed, so this
// asserts what leaves the browser and what is made of what comes back — never a
// real network call.
//
// THE ASSERTION THAT MATTERS MOST: no request body or query string ever carries
// an owner. The backend derives the owner from the bearer token and filters every
// conversation lookup on it; a client that sent one would be inventing an
// impersonation surface the server explicitly rejects.

const BASE = "http://vo-backend.test";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RealToucanService", () => {
  const service = new RealToucanService();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("VITE_CHAT_SOCKET_URL", BASE);
    setDevIdentity("angelo@example.com");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    setDevIdentity(null);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const lastCall = () => fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const lastBody = () => JSON.parse(lastCall()[1].body as string);

  it("sends the conversation id and no owner field", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ text: "hi", intent: "mock", supported: true, conversationId: "c-1" }),
    );

    const answer = await service.ask({
      question: "who is online",
      history: [],
      conversationId: "c-1",
    });

    expect(lastCall()[0]).toBe(`${BASE}/toucan/ask`);
    expect(lastBody()).toEqual({ question: "who is online", history: [], conversationId: "c-1" });
    expect(Object.keys(lastBody())).not.toContain("ownerEmail");
    expect(Object.keys(lastBody())).not.toContain("email");
    expect(answer.conversationId).toBe("c-1");
  });

  it("sends a null conversation id when there is none yet", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ text: "hi", intent: "mock", supported: true, conversationId: "c-new" }),
    );

    const answer = await service.ask({ question: "who is online", history: [] });

    expect(lastBody().conversationId).toBeNull();
    // The server tells the client which conversation it actually landed in.
    expect(answer.conversationId).toBe("c-new");
  });

  it("raises a distinct error when the conversation is gone, so the panel can self-heal", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Conversation not found" }, 404));

    await expect(
      service.ask({ question: "who is online", history: [], conversationId: "stale" }),
    ).rejects.toBeInstanceOf(ToucanConversationGoneError);
  });

  it("treats a 404 with no conversation id as an ordinary failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "nope" }, 404));

    await expect(service.ask({ question: "who is online", history: [] })).rejects.not.toBeInstanceOf(
      ToucanConversationGoneError,
    );
  });

  it("reads the latest conversation from one GET, and passes null straight through", async () => {
    fetchMock.mockResolvedValue(jsonResponse(null));
    await expect(service.loadLatestConversation()).resolves.toBeNull();
    expect(lastCall()[0]).toBe(`${BASE}/toucan/conversations/latest`);
    // A GET carries no body at all, so there is nowhere for an owner to hide.
    expect(lastCall()[1].body).toBeUndefined();
  });

  it("returns the restored transcript unchanged", async () => {
    const detail = {
      id: "c-1",
      title: "who is online",
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:01.000Z",
      messages: [
        { id: "m1", role: "user", content: "who is online", createdAt: "2026-09-02T00:00:00.000Z" },
        { id: "m2", role: "assistant", content: "nobody", createdAt: "2026-09-02T00:00:01.000Z" },
      ],
    };
    fetchMock.mockResolvedValue(jsonResponse(detail));
    await expect(service.loadLatestConversation()).resolves.toEqual(detail);
  });

  it("creates a new conversation with an empty POST", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "c-2", title: null, createdAt: "t", updatedAt: "t" }),
    );

    const conversation = await service.createConversation();

    expect(lastCall()[0]).toBe(`${BASE}/toucan/conversations`);
    expect(lastCall()[1].method).toBe("POST");
    expect(lastCall()[1].body).toBeUndefined();
    expect(conversation.id).toBe("c-2");
  });

  it("lists conversations from the existing list endpoint, with no owner anywhere", async () => {
    const saved = [
      { id: "c-2", title: "newer", createdAt: "t", updatedAt: "2026-09-02T00:00:02.000Z" },
      { id: "c-1", title: "older", createdAt: "t", updatedAt: "2026-09-02T00:00:01.000Z" },
    ];
    fetchMock.mockResolvedValue(jsonResponse(saved));

    // Server ordering is passed through untouched — the client never re-sorts.
    await expect(service.listConversations()).resolves.toEqual(saved);
    expect(lastCall()[0]).toBe(`${BASE}/toucan/conversations`);
    expect(lastCall()[1].body).toBeUndefined();
    // No owner in the query string either.
    expect(lastCall()[0]).not.toContain("@");
  });

  it("loads one saved conversation by id for the history panel", async () => {
    const detail = {
      id: "c-1",
      title: "older",
      createdAt: "t",
      updatedAt: "t",
      messages: [{ id: "m1", role: "user", content: "older", createdAt: "t" }],
    };
    fetchMock.mockResolvedValue(jsonResponse(detail));

    await expect(service.loadConversation("c-1")).resolves.toEqual(detail);
    expect(lastCall()[0]).toBe(`${BASE}/toucan/conversations/c-1`);
    expect(lastCall()[1].method).toBeUndefined();
  });

  it("reports a conversation that is gone (or never theirs) distinctly", async () => {
    // The backend answers 404 for both cases on purpose — it will not confirm
    // that somebody else's id exists.
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Conversation not found" }, 404));
    await expect(service.loadConversation("c-1")).rejects.toBeInstanceOf(
      ToucanConversationGoneError,
    );
  });

  it("surfaces a failed restore as an error rather than a fake empty conversation", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "boom" }, 500));
    await expect(service.loadLatestConversation()).rejects.toThrow();
  });

  it("authenticates every persistence call the same way as ask", async () => {
    fetchMock.mockResolvedValue(jsonResponse(null));
    await service.loadLatestConversation();
    const headers = lastCall()[1].headers as Headers;
    expect(headers.get("x-dev-email")).toBe("angelo@example.com");
  });
});
