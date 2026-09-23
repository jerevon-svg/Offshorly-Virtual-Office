from __future__ import annotations

import os
import tempfile

import pytest

# --- THE TEST SUITE NEVER OPENS A REAL DATABASE. -------------------------------------------------
#
# Settings resolve from backend/.env, and until this block existed the whole suite therefore opened
# the developer's own virtual_office_fastapi.db: every `Base.metadata.create_all(engine)` in a test
# module — and the two `drop_all`s — ran against it. That destroyed real local data more than once
# (see isolated_app_db's history below). Patching fixtures one file at a time left ~45 unpatched.
#
# So the redirect happens HERE, at import, BEFORE `app.config` is first imported anywhere in the
# process: pytest loads conftest.py before any test module, and `settings` is built the moment
# app.config is imported, with the environment outranking .env. Every engine the app builds for the
# rest of the session — `app.database.engine`, the sessionmakers, alembic's env — points at a
# throwaway file. A test's own truncation then cannot reach anything real.
#
# FAIL CLOSED: `_assert_test_database` below runs once per session and stops pytest outright if the
# engine still resolves to anything that is not recognisably a test database — a developer's dev
# file, the acceptance rig's dev_hub_playground.db, or any Postgres URL.
_TEST_DB_FILE = os.path.join(tempfile.gettempdir(), f"vo_pytest_{os.getpid()}.db")
_TEST_DB_URL = f"sqlite+aiosqlite:///{_TEST_DB_FILE}"


def _is_test_database_url(url: str) -> bool:
    """Only in-memory SQLite, this session's own pytest file, or a fixture's isolated_test.db qualify.
    Everything else — named dev files, anything Postgres — is treated as real."""
    if not url.startswith("sqlite+aiosqlite://"):
        return False
    if url == "sqlite+aiosqlite://" or url.endswith(":memory:"):
        return True
    name = url.rsplit("/", 1)[-1]
    return name.startswith("vo_pytest_") or name == "isolated_test.db"


if not _is_test_database_url(os.environ.get("DATABASE_URL", "")):
    os.environ["DATABASE_URL"] = _TEST_DB_URL

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: F401,E402 - registers every model on Base.metadata
from app.database import Base  # noqa: E402


@pytest.fixture(autouse=True, scope="session")
def _assert_test_database():
    """The guard. Refuses to run a single test if the app engine is not on a test database."""
    from app import database as app_db
    from app.config import settings

    engine_url = str(app_db.engine.url)
    if not _is_test_database_url(settings.DATABASE_URL) or not _is_test_database_url(engine_url):
        pytest.exit(
            "REFUSING TO RUN: the application engine is not on a test database "
            f"(settings={settings.DATABASE_URL!r}, engine={engine_url!r}). "
            "Tests create and drop tables on this engine; a dev, rig or production database "
            "must never be behind it. See tests/conftest.py.",
            returncode=3,
        )
    yield
    # The session's throwaway file, gone with the session.
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(_TEST_DB_FILE + suffix)
        except FileNotFoundError:
            pass


@pytest.fixture(autouse=True)
def _no_real_ai_provider(monkeypatch):
    """NO REAL OPENAI CALLS IN AUTOMATED TESTS — enforced here rather than trusted per-file.

    Settings resolve from backend/.env, so a developer machine with a real OPENAI_API_KEY would
    otherwise turn every unfaked unsupported-tail /toucan/ask in the suite into a live network
    request (nondeterministic answers, real cost, and exactly the failure mode the provider's
    test seam exists to prevent). Blank the key for every test; a test that wants the AI lane
    re-enables it explicitly AND fakes provider._request_text (see test_toucan_ai._enable_ai),
    which runs after this fixture and therefore wins."""
    from app.config import settings

    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")


@pytest.fixture
async def db_session():
    """A fresh in-memory SQLite DB per test, independent of the app's configured
    DATABASE_URL/settings — isolates repository-layer tests from any real DB config."""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_maker() as session:
        yield session

    await engine.dispose()


# --- isolated app database ------------------------------------------------------------------
#
# WHY THIS EXISTS. The `db_session` fixture above is properly isolated, but it only helps tests
# that drive a repository directly. Tests that drive the ASGI app or the Socket.IO server cannot
# use it: the code under test reaches for `app.database`'s own engine/sessionmaker, so those
# tests were importing the REAL ones — which resolve from backend/.env to the developer's
# virtual_office_fastapi.db. Their setup fixtures then truncated tables in it. Running the suite
# destroyed real local Toucan history, chat conversations and Hub items.
#
# WHAT THIS FIXTURE DOES. Points the application itself at a throwaway SQLite file for the
# duration of one test, so every session the app opens — through get_db, through socket.py's
# direct async_session_maker() calls — lands in a database that is deleted afterwards. A test's
# own truncation then cannot reach anything real, because nothing real is connected.
#
# WHY PATCHING app.database ALONE IS NOT ENOUGH: `get_db` looks `async_session_maker` up on the
# module at call time, so patching app.database covers every router. But a handful of modules
# did `from app.database import async_session_maker`, which binds the object by value at import
# time — those bindings have to be replaced individually, and _SESSION_MAKER_BINDINGS is that
# list. A module added to that import style later must be added here too, or its writes will
# escape the sandbox.

# (module path, attribute) pairs holding a by-value binding of async_session_maker.
_SESSION_MAKER_BINDINGS = (
    "app.database",
    "app.main",
    "app.realtime.socket",
    "app.scripts.seed_dev_hub_content",
)


@pytest.fixture
async def isolated_app_db(tmp_path, monkeypatch):
    """Redirect the whole application onto a temporary database, then throw it away.

    Yields the engine so a test can create/inspect schema, but the important half is the
    redirection: after this fixture is active, `app.database.engine` and every
    `async_session_maker` binding in the process point at `tmp_path`, and the developer's real
    database is not open anywhere."""
    import importlib

    from app import database as app_db

    db_file = tmp_path / "isolated_test.db"
    test_engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_file}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Same pragmas the app applies to its own SQLite engine (WAL + busy timeout), so concurrent
    # writes from socket handlers behave here the way they do in the real app.
    app_db._set_sqlite_pragmas(test_engine)

    test_session_maker = async_sessionmaker(
        test_engine, class_=AsyncSession, expire_on_commit=False, autocommit=False, autoflush=False
    )

    monkeypatch.setattr(app_db, "engine", test_engine)
    for module_path in _SESSION_MAKER_BINDINGS:
        module = importlib.import_module(module_path)
        if hasattr(module, "async_session_maker"):
            monkeypatch.setattr(module, "async_session_maker", test_session_maker)

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield test_engine

    await test_engine.dispose()
