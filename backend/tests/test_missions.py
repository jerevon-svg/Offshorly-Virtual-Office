from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.mission import MissionAssignment
from app.models.quest import QuestProgress
from app.repositories import missions as missions_repo
from app.services.quests import missions
from app.services.quests.engine import record_quest_event
from app.services.quests.registry import EVENT_CHECK_IN, EVENT_DM_SENT, EVENT_GROUP_MESSAGE_SENT

# Daily/Weekly Missions: UTC period math, deterministic pinned draws, period-bounded anti-farm
# progress in all three modes, rollover, the engine seam (completed_missions), and the
# self-scoped GET /missions/me over the isolated app DB.

pytestmark = pytest.mark.asyncio

A, B, C, D, E = "a@example.com", "b@example.com", "c@example.com", "d@example.com", "e@example.com"
T0 = datetime(2026, 9, 2, 9, 0, tzinfo=timezone.utc)  # a Wednesday, ISO week 36


def _utc(dt):
    return dt if dt is None or dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def _progress(session, actor, mission_id, period_key) -> QuestProgress | None:
    stmt = select(QuestProgress).where(
        QuestProgress.actor_email == actor,
        QuestProgress.quest_id == mission_id,
        QuestProgress.period_key == period_key,
    )
    return (await session.execute(stmt)).scalar_one_or_none()


async def _force_assignment(session, actor, period, *mission_ids):
    """Pin a chosen draw so a test can target specific pool entries regardless of the hash."""
    for slot, mid in enumerate(mission_ids):
        session.add(
            MissionAssignment(actor_email=actor, cadence=period.cadence, period_key=period.key, mission_id=mid, slot=slot)
        )
    await session.flush()


# --- periods & pool -------------------------------------------------------------------------


def test_periods_are_utc_calendar_day_and_iso_week():
    d = missions.period_for("daily", T0)
    assert (d.key, d.starts_at, d.ends_at) == (
        "d:2026-09-02",
        datetime(2026, 9, 2, tzinfo=timezone.utc),
        datetime(2026, 9, 3, tzinfo=timezone.utc),
    )
    w = missions.period_for("weekly", T0)
    assert (w.key, w.starts_at, w.ends_at) == (
        "w:2026-W36",
        datetime(2026, 8, 31, tzinfo=timezone.utc),
        datetime(2026, 9, 7, tzinfo=timezone.utc),
    )
    # The client's local time never matters: 23:30 UTC-5 is already the next UTC day.
    late = datetime(2026, 9, 2, 23, 30, tzinfo=timezone(timedelta(hours=-5)))
    assert missions.period_for("daily", late).key == "d:2026-09-03"
    # Naive datetimes (SQLite round-trips) are UTC by contract.
    assert missions.period_for("daily", T0.replace(tzinfo=None)).key == "d:2026-09-02"
    # Sunday still belongs to the week that started the previous Monday.
    assert missions.period_for("weekly", datetime(2026, 9, 6, 23, 59, tzinfo=timezone.utc)).key == "w:2026-W36"
    assert missions.period_for("weekly", datetime(2026, 9, 7, 0, 0, tzinfo=timezone.utc)).key == "w:2026-W37"
    with pytest.raises(ValueError):
        missions.period_for("monthly", T0)


def test_pool_is_valid_and_has_no_raw_count_mode():
    for m in missions.MISSION_POOL:
        assert m.mode in missions.MISSION_MODES
        assert missions.get_mission(m.id) is m
    assert all(len(missions.pool_for(c)) >= missions.ACTIVE_PER_CADENCE[c] for c in missions.CADENCES)
    with pytest.raises(ValueError):
        missions.MissionDefinition("x", "x", EVENT_CHECK_IN, "daily", mode="count", target=3)
    with pytest.raises(ValueError):
        missions.MissionDefinition("x", "x", EVENT_CHECK_IN, "monthly")
    with pytest.raises(ValueError):
        missions.MissionDefinition("x", "x", EVENT_CHECK_IN, "daily", target=2)


def test_draw_is_deterministic_per_actor_and_period():
    d = missions.period_for("daily", T0)
    first = missions.select_missions(A, d)
    assert first == missions.select_missions(A, d)
    assert len(first) == missions.ACTIVE_PER_CADENCE["daily"] == len({m.id for m in first})
    assert all(m.cadence == "daily" for m in first)
    tomorrow = missions.period_for("daily", T0 + timedelta(days=1))
    # Different period or different actor → an independent draw (not necessarily different, but
    # over a handful of periods someone must get a different set or the seed is dead).
    draws = {missions.select_missions(A, missions.period_for("daily", T0 + timedelta(days=i))) for i in range(10)}
    assert len(draws) > 1
    assert missions.select_missions(A, tomorrow) == missions.select_missions(A, tomorrow)


# --- engine integration (in-memory db_session) ---------------------------------------------


