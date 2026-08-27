import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — same shape as roomRequestsClient.test.ts's FakeSocket.
class FakeSocket {
  handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  emitted: Array<{ event: string; payload: unknown }> = [];

  on(event: string, cb: (...args: unknown[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }

  emit(event: string, payload?: unknown) {
    this.emitted.push({ event, payload });
    return this;
  }

  disconnect() {
    return this;
  }

  trigger(event: string, payload?: unknown) {
    for (const cb of this.handlers.get(event) ?? []) cb(payload);
  }
}

let lastFakeSocket: FakeSocket | null = null;

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    lastFakeSocket = new FakeSocket();
    return lastFakeSocket;
  }),
}));

vi.mock("../api/client", () => ({
  getAuthToken: vi.fn(() => "fake-token"),
}));

function makeRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "talk-req-1",
    targetEmail: "a@example.com",
    requesterEmail: "b@example.com",
    kind: "chat",
    state: "pending",
    resolverEmail: null,
    resolvedAt: null,
    createdAt: "2026-08-27T00:00:00Z",
    updatedAt: "2026-08-27T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  lastFakeSocket = null;
  (import.meta.env as Record<string, string>).VITE_CHAT_SOCKET_URL = "http://localhost:4800";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("talkRequestsClient", () => {
  it("fetches the initial pending list on first hook mount", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [makeRequest()],
    });

    const { usePendingTalkRequests } = await import("./talkRequestsClient");
    const { result } = renderHook(() => usePendingTalkRequests());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].id).toBe("talk-req-1");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/talk-requests/pending");
  });

  it("adds a request to pending on talk_request_created and removes it on talk_request_resolved", async () => {
    const { usePendingTalkRequests } = await import("./talkRequestsClient");
    const { result } = renderHook(() => usePendingTalkRequests());
    await waitFor(() => expect(lastFakeSocket).not.toBeNull());

    act(() => {
      lastFakeSocket!.trigger("talk_request_created", makeRequest());
    });
    expect(result.current).toHaveLength(1);

    act(() => {
      lastFakeSocket!.trigger("talk_request_resolved", makeRequest({ state: "accepted" }));
    });
    expect(result.current).toHaveLength(0);
  });

  it("removes a request from pending on talk_request_cancelled", async () => {
    const { usePendingTalkRequests } = await import("./talkRequestsClient");
    const { result } = renderHook(() => usePendingTalkRequests());
    await waitFor(() => expect(lastFakeSocket).not.toBeNull());

    act(() => {
      lastFakeSocket!.trigger("talk_request_created", makeRequest());
    });
    expect(result.current).toHaveLength(1);

    act(() => {
      lastFakeSocket!.trigger("talk_request_cancelled", makeRequest({ state: "cancelled" }));
    });
    expect(result.current).toHaveLength(0);
  });

  it("createTalkRequest posts {targetEmail, kind}", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => makeRequest(),
    });

    const { createTalkRequest } = await import("./talkRequestsClient");
    await createTalkRequest("a@example.com", "chat");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/talk-requests");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      targetEmail: "a@example.com",
      kind: "chat",
    });
  });

  it("createTalkRequest throws TalkRequestCooldownError on a 429 with cooldownUntil", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "Recently declined", cooldownUntil: "2026-08-27T00:15:00Z" }),
    });

    const { createTalkRequest, TalkRequestCooldownError } = await import("./talkRequestsClient");

    await expect(createTalkRequest("a@example.com", "chat")).rejects.toBeInstanceOf(TalkRequestCooldownError);
  });

  it("a non-cooldown error response throws a plain Error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "Target is not currently in Do Not Disturb" }),
    });

    const { createTalkRequest, TalkRequestCooldownError } = await import("./talkRequestsClient");

    await expect(createTalkRequest("a@example.com", "chat")).rejects.not.toBeInstanceOf(TalkRequestCooldownError);
  });

  it("resolveTalkRequest posts the decision and resolves with the server response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => makeRequest({ state: "accepted" }),
    });

    const { resolveTalkRequest } = await import("./talkRequestsClient");
    const out = await resolveTalkRequest("talk-req-1", "accept");

    expect(out.state).toBe("accepted");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/talk-requests/talk-req-1/resolve");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ decision: "accept" });
  });

  it("cancelTalkRequest posts to /talk-requests/{id}/cancel", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => makeRequest({ state: "cancelled" }),
    });

    const { cancelTalkRequest } = await import("./talkRequestsClient");
    await cancelTalkRequest("talk-req-1");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/talk-requests/talk-req-1/cancel");
  });

  it("onTalkRequestResolved fires for talk_request_resolved events", async () => {
    const { usePendingTalkRequests, onTalkRequestResolved } = await import("./talkRequestsClient");
    renderHook(() => usePendingTalkRequests());
    await waitFor(() => expect(lastFakeSocket).not.toBeNull());

    const cb = vi.fn();
    const unsubscribe = onTalkRequestResolved(cb);

    const resolved = makeRequest({ state: "declined" });
    lastFakeSocket!.trigger("talk_request_resolved", resolved);

    expect(cb).toHaveBeenCalledWith(resolved);
    unsubscribe();
  });
});
