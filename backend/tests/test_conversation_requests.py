from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.models.conversation import Conversation
from app.models.request import ConversationRequest

# Model-level coverage for Stage 1 (schema/migration only) of "Ask to Join + Group Conversation".
#
# `uq_pending_request` (D4) is a partial unique index declared on both the Alembic migration and
# ConversationRequest.__table_args__, so the standard `db_session` fixture (conftest.py, which
# builds schema via Base.metadata.create_all) enforces it too. The FK ondelete=SET NULL test below
# still needs `migrated_session` since `db_session` doesn't enable `PRAGMA foreign_keys=ON`.

pytestmark = pytest.mark.asyncio

BACKEND_DIR = Path(__file__).resolve().parent.parent


@pytest.fixture
async def migrated_session(tmp_path, monkeypatch):
    from app.config import settings

    db_path = tmp_path / "scratch_conversation_requests.db"
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite+aiosqlite:///{db_path}")

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")

    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # SQLite ignores FK actions (ondelete=SET NULL/CASCADE) unless foreign_keys is explicitly
    # turned on per-connection — the app's own engine (app/database.py) doesn't set this, so
    # `ondelete` there is effectively DB-schema documentation only. Turn it on here so this test
    # actually exercises the migration's declared ondelete="SET NULL" behavior.
    @event.listens_for(engine.sync_engine, "connect")
    def _enable_fk(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_maker() as session:
        yield session

    await engine.dispose()


async def test_conversation_type_defaults_to_dm(db_session):
    conv = Conversation()
    db_session.add(conv)
    await db_session.commit()

    await db_session.refresh(conv)
    assert conv.type == "dm"
    assert conv.title is None


async def test_conversation_request_insert_with_required_fields_only(migrated_session):
    req = ConversationRequest(kind="join_group", requester_email="a@example.com")
    migrated_session.add(req)
    await migrated_session.commit()

    await migrated_session.refresh(req)
    assert req.id is not None
    assert req.created_at is not None
    assert req.updated_at is not None
    assert req.state == "pending"
    assert req.conversation_id is None
    assert req.payload is None


async def test_uq_pending_request_rejects_duplicate_pending_row(db_session):
    # NULL is never "equal" to NULL for SQL unique-index purposes (SQLite/Postgres both), so a
    # NULL conversation_id would never collide regardless of the index — use a real group
    # conversation id so the (kind, conversation_id, requester_email) tuple is actually comparable.
    conv = Conversation(type="group")
    db_session.add(conv)
    await db_session.commit()
    await db_session.refresh(conv)

    first = ConversationRequest(kind="join_group", conversation_id=conv.id, requester_email="a@example.com")
    db_session.add(first)
    await db_session.commit()

    dup = ConversationRequest(kind="join_group", conversation_id=conv.id, requester_email="a@example.com")
    db_session.add(dup)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_uq_pending_request_allows_new_row_once_prior_one_resolved(db_session):
    conv = Conversation(type="group")
    db_session.add(conv)
    await db_session.commit()
    await db_session.refresh(conv)

    first = ConversationRequest(kind="join_group", conversation_id=conv.id, requester_email="a@example.com")
    db_session.add(first)
    await db_session.commit()

    first.state = "declined"
    await db_session.commit()

    second = ConversationRequest(kind="join_group", conversation_id=conv.id, requester_email="a@example.com")
    db_session.add(second)
    await db_session.commit()  # should not raise

    await db_session.refresh(second)
    assert second.id != first.id


async def test_deleting_conversation_nulls_request_fk_but_keeps_request_row(migrated_session):
    conv = Conversation()
    migrated_session.add(conv)
    await migrated_session.commit()
    await migrated_session.refresh(conv)

    req = ConversationRequest(kind="join_group", conversation_id=conv.id, requester_email="a@example.com")
    migrated_session.add(req)
    await migrated_session.commit()
    await migrated_session.refresh(req)
    req_id = req.id

    await migrated_session.delete(conv)
    await migrated_session.commit()

    await migrated_session.refresh(req)
    assert req.id == req_id
    assert req.conversation_id is None
