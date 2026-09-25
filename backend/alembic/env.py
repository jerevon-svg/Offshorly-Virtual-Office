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
    """Emit SQL to stdout without a live DB connection (`alembic upgrade --sql`).

    NOTE: `schema_translate_map` is a `Connection.execution_options()` concept — it is applied by
    SQLAlchemy's compiler when a statement is executed/compiled *through a live connection*. There
    is no live connection here (offline mode only renders SQL text), and
    `EnvironmentContext.configure()` has no `schema_translate_map` parameter of its own (passing one
    is silently absorbed into `**kw` and does nothing — this was the actual bug in the online path,
    now fixed below). As a result, `alembic upgrade --sql` output is NOT schema-qualified for VO;
    every `op.create_table(...)` call renders unqualified, landing in whatever schema the target
    database's `search_path` defaults to. This is a known, accepted gap: `render.yaml`'s deploy
    command runs `alembic upgrade head` (the online path, which IS correctly schema-isolated below),
    not `--sql`/offline generation. Do not add `schema_translate_map=...` back here — it is not a
    real option and would silently do nothing while looking like it works.
    """
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        render_as_batch=_is_sqlite,
        version_table_schema=_target_schema,
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
            # `SET search_path` makes *unqualified* names resolve to `virtual_office` for
            # everything the Postgres server itself resolves by name — both new objects (an
            # unqualified `CREATE TABLE`/`CREATE INDEX` lands in the first schema on the path) and
            # existing ones (an unqualified `ALTER TABLE ...`/reflection query for a table not
            # found in the path's earlier entries resolves against it). This is required in
            # addition to `schema_translate_map` below: Alembic's own ALTER-family DDL constructs
            # (`AddColumn`, `DropColumn`, `AlterColumn`/column type/nullable/default/rename,
            # `RenameTable` — see `alembic/ddl/base.py`) build raw `"ALTER TABLE %s" % name` SQL
            # strings via `format_table_name()`, which only qualifies with a schema `if schema:` is
            # truthy — it never consults `schema_translate_map` at all (that mechanism only kicks in
            # for real SQLAlchemy `Table`-object DDL, e.g. `CREATE TABLE`/`DROP TABLE`). Verified
            # against live Postgres: without this, `op.add_column`/batch `ADD COLUMN` compiled to an
            # unqualified `ALTER TABLE conversation_participants ...` and failed with
            # `UndefinedTable`, even though `schema_translate_map` was correctly applied to the
            # connection and `CREATE TABLE` calls for the same table landed in `virtual_office` fine.
            connection.execute(text(f"SET search_path TO {_target_schema}"))
            # `SET search_path` above opens its own implicit transaction on this connection
            # (SQLAlchemy 2.0 "autobegin"); it must be explicitly committed here too, just like the
            # `CREATE SCHEMA` above. Leaving it open would make Alembic's own
            # `context.begin_transaction()` below nest inside it as a SAVEPOINT instead of owning
            # the outer transaction — and `with connectable.connect() as connection:` rolls back any
            # transaction left open at `connection.close()` time, silently discarding every
            # migration Alembic just ran with no error at all. (Verified against live Postgres:
            # omitting this `commit()` made `alembic upgrade head` log all 31 revisions successfully,
            # then leave the database completely untouched — zero tables anywhere, not even in
            # `public`.)
            connection.commit()

        if _schema_translate_map is not None:
            # `schema_translate_map` is NOT a real `EnvironmentContext.configure()` kwarg — it is a
            # `Connection.execution_options()` concept from SQLAlchemy that the compiler consults
            # when a statement is executed through *this connection*. Passing it into
            # `context.configure(...)` (as was previously done) is silently absorbed by that
            # method's `**kw` and never reaches the compiler, so every unqualified
            # `op.create_table(...)` call compiled to the DB's default schema (`public`) instead of
            # `virtual_office`. It must be applied to the connection itself, before that connection
            # is handed to `context.configure()`, for every DDL/DML statement Alembic emits on it to
            # actually get schema-translated. Kept alongside `SET search_path` above (not a
            # replacement for it — see that comment) because it still correctly and explicitly
            # qualifies `CREATE TABLE`/`DROP TABLE`-style DDL regardless of search_path, and matches
            # the same mechanism `app/database.py` uses for the app's runtime engine.
            connection = connection.execution_options(schema_translate_map=_schema_translate_map)

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            render_as_batch=_is_sqlite,
            version_table_schema=_target_schema,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
