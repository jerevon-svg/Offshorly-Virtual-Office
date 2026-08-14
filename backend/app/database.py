from __future__ import annotations
import logging
import ssl
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool
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


_engine_kwargs: dict = {"echo": False}

if _is_sqlite():
    _engine_kwargs.update({"connect_args": {"check_same_thread": False}, "poolclass": StaticPool})
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
