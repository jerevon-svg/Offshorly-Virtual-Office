# db

Plain SQL migrations for Postgres. No ORM (Prisma explicitly out of scope
for this phase) — migrations are hand-written `.sql` files run in filename
order.

## Schema (Phase 3: chat)

`migrations/001_chat.sql` adds:

- `conversations(id, last_message_at, created_at)` — `id` is deterministic
  from the two participant emails: `` `conv-${[a,b].sort().join("__")}` ``
  (same scheme the client-side mock already used, just keyed on email
  instead of sprite id — see `frontend/src/services/chat/MockChatService.ts`
  and `backend/src/repo/conversations.ts`).
- `conversation_participants(conversation_id, user_id, last_read_at)` —
  `user_id` is the participant's lowercased email.
- `messages(id, conversation_id, sender_id, body, sent_at, created_at)`,
  indexed on `(conversation_id, sent_at)` for cursor-based history queries.

Unread count is NOT a stored counter — it's derived per-request:
`count(*) from messages where conversation_id = $1 and sent_at > $2 and
sender_id <> $3` (participant's `last_read_at` as the cursor). One less
thing to keep in sync.

## Running the migration

Any of these work — pick whichever is already on hand:

```bash
# Directly with psql
psql "$DATABASE_URL" -f db/migrations/001_chat.sql

# Or via the backend's own tiny migration runner (loops over
# db/migrations/*.sql in filename order, idempotent — every statement uses
# IF NOT EXISTS):
cd backend && npm run migrate
```

`backend/src/db.ts` + the `migrate` npm script are the canonical way to run
this in CI/deploy; `psql -f` is the quick local-only path.

This folder is otherwise still just schema + migrations — no seed data, no
generated client code (see `backend/README.md` for the app that talks to
this schema).
