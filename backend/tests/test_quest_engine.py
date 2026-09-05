from __future__ import annotations

import logging
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.models.attendance import EmployeeAttendance
from app.models.quest import QuestEvent, QuestProgress
from app.services.quests import engine as quest_engine
from app.services.quests import registry
from app.services.quests.engine import record_quest_event
from app.services.quests.registry import (
    EVENT_CHECK_IN,
    EVENT_DM_SENT,
    EVENT_GROUP_MESSAGE_SENT,
    EVENT_TOUCAN_ASKED,
    MODE_UNIQUE_COUNT,
)

# Engine-level coverage for Quest Foundation, on the isolated in-memory db_session fixture:
# once / unique_count modes, namespaced idempotency, the self/Toucan target rule, completion
# stickiness and — most importantly — failure isolation (a broken engine never poisons the
# caller's transaction and never logs content).

pytestmark = pytest.mark.asyncio

A = "a@example.com"


async def _events(session) -> list[QuestEvent]:
    return list((await session.execute(select(QuestEvent).order_by(QuestEvent.created_at))).scalars().all())


async def _progress(session, actor: str, quest_id: str) -> QuestProgress | None:
    stmt = select(QuestProgress).where(QuestProgress.actor_email == actor, QuestProgress.quest_id == quest_id)
    return (await session.execute(stmt)).scalar_one_or_none()


def _utc(dt: datetime | None) -> datetime | None:
    # SQLite hands timezone-aware columns back naive; compare in UTC either way.
    return dt if dt is None or dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def test_registry_definitions_are_valid_and_cover_both_modes():
    defs = registry.all_definitions()
    assert [d.id for d in defs] == sorted((d.id for d in defs), key=lambda i: registry.get_definition(i).order)
    assert any(d.mode == MODE_UNIQUE_COUNT for d in defs)
    assert registry.definitions_for(EVENT_GROUP_MESSAGE_SENT) == ()  # emitted, but nothing subscribes today
    with pytest.raises(ValueError):
        registry.QuestDefinition(id="x", title="x", event_type=EVENT_CHECK_IN, mode="daily")
    with pytest.raises(ValueError):
        registry.QuestDefinition(id="x", title="x", event_type=EVENT_CHECK_IN, target=3)


async def test_once_mode_completes_on_first_event(db_session):
    when = datetime(2026, 9, 5, 9, 0, tzinfo=timezone.utc)
    result = await record_quest_event(
        db_session, actor_email="A@Example.com", event_type=EVENT_CHECK_IN, dedupe_key="a:1", occurred_at=when
    )
    await db_session.commit()
    assert result is not None and result.stored
    assert result.completed_quest_ids == ("first_check_in",)
    row = await _progress(db_session, A, "first_check_in")
    assert row is not None and row.count == 1 and _utc(row.completed_at) == when and row.period_key == ""
    assert (await _events(db_session))[0].actor_email == A  # normalized


async def test_unsubscribed_event_type_is_not_stored(db_session):
    result = await record_quest_event(
        db_session, actor_email=A, event_type=EVENT_GROUP_MESSAGE_SENT, dedupe_key="m1"
    )
    result2 = await record_quest_event(db_session, actor_email=A, event_type="no_such_event", dedupe_key="x")
    await db_session.commit()
    assert result is not None and not result.stored and not result.duplicate
    assert result2 is not None and not result2.stored
    assert await _events(db_session) == []


async def test_duplicate_key_records_nothing_and_key_is_namespaced_by_event_type(db_session):
    first = await record_quest_event(db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="same")
    dup = await record_quest_event(db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="same")
    other = await record_quest_event(db_session, actor_email=A, event_type=EVENT_TOUCAN_ASKED, dedupe_key="same")
    await db_session.commit()
    assert first.stored and other.stored
    assert dup is not None and dup.duplicate and not dup.stored
    assert len(await _events(db_session)) == 2
    assert (await _progress(db_session, A, "first_check_in")).count == 1


