# Running Virtual Office locally

Virtual Office has a Python API in `backend/` and a Vite frontend in
`frontend/`. Atlas supplies login, the roster and the Zoho integration.
For real VO persistence, run four processes: Atlas API and frontend, plus
VO API and frontend. Open the office through Atlas to retain its login origin.

## Prerequisites

- Check out Atlas (`Offshorlyreporting`) and this repository side by side.
- Use Python with a dedicated `backend/.venv` and install `backend/requirements.txt`.
- Use Node satisfying the engines in `frontend/package-lock.json`. The current
  locked jsdom requires `^22.22.2 || ^24.15.0 || >=26.0.0`; Vite requires
  `^20.19.0 || >=22.12.0`. Recheck these when updating the lockfile.
- Ask the Atlas administrator for `can_view_virtual_office` access.
- Obtain required Atlas secrets through the team's password manager. Never put
  secrets in `VITE_*`: those values become public browser code.

## Configure local services

Keep environment files untracked. Use each repository's example files and
local-only credentials; never copy a production database URL into a test setup.

Atlas `frontend/.env.local` needs:

```dotenv
VIRTUAL_OFFICE_URL=http://localhost:5173
```

Follow Atlas's setup instructions for its API on port 8000 and frontend on
port 3000. Its API must allow the browser origin `http://localhost:3000`.

Create this repository's `backend/.env` from `backend/.env.example` if absent,
then use these local settings:

```dotenv
APP_ENV=development
DEBUG=false
DATABASE_URL=sqlite+aiosqlite:///./virtual_office.db
ATLAS_API_URL=http://localhost:8000
CORS_ORIGINS=http://localhost:3000
FRONTEND_URL=http://localhost:3000
```

SQLite suffices for local feature work. It does not prove PostgreSQL schema
isolation; use a disposable local PostgreSQL database for migration regression
checks. Never run migrations against a shared database for local setup.

This repository's `frontend/.env.local`:

```dotenv
VITE_API_URL=http://localhost:8000
VITE_OFFICE_INTEGRATION_MODE=real
VITE_ZOHO_INTEGRATION_MODE=mock
VITE_AVATAR_GENERATION_MODE=mock
VITE_CHAT_MODE=real
VITE_CHAT_SOCKET_URL=http://localhost:4800
VITE_ATTENDANCE_MODE=real
VITE_TOUCAN_MODE=real
# Leave VITE_AUTH_GATE unset when testing Atlas login.
```

Keep Zoho mocked for ordinary development: real mode can write employee time
entries through Atlas. Use real mode only with an explicitly authorized test
account and fixture. Chat, attendance and Toucan use the VO API; the roster
and time-logging use Atlas. Mock attendance does not test server persistence.

## Start the four processes

Start Atlas's API and frontend using that repository's instructions. In a
separate terminal, start the VO API:

```bash
cd Offshorly-Virtual-Office/backend
python3 -m venv .venv  # First setup only; reuse an existing .venv.
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 4800
```

In another terminal, start the VO frontend:

```bash
cd Offshorly-Virtual-Office/frontend
npm ci
npm run dev
```

Log in at `http://localhost:3000`, then open
`http://localhost:3000/virtual-office/`. The Atlas proxy forwards to Vite on
5173 while the browser keeps Atlas's origin and login storage. Opening 5173
directly uses a different origin and does not share the Atlas session.

Restart the relevant process after editing environment or proxy configuration.
Vite variables are build-time settings in production: rebuild after changes.
The development settings above are not a release configuration.

## Standalone visual work

The standalone mock rig needs both the VO backend and frontend, but no Atlas.
With backend dependencies installed as above, start its isolated backend:

```bash
cd Offshorly-Virtual-Office/backend
bash run-mock-hub-backend.sh
```

The script migrates `backend/dev_hub_playground.db`, enables development Hub
seeding, and serves the API on port 8002. In another terminal, run
`npm run dev:mock` from `frontend/` and open
`http://localhost:5174/virtual-office/`.

`frontend/.env.mock` uses mock identity, roster and Zoho integration, with
`VITE_AUTH_GATE=off` for standalone development only. Chat, attendance and
Toucan use real services at port 8002 and persist data in the rig's SQLite
database. Mock identity does not mean disposable or browser-only data; this
rig cannot validate Atlas login or the real Atlas roster/Zoho integration.

## Checks

From `backend/`:

```bash
.venv/bin/python -m pip check
.venv/bin/python -m pytest -q tests/test_migrations.py
.venv/bin/python -m pytest -q
.venv/bin/python -m ruff check app tests alembic
```

The pytest suite enforces an isolated SQLite database. Setting a PostgreSQL
URL does not turn these tests into PostgreSQL tests.

From `frontend/`:

```bash
npm test
npm run lint
npm run build
```

Build output is `frontend/dist/virtual-office/index.html` and its assets.
If the office redirects home, check Atlas login and permission first. If the
wrong office loads, check Atlas's `VIRTUAL_OFFICE_URL` and restart its frontend.
For persistence failures, inspect requests to port 4800 and the VO API logs.

See [DEPLOY.md](DEPLOY.md) for deployment paths and release variables, and
Atlas's `docs/VIRTUAL_OFFICE_PROXY_SPEC.md` and
`docs/OFFICE_TIMELOG_IMPLEMENTATION.md` for integration contracts.
