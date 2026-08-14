# backend

FastAPI service for the Virtual Office DB foundation (avatars + chat persistence). Mirrors the
OffshorlyLMS backend's async SQLAlchemy + Alembic pattern: SQLite for local dev, Render-managed
Postgres in production.

Identity is plain email strings throughout (`owner_email`, `sender_email`, `participant_email`).
There is **no users table** here — Atlas remains the source of truth for users, presence, rooms,
and people. This service only persists avatars and chat conversations/messages, keyed by email.

Scope today is DB foundation only: SQLAlchemy models + an Alembic migration, and a minimal
FastAPI app (`GET /health`). No routers/API endpoints are wired up yet.

## Stack

- FastAPI + Uvicorn
- SQLAlchemy 2.x (async) — `aiosqlite` locally, `asyncpg` in production
- Alembic for migrations (runs over a *sync* driver — psycopg2/sqlite — see `alembic/env.py`)
- Pydantic Settings for config (`.env` file)

## Local setup

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows (Git Bash: source .venv/Scripts/activate)
pip install -r requirements.txt
cp .env.example .env           # defaults already point at local SQLite
```

## Running migrations

```bash
# Apply all migrations (creates ./virtual_office.db locally on first run)
alembic upgrade head

# After changing a model under app/models/, generate a new migration:
alembic revision --autogenerate -m "describe the change"
# Review the generated file under alembic/versions/, then:
alembic upgrade head
```

## Running the app

```bash
uvicorn app.main:app --reload
# GET http://localhost:8000/health -> {"status": "ok"}
```

## Env vars (see `.env.example`)

| Var | Purpose |
| --- | --- |
| `APP_NAME` | Display name, default "Virtual Office" |
| `APP_ENV` | `development` \| `production` |
| `DEBUG` | Verbose logging toggle |
| `SECRET_KEY` | Reserved for future auth/signing needs |
| `DATABASE_URL` | `sqlite+aiosqlite:///./virtual_office.db` locally; Render Postgres connection string in prod (`postgresql://...`, auto-upgraded to `+asyncpg` at runtime and `+psycopg2` for Alembic — see `app/database.py` / `alembic/env.py`) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `FRONTEND_URL` | Frontend base URL |

## Schema

