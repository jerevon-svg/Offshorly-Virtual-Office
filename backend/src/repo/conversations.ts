import { query } from "../db.js";

export interface Conversation {
  id: string;
  participantIds: string[];
  lastMessageAt: string;
  // Only populated by listConversationsForUser (it's derived per-requester —
  // see unreadCount below). Absent on conversations returned by
  // getConversationById/upsertConversation, which have no "requesting user"
  // to derive it against.
  unreadCount?: number;
}

// Same deterministic scheme the client-side mock uses
// (frontend/src/services/chat/MockChatService.ts), just keyed on emails.
export function conversationId(a: string, b: string): string {
  return `conv-${[a.toLowerCase(), b.toLowerCase()].sort().join("__")}`;
}

// Upserts a conversation + both participant rows for a DM between two
// emails. Idempotent — safe to call every time a chat is opened.
export async function upsertConversation(emailA: string, emailB: string): Promise<Conversation> {
  const a = emailA.toLowerCase();
  const b = emailB.toLowerCase();
  const id = conversationId(a, b);
  const now = new Date().toISOString();

  await query(
    `INSERT INTO conversations (id, last_message_at)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [id, now],
  );

  await query(
    `INSERT INTO conversation_participants (conversation_id, user_id)
     VALUES ($1, $2), ($1, $3)
     ON CONFLICT (conversation_id, user_id) DO NOTHING`,
    [id, a, b],
  );

  const conv = await getConversationById(id);
  if (!conv) throw new Error(`Failed to upsert conversation ${id}`);
  return conv;
}

export async function getConversationById(id: string): Promise<Conversation | null> {
  const convRes = await query<{ id: string; last_message_at: string }>(
    `SELECT id, last_message_at FROM conversations WHERE id = $1`,
    [id],
  );
  if (convRes.rows.length === 0) return null;

  const participantsRes = await query<{ user_id: string }>(
    `SELECT user_id FROM conversation_participants WHERE conversation_id = $1`,
    [id],
  );

  return {
    id: convRes.rows[0].id,
    lastMessageAt: convRes.rows[0].last_message_at,
    participantIds: participantsRes.rows.map((r) => r.user_id),
  };
}

// All conversations a given email participates in, most-recently-active
// first. Each row also carries `unreadCount` — the same derivation
// `unreadCount()` below computes standalone for the read-receipt response,
// inlined here as a correlated subquery so listing conversations doesn't
// fan out into one extra round-trip per conversation.
export async function listConversationsForUser(email: string): Promise<Conversation[]> {
  const self = email.toLowerCase();
  const res = await query<{
    id: string;
    last_message_at: string;
    user_ids: string[];
    unread_count: string;
  }>(
    `SELECT c.id, c.last_message_at, array_agg(cp2.user_id) AS user_ids,
       (
         SELECT count(*)
         FROM messages m
         WHERE m.conversation_id = c.id
           AND m.sender_id <> $1
           AND (cp.last_read_at IS NULL OR m.sent_at > cp.last_read_at)
       ) AS unread_count
     FROM conversations c
     JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1
     JOIN conversation_participants cp2 ON cp2.conversation_id = c.id
     GROUP BY c.id, c.last_message_at, cp.last_read_at
     ORDER BY c.last_message_at DESC`,
    [self],
  );

  return res.rows.map((row) => ({
    id: row.id,
    lastMessageAt: row.last_message_at,
    participantIds: row.user_ids,
    unreadCount: Number(row.unread_count),
  }));
}

export async function isParticipant(conversationId: string, email: string): Promise<boolean> {
  const res = await query(
    `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, email.toLowerCase()],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function touchConversation(conversationId: string, sentAt: string): Promise<void> {
  await query(`UPDATE conversations SET last_message_at = $2 WHERE id = $1`, [conversationId, sentAt]);
}

export async function markRead(conversationId: string, email: string, upToSentAt: string): Promise<void> {
  await query(
    `UPDATE conversation_participants SET last_read_at = $3
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, email.toLowerCase(), upToSentAt],
  );
}

// Derived, not stored — see db/README.md.
export async function unreadCount(conversationId: string, email: string): Promise<number> {
  const self = email.toLowerCase();
  const res = await query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM messages m
     JOIN conversation_participants cp
       ON cp.conversation_id = m.conversation_id AND cp.user_id = $2
     WHERE m.conversation_id = $1
       AND m.sender_id <> $2
       AND (cp.last_read_at IS NULL OR m.sent_at > cp.last_read_at)`,
    [conversationId, self],
  );
  return Number(res.rows[0]?.count ?? 0);
}
