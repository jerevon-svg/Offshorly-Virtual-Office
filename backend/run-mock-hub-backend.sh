#!/usr/bin/env bash
# MOCK-RIG ONLY — the backend half of the localhost:5174 mock environment.
#
# Runs the SAME FastAPI app as the ordinary local backend, but pinned to its own database file,
# its own port, and the one env var that turns on Company Hub mock seeding. Nothing here is
# read by a deploy: render.yaml starts uvicorn directly and never sources this script.
#
# Isolation, explicitly:
#   * DATABASE_URL  -> ./dev_hub_playground.db, a separate sqlite file. The ordinary local
#                      backend's ./virtual_office_fastapi.db is never opened by this process,
#                      and Atlas (its own service, its own Postgres, :8000) is not involved at
#                      all — this app only ever CALLS Atlas to verify a bearer token, and the
#                      mock rig authenticates with the dev x-dev-email header instead.
#   * MOCK_HUB_SEED -> only this process seeds [DEV] Hub content (see app/main.py's
#                      _seed_mock_hub_content and app/scripts/seed_dev_hub_content.py). Leave it
#                      unset everywhere else and no mock row can be written.
#   * PORT 8002     -> distinct from the ordinary local backend (:8001) and Atlas (:8000), so
#                      both can run side by side and the mock frontend can point at exactly one.
#
# Pair with:  cd ../frontend && npm run dev:mock     (serves the mock frontend on :5174)
set -euo pipefail
cd "$(dirname "$0")"

export APP_ENV=development
export DATABASE_URL="sqlite+aiosqlite:///./dev_hub_playground.db"
export MOCK_HUB_SEED=1
export CORS_ORIGINS="http://localhost:5174,http://127.0.0.1:5174"

exec .venv/bin/uvicorn app.main:app --reload --port 8002
