import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppNotification, NotificationList } from "../../services/notifications/notificationsClient";

vi.mock("../../services/notifications/notificationsClient", () => ({
  fetchNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  setDevIdentity: vi.fn(),
}));

// The store opens its own socket (see notificationsStore.ts). Faked so the tests exercise the
// store's event handling without a server, and so no real connection is attempted in jsdom.
const socketHandlers = new Map<string, (payload: unknown) => void>();
vi.mock("socket.io-client", () => ({
  io: () => ({
    on: (event: string, handler: (payload: unknown) => void) => {
      socketHandlers.set(event, handler);
    },
    disconnect: () => {},
  }),
}));

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../services/notifications/notificationsClient";
import {
  resetNotificationsStoreForTests,
  setDevIdentity,
} from "../../services/notifications/notificationsStore";
import { NotificationCenter, destinationFor, relativeTime } from "./NotificationCenter";

const notification = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: "n1",
  type: "kudos_received",
  title: "🏆 You received Kudos!",
  body: "Bon: “Great work on the deployment!”\n+75 XP · +20 Coins",
  navKind: "profile_feed",
  navPayload: { email: "alex@example.com", postId: "p1" },
  readAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

function list(over: Partial<NotificationList> = {}): NotificationList {
  return { notifications: [notification()], unreadCount: 1, ...over };
}

beforeEach(() => {
  socketHandlers.clear();
  resetNotificationsStoreForTests();
  vi.mocked(fetchNotifications).mockReset();
  vi.mocked(markNotificationRead).mockReset();
  vi.mocked(markAllNotificationsRead).mockReset();
  vi.mocked(fetchNotifications).mockResolvedValue(list());
  vi.mocked(markNotificationRead).mockResolvedValue({ unreadCount: 0, updated: 1 });
  vi.mocked(markAllNotificationsRead).mockResolvedValue({ unreadCount: 0, updated: 1 });
  // A dev identity is what lets the store open its (faked) socket at all.
  setDevIdentity("alex@example.com");
});

afterEach(() => {
  resetNotificationsStoreForTests();
});

async function open(props: Parameters<typeof NotificationCenter>[0] = {}) {
  render(<NotificationCenter {...props} />);
  await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
  return screen.getByTestId("notification-panel");
}

describe("unread badge", () => {
  it("shows the server's unread count on the bell", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue(list({ unreadCount: 3 }));
    render(<NotificationCenter />);
    await waitFor(() => expect(screen.getByTestId("notification-badge")).toHaveTextContent("3"));
    expect(screen.getByRole("button", { name: "Notifications (3 unread)" })).toBeInTheDocument();
  });

  it("shows no badge when nothing is unread", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({ notifications: [notification({ readAt: "x" })], unreadCount: 0 });
    render(<NotificationCenter />);
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
    expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();
  });

  it("caps the displayed count rather than widening the pill", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue(list({ unreadCount: 250 }));
    render(<NotificationCenter />);
    await waitFor(() => expect(screen.getByTestId("notification-badge")).toHaveTextContent("99+"));
  });
});

describe("panel", () => {
  it("lists notifications newest first, as the server ordered them", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({
      notifications: [notification({ id: "new", title: "Newest" }), notification({ id: "old", title: "Oldest" })],
      unreadCount: 2,
    });
    await open();
    expect(screen.getAllByTestId("notification-item").map((el) => el.textContent?.slice(0, 6))).toEqual([
      "Newest",
      "Oldest",
    ]);
  });

  it("shows a sensible empty state", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({ notifications: [], unreadCount: 0 });
    await open();
    expect(screen.getByText(/nothing new yet/i)).toBeInTheDocument();
  });

  it("closes on Escape and on a click outside", async () => {
    await open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByTestId("notification-panel")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument();
  });

  it("closes when a full-screen modal takes the view", async () => {
    const { rerender } = render(<NotificationCenter modalOpen={false} />);
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.getByTestId("notification-panel")).toBeInTheDocument();

    rerender(<NotificationCenter modalOpen />);
    expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument();
  });
});

describe("read state", () => {
  it("marks a notification read when it is clicked, and takes the count from the server", async () => {
    vi.mocked(markNotificationRead).mockResolvedValue({ unreadCount: 0, updated: 1 });
    await open();
    fireEvent.click(screen.getByTestId("notification-item"));

    expect(markNotificationRead).toHaveBeenCalledWith("n1");
    await waitFor(() => expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument());
  });

  it("marks everything read from the header", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({
      notifications: [notification({ id: "a" }), notification({ id: "b" })],
      unreadCount: 2,
    });
    vi.mocked(markAllNotificationsRead).mockResolvedValue({ unreadCount: 0, updated: 2 });
    await open();
    fireEvent.click(screen.getByRole("button", { name: /mark all as read/i }));

    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByTestId("notification-item").every((el) => el.dataset.read === "true")).toBe(true),
    );
    expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark all as read/i })).toBeDisabled();
  });

  it("re-asks the server when marking read fails, instead of trusting a guess", async () => {
    vi.mocked(markNotificationRead).mockRejectedValue(new Error("offline"));
    await open();
    fireEvent.click(screen.getByTestId("notification-item"));
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(2));
  });
});