- **avatars** — one row per `SavedAvatar` (frontend `services/avatar/types.ts`): `avatar_id`
  (unique, the frontend `GeneratedAvatar.avatarId`), `owner_email` (nullable — colleague avatars
  generated on someone else's behalf have no owner), `nickname`, `employee_name`, `outfit_id`,
  `room_id`, `preview_url`, `confidence`, `seed`, `generated_at`/`saved_at` (ISO strings as sent by
  the frontend), `generation_status` (`pending`/`ready`/`error`, nullable), `job_id` (nullable),
  `sprite_set` (JSON — the optional 24-slot walk/idle/pat/sitType sprite set).
- **conversations** — `last_message_at`.
- **conversation_participants** — join table: `conversation_id` (FK), `participant_email`, unique
  on the pair.
- **messages** — `conversation_id` (FK), `sender_email`, `text`, `sent_at` (indexed).

Deployed on Render per the root `render.yaml` (`rootDir: backend`, `alembic upgrade head` runs
before `uvicorn` on every deploy).

## Legacy Node chat backend (pending Python port)

There is also a Node/Express/Socket.IO chat backend under `backend/src/`
from an earlier iteration — it is being ported to Python on top of this
FastAPI service. Do not delete `backend/src/` or its `package.json` without
confirming with Bon first; keep it working until the Python port is built
and approved. See the legacy docs below for how it currently runs.

<details>
<summary>Legacy Node backend README (pre-port)</summary>

Real Phase 3 chat backend: Node + TypeScript + Express + Socket.IO, backed
by plain Postgres (`db/`). No Redis pub/sub, no BullMQ, no Prisma, no
Firebase — single-instance is fine at this scale, and identity is verified
by proxying to Atlas's own `/api/v1/auth/me` rather than checking JWT
signatures locally (Atlas owns the signing key).

`frontend/scripts/avatar-pipeline/gen-server.mjs` and `review-server.mjs`
remain local dev-only tooling under `frontend/` — unrelated to this service.

## Identity

Every request/socket connection is verified against Atlas, not trusted from
the client:

- REST: `Authorization: Bearer <token>` → `verifyAtlasToken` calls
  `${ATLAS_API_URL}/api/v1/auth/me` and extracts `email` from the response.
  Successful verifications are cached in-memory for ~60s per token so an
  active session doesn't hammer Atlas on every request/socket event.
- Socket.IO: same verification in the handshake middleware, using
  `handshake.auth.token`.
- Chat identity throughout is the user's **lowercased email** — never a
  sprite/layer id. A client can never claim to be someone else: every
  write (`send_message`, REST `POST`s) uses the server-verified email as
  the actor, ignoring anything the client sends for "who am I".

### Dev-only bypass

When `NODE_ENV !== "production"`, requests/sockets may supply an
`x-dev-email` header/query param (`auth: { "x-dev-email": "..." }` for
sockets) instead of a real Atlas bearer token, so two browser
profiles/tabs can test chat locally without live Atlas credentials. This
bypass is hard-gated: the code path that reads `x-dev-email` is only
reachable when `config.isProduction` is `false` — in production it always
returns `null` and falls through to real Atlas verification, no matter
what a client sends.

## Local development

```bash
cd backend
npm install
cp .env.example .env   # fill in DATABASE_URL (a local/dev Postgres) at minimum
npm run migrate         # applies db/migrations/*.sql (idempotent)
npm run dev              # tsx watch, listens on PORT (default 4800)
```

Run the test suite:

```bash
npm test
```

## REST API (all routes except `/healthz` require auth)

- `POST /conversations` `{ peerEmail }` → upserts + returns the DM
  `Conversation` between the caller and `peerEmail`.
- `GET /conversations` → the caller's `Conversation[]`.
- `GET /conversations/:id/messages?since=&before=&limit=` → `ChatMessage[]`
  for that conversation (403 if the caller isn't a participant).
- `POST /conversations/:id/read` `{ upToSentAt }` → marks read up to that
  timestamp, returns `{ unreadCount }`.

## Socket.IO events

Handshake: `io(url, { auth: { token: "<atlas bearer token>" } })`.

Client → server:
- `join_conversation` `{ conversationId }`
- `send_message` `{ conversationId, text, clientTempId }`
- `message_read` `{ conversationId, upToSentAt }`

Server → client:
- `message_saved` `{ clientTempId, message }` — ack to the sender only.
- `incoming_message` `{ message }` — to every other participant in the room.
- `unread_count` `{ conversationId, count }` — to the reading user's other
  connected sockets.
- `chat_error` `{ code, message }` — validation/authz failures, instead of
  throwing uncaught inside a handler.

## Deploy (manual — not automated by this repo)

This is a stateful Socket.IO server, so it needs an actual **Render Web
Service** (not the frontend's Static Site — see `../DEPLOY.md`, a static
bundle cannot host sockets). Provisioning is Bon's manual step:

1. Create a new Render **Web Service** pointed at this repo, Root Directory
   `backend`, Build Command `npm ci && npm run build`, Start Command
   `npm start`.
2. Provision a managed Postgres instance (Render Postgres or otherwise) and
   set `DATABASE_URL` on the Web Service to its connection string. Run
   `npm run migrate` once against it (e.g. via a one-off Render job or
   locally with `DATABASE_URL` pointed at the remote instance).
3. Set env vars: `ATLAS_API_URL` (Atlas's real API base), `PORT` (Render
   sets this automatically — `config.ts` reads `process.env.PORT`),
   `CORS_ORIGIN` = the Atlas-proxied frontend origin(s)
   (e.g. `https://atlas.offshorly.com`), `NODE_ENV=production` (this is
   what hard-gates off the dev-email bypass — do not skip it).
4. Frontend: set `VITE_CHAT_MODE=real` and `VITE_CHAT_SOCKET_URL` to this
   service's `https://<service>.onrender.com` URL, then rebuild/redeploy
   the frontend static site (env is inlined at build time, same caveat as
   `VITE_API_URL` in `../DEPLOY.md`). In production this URL is reached
   over `wss://` (Socket.IO negotiates this automatically over an
   `https://` base) — do not point it at a plain `http://` origin in prod.

No cloud infrastructure is provisioned by this repo/PR — the above is a
checklist for Bon's manual dashboard work, not something `npm run build`
does for you.

</details>

