import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — same shape as offlineLineupClient.test.ts's FakeSocket.
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
    id: "req-1",
    kind: "join_group",
    conversationId: "conv-1",
    requesterEmail: "requester@example.com",
    state: "pending",
    resolverEmail: null,
    resultConversationId: null,
    payload: null,
    resolvedAt: null,
    createdAt: "2026-08-22T00:00:00Z",
    updatedAt: "2026-08-22T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  lastFakeSocket = null;
  (import.meta.env as Record<string, string>).VITE_CHAT_SOCKET_URL = "http://localhost:4800";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestsClient", () => {
  it("fetches the initial pending list on first hook mount", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [makeRequest()],
    });

    const { usePendingRequests } = await import("./requestsClient");
    const { result } = renderHook(() => usePendingRequests());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].id).toBe("req-1");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/requests/pending");
  });

  it("adds a request to pending on request_created and removes it on request_resolved", async () => {
    const { usePendingRequests } = await import("./requestsClient");
    const { result } = renderHook(() => usePendingRequests());

    await waitFor(() => expect(lastFakeSocket).not.toBeNull());

    act(() => {
      lastFakeSocket!.trigger("request_created", makeRequest());
    });
    expect(result.current).toHaveLength(1);

    act(() => {
      lastFakeSocket!.trigger(
        "request_resolved",
        makeRequest({ state: "accepted", resultConversationId: "conv-1" }),
      );
    });
    expect(result.current).toHaveLength(0);
  });

  it("removes a request from pending on request_cancelled", async () => {
    const { usePendingRequests } = await import("./requestsClient");
    const { result } = renderHook(() => usePendingRequests());
    await waitFor(() => expect(lastFakeSocket).not.toBeNull());

    act(() => {
      lastFakeSocket!.trigger("request_created", makeRequest());
    });
    expect(result.current).toHaveLength(1);

    act(() => {
      lastFakeSocket!.trigger("request_cancelled", makeRequest({ state: "cancelled" }));
    });
    expect(result.current).toHaveLength(0);
  });

  it("createJoinRequest posts kind=join_group and the given conversationId", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => makeRequest(),
    });

    const { createJoinRequest } = await import("./requestsClient");
    await createJoinRequest("conv-1");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/requests");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      kind: "join_group",
      conversationId: "conv-1",
    });
  });

  it("resolveRequest posts the decision and resolves with the server response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => makeRequest({ state: "accepted" }),
    });

    const { resolveRequest } = await import("./requestsClient");
    const out = await resolveRequest("req-1", "accept");

    expect(out.state).toBe("accepted");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/requests/req-1/resolve");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ decision: "accept" });
  });

  it("cancelRequest posts to /requests/{id}/cancel", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => makeRequest({ state: "cancelled" }),
    });

    const { cancelRequest } = await import("./requestsClient");
    await cancelRequest("req-1");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/requests/req-1/cancel");
  });

  it("onRequestResolved fires for request_resolved events on this client's socket", async () => {
    const { usePendingRequests, onRequestResolved } = await import("./requestsClient");
    renderHook(() => usePendingRequests());
    await waitFor(() => expect(lastFakeSocket).not.toBeNull());

    const cb = vi.fn();
    const unsubscribe = onRequestResolved(cb);

    const resolved = makeRequest({ state: "declined" });
    lastFakeSocket!.trigger("request_resolved", resolved);

    expect(cb).toHaveBeenCalledWith(resolved);
    unsubscribe();
  });

  it("setDevIdentity causes the next socket connection to authenticate with x-dev-email instead of token", async () => {
    const { usePendingRequests, setDevIdentity } = await import("./requestsClient");

    setDevIdentity("dev@example.com");
    renderHook(() => usePendingRequests());

    await waitFor(() => expect(lastFakeSocket).not.toBeNull());
    const socketIoModule = await import("socket.io-client");
    const ioMock = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;
    const lastCallOptions = ioMock.mock.calls[ioMock.mock.calls.length - 1][1];
    expect(lastCallOptions.auth).toEqual({ "x-dev-email": "dev@example.com" });
  });

  it("setDevIdentity causes REST calls to send x-dev-email instead of an Authorization bearer token", async () => {
    const { createJoinRequest, setDevIdentity } = await import("./requestsClient");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => makeRequest(),
    });

    setDevIdentity("dev@example.com");
    await createJoinRequest("conv-1");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Headers;
    expect(headers.get("x-dev-email")).toBe("dev@example.com");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("setDevIdentity tears down a live socket and reconnects with the new identity", async () => {
    const { usePendingRequests, setDevIdentity } = await import("./requestsClient");
    const socketIoModule = await import("socket.io-client");
    const ioMock = socketIoModule.io as unknown as ReturnType<typeof vi.fn>;

    setDevIdentity("first@example.com");
    renderHook(() => usePendingRequests());
    await waitFor(() => expect(lastFakeSocket).not.toBeNull());
    const firstSocket = lastFakeSocket;
    const disconnectSpy = vi.spyOn(firstSocket!, "disconnect");
    const callsBefore = ioMock.mock.calls.length;

    setDevIdentity("second@example.com");
    expect(disconnectSpy).toHaveBeenCalledTimes(1);

    renderHook(() => usePendingRequests());
    await waitFor(() => expect(ioMock.mock.calls.length - callsBefore).toBe(1));
    const lastCallOptions = ioMock.mock.calls[ioMock.mock.calls.length - 1][1];
    expect(lastCallOptions.auth).toEqual({ "x-dev-email": "second@example.com" });
  });

  // Run last: overrides the module-level "../api/client" mock for the rest of this file.
  it("does not open a socket connection when there is no auth token", async () => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    const { usePendingRequests } = await import("./requestsClient");
    renderHook(() => usePendingRequests());

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(lastFakeSocket).toBeNull();
  });

  it("setDevIdentity allows connecting even with no real auth token present (doomed-from-the-start guard bypassed)", async () => {
    vi.doMock("../api/client", () => ({ getAuthToken: vi.fn(() => null) }));
    const { usePendingRequests, setDevIdentity } = await import("./requestsClient");

    setDevIdentity("dev@example.com");
    renderHook(() => usePendingRequests());

    await waitFor(() => expect(lastFakeSocket).not.toBeNull());
  });
});