async def test_unique_count_counts_distinct_targets_only(db_session):
    async def dm(key: str, target: str):
        return await record_quest_event(
            db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key=key, target_email=target
        )

    r1 = await dm("m1", "b@example.com")
    assert set(r1.completed_quest_ids) == {"first_dm"}
    await dm("m2", "b@example.com")  # repeat to the same coworker
    await dm("m3", "B@EXAMPLE.COM")  # same coworker, different casing
    row = await _progress(db_session, A, "chat_unique_coworkers")
    assert row.count == 1 and row.completed_at is None

    await dm("m4", "c@example.com")
    assert (await _progress(db_session, A, "chat_unique_coworkers")).count == 2
    r5 = await dm("m5", "d@example.com")
    await db_session.commit()
    row = await _progress(db_session, A, "chat_unique_coworkers")
    assert row.count == 3 and row.completed_at is not None
    assert r5.completed_quest_ids == ("chat_unique_coworkers",)


async def test_self_and_toucan_targets_are_never_recorded(db_session):
    r_self = await record_quest_event(
        db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="s1", target_email="A@example.com "
    )
    r_toucan = await record_quest_event(
        db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="s2", target_email=quest_engine._TOUCAN_SENDER
    )
    await db_session.commit()
    assert not r_self.stored and not r_toucan.stored
    assert await _events(db_session) == []
    assert await _progress(db_session, A, "first_dm") is None


async def test_once_completed_stays_completed_and_count_is_capped(db_session):
    t1 = datetime(2026, 9, 5, 9, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 9, 6, 9, 0, tzinfo=timezone.utc)
    await record_quest_event(db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="d1", occurred_at=t1)
    later = await record_quest_event(
        db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="d2", occurred_at=t2
    )
    await db_session.commit()
    assert later.stored and later.updated_quest_ids == () and later.completed_quest_ids == ()
    row = await _progress(db_session, A, "first_check_in")
    assert row.count == 1 and _utc(row.completed_at) == t1
    assert len(await _events(db_session)) == 2  # the ledger still has both real check-ins


async def test_engine_failure_is_isolated_logged_and_leaves_session_usable(db_session, monkeypatch, caplog):
    async def _boom(*_a, **_k):
        raise RuntimeError("engine exploded: SECRET MESSAGE BODY")

    monkeypatch.setattr(quest_engine, "_record", _boom)
    # Primary write first, exactly like a router that flushed its own row before the hook.
    db_session.add(EmployeeAttendance(email=A, checked_in_at=None, checked_out_at=None, updated_at=datetime.now(timezone.utc)))
    await db_session.flush()

    with caplog.at_level(logging.ERROR, logger="app.services.quests.engine"):
        result = await record_quest_event(
            db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="k1", reference_id="ref-1"
        )
    assert result is None

    # The caller's transaction is intact: the primary row commits and is readable.
    await db_session.commit()
    assert (await db_session.execute(select(func.count()).select_from(EmployeeAttendance))).scalar_one() == 1
    assert await _events(db_session) == []

    record = next(r for r in caplog.records if "quest event recording failed" in r.getMessage())
    assert f"actor={A}" in record.getMessage()
    assert f"event_type={EVENT_CHECK_IN}" in record.getMessage()
    assert "reference_id=ref-1" in record.getMessage()
    assert "SECRET MESSAGE BODY" not in record.getMessage()  # the traceback carries it, the line does not
    assert record.exc_info is not None


async def test_partial_failure_rolls_back_the_ledger_row_too(db_session, monkeypatch):
    """The event INSERT succeeded, then progress computation blew up: the savepoint must unwind
    the event as well, so the ledger never carries an event whose progress was not applied."""

    async def _boom(*_a, **_k):
        raise RuntimeError("count failed")

    monkeypatch.setattr(quest_engine, "_distinct_target_count", _boom)
    result = await record_quest_event(
        db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="m1", target_email="b@example.com"
    )
    await db_session.commit()
    assert result is None
    assert await _events(db_session) == []
    assert await _progress(db_session, A, "first_dm") is None

    # And the same key can be recorded once the engine is healthy again.
    monkeypatch.undo()
    ok = await record_quest_event(
        db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="m1", target_email="b@example.com"
    )
    await db_session.commit()
    assert ok.stored and len(await _events(db_session)) == 1
