from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.badge import BadgeAward, BadgeProgress
from app.models.mission import MissionAssignment
from app.repositories import badges as badges_repo
from app.services.quests import badges, missions
from app.services.quests.engine import record_quest_event
from app.services.quests.registry import EVENT_CHECK_IN, EVENT_DM_SENT, EVENT_HUB_VISITED, EVENT_RECOGNITION_GIVEN

# Badge Progression V1: definitions, tier math, monotonic metrics over quest_events /
# quest_progress, automatic tier awards from the engine, streak runs, completion badges, the
# one-time read backfill, and the self-scoped GET /badges/me.

pytestmark = pytest.mark.asyncio

A, B = "a@example.com", "b@example.com"
T0 = datetime(2026, 9, 2, 9, 0, tzinfo=timezone.utc)


def test_definitions_are_valid_and_cover_the_v1_set():
    ids = [b.id for b in badges.all_badges()]
    assert ids == ["regular", "connector", "approachable", "hub_regular", "cheerleader", "mission_runner", "pathfinder", "streak"]
    assert badges.get_badge("regular").thresholds == (5, 20, 60, 150)
    assert badges.get_badge("streak").thresholds == (3, 7, 14, 30)
    assert badges.get_badge("pathfinder").thresholds == (3, 6, 9, 11)
    assert badges.get_badge("regular").tier_for(4) == 0 and badges.get_badge("regular").tier_for(5) == 1
    assert badges.get_badge("regular").tier_for(150) == 4 and badges.get_badge("regular").tier_for(1000) == 4
    assert {b.id for b in badges.badge_definitions_for(EVENT_CHECK_IN)} == {"regular", "streak"}
    cats = {b.id: b.category for b in badges.all_badges()}
    assert cats == {
        "regular": "engagement", "streak": "engagement", "hub_regular": "engagement",
        "connector": "social", "approachable": "social",
        "cheerleader": "contribution",
        "mission_runner": "growth", "pathfinder": "growth",
    }
    assert all(b.emblem == b.id for b in badges.all_badges())
    with pytest.raises(ValueError):
        badges.BadgeDefinition("x", "x", "x", badges.METRIC_EVENT_COUNT, (1, 2, 3, 4), EVENT_CHECK_IN, category="misc")
    with pytest.raises(ValueError):
        badges.BadgeDefinition("x", "x", "x", badges.METRIC_EVENT_COUNT, (5, 4, 6, 7), EVENT_CHECK_IN)
    with pytest.raises(ValueError):
        badges.BadgeDefinition("x", "x", "x", badges.METRIC_QUESTS_COMPLETED, (1, 2, 3, 4), EVENT_CHECK_IN)


def test_longest_run_and_local_day_default_to_utc():
    d = date(2026, 9, 1)
    assert badges.longest_run(set()) == 0
    assert badges.longest_run({d}) == 1
    assert badges.longest_run({d, d + timedelta(days=1), d + timedelta(days=2), d + timedelta(days=5)}) == 3
    # Late-evening UTC-5 is already the next UTC day; tz=None means UTC by contract (Early Bird
    # will pass a per-employee zone later — nothing here assumes Asia/Manila).
    late = datetime(2026, 9, 2, 23, 30, tzinfo=timezone(timedelta(hours=-5)))
    assert badges.local_day(late, None) == date(2026, 9, 3)
    assert badges.local_day(late, timezone(timedelta(hours=-5))) == date(2026, 9, 2)


async def _awards(session, actor):
    rows = (await session.execute(select(BadgeAward).where(BadgeAward.actor_email == actor))).scalars().all()
    return sorted((r.badge_id, r.tier) for r in rows)


async def _progress(session, actor, badge_id):
    stmt = select(BadgeProgress).where(BadgeProgress.actor_email == actor, BadgeProgress.badge_id == badge_id)
    return (await session.execute(stmt)).scalar_one_or_none()


async def test_check_ins_award_regular_bronze_and_streak_from_consecutive_days(db_session):
    for i in range(5):
        r = await record_quest_event(
            db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key=f"ci{i}", occurred_at=T0 + timedelta(days=i)
        )
    assert await _awards(db_session, A) == [("regular", 1), ("streak", 1)]
    assert badges.BadgeAwardRef("regular", 1) in r.awarded_badges
    assert (await _progress(db_session, A, "regular")).metric == 5
    assert (await _progress(db_session, A, "streak")).metric == 5
    # A gap keeps the streak metric monotonic (best run stays 5) while check-ins keep counting.
    await record_quest_event(db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="ci-late", occurred_at=T0 + timedelta(days=9))
    assert (await _progress(db_session, A, "streak")).metric == 5
    assert (await _progress(db_session, A, "regular")).metric == 6
    # Actor B is untouched.
    assert await _awards(db_session, B) == []


