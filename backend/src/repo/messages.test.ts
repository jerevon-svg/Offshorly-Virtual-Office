import { test, mock } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.ATLAS_API_URL ??= "https://atlas-api.test";
process.env.NODE_ENV ??= "test";
process.env.CORS_ORIGIN ??= "http://localhost:5173";

interface FakeRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  sent_at: string;
}

// In-memory fake for db.ts's `query` — good enough to exercise the SQL
// shape messages.ts relies on (WHERE/ORDER/LIMIT semantics) without a real
// Postgres instance.
const rows: FakeRow[] = [];
let seq = 0;

function fakeQuery(text: string, params: unknown[] = []) {
  if (text.startsWith("INSERT INTO messages")) {
    const [conversationId, senderId, body] = params as string[];
    seq += 1;
    const row: FakeRow = {
      id: `msg-${seq}`,
      conversation_id: conversationId,
      sender_id: senderId,
      body,
      sent_at: new Date(Date.now() + seq).toISOString(), // monotonically increasing
    };
    rows.push(row);
    return Promise.resolve({ rows: [row], rowCount: 1 });
  }

  if (text.startsWith("SELECT id, conversation_id, sender_id, body, sent_at")) {
    const conversationId = params[0] as string;
    let idx = 1;
    let since: string | undefined;
    let before: string | undefined;
    if (text.includes("sent_at > $")) since = params[idx++] as string;
    if (text.includes("sent_at < $")) before = params[idx++] as string;
    const limit = params[idx] as number;

    let filtered = rows.filter((r) => r.conversation_id === conversationId);
    if (since) filtered = filtered.filter((r) => r.sent_at > since!);
    if (before) filtered = filtered.filter((r) => r.sent_at < before!);
    filtered.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    return Promise.resolve({ rows: filtered.slice(0, limit), rowCount: filtered.length });
  }

  throw new Error(`Unmocked query: ${text}`);
}

mock.module("../db.js", {
  exports: { query: fakeQuery },
});

const { insertMessage, listMessages } = await import("./messages.js");

test("insertMessage inserts and returns a mapped ChatMessageRow", async () => {
  const msg = await insertMessage({
    conversationId: "conv-a__b",
    senderId: "A@Example.com",
    text: "hello",
  });
  assert.equal(msg.conversationId, "conv-a__b");
  assert.equal(msg.senderId, "a@example.com");
  assert.equal(msg.text, "hello");
  assert.ok(msg.id);
  assert.ok(msg.sentAt);
});

test("listMessages returns messages for a conversation ordered by sentAt", async () => {
  const convId = "conv-x__y";
  const m1 = await insertMessage({ conversationId: convId, senderId: "x@example.com", text: "first" });
  const m2 = await insertMessage({ conversationId: convId, senderId: "y@example.com", text: "second" });

  const list = await listMessages(convId);
  assert.deepEqual(
    list.map((m) => m.text),
    ["first", "second"],
  );
  assert.ok(m1.sentAt < m2.sentAt);
});

test("listMessages respects a since cursor", async () => {
  const convId = "conv-cursor-test";
  const first = await insertMessage({ conversationId: convId, senderId: "a@example.com", text: "old" });
  await insertMessage({ conversationId: convId, senderId: "b@example.com", text: "new" });

  const sinceFirst = await listMessages(convId, { since: first.sentAt });
  assert.deepEqual(
    sinceFirst.map((m) => m.text),
    ["new"],
  );
});
