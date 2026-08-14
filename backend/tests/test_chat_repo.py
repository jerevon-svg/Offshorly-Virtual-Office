from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.database import Base
from app.models.conversation import Conversation, ConversationParticipant
from app.repositories import chat as chat_repo

# Port of backend/src/repo/conversations.test.ts + backend/src/repo/messages.test.ts onto the
# Python repository layer, against a real (in-memory) SQLAlchemy session rather than a hand
# rolled query fake.

pytestmark = pytest.mark.asyncio


async def _seed_conversation(db_session):
    return await chat_repo.upsert_conversation(db_session, "a@example.com", "b@example.com")


async def test_list_conversations_reports_zero_unread_with_no_messages(db_session):
    await _seed_conversation(db_session)
    [conv] = await chat_repo.list_conversations_for_user(db_session, "a@example.com")
    assert conv["unread_count"] == 0


async def test_list_conversations_counts_messages_from_peer_sent_after_last_read_at(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]

    await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 1")
    await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 2")
    # A's own message never counts toward A's own unread total.
    await chat_repo.insert_message(db_session, conv_id, "a@example.com", "reply")
    await db_session.commit()

    [conv_for_a] = await chat_repo.list_conversations_for_user(db_session, "a@example.com")
    assert conv_for_a["unread_count"] == 2

    # B never read A's message either — B's unread count reflects only A's one message, not
    # B's own two messages to A (which B sent, so they don't count toward B's total).
    [conv_for_b] = await chat_repo.list_conversations_for_user(db_session, "b@example.com")
    assert conv_for_b["unread_count"] == 1


async def test_list_conversations_excludes_messages_at_or_before_last_read_at(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]

    m1 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 1")
    await chat_repo.mark_read(db_session, conv_id, "a@example.com", m1.sent_at)
    await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 2")
    await db_session.commit()

    [conv_for_a] = await chat_repo.list_conversations_for_user(db_session, "a@example.com")
    assert conv_for_a["unread_count"] == 1


async def test_upsert_conversation_is_idempotent_per_email_pair(db_session):
    first = await chat_repo.upsert_conversation(db_session, "a@example.com", "b@example.com")
    second = await chat_repo.upsert_conversation(db_session, "B@Example.com", "A@Example.com")
    assert first["id"] == second["id"]


@pytest.fixture
async def file_engine(tmp_path):
    """A real file-based SQLite engine wired the same way as the app's production engine
    (NullPool + busy_timeout/WAL pragmas) — needed to exercise genuine multi-connection
    concurrency, which the in-memory `db_session` fixture (single shared StaticPool connection)
    cannot exercise."""
    db_path = tmp_path / "race.db"
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        connect_args={"check_same_thread": False},
        poolclass=NullPool,
    )

    @event.listens_for(engine.sync_engine, "connect")
    def _set_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine
    await engine.dispose()


async def test_upsert_conversation_survives_a_conflicting_insert_between_select_and_flush(
    file_engine, monkeypatch
):
    """Simulates the exact race: a SECOND, separate session/connection commits the winning
    dm_key row in the window between this call's own initial SELECT and its own flush/insert,
    so this call's insert genuinely hits the UNIQUE constraint (IntegrityError) and must
    converge on the winner instead of raising."""
    session_maker = async_sessionmaker(file_engine, class_=AsyncSession, expire_on_commit=False)
    key = chat_repo.dm_key("a@example.com", "b@example.com")
    triggered = {"done": False}

    async with session_maker() as session:
        original_execute = session.execute

        async def racing_execute(statement, *args, **kwargs):
            result = await original_execute(statement, *args, **kwargs)
            compiled = str(statement).lower()
            if not triggered["done"] and "conversations" in compiled and "dm_key" in compiled:
                triggered["done"] = True
                # A concurrent "other request" wins the race: separate session/connection
                # commits a conversation with this dm_key right after our SELECT found nothing.
                async with session_maker() as other_session:
                    other_session.add(
                        Conversation(dm_key=key, last_message_at=datetime.now(timezone.utc))
                    )
                    await other_session.commit()
            return result

        monkeypatch.setattr(session, "execute", racing_execute)

        result = await chat_repo.upsert_conversation(session, "a@example.com", "b@example.com")

    assert triggered["done"], "test setup bug: race window was never triggered"
    assert sorted(result["participant_ids"]) == ["a@example.com", "b@example.com"]

    async with session_maker() as verify_session:
        conv_rows = (
            await verify_session.execute(select(Conversation).where(Conversation.dm_key == key))
        ).scalars().all()
        assert len(conv_rows) == 1
        assert conv_rows[0].id == result["id"]

        participant_rows = (
            await verify_session.execute(
                select(ConversationParticipant).where(
                    ConversationParticipant.conversation_id == result["id"]
                )
            )
        ).scalars().all()
        assert len(participant_rows) == 2


