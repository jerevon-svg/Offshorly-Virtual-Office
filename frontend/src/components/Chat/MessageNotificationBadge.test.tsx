import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MessageNotificationBadge } from "./MessageNotificationBadge";
import type { Conversation } from "../../services/chat/types";

const SELF = "bon@example.com";

function resolveDisplayName(email: string): string {
  return email.split("@")[0];
}

afterEach(() => cleanup());

function dm(overrides: Partial<Conversation>): Conversation {
  return {
    id: "conv-dm",
    participantIds: [SELF, "alex@example.com"],
    lastMessageAt: "2026-08-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("MessageNotificationBadge", () => {
  it("stays visible (persistent Global Chat entry point) even with no unread messages and no conversations", () => {
    render(
      <MessageNotificationBadge
        total={0}
        conversations={[]}
        selfId={SELF}
        resolveDisplayName={resolveDisplayName}
        onSelectConversation={() => {}}
        onNewMessage={() => {}}
        onFindPerson={() => {}}
        onNewGroupChat={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Conversations" })).toBeInTheDocument();
  });

  it("calls onNewMessage/onFindPerson/onNewGroupChat and closes the dropdown when their action rows are clicked", () => {
    const onNewMessage = vi.fn();
    const onFindPerson = vi.fn();
    const onNewGroupChat = vi.fn();

    render(
      <MessageNotificationBadge
        total={0}
        conversations={[]}
        selfId={SELF}
        resolveDisplayName={resolveDisplayName}
        onSelectConversation={() => {}}
        onNewMessage={onNewMessage}
        onFindPerson={onFindPerson}
        onNewGroupChat={onNewGroupChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    fireEvent.click(screen.getByText("+ New Message"));
    expect(onNewMessage).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("+ New Message")).not.toBeInTheDocument(); // dropdown closed

    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    fireEvent.click(screen.getByText("🔍 Find Person"));
    expect(onFindPerson).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    fireEvent.click(screen.getByText("+ New Group Chat"));
    expect(onNewGroupChat).toHaveBeenCalledTimes(1);
  });

  it("lists ALL conversations (including 0-unread and groups), sorted by lastMessageAt descending", () => {
    const conversations: Conversation[] = [
      dm({ id: "conv-old", lastMessageAt: "2026-08-18T10:00:00.000Z", unreadCount: 0 }),
      {
        id: "conv-group",
        participantIds: [SELF, "alex@example.com", "lui@example.com"],
        lastMessageAt: "2026-08-21T10:00:00.000Z",
        type: "group",
        title: "Project Chat",
        unreadCount: 2,
      },
      dm({ id: "conv-new", lastMessageAt: "2026-08-22T10:00:00.000Z", unreadCount: 1 }),
    ];

    render(
      <MessageNotificationBadge
        total={3}
        conversations={conversations}
        selfId={SELF}
        resolveDisplayName={resolveDisplayName}
        onSelectConversation={() => {}}
        onNewMessage={() => {}}
        onFindPerson={() => {}}
        onNewGroupChat={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /unread message/i }));

    const rows = screen.getAllByRole("button").filter((el) => el.className.includes("row"));
    const rowLabels = rows.map((r) => r.textContent);
    // conv-new (newest) first, then conv-group, then conv-old (oldest last)
    expect(rowLabels[0]).toContain("alex");
    expect(rowLabels[1]).toContain("Project Chat");
    expect(rowLabels[2]).toContain("alex");
  });

  it("shows a group's title when present, else joined non-self participant display names", () => {
    const conversations: Conversation[] = [
      {
        id: "conv-group-no-title",
        participantIds: [SELF, "alex@example.com", "lui@example.com"],
        lastMessageAt: "2026-08-21T10:00:00.000Z",
        type: "group",
        title: null,
      },
    ];

    render(
      <MessageNotificationBadge
        total={0}
        conversations={conversations}
        selfId={SELF}
        resolveDisplayName={resolveDisplayName}
        onSelectConversation={() => {}}
        onNewMessage={() => {}}
        onFindPerson={() => {}}
        onNewGroupChat={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    expect(screen.getByText("alex, lui")).toBeInTheDocument();
  });

  it("shows an unread badge/count only when unreadCount > 0", () => {
    const conversations: Conversation[] = [
      dm({ id: "conv-a", unreadCount: 0 }),
      dm({ id: "conv-b", unreadCount: 3, participantIds: [SELF, "lui@example.com"] }),
    ];

    render(
      <MessageNotificationBadge
        total={3}
        conversations={conversations}
        selfId={SELF}
        resolveDisplayName={resolveDisplayName}
        onSelectConversation={() => {}}
        onNewMessage={() => {}}
        onFindPerson={() => {}}
        onNewGroupChat={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /unread message/i }));
    expect(screen.getAllByText("3")).toHaveLength(2); // top-level badge + this row's count
  });

  it("calls onSelectConversation with the full conversation object when a row is clicked", () => {
    const onSelectConversation = vi.fn();
    const conv = dm({ id: "conv-click" });

    render(
      <MessageNotificationBadge
        total={0}
        conversations={[conv]}
        selfId={SELF}
        resolveDisplayName={resolveDisplayName}
        onSelectConversation={onSelectConversation}
        onNewMessage={() => {}}
        onFindPerson={() => {}}
        onNewGroupChat={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
    fireEvent.click(screen.getByText("alex"));

    expect(onSelectConversation).toHaveBeenCalledWith(conv);
  });

  it('renders the "No conversations yet." empty state when the list is empty but the icon is visible', () => {
    // total > 0 with an empty conversations list is a transient edge case
    // (e.g. a stale unread push before the conversation list itself has
    // loaded) — still keeps the icon visible so the dropdown can be opened
    // and show the empty state rather than nothing at all.
    render(
      <MessageNotificationBadge
        total={1}
        conversations={[]}
        selfId={SELF}
        resolveDisplayName={resolveDisplayName}
        onSelectConversation={() => {}}
        onNewMessage={() => {}}
        onFindPerson={() => {}}
        onNewGroupChat={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /unread message/i }));
    expect(screen.getByText("No conversations yet.")).toBeInTheDocument();
  });
});
