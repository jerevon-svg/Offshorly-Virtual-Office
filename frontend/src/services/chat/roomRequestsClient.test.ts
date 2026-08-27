import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake Socket.IO client — same shape as requestsClient.test.ts's FakeSocket.
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
    id: "room-req-1",
    roomId: "design-team",
    requesterEmail: "requester@example.com",
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

describe("roomRequestsClient", () => {
  it("fetches the initial pending list on first hook mount", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [makeRequest()],
    });

    const { usePendingRoomRequests } = await import("./roomRequestsClient");
    const { result } = renderHook(() => usePendingRoomRequests());

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].id).toBe("room-req-1");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/room-requests/pending");
  });

  it("adds a request to pending on room_request_created and removes it on room_request_resolved", async () => {
    const { usePendingRoomRequests } = await import("./roomRequestsClient");
    const { result } = renderHook(() => usePendingRoomRequests());
    await waitFor(() => expect(lastFakeSocket).not.toBeNull());

    act(() => {
      lastFakeSocket!.trigger("room_request_created", makeRequest());
    });
    expect(result.current).toHaveLength(1);

    act(() => {
      lastFakeSocket!.trigger("room_request_resolved", makeRequest({ state: "accepted" }));
    });
    expect(result.current).toHaveLength(0);
  });

  it("removes a request from pending on room_request_cancelled", async () => {
    const { usePendingRoomRequests } = await import("./roomRequestsClient");
    const { result } = renderHook(() => usePendingRoomRequests());
    await waitFor(() => expect(lastFakeSocket).not.toBeNull());

    act(() => {
      lastFakeSocket!.trigger("room_request_created", makeRequest());
    });
    expect(result.current).toHaveLength(1);

    act(() => {
      lastFakeSocket!.trigger("room_request_cancelled", makeRequest({ state: "cancelled" }));
    });
    expect(result.current).toHaveLength(0);
  });

  it("createRoomEntryRequest posts {roomId}", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => makeRequest(),
    });

    const { createRoomEntryRequest } = await import("./roomRequestsClient");
    await createRoomEntryRequest("design-team");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/room-requests");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ roomId: "design-team" });
  });

  it("resolveRoomEntryRequest posts the decision and resolves with the server response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => makeRequest({ state: "accepted" }),
    });

    const { resolveRoomEntryRequest } = await import("./roomRequestsClient");
    const out = await resolveRoomEntryRequest("room-req-1", "accept");

    expect(out.state).toBe("accepted");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/room-requests/room-req-1/resolve");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ decision: "accept" });
  });

  it("cancelRoomEntryRequest posts to /room-requests/{id}/cancel", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => makeRequest({ state: "cancelled" }),
    });

    const { cancelRoomEntryRequest } = await import("./roomRequestsClient");
    await cancelRoomEntryRequest("room-req-1");

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/room-requests/room-req-1/cancel");
  });

  it("onRoomRequestResolved fires for room_request_resolved events", async () => {
    const { usePendingRoomRequests, onRoomRequestResolved } = await import("./roomRequestsClient");
    renderHook(() => usePendingRoomRequests());
    await waitFor(() => expect(lastFakeSocket).not.toBeNull());

    const cb = vi.fn();
    const unsubscribe = onRoomRequestResolved(cb);

    const resolved = makeRequest({ state: "declined" });
    lastFakeSocket!.trigger("room_request_resolved", resolved);

    expect(cb).toHaveBeenCalledWith(resolved);
    unsubscribe();
  });

  it("onRoomRequestCancelled fires for room_request_cancelled events", async () => {
    const { usePendingRoomRequests, onRoomRequestCancelled } = await import("./roomRequestsClient");
    renderHook(() => usePendingRoomRequests());
    await waitFor(() => expect(lastFakeSocket).not.toBeNull());

    const cb = vi.fn();
    const unsubscribe = onRoomRequestCancelled(cb);

    const cancelled = makeRequest({ state: "cancelled" });
    lastFakeSocket!.trigger("room_request_cancelled", cancelled);

    expect(cb).toHaveBeenCalledWith(cancelled);
    unsubscribe();
  });
});
