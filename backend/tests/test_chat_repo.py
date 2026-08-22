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
from app.routers.chat import _parse_iso
from app.schemas.chat import to_iso_z

# Port of backend/src/repo/conversations.test.ts + backend/src/repo/messages.test.ts onto the
# Python repository layer, against a real (in-memory) SQLAlchemy session rather than a hand
# rolled query fake.

pytestmark = pytest.mark.asyncio


async def _seed_conversation(db_session):
    return await chat_repo.upsert_conversation(db_session, "a@example.com", "b@example.com")


def _utc(dt):
    """SQLite round-trips DateTime(timezone=True) columns as naive — normalize before comparing
    a freshly-queried watermark against an in-session ORM object's (still tz-aware) sent_at."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


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
    # Force a deterministic gap between m1's sent_at and m2's: two back-to-back insert_message
    # calls can otherwise land in the same millisecond-truncated timestamp (see insert_message's
    # truncation), collapsing the `> last_read_at` boundary and making this test race the clock.
    # Nudge m1's watermark backward instead of forward so m2 (inserted with a real, untouched
    # "now") is guaranteed to be strictly after it, regardless of how fast the two calls run.
    m1.sent_at = m1.sent_at - timedelta(milliseconds=5)
    await db_session.flush()
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


async def test_mark_delivered_advances_the_watermark(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    m1 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi")
    await db_session.commit()

    advanced = await chat_repo.mark_delivered(db_session, conv_id, "a@example.com", m1.sent_at)
    await db_session.commit()
    assert advanced is True

    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    delivered_at, read_at = watermarks["a@example.com"]
    assert _utc(delivered_at) == _utc(m1.sent_at)
    assert read_at is None


async def test_mark_read_returns_true_on_genuine_advance_false_on_noop_and_missing_participant(
    db_session,
):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    m1 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 1")
    m2 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 2")
    await db_session.commit()

    assert await chat_repo.mark_read(db_session, conv_id, "a@example.com", m2.sent_at) is True
    await db_session.commit()

    # Same/earlier watermark again — no-op, must report False.
    assert await chat_repo.mark_read(db_session, conv_id, "a@example.com", m1.sent_at) is False
    assert await chat_repo.mark_read(db_session, conv_id, "a@example.com", m2.sent_at) is False
    await db_session.commit()

    # Non-participant email — no row to advance, must report False.
    assert await chat_repo.mark_read(db_session, conv_id, "nobody@example.com", m2.sent_at) is False


async def test_mark_delivered_returns_true_on_genuine_advance_false_on_noop_and_missing_participant(
    db_session,
):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    m1 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 1")
    m2 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 2")
    await db_session.commit()

    assert await chat_repo.mark_delivered(db_session, conv_id, "a@example.com", m2.sent_at) is True
    await db_session.commit()

    assert await chat_repo.mark_delivered(db_session, conv_id, "a@example.com", m1.sent_at) is False
    assert await chat_repo.mark_delivered(db_session, conv_id, "a@example.com", m2.sent_at) is False
    await db_session.commit()

    assert (
        await chat_repo.mark_delivered(db_session, conv_id, "nobody@example.com", m2.sent_at) is False
    )


async def test_mark_delivered_monotonic_guard_rejects_backward_move(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    m1 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 1")
    m2 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 2")
    await db_session.commit()

    await chat_repo.mark_delivered(db_session, conv_id, "a@example.com", m2.sent_at)
    await chat_repo.mark_delivered(db_session, conv_id, "a@example.com", m1.sent_at)
    await db_session.commit()

    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    delivered_at, _ = watermarks["a@example.com"]
    assert _utc(delivered_at) == _utc(m2.sent_at)


async def test_mark_read_monotonic_guard_rejects_backward_move(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    m1 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 1")
    m2 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 2")
    await db_session.commit()

    await chat_repo.mark_read(db_session, conv_id, "a@example.com", m2.sent_at)
    await chat_repo.mark_read(db_session, conv_id, "a@example.com", m1.sent_at)
    await db_session.commit()

    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    _, read_at = watermarks["a@example.com"]
    assert _utc(read_at) == _utc(m2.sent_at)


async def test_compute_message_receipts_transitions_sent_delivered_read(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    m1 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi")
    await db_session.commit()

    # sent only — recipient (a) has no watermarks yet.
    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    delivered_to, read_by = chat_repo.compute_message_receipts(m1, watermarks)
    assert delivered_to == []
    assert read_by == []

    # delivered — a's last_delivered_at has caught up to m1.sent_at.
    await chat_repo.mark_delivered(db_session, conv_id, "a@example.com", m1.sent_at)
    await db_session.commit()
    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    delivered_to, read_by = chat_repo.compute_message_receipts(m1, watermarks)
    assert delivered_to == ["a@example.com"]
    assert read_by == []

    # read — a's last_read_at has also caught up.
    await chat_repo.mark_read(db_session, conv_id, "a@example.com", m1.sent_at)
    await db_session.commit()
    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    delivered_to, read_by = chat_repo.compute_message_receipts(m1, watermarks)
    assert delivered_to == ["a@example.com"]
    assert read_by == ["a@example.com"]


async def test_compute_message_receipts_batch_read_shares_same_read_at(db_session):
    """Pins the intended 'one Seen time per batch' Messenger-style behavior — multiple messages
    read together via a single watermark all report the SAME read_at, not distinct per-message
    timestamps."""
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    m1 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 1")
    m1.sent_at = datetime.now(timezone.utc) - timedelta(seconds=2)
    m2 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi 2")
    m2.sent_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    read_watermark = datetime.now(timezone.utc)
    await chat_repo.mark_read(db_session, conv_id, "a@example.com", read_watermark)
    await db_session.commit()

    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    _, read_by_1 = chat_repo.compute_message_receipts(m1, watermarks)
    _, read_by_2 = chat_repo.compute_message_receipts(m2, watermarks)
    assert read_by_1 == ["a@example.com"]
    assert read_by_2 == ["a@example.com"]
    assert read_by_1 == read_by_2


async def test_compute_message_receipts_resolves_after_wire_precision_round_trip(db_session):
    """Regression pin for the sent_at-precision bug: insert_message must store sent_at truncated
    to millisecond precision (matching to_iso_z's wire serialization) so that a client echoing
    back its own `sentAt` — serialized via to_iso_z, parsed back via the real `_parse_iso` used
    by the mark-read/mark-delivered routes and socket handlers — produces a watermark that is
    >= the stored message.sent_at. Before the fix, insert_message stored full-microsecond
    precision while to_iso_z/_parse_iso only round-tripped milliseconds, so the recipient's
    watermark was always truncated *below* the true sent_at and compute_message_receipts could
    never resolve delivered/read for any message."""
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    m1 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi")
    await db_session.commit()

    # Exactly what the wire does: server -> client (to_iso_z) -> client echoes it back verbatim
    # as upToSentAt -> server parses it again (_parse_iso) before calling mark_read/mark_delivered.
    wire_sent_at = to_iso_z(m1.sent_at)
    round_tripped = _parse_iso(wire_sent_at)

    await chat_repo.mark_delivered(db_session, conv_id, "a@example.com", round_tripped)
    await chat_repo.mark_read(db_session, conv_id, "a@example.com", round_tripped)
    await db_session.commit()

    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    delivered_to, read_by = chat_repo.compute_message_receipts(m1, watermarks)
    assert delivered_to == ["a@example.com"]
    assert read_by == ["a@example.com"]


async def test_unread_count_unaffected_by_mark_delivered(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    m1 = await chat_repo.insert_message(db_session, conv_id, "b@example.com", "hi")
    await db_session.commit()

    before = await chat_repo.unread_count(db_session, conv_id, "a@example.com")
    assert before == 1

    await chat_repo.mark_delivered(db_session, conv_id, "a@example.com", m1.sent_at)
    await db_session.commit()

    after = await chat_repo.unread_count(db_session, conv_id, "a@example.com")
    assert after == 1


async def test_list_messages_clamps_limit_between_1_and_500(db_session):
    conv = await _seed_conversation(db_session)
    conv_id = conv["id"]
    for i in range(5):
        await chat_repo.insert_message(db_session, conv_id, "a@example.com", f"msg-{i}")
    await db_session.commit()

    assert len(await chat_repo.list_messages(db_session, conv_id, limit=0)) == 1
    assert len(await chat_repo.list_messages(db_session, conv_id, limit=2)) == 2
    assert len(await chat_repo.list_messages(db_session, conv_id, limit=10_000)) == 5


async def test_compute_message_receipts_with_three_plus_participants_partial_and_full(db_session):
    conv = await chat_repo.create_group_conversation(
        db_session, "a@example.com", ["b@example.com", "c@example.com"], title="Squad"
    )
    conv_id = conv["id"]
    m1 = await chat_repo.insert_message(db_session, conv_id, "a@example.com", "hi all")
    await db_session.commit()

    # Nobody's acked yet.
    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    delivered_to, read_by = chat_repo.compute_message_receipts(m1, watermarks)
    assert delivered_to == []
    assert read_by == []

    # b delivers only, c reads (which does not require delivered to be set).
    await chat_repo.mark_delivered(db_session, conv_id, "b@example.com", m1.sent_at)
    await chat_repo.mark_read(db_session, conv_id, "c@example.com", m1.sent_at)
    await db_session.commit()

    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    delivered_to, read_by = chat_repo.compute_message_receipts(m1, watermarks)
    # Sender (a) is always excluded even though a is a watermark entry.
    assert "a@example.com" not in delivered_to
    assert "a@example.com" not in read_by
    assert delivered_to == ["b@example.com"]
    assert read_by == ["c@example.com"]

    # Everyone else also delivers/reads — full fan-out, both lists sorted.
    await chat_repo.mark_delivered(db_session, conv_id, "c@example.com", m1.sent_at)
    await chat_repo.mark_read(db_session, conv_id, "b@example.com", m1.sent_at)
    await db_session.commit()

    watermarks = await chat_repo.get_participant_watermarks(db_session, conv_id)
    delivered_to, read_by = chat_repo.compute_message_receipts(m1, watermarks)
    assert delivered_to == ["b@example.com", "c@example.com"]
    assert read_by == ["b@example.com", "c@example.com"]


async def test_create_group_conversation_dedups_and_includes_creator(db_session):
    conv = await chat_repo.create_group_conversation(
        db_session,
        "A@Example.com",
        ["b@example.com", "B@Example.com", "a@example.com"],
        title="Team Chat",
    )
    assert conv["type"] == "group"
    assert conv["title"] == "Team Chat"
    assert sorted(conv["participant_ids"]) == ["a@example.com", "b@example.com"]


async def test_create_group_conversation_raises_on_fewer_than_two_unique_members(db_session):
    with pytest.raises(ValueError):
        await chat_repo.create_group_conversation(
            db_session, "a@example.com", ["a@example.com", "A@Example.com"], title=None
        )


async def test_create_group_conversation_helper_no_commit(db_session):
    """`_create_group_conversation` is the no-commit core `accept_join_request` relies on to
    fold group creation into its own surrounding transaction — proves it genuinely never
    self-commits by rolling back right after calling it and confirming nothing persisted."""
    new_id = await chat_repo._create_group_conversation(
        db_session, {"a@example.com", "b@example.com"}, title=None
    )
    assert new_id

    await db_session.rollback()

    result = await db_session.execute(select(Conversation).where(Conversation.id == new_id))
    assert result.scalar_one_or_none() is None