async def test_upsert_conversation_concurrent_distinct_pairs_all_succeed(file_engine):
    """Non-colliding email pairs run concurrently must all succeed with no crashes and each get
    their own conversation (regression check for the enable_sqlite_savepoints/StaticPool bugs
    that broke concurrent DISTINCT requests)."""
    session_maker = async_sessionmaker(file_engine, class_=AsyncSession, expire_on_commit=False)

    async def run(i: int) -> dict:
        async with session_maker() as session:
            return await chat_repo.upsert_conversation(
                session, f"user{i}a@example.com", f"user{i}b@example.com"
            )

    results = await asyncio.gather(*(run(i) for i in range(8)))

    assert len({r["id"] for r in results}) == 8
    for r in results:
        assert len(r["participant_ids"]) == 2


@pytest.mark.parametrize("concurrency", [2, 8])
async def test_upsert_conversation_concurrent_same_pair_converges(file_engine, concurrency):
    """The SAME email pair, requested concurrently multiple ways, must converge on exactly one
    conversation row with exactly 2 participant rows and zero crashes."""
    session_maker = async_sessionmaker(file_engine, class_=AsyncSession, expire_on_commit=False)

    async def run() -> dict:
        async with session_maker() as session:
            return await chat_repo.upsert_conversation(
                session, "same-a@example.com", "same-b@example.com"
            )

    results = await asyncio.gather(*(run() for _ in range(concurrency)))

    conv_ids = {r["id"] for r in results}
    assert len(conv_ids) == 1
    conv_id = conv_ids.pop()

    async with session_maker() as verify_session:
        conv_rows = (
            await verify_session.execute(select(Conversation).where(Conversation.id == conv_id))
        ).scalars().all()
        assert len(conv_rows) == 1

        participant_rows = (
            await verify_session.execute(
                select(ConversationParticipant).where(
                    ConversationParticipant.conversation_id == conv_id
                )
            )
        ).scalars().all()
        assert len(participant_rows) == 2


async def test_is_participant(db_session):
    conv = await _seed_conversation(db_session)
    assert await chat_repo.is_participant(db_session, conv["id"], "a@example.com") is True
    assert await chat_repo.is_participant(db_session, conv["id"], "c@example.com") is False


async def test_insert_message_lowercases_sender_and_maps_fields(db_session):
    conv = await _seed_conversation(db_session)
    msg = await chat_repo.insert_message(db_session, conv["id"], "A@Example.com", "hello")
    await db_session.commit()
    assert msg.conversation_id == conv["id"]
    assert msg.sender_email == "a@example.com"
    assert msg.text == "hello"
    assert msg.id
    assert msg.sent_at is not None


async def test_list_messages_returns_messages_ordered_by_sent_at(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]

    m1 = await chat_repo.insert_message(db_session, conv_id, "a@example.com", "first")
    m1.sent_at = datetime.now(timezone.utc) - timedelta(seconds=2)
    m2 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "second")
    m2.sent_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    messages = await chat_repo.list_messages(db_session, conv_id)
    assert [m.text for m in messages] == ["first", "second"]
    assert m1.sent_at < m2.sent_at


async def test_list_messages_respects_a_since_cursor(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]

    old = await chat_repo.insert_message(db_session, conv_id, "a@example.com", "old")
    old.sent_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    new = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "new")
    new.sent_at = datetime.now(timezone.utc)
    await db_session.commit()

    since_old = await chat_repo.list_messages(db_session, conv_id, since=old.sent_at)
    assert [m.text for m in since_old] == ["new"]


async def test_list_messages_clamps_limit_between_1_and_500(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    for i in range(5):
        await chat_repo.insert_message(db_session, conv_id, "a@example.com", f"msg-{i}")
    await db_session.commit()

    assert len(await chat_repo.list_messages(db_session, conv_id, limit=0)) == 1
    assert len(await chat_repo.list_messages(db_session, conv_id, limit=2)) == 2
    assert len(await chat_repo.list_messages(db_session, conv_id, limit=10_000)) == 5
