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
