#!/usr/bin/env bash
# FILM RIG ONLY — the isolated backend for the LinkedIn teaser takes (frontend/scripts/film/).
#
# Its own SQLite file (dev_film.db, gitignored by *.db), its own port (:8003) and its own CORS
# origin (:5175). It never reads or writes:
#   - production (Render Postgres) — DATABASE_URL is forced to the local file below,
#   - the mock/acceptance rig (:8002, dev_hub_playground.db),
#   - Atlas — ATLAS_API_URL is pointed at a closed local port, so any stray Atlas call fails
#     locally instead of reaching atlas-api.offshorly.com.
# MOCK_HUB_SEED is deliberately NOT set: the [DEV] Hub dataset is test copy and must not appear
# on camera. Film content is created through the real Hub API by frontend/scripts/film/seed.mjs.
#
# Environment variables beat backend/.env (pydantic-settings), so LiveKit / OpenAI / weather keys
# still come from .env — the real services the product uses — while the data stays in this file.
set -euo pipefail
cd "$(dirname "$0")"

export APP_ENV=development
export DATABASE_URL="sqlite+aiosqlite:///./dev_film.db"
export CORS_ORIGINS="http://localhost:5175,http://127.0.0.1:5175"
export FRONTEND_URL="http://localhost:5175"
export ATLAS_API_URL="http://127.0.0.1:9"
unset MOCK_HUB_SEED

.venv/bin/alembic upgrade head

exec .venv/bin/uvicorn app.main:app --port 8003
