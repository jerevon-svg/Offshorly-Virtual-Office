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
