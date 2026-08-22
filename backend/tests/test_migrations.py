from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

# The rest of the test suite builds schema straight from Base.metadata (see conftest.py's
# db_session fixture) — migrations aren't otherwise exercised by any test. This runs the real
# Alembic upgrade/downgrade path against a scratch on-disk SQLite DB so a broken revision chain
# or a bad batch_alter_table would actually fail CI, not just look fine in prod.

pytestmark = pytest.mark.asyncio


BACKEND_DIR = Path(__file__).resolve().parent.parent


async def test_alembic_upgrade_head_then_downgrade_one_round_trips_cleanly(tmp_path, monkeypatch):
    # `app.config.settings` is a module-level singleton instantiated at import time — env.py
    # reads settings.DATABASE_URL directly, so monkeypatching the env var alone wouldn't take
    # effect on an already-imported process. Patch the singleton's attribute instead.
    from app.config import settings

    db_path = tmp_path / "scratch_migrations.db"
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))

    command.upgrade(cfg, "head")
    command.downgrade(cfg, "-1")
    command.upgrade(cfg, "head")
