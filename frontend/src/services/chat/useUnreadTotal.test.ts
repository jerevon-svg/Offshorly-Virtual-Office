import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const listConversations = vi.fn();
const unreadCountListeners = new Set<(u: { conversationId: string; count: number }) => void>();
const onUnreadCount = vi.fn((cb: (u: { conversationId: string; count: number }) => void) => {
  unreadCountListeners.add(cb);
  return () => unreadCountListeners.delete(cb);
});

function fireUnreadCount(update: { conversationId: string; count: number }) {
  for (const cb of unreadCountListeners) cb(update);
}

let mockChatMode: "real" | "mock" = "real";

vi.mock("./index", () => ({
  get chatMode() {
    return mockChatMode;
  },
  chatService: {
    listConversations,
    onUnreadCount,
  },
}));

beforeEach(() => {
  mockChatMode = "real";
  unreadCountListeners.clear();
  listConversations.mockReset();
  onUnreadCount.mockClear();
});

describe("useUnreadTotal", () => {
  it("reports 0/empty in mock mode without calling the service at all", async () => {
    mockChatMode = "mock";
    const { useUnreadTotal } = await import("./useUnreadTotal");
    const { result } = renderHook(() => useUnreadTotal("a@example.com"));

    expect(result.current.total).toBe(0);
    expect(result.current.unreadConversations).toEqual([]);
    expect(listConversations).not.toHaveBeenCalled();
  });

  it("sums unreadCount across the initial conversation list in real mode", async () => {
    listConversations.mockResolvedValue([
      { id: "conv-1", participantIds: ["a@example.com", "b@example.com"], lastMessageAt: "t", unreadCount: 2 },
      { id: "conv-2", participantIds: ["a@example.com", "c@example.com"], lastMessageAt: "t", unreadCount: 1 },
      { id: "conv-3", participantIds: ["a@example.com", "d@example.com"], lastMessageAt: "t", unreadCount: 0 },
    ]);

    const { useUnreadTotal } = await import("./useUnreadTotal");
    const { result } = renderHook(() => useUnreadTotal("a@example.com"));

    await waitFor(() => expect(result.current.total).toBe(3));
    expect(result.current.unreadConversations.sort((x, y) => x.conversationId.localeCompare(y.conversationId))).toEqual([
      { conversationId: "conv-1", peerId: "b@example.com", count: 2 },
      { conversationId: "conv-2", peerId: "c@example.com", count: 1 },
    ]);
  });

  it("updates the total live when an unread_count event arrives for a known conversation", async () => {
    listConversations.mockResolvedValue([
      { id: "conv-1", participantIds: ["a@example.com", "b@example.com"], lastMessageAt: "t", unreadCount: 1 },
    ]);

    const { useUnreadTotal } = await import("./useUnreadTotal");
    const { result } = renderHook(() => useUnreadTotal("a@example.com"));

    await waitFor(() => expect(result.current.total).toBe(1));

    act(() => {
      fireUnreadCount({ conversationId: "conv-1", count: 4 });
    });

    await waitFor(() => expect(result.current.total).toBe(4));
  });

  it("returns ALL conversations (including 0-unread and groups), sorted by lastMessageAt descending", async () => {
    listConversations.mockResolvedValue([
      { id: "conv-old", participantIds: ["a@example.com", "b@example.com"], lastMessageAt: "2026-08-18T10:00:00.000Z", unreadCount: 0 },
      {
        id: "conv-group",
        participantIds: ["a@example.com", "c@example.com", "d@example.com"],
        lastMessageAt: "2026-08-22T10:00:00.000Z",
        unreadCount: 2,
        type: "group",
        title: "Team Chat",
      },
      { id: "conv-mid", participantIds: ["a@example.com", "e@example.com"], lastMessageAt: "2026-08-20T10:00:00.000Z", unreadCount: 1 },
    ]);

    const { useUnreadTotal } = await import("./useUnreadTotal");
    const { result } = renderHook(() => useUnreadTotal("a@example.com"));

    await waitFor(() => expect(result.current.conversations).toHaveLength(3));
    expect(result.current.conversations.map((c) => c.id)).toEqual(["conv-group", "conv-mid", "conv-old"]);
    // Existing behavior stays intact — total/unreadConversations unaffected by this addition.
    expect(result.current.total).toBe(3);
    expect(result.current.unreadConversations).toHaveLength(2);
  });

  it("keeps a live unread_count push reflected in the conversations list's unreadCount field", async () => {
    listConversations.mockResolvedValue([
      { id: "conv-1", participantIds: ["a@example.com", "b@example.com"], lastMessageAt: "t", unreadCount: 1 },
    ]);

    const { useUnreadTotal } = await import("./useUnreadTotal");
    const { result } = renderHook(() => useUnreadTotal("a@example.com"));

    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    expect(result.current.conversations[0].unreadCount).toBe(1);

    act(() => {
      fireUnreadCount({ conversationId: "conv-1", count: 5 });
    });

    await waitFor(() => expect(result.current.conversations[0].unreadCount).toBe(5));
  });

  it("drops a conversation from the total once its count reaches 0 (read elsewhere)", async () => {
    listConversations.mockResolvedValue([
      { id: "conv-1", participantIds: ["a@example.com", "b@example.com"], lastMessageAt: "t", unreadCount: 2 },
    ]);

    const { useUnreadTotal } = await import("./useUnreadTotal");
    const { result } = renderHook(() => useUnreadTotal("a@example.com"));

    await waitFor(() => expect(result.current.total).toBe(2));

    act(() => {
      fireUnreadCount({ conversationId: "conv-1", count: 0 });
    });

    await waitFor(() => expect(result.current.total).toBe(0));
    expect(result.current.unreadConversations).toEqual([]);
  });
});
