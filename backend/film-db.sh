#!/usr/bin/env bash
# FILM RIG ONLY — snapshot / restore the isolated film database (dev_film.db) between takes.
#
# Some real actions can only happen once per person (a birthday wish, a Kudos, a claimed quest), so a
# second take of those shots needs the film DB put back exactly as it was. This copies ONLY the film
# files in this folder; it never touches dev_hub_playground.db, virtual_office_fastapi.db, production
# or Atlas.
#
#   ./film-db.sh snapshot   # dev_film.db → dev_film.pristine.db (SQLite online backup; safe while running)
#   ./film-db.sh restore    # stop the :8003 film backend, dev_film.pristine.db → dev_film.db, start it again
#   ./film-db.sh fresh      # stop the film backend, delete dev_film.db, start it (alembic builds an empty one)
#                           # then: node ../frontend/scripts/film/seed.mjs && ./film-db.sh snapshot
#
# After a restore, reload the hero page (any director shot does this through its attendance step).
set -euo pipefail
cd "$(dirname "$0")"
DB=dev_film.db
SNAP=dev_film.pristine.db

case "${1:-}" in
  snapshot)
    .venv/bin/python - "$DB" "$SNAP" <<'PY'
import sqlite3, sys
src, dst = sqlite3.connect(sys.argv[1]), sqlite3.connect(sys.argv[2])
src.backup(dst); dst.close(); src.close()
print(f"snapshot: {sys.argv[1]} -> {sys.argv[2]}")
PY
    ;;
  restore)
    [ -f "$SNAP" ] || { echo "no $SNAP — run: ./film-db.sh snapshot"; exit 1; }
    # only the film backend: the uvicorn listening on :8003 (never :8001 / :8002 / :8000)
    PIDS=$(lsof -tiTCP:8003 -sTCP:LISTEN || true)
    [ -n "$PIDS" ] && kill $PIDS && sleep 2
    rm -f "$DB-wal" "$DB-shm"
    cp "$SNAP" "$DB"
    nohup ./run-film-backend.sh > film-backend.log 2>&1 &
    for i in $(seq 1 30); do curl -sf http://127.0.0.1:8003/health >/dev/null && break; sleep 1; done
    echo "restore: $SNAP -> $DB, film backend back on :8003"
    ;;
  fresh)
    PIDS=$(lsof -tiTCP:8003 -sTCP:LISTEN || true)
    [ -n "$PIDS" ] && kill $PIDS && sleep 2
    rm -f "$DB" "$DB-wal" "$DB-shm"
    nohup ./run-film-backend.sh > film-backend.log 2>&1 &
    for i in $(seq 1 40); do curl -sf http://127.0.0.1:8003/health >/dev/null && break; sleep 1; done
    echo "fresh: empty $DB, film backend back on :8003"
    ;;
  *) echo "usage: $0 snapshot|restore|fresh"; exit 2 ;;
esac