async def test_connector_counts_distinct_coworkers_and_never_double_awards(db_session):
    for i, target in enumerate(["b@x.com", "b@x.com", "c@x.com", "d@x.com"]):
        r = await record_quest_event(db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key=f"m{i}", target_email=target, occurred_at=T0)
    assert (await _progress(db_session, A, "connector")).metric == 3
    assert r.awarded_badges == (badges.BadgeAwardRef("connector", 1),)
    # Re-evaluating with no change awards nothing again.
    again = await badges.evaluate_badge(db_session, actor=A, definition=badges.get_badge("connector"), now=T0)
    assert again == ()
    assert await _awards(db_session, A) == [("connector", 1)]


async def test_multiple_tiers_can_be_crossed_in_one_evaluation(db_session):
    # Ten recognitions written straight to the ledger, then one evaluation: bronze AND silver.
    from app.models.quest import QuestEvent

    for i in range(10):
        db_session.add(QuestEvent(actor_email=A, event_type=EVENT_RECOGNITION_GIVEN, dedupe_key=f"k{i}", target_email="b@x.com", occurred_at=T0))
    await db_session.flush()
    awarded = await badges.evaluate_badge(db_session, actor=A, definition=badges.get_badge("cheerleader"), now=T0)
    assert awarded == (badges.BadgeAwardRef("cheerleader", 1), badges.BadgeAwardRef("cheerleader", 2))
    row = await _progress(db_session, A, "cheerleader")
    assert (row.metric, row.tier) == (10, 2)


async def test_completion_badges_follow_quest_and_mission_completions(db_session):
    d = missions.period_for("daily", T0)
    for slot, mid in enumerate(("daily_check_in", "daily_dm_two_coworkers", "daily_ask_toucan")):
        db_session.add(MissionAssignment(actor_email=A, cadence="daily", period_key=d.key, mission_id=mid, slot=slot))
    await db_session.flush()
    # check_in completes first_check_in (quest) AND daily_check_in (mission) → both counters move.
    r = await record_quest_event(db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="ci", occurred_at=T0)
    assert r.completed_quest_ids and r.completed_missions
    assert (await _progress(db_session, A, "pathfinder")).metric == 1
    assert (await _progress(db_session, A, "mission_runner")).metric == 1
    # Two more quests: first_dm + chat_unique (needs 3) → pathfinder 3 = bronze.
    for i, t in enumerate(["b@x.com", "c@x.com", "d@x.com"]):
        r = await record_quest_event(db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key=f"m{i}", target_email=t, occurred_at=T0)
    assert (await _progress(db_session, A, "pathfinder")).metric == 3
    assert ("pathfinder", 1) in await _awards(db_session, A)


async def test_first_read_backfills_from_history(db_session):
    from app.models.quest import QuestEvent

    for i in range(6):
        db_session.add(QuestEvent(actor_email=A, event_type=EVENT_HUB_VISITED, dedupe_key=f"h{i}", occurred_at=T0 + timedelta(days=i)))
    await db_session.flush()
    out = await badges_repo.list_my_badges(db_session, actor_email=A, now=T0)
    by_id = {b["id"]: b for b in out}
    assert by_id["hub_regular"]["metric"] == 6 and by_id["hub_regular"]["tier"] == 1
    assert by_id["hub_regular"]["tier_name"] == "bronze" and by_id["hub_regular"]["next_threshold"] == 20
    assert by_id["hub_regular"]["tiers_awarded_at"][0] is not None and by_id["hub_regular"]["tiers_awarded_at"][1] is None
    assert by_id["regular"]["metric"] == 0 and by_id["regular"]["next_threshold"] == 5
    assert [b["id"] for b in out] == [b.id for b in badges.all_badges()]


@pytest.fixture
async def _app_db(isolated_app_db):
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


async def test_badges_me_requires_identity_and_is_self_scoped(_app_db):
    async with _client() as client:
        assert (await client.get("/badges/me")).status_code == 401
        res = await client.get("/badges/me", headers={"x-dev-email": A})
        assert res.status_code == 200
        body = res.json()["badges"]
        assert len(body) == 8
        assert set(body[0]) == {
            "id", "title", "description", "category", "emblem", "metricKind", "metric", "tier", "tierName",
            "thresholds", "nextThreshold", "tiersAwardedAt", "tiersClaimedAt", "tierRewards",
        }
        assert body[0]["tierRewards"] == [{"xp": 25, "coins": 10}, {"xp": 75, "coins": 25}, {"xp": 150, "coins": 50}, {"xp": 300, "coins": 100}]
        assert body[0]["tiersClaimedAt"] == [None, None, None, None]
        assert all(b["tier"] == 0 and b["tierName"] == "none" for b in body)
        # A real check-in over REST moves Regular for A only.
        assert (await client.post("/attendance/check-in", headers={"x-dev-email": A})).status_code == 200
        a = {b["id"]: b for b in (await client.get("/badges/me", headers={"x-dev-email": A})).json()["badges"]}
        b = {x["id"]: x for x in (await client.get("/badges/me", headers={"x-dev-email": B})).json()["badges"]}
        assert a["regular"]["metric"] == 1 and a["pathfinder"]["metric"] == 1
        assert b["regular"]["metric"] == 0 and b["pathfinder"]["metric"] == 0
