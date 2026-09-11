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
import {
  NotificationCenter,
  actorNameFor,
  destinationFor,
  displayTitle,
  relativeTime,
  splitBody,
} from "./NotificationCenter";

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
    fireEvent.click(screen.getByRole("button", { name: /mark all read/i }));

    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByTestId("notification-item").every((el) => el.dataset.read === "true")).toBe(true),
    );
    expect(screen.queryByTestId("notification-badge")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark all read/i })).toBeDisabled();
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

describe("All / Unread filter", () => {
  // The filter is a VIEW over the store, not a fetch: the server's list and order are untouched.
  it("shows everything under All and only unread under Unread", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({
      notifications: [notification({ id: "unread", title: "Unread one" }), notification({ id: "read", title: "Read one", readAt: "2026-09-08T00:00:00Z" })],
      unreadCount: 1,
    });
    await open();
    expect(screen.getAllByTestId("notification-item")).toHaveLength(2);

    fireEvent.click(screen.getByRole("tab", { name: "Unread" }));
    const shown = screen.getAllByTestId("notification-item");
    expect(shown).toHaveLength(1);
    expect(shown[0].dataset.read).toBe("false");

    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    expect(screen.getAllByTestId("notification-item")).toHaveLength(2);
    expect(fetchNotifications).toHaveBeenCalledTimes(1); // no refetch — filtering is local
  });

  it("uses the shared tab bar's roles, with All selected first", async () => {
    await open();
    expect(screen.getByRole("tablist", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Unread" })).toHaveAttribute("aria-selected", "false");
  });

  it("still marks read and navigates from a row shown under Unread", async () => {
    const onNavigate = vi.fn().mockReturnValue(true);
    await open({ onNavigate });
    fireEvent.click(screen.getByRole("tab", { name: "Unread" }));
    fireEvent.click(screen.getByTestId("notification-item"));
    expect(markNotificationRead).toHaveBeenCalledWith("n1");
    expect(onNavigate).toHaveBeenCalledWith({ kind: "profileFeed", email: "alex@example.com", postId: "p1" });
  });

  it("has its own empty copy for a caught-up Unread tab", async () => {
    vi.mocked(fetchNotifications).mockResolvedValue({
      notifications: [notification({ readAt: "2026-09-08T00:00:00Z" })],
      unreadCount: 0,
    });
    await open();
    fireEvent.click(screen.getByRole("tab", { name: "Unread" }));
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });
});

describe("screen-owning behaviour", () => {
  // Notifications is a dock TOOL: the caller feeds onOpenChange into officeToolOpen, which is
  // what hides the dock, the Toucan and the minimized chat-head rail — and restores them.
  it("reports open and closed so the caller can hide and restore the dock chrome", async () => {
    const onOpenChange = vi.fn();
    render(<NotificationCenter onOpenChange={onOpenChange} />);
    await waitFor(() => expect(fetchNotifications).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: /close notifications/i }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument();
  });

  it("keeps the panel open for a click inside it, even though it is portaled out of the dock", async () => {
    await open();
    fireEvent.pointerDown(screen.getByTestId("notification-panel"));
    expect(screen.getByTestId("notification-panel")).toBeInTheDocument();
    // The scrim is outside the panel, so a press there still dismisses.
    fireEvent.pointerDown(screen.getByTestId("notification-backdrop"));
    expect(screen.queryByTestId("notification-panel")).not.toBeInTheDocument();
  });
});

describe("row presentation", () => {
  it("shows the reward line as the shared RewardTag instead of body text", async () => {
    await open();
    const tag = screen.getByTestId("reward-tag");
    expect(tag).toHaveTextContent("+75 XP");
    expect(tag).toHaveTextContent("+20");
    // The amounts are no longer duplicated as plain text in the body.
    expect(screen.getByTestId("notification-item").textContent).not.toContain("+75 XP · +20 Coins");
  });

  it("renders the real employee portrait the caller resolves, and copes without one", async () => {
    const resolvePortrait = vi.fn().mockReturnValue("/portraits/angelo.png");
    await open({ resolvePortrait });
    expect(document.querySelector("img[src='/portraits/angelo.png']")).toBeInTheDocument();
    expect(resolvePortrait).toHaveBeenCalledWith(expect.objectContaining({ id: "n1" }));

    fireEvent.keyDown(document, { key: "Escape" });
    resolvePortrait.mockReturnValue(null);
    fireEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(document.querySelector("img[src='/portraits/angelo.png']")).not.toBeInTheDocument();
    expect(screen.getByTestId("notification-item")).toBeInTheDocument();
  });
});

describe("presentational parsing", () => {
  it("drops a leading emoji from the title, since the row leads with a production icon", () => {
    expect(displayTitle("🏆 You received Kudos!")).toBe("You received Kudos!");
    expect(displayTitle("You received Kudos!")).toBe("You received Kudos!");
    // Never returns nothing: an all-emoji title keeps its original text.
    expect(displayTitle("🏆")).toBe("🏆");
  });

  it("splits the server's reward line off the body, and leaves anything else alone", () => {
    expect(splitBody("Bon: “Nice”\n+75 XP · +20 Coins")).toEqual({
      text: "Bon: “Nice”",
      reward: { xp: 75, coins: 20 },
    });
    expect(splitBody("Bon gave you Kudos.")).toEqual({ text: "Bon gave you Kudos.", reward: null });
    expect(splitBody(null)).toEqual({ text: null, reward: null });
    // A single line that happens to look like a reward line is still the whole body.
    expect(splitBody("+75 XP · +20 Coins")).toEqual({ text: "+75 XP · +20 Coins", reward: null });
  });

  it("reads the actor's name out of the copy the server rendered", () => {
    expect(actorNameFor(notification())).toBe("Bon");
    expect(actorNameFor(notification({ body: "Angelo gave you Kudos." }))).toBe("Angelo");
    expect(actorNameFor(notification({ body: null }))).toBeNull();
    expect(actorNameFor(notification({ body: "Something with no name" }))).toBeNull();
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