async def test_first_event_pins_assignments_and_advances_only_subscribed_missions(db_session):
    d = missions.period_for("daily", T0)
    w = missions.period_for("weekly", T0)
    await _force_assignment(db_session, A, d, "daily_check_in", "daily_ask_toucan", "daily_dm_two_coworkers")
    await _force_assignment(db_session, A, w, "weekly_check_in_days", "weekly_ask_to_join", "weekly_dm_coworkers")

    r = await record_quest_event(db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="ci1", occurred_at=T0)
    assert r.stored
    assert r.completed_missions == (missions.MissionRef("daily_check_in", "daily", d.key),)
    assert {x.mission_id for x in r.updated_missions} == {"daily_check_in", "weekly_check_in_days"}
    assert (await _progress(db_session, A, "daily_check_in", d.key)).completed_at is not None
    wk = await _progress(db_session, A, "weekly_check_in_days", w.key)
    assert (wk.count, wk.completed_at) == (1, None)
    assert await _progress(db_session, A, "daily_ask_toucan", d.key) is None  # untouched

    # Second check-in the same day: dedupe key differs (a real second session) but unique_days
    # stays 1 and the daily once-mission is already done → nothing moves.
    r2 = await record_quest_event(
        db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="ci2", occurred_at=T0 + timedelta(hours=5)
    )
    assert r2.stored and r2.updated_missions == () and r2.completed_missions == ()


async def test_unique_days_and_weekly_rollover(db_session):
    w = missions.period_for("weekly", T0)
    await _force_assignment(db_session, A, w, "weekly_check_in_days", "weekly_ask_to_join", "weekly_dm_coworkers")
    for i in range(3):  # Wed, Thu, Fri
        r = await record_quest_event(
            db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key=f"ci{i}", occurred_at=T0 + timedelta(days=i)
        )
    row = await _progress(db_session, A, "weekly_check_in_days", w.key)
    assert row.count == 3 and row.completed_at is not None
    assert missions.MissionRef("weekly_check_in_days", "weekly", w.key) in r.completed_missions

    # Monday of the next ISO week: a fresh period with its own (hash-drawn) assignments and no
    # progress carried over; the old week's rows are untouched.
    nxt = T0 + timedelta(days=5)
    await record_quest_event(db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="ci-next", occurred_at=nxt)
    w2 = missions.period_for("weekly", nxt)
    assert w2.key == "w:2026-W37"
    rows = (
        await db_session.execute(
            select(MissionAssignment).where(MissionAssignment.actor_email == A, MissionAssignment.period_key == w2.key)
        )
    ).scalars().all()
    assert [r.mission_id for r in sorted(rows, key=lambda r: r.slot)] == [
        m.id for m in missions.select_missions(A, w2)
    ]
    assert (await _progress(db_session, A, "weekly_check_in_days", w.key)).count == 3


async def test_unique_count_is_bounded_to_the_period_and_ignores_repeats(db_session):
    d = missions.period_for("daily", T0)
    await _force_assignment(db_session, A, d, "daily_dm_two_coworkers", "daily_check_in", "daily_ask_toucan")
    # Yesterday's DM to B must not count toward today's mission.
    await record_quest_event(
        db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="m0", target_email=B,
        occurred_at=T0 - timedelta(days=1),
    )
    await record_quest_event(db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="m1", target_email=B, occurred_at=T0)
    await record_quest_event(db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="m2", target_email=B, occurred_at=T0)
    row = await _progress(db_session, A, "daily_dm_two_coworkers", d.key)
    assert (row.count, row.completed_at) == (1, None)  # spamming B is still one coworker
    # Self / Toucan targets never reach the ledger (engine rule) → no movement.
    await record_quest_event(db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="m3", target_email=A, occurred_at=T0)
    assert (await _progress(db_session, A, "daily_dm_two_coworkers", d.key)).count == 1
    r = await record_quest_event(db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="m4", target_email=C, occurred_at=T0)
    row = await _progress(db_session, A, "daily_dm_two_coworkers", d.key)
    assert (row.count, _utc(row.completed_at)) == (2, T0)
    assert missions.MissionRef("daily_dm_two_coworkers", "daily", d.key) in r.completed_missions
    # Completed is sticky and clamped: a fourth coworker changes nothing.
    await record_quest_event(db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="m5", target_email=D, occurred_at=T0)
    assert (await _progress(db_session, A, "daily_dm_two_coworkers", d.key)).count == 2


