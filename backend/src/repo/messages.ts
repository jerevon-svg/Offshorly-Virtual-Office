import { query } from "../db.js";

export interface ChatMessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  sentAt: string;
}

function rowToMessage(row: {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  sent_at: string;
}): ChatMessageRow {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    text: row.body,
    sentAt: row.sent_at,
  };
}

export async function insertMessage(input: {
  conversationId: string;
  senderId: string;
  text: string;
}): Promise<ChatMessageRow> {
  const res = await query<{
    id: string;
    conversation_id: string;
    sender_id: string;
    body: string;
    sent_at: string;
  }>(
    `INSERT INTO messages (conversation_id, sender_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, conversation_id, sender_id, body, sent_at`,
    [input.conversationId, input.senderId.toLowerCase(), input.text],
  );
  return rowToMessage(res.rows[0]);
}

export interface ListMessagesOptions {
  since?: string; // ISO — messages strictly after this
  before?: string; // ISO — messages strictly before this
  limit?: number;
}

export async function listMessages(
  conversationId: string,
  opts: ListMessagesOptions = {},
): Promise<ChatMessageRow[]> {
  const conditions = ["conversation_id = $1"];
  const params: unknown[] = [conversationId];

  if (opts.since) {
    params.push(opts.since);
    conditions.push(`sent_at > $${params.length}`);
  }
  if (opts.before) {
    params.push(opts.before);
    conditions.push(`sent_at < $${params.length}`);
  }

  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  params.push(limit);

  const res = await query<{
    id: string;
    conversation_id: string;
    sender_id: string;
    body: string;
    sent_at: string;
  }>(
    `SELECT id, conversation_id, sender_id, body, sent_at
     FROM messages
     WHERE ${conditions.join(" AND ")}
     ORDER BY sent_at ASC
     LIMIT $${params.length}`,
    params,
  );

  return res.rows.map(rowToMessage);
}
