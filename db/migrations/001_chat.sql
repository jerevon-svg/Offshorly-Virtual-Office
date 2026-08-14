-- Phase 3 chat backend schema.
--
-- Identity is the user's EMAIL (lowercased), not a sprite/layer id — see
-- frontend/src/services/chat/RealChatService.ts and backend/src/auth for why.
--
-- conversation ids are deterministic from the two participant emails, using
-- the same scheme MockChatService.ts already uses client-side
-- (`conv-${[a,b].sort().join("__")}`), just computed server-side from
-- emails instead of sprite ids. That keeps a 1:1 DM's id stable and
-- collision-free without a lookup, and lets the client and server agree on
-- an id for the same pair independently.
--
-- No separate unread-counter table: unread count is a cheap derived query
-- (see backend/src/repo/conversations.ts) — a counter table would just be a
-- second source of truth to keep in sync for a query this simple.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

CREATE TABLE IF NOT EXISTS conversations (
  id text PRIMARY KEY,
  last_message_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id text NOT NULL, -- email, lowercased
  last_read_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id text NOT NULL, -- email, lowercased
  body text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_sent_at
  ON messages (conversation_id, sent_at);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user
  ON conversation_participants (user_id);
