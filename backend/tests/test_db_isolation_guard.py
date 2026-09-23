"""The suite's database isolation, asserted rather than trusted — see tests/conftest.py."""
from __future__ import annotations

import os

import pytest

from tests.conftest import _TEST_DB_FILE, _is_test_database_url


def test_app_engine_is_on_the_session_test_database():
    from app import database as app_db
    from app.config import settings

    assert _is_test_database_url(settings.DATABASE_URL)
    assert str(app_db.engine.url).endswith(os.path.basename(_TEST_DB_FILE))


@pytest.mark.parametrize(
    "url",
    [
        "sqlite+aiosqlite:///./virtual_office_fastapi.db",
        "sqlite+aiosqlite:///./dev_hub_playground.db",
        "sqlite+aiosqlite:///./virtual_office.db",
        "sqlite+aiosqlite:///./virtual_office_attendance_rig.db",
        "postgresql+asyncpg://user:pw@host/virtual_office",
        "postgresql://user:pw@host/offshorly_reporting",
        "",
    ],
)
def test_real_database_urls_are_never_treated_as_test_databases(url: str):
    assert _is_test_database_url(url) is False


@pytest.mark.parametrize(
    "url",
    ["sqlite+aiosqlite://", "sqlite+aiosqlite:///:memory:", "sqlite+aiosqlite:////tmp/vo_pytest_123.db", "sqlite+aiosqlite:////tmp/x/isolated_test.db"],
)
def test_only_throwaway_urls_qualify(url: str):
    assert _is_test_database_url(url) is True


def test_dot_env_database_is_not_what_the_engine_opened():
    """backend/.env names the developer's real file; the engine must not be on it."""
    from app import database as app_db

    assert "virtual_office_fastapi" not in str(app_db.engine.url)
    assert "dev_hub_playground" not in str(app_db.engine.url)
