import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool, text

from alembic import context

# Make the `app` package importable when alembic is invoked from backend/.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.database import Base  # noqa: E402
import app.models  # noqa: E402,F401  — registers every model on Base.metadata

# Alembic Config object (values from alembic.ini).
config = context.config


def _sync_url() -> str:
    """Alembic runs migrations over a *synchronous* driver (psycopg2 / sqlite) to avoid the
    greenlet/async machinery in a CLI context (MissingGreenlet, sqlalche.me/e/20/f405). The
    application itself still uses asyncpg/aiosqlite at runtime — only migrations use sync."""
    url = settings.DATABASE_URL
    if url.startswith("postgresql+asyncpg://"):
        return url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg2://", 1)
    if url.startswith("sqlite+aiosqlite://"):
        return url.replace("sqlite+aiosqlite://", "sqlite://", 1)
    return url


config.set_main_option("sqlalchemy.url", _sync_url())

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# SQLite cannot ALTER columns in place; batch mode rewrites the table instead.
_is_sqlite = _sync_url().startswith("sqlite")

# Virtual Office's Postgres database is shared with Atlas's own audit database (same physical
# instance, same default `public` schema/`alembic_version` row already owned by Atlas). Every VO
# table — and VO's own alembic version-tracking row — must live inside this dedicated schema so
# the two apps' migration histories and tables never collide. SQLite has no schema concept and
# local dev must be completely unaffected, so this is `None` there and every schema-related option
# below becomes a no-op.
_VO_SCHEMA = "virtual_office"
_target_schema = None if _is_sqlite else _VO_SCHEMA
# `None` (the models' own unqualified/default schema) is translated to `virtual_office` at compile
# time for every DDL/DML statement Alembic (and, via app/database.py, the app itself) emits — this
# is what lets the 31 already-shipped migration files keep their historical `op.create_table(...)`
# calls with no schema argument at all, instead of hand-editing each one.
_schema_translate_map = None if _is_sqlite else {None: _VO_SCHEMA}


def run_migrations_offline() -> None:
    """Emit SQL to stdout without a live DB connection (`alembic upgrade --sql`)."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        render_as_batch=_is_sqlite,
        version_table_schema=_target_schema,
        schema_translate_map=_schema_translate_map,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live DB using a synchronous engine."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        if _target_schema is not None:
            # Alembic does not create schemas on its own — do it up front, in its own transaction,
            # before configure()/run_migrations() so the version table and every VO table below
            # have somewhere to land. IF NOT EXISTS keeps re-deploys idempotent.
            connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {_target_schema}"))
            connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            render_as_batch=_is_sqlite,
            version_table_schema=_target_schema,
            schema_translate_map=_schema_translate_map,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