async def test_first_read_of_a_period_reconciles_events_already_in_the_ledger(db_session):
    # An event of a type nothing in this actor's draw subscribes to still pins the period; a
    # later pool-only event type must not be lost either. Simulate "events before the draw" by
    # writing progress-less ledger rows first (as a pre-deploy ledger would look).
    d = missions.period_for("daily", T0)
    from app.models.quest import QuestEvent

    db_session.add(QuestEvent(actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="pre", occurred_at=T0))
    await db_session.flush()
    await _force_assignment(db_session, A, d, "daily_check_in", "daily_ask_toucan", "daily_dm_two_coworkers")
    # Assignments exist but no progress rows: list must NOT reconcile (only first touch does)…
    data = await missions_repo.list_my_missions(db_session, actor_email=A, now=T0)
    daily = {m["id"]: m for m in data["daily"]["missions"]}
    assert daily["daily_check_in"]["count"] == 0
    # …whereas an actor whose period is first touched by the read gets a full recount.
    db_session.add(QuestEvent(actor_email=B, event_type=EVENT_CHECK_IN, dedupe_key="pre-b", occurred_at=T0))
    await db_session.flush()
    data = await missions_repo.list_my_missions(db_session, actor_email=B, now=T0)
    drawn = {m["id"] for m in data["daily"]["missions"]}
    assert drawn == {m.id for m in missions.select_missions(B, d)}
    if "daily_check_in" in drawn:
        assert next(m for m in data["daily"]["missions"] if m["id"] == "daily_check_in")["completed_at"] is not None
    assert data["daily"]["period_key"] == d.key and data["weekly"]["period_key"] == "w:2026-W36"


async def test_unsubscribed_event_types_are_still_not_stored(db_session):
    r = await record_quest_event(db_session, actor_email=A, event_type=EVENT_GROUP_MESSAGE_SENT, dedupe_key="g1", occurred_at=T0)
    assert r.stored is False and r.updated_missions == ()
    r = await record_quest_event(db_session, actor_email=A, event_type="not_a_thing", dedupe_key="x", occurred_at=T0)
    assert r.stored is False


# --- REST ---------------------------------------------------------------------------------


@pytest.fixture
async def _app_db(isolated_app_db):
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


async def test_missions_me_requires_identity(_app_db):
    async with _client() as client:
        assert (await client.get("/missions/me")).status_code == 401


async def test_missions_me_shape_is_stable_across_refreshes_and_self_scoped(_app_db):
    async with _client() as client:
        res = await client.get("/missions/me", headers={"x-dev-email": A})
        assert res.status_code == 200
        body = res.json()
        assert set(body) == {"serverTime", "daily", "weekly"}
        for cadence in ("daily", "weekly"):
            block = body[cadence]
            assert block["cadence"] == cadence
            assert block["periodKey"].startswith("d:" if cadence == "daily" else "w:")
            assert block["startsAt"].endswith("Z") and block["endsAt"].endswith("Z")
            assert len(block["missions"]) == missions.ACTIVE_PER_CADENCE[cadence]
            for m in block["missions"]:
                assert set(m) == {
                    "id", "title", "eventType", "mode", "target", "cadence", "count", "completed", "completedAt",
                    "rewardXp", "rewardCoins", "claimed", "claimedAt",
                }
                assert (m["rewardXp"], m["rewardCoins"]) == ((20, 5) if cadence == "daily" else (60, 15))
                assert m["claimed"] is False and m["claimedAt"] is None
                assert m["cadence"] == cadence and m["count"] == 0 and m["completed"] is False
        # Refresh / reconnect: the pinned draw is identical, not re-rolled.
        again = (await client.get("/missions/me", headers={"x-dev-email": A})).json()
        assert [m["id"] for m in again["daily"]["missions"]] == [m["id"] for m in body["daily"]["missions"]]
        assert [m["id"] for m in again["weekly"]["missions"]] == [m["id"] for m in body["weekly"]["missions"]]
        # Another actor sees their own draw and never A's progress.
        other = (await client.get("/missions/me", headers={"x-dev-email": B})).json()
        assert other["daily"]["periodKey"] == body["daily"]["periodKey"]
    async with app_db.async_session_maker() as session:
        rows = (await session.execute(select(MissionAssignment))).scalars().all()
        assert {r.actor_email for r in rows} == {A, B}
        assert len([r for r in rows if r.actor_email == A]) == sum(missions.ACTIVE_PER_CADENCE.values())


async def test_check_in_over_rest_moves_a_pinned_daily_mission(_app_db):
    now = datetime.now(timezone.utc)
    d = missions.period_for("daily", now)
    async with app_db.async_session_maker() as session:
        await _force_assignment(session, A, d, "daily_check_in", "daily_ask_toucan", "daily_dm_two_coworkers")
        await session.commit()
    async with _client() as client:
        res = await client.post("/attendance/check-in", headers={"x-dev-email": A})
        assert res.status_code in (200, 201), res.text
        body = (await client.get("/missions/me", headers={"x-dev-email": A})).json()
        by_id = {m["id"]: m for m in body["daily"]["missions"]}
        assert list(by_id) == ["daily_check_in", "daily_ask_toucan", "daily_dm_two_coworkers"]  # slot order
        assert by_id["daily_check_in"]["completed"] is True and by_id["daily_check_in"]["count"] == 1
        assert by_id["daily_ask_toucan"]["completed"] is False