describe("realtime arrival", () => {
  it("prepends a pushed notification and takes the pushed unread count", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({ notifications: [], unreadCount: 0 });
    await open();
    expect(screen.getByText(/nothing new yet/i)).toBeInTheDocument();

    act(() => {
      socketHandlers.get("notification_new")?.({
        notification: notification({ id: "live", title: "🏆 You received Kudos!" }),
        unreadCount: 1,
      });
    });

    expect(screen.getByTestId("notification-item")).toBeInTheDocument();
    expect(screen.getByTestId("notification-badge")).toHaveTextContent("1");
  });

  it("does not duplicate a notification already in the list", async () => {
    await open();
    act(() => {
      socketHandlers.get("notification_new")?.({ notification: notification(), unreadCount: 1 });
    });
    expect(screen.getAllByTestId("notification-item")).toHaveLength(1);
  });

  it("re-fetches on socket (re)connect, so pushes missed while disconnected are recovered", async () => {
    render(<NotificationCenter />);
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(1));
    await act(async () => {
      socketHandlers.get("connect")?.(undefined);
    });
    expect(fetchNotifications).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when the tab regains focus", async () => {
    render(<NotificationCenter />);
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(1));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchNotifications).toHaveBeenCalledTimes(2);
  });
});

describe("click destinations", () => {
  it("opens the recipient's feed focused on the Kudos, then closes the panel", async () => {
    const onNavigate = vi.fn().mockReturnValue(true);
    await open({ onNavigate });
    fireEvent.click(screen.getByTestId("notification-item"));

    expect(onNavigate).toHaveBeenCalledWith({ kind: "profileFeed", email: "alex@example.com", postId: "p1" });
    expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument();
  });

  it("marks read and navigates nowhere for an unsupported destination", async () => {
    const onNavigate = vi.fn();
    vi.mocked(fetchNotifications).mockResolvedValue({
      notifications: [notification({ navKind: "meeting_starting", navPayload: { meetingId: "m1" } })],
      unreadCount: 1,
    });
    await open({ onNavigate });
    fireEvent.click(screen.getByTestId("notification-item"));

    expect(onNavigate).not.toHaveBeenCalled();
    expect(markNotificationRead).toHaveBeenCalledWith("n1");
    // Panel stays open: nothing was opened, so closing it would just lose the viewer's place.
    expect(screen.getByTestId("notification-panel")).toBeInTheDocument();
  });

  it("keeps the panel open when the destination could not be honoured", async () => {
    const onNavigate = vi.fn().mockReturnValue(false);
    await open({ onNavigate });
    fireEvent.click(screen.getByTestId("notification-item"));
    expect(screen.getByTestId("notification-panel")).toBeInTheDocument();
    expect(markNotificationRead).toHaveBeenCalledWith("n1");
  });
});

describe("destinationFor", () => {
  it("maps every kind this build supports", () => {
    expect(destinationFor(notification())).toEqual({
      kind: "profileFeed",
      email: "alex@example.com",
      postId: "p1",
    });
    expect(destinationFor(notification({ navKind: "conversation", navPayload: { conversationId: "c1" } }))).toEqual({
      kind: "conversation",
      conversationId: "c1",
    });
    expect(destinationFor(notification({ navKind: "quests", navPayload: {} }))).toEqual({ kind: "quests" });
    expect(destinationFor(notification({ navKind: "missions", navPayload: {} }))).toEqual({ kind: "missions" });
    expect(destinationFor(notification({ navKind: "achievements", navPayload: {} }))).toEqual({
      kind: "achievements",
    });
    expect(destinationFor(notification({ navKind: "hub", navPayload: {} }))).toEqual({ kind: "hub" });
  });

  it("returns null rather than inventing navigation", () => {
    expect(destinationFor(notification({ navKind: null, navPayload: null }))).toBeNull();
    expect(destinationFor(notification({ navKind: "hr_case", navPayload: { id: "x" } }))).toBeNull();
    // A known kind with a payload it cannot use is just as unsupported.
    expect(destinationFor(notification({ navKind: "profile_feed", navPayload: {} }))).toBeNull();
    expect(destinationFor(notification({ navKind: "conversation", navPayload: { conversationId: "  " } }))).toBeNull();
  });

  it("tolerates a missing postId — the feed still opens, just unfocused", () => {
    expect(destinationFor(notification({ navPayload: { email: "alex@example.com" } }))).toEqual({
      kind: "profileFeed",
      email: "alex@example.com",
      postId: null,
    });
  });
});

describe("relativeTime", () => {
  it("reads a UTC server timestamp as UTC, not as local time", () => {
    const now = Date.parse("2026-09-08T12:00:00Z");
    expect(relativeTime("2026-09-08T11:58:00Z", now)).toBe("2m ago");
    expect(relativeTime("2026-09-08T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-09-08T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-09-07T12:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-09-05T12:00:00Z", now)).toBe("3d ago");
  });

  it("returns an empty string rather than NaN for an unparseable timestamp", () => {
    expect(relativeTime("not a date")).toBe("");
  });
});
