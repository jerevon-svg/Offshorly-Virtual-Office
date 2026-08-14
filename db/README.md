# db

Real database now exists: SQLAlchemy models + Alembic migrations live under `backend/app/models/`
and `backend/alembic/`, mirroring the OffshorlyLMS backend pattern (async SQLAlchemy, SQLite for
local dev, Render-managed Postgres in production). See `backend/README.md` for setup/commands.

Identity is plain email strings (`owner_email`, `sender_email`, `participant_email`) — there is
**no users table**. Atlas remains the source of truth for users, presence, rooms, and people; this
database only persists avatars and chat data, keyed by email.

## Tables

- `avatars` — persisted `SavedAvatar` records (frontend `services/avatar/types.ts`).
- `conversations` / `conversation_participants` / `messages` — chat persistence (frontend
  `services/chat/types.ts`).

## Still client-side / external

- Auth + presence + rooms + people: external Atlas API.
- Mocked Zoho integration: `frontend/src/services/zoho/MockZohoService.ts`.
- Anything not yet migrated off `localStorage` (e.g. `frontend/src/data/checkoutStorage.ts`).

This folder stays as documentation only — the actual schema/migrations live under `backend/`
so Alembic and the app can both reach them without a path juggle.
