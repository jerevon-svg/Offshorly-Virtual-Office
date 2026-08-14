import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.ATLAS_API_URL ??= "https://atlas-api.test";
process.env.NODE_ENV ??= "test";
process.env.CORS_ORIGIN ??= "http://localhost:5173";

interface FakeConvRow {
  id: string;
  last_message_at: string;
}
interface FakeParticipantRow {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
}
interface FakeMessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  sent_at: string;
}

// In-memory fake for db.ts's `query` — good enough to exercise the SQL
// shape conversations.ts relies on, including the unread-count subquery in
// listConversationsForUser, without a real Postgres instance.
const conversations: FakeConvRow[] = [];
const participants: FakeParticipantRow[] = [];
const messages: FakeMessageRow[] = [];
let seq = 0;

function fakeQuery(text: string, params: unknown[] = []) {
  if (text.startsWith("SELECT c.id, c.last_message_at, array_agg(cp2.user_id) AS user_ids")) {
    const self = params[0] as string;
    const myConvIds = participants.filter((p) => p.user_id === self).map((p) => p.conversation_id);
    const rows = conversations
      .filter((c) => myConvIds.includes(c.id))
      .map((c) => {
        const myRow = participants.find((p) => p.conversation_id === c.id && p.user_id === self)!;
        const userIds = participants.filter((p) => p.conversation_id === c.id).map((p) => p.user_id);
        const unread = messages.filter(
          (m) =>
            m.conversation_id === c.id &&
            m.sender_id !== self &&
            (myRow.last_read_at === null || m.sent_at > myRow.last_read_at),
        ).length;
        return {
          id: c.id,
          last_message_at: c.last_message_at,
          user_ids: userIds,
          unread_count: String(unread),
        };
      })
      .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  throw new Error(`Unmocked query: ${text}`);
}

mock.module("../db.js", { exports: { query: fakeQuery } });

const { listConversationsForUser } = await import("./conversations.js");

function seed() {
  conversations.length = 0;
  participants.length = 0;
  messages.length = 0;
  seq = 0;

  conversations.push({ id: "conv-a__b", last_message_at: "2026-01-01T00:00:00.000Z" });
  participants.push(
    { conversation_id: "conv-a__b", user_id: "a@example.com", last_read_at: null },
    { conversation_id: "conv-a__b", user_id: "b@example.com", last_read_at: null },
  );
}

test("listConversationsForUser reports 0 unread with no messages", async () => {
  seed();
  const [conv] = await listConversationsForUser("a@example.com");
  assert.equal(conv.unreadCount, 0);
});

test("listConversationsForUser counts messages from the peer sent after last_read_at", async () => {
  seed();
  messages.push({ id: "m1", conversation_id: "conv-a__b", sender_id: "b@example.com", sent_at: "2026-01-01T00:01:00.000Z" });
  messages.push({ id: "m2", conversation_id: "conv-a__b", sender_id: "b@example.com", sent_at: "2026-01-01T00:02:00.000Z" });
  // A's own message never counts toward A's own unread total.
  messages.push({ id: "m3", conversation_id: "conv-a__b", sender_id: "a@example.com", sent_at: "2026-01-01T00:03:00.000Z" });

  const [convForA] = await listConversationsForUser("a@example.com");
  assert.equal(convForA.unreadCount, 2);

  // B never read A's message (m3) either — B's own unread count reflects
  // that one message from A, not A's two messages to B (which B sent, so
  // they don't count toward B's total).
  const [convForB] = await listConversationsForUser("b@example.com");
  assert.equal(convForB.unreadCount, 1);
});

test("listConversationsForUser excludes messages at or before last_read_at", async () => {
  seed();
  participants.find((p) => p.conversation_id === "conv-a__b" && p.user_id === "a@example.com")!.last_read_at =
    "2026-01-01T00:01:00.000Z";
  messages.push({ id: "m1", conversation_id: "conv-a__b", sender_id: "b@example.com", sent_at: "2026-01-01T00:01:00.000Z" });
  messages.push({ id: "m2", conversation_id: "conv-a__b", sender_id: "b@example.com", sent_at: "2026-01-01T00:02:00.000Z" });

  const [conv] = await listConversationsForUser("a@example.com");
  assert.equal(conv.unreadCount, 1);
});
