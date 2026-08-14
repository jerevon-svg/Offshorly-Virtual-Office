from __future__ import annotations
import logging
import ssl
from typing import AsyncGenerator
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool, StaticPool
from app.config import settings

_logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def get_database_url() -> str:
    url = settings.DATABASE_URL
    if url.startswith("sqlite://"):
        url = url.replace("sqlite://", "sqlite+aiosqlite://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def _is_sqlite() -> bool:
    return settings.DATABASE_URL.startswith("sqlite")


def _is_sqlite_memory() -> bool:
    return _is_sqlite() and ":memory:" in settings.DATABASE_URL


def _set_sqlite_pragmas(engine) -> None:
    """File-based SQLite is shared across multiple connections under concurrent requests (unlike
    the in-memory test DB, which is fundamentally single-connection). Without a busy timeout,
    concurrent writers hit `database is locked` immediately instead of waiting briefly for the
    other writer's transaction to finish; WAL mode lets readers proceed without blocking on a
    writer."""

    @event.listens_for(engine.sync_engine, "connect")
    def _do_connect(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


_engine_kwargs: dict = {"echo": False}

if _is_sqlite():
    _engine_kwargs.update({"connect_args": {"check_same_thread": False}})
    # In-memory SQLite is single-connection by nature — StaticPool (one shared connection) is
    # required there or the DB disappears between connections. The real file-based dev DB, by
    # contrast, needs a real connection per session (NullPool) so concurrent requests don't
    # serialize on one shared connection/cursor.
    _engine_kwargs["poolclass"] = StaticPool if _is_sqlite_memory() else NullPool
else:
    # Sized down for the free-tier Postgres instance: no managed connection
    # pooling is available on this plan, and max_connections is derived from
    # the instance's small RAM (exact figure not published by Render).
    # `alembic upgrade head` in the deploy startCommand opens its own
    # short-lived connection before uvicorn boots, so headroom must be left
    # for it. If the database is later upgraded to a paid plan
    # (basic-256mb or above), these can go back up — LMS uses 5/10 on paid.
    # Note: uvicorn currently runs single-process (no --workers flag in
    # render.yaml startCommand); adding workers would multiply these
    # numbers per worker.
    _pg_kwargs: dict = {"pool_pre_ping": True, "pool_size": 3, "max_overflow": 2}
    if "render.com" in settings.DATABASE_URL:
        _ssl_ctx = ssl.create_default_context()
        _ssl_ctx.check_hostname = False
        _ssl_ctx.verify_mode = ssl.CERT_NONE
        _pg_kwargs["connect_args"] = {"ssl": _ssl_ctx}
    _engine_kwargs.update(_pg_kwargs)

engine = create_async_engine(get_database_url(), **_engine_kwargs)

if _is_sqlite():
    _set_sqlite_pragmas(engine)

async_session_maker = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False, autocommit=False, autoflush=False
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    await engine.dispose()
