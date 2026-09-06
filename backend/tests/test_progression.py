from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import select

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.mission import MissionAssignment
from app.models.quest import QuestProgress
from app.models.reward import RewardGrant
from app.services.quests import missions, rewards
from app.services.quests.engine import record_quest_event
from app.services.quests.registry import EVENT_CHECK_IN, EVENT_DM_SENT

# Progression & Rewards V1: level curve, claim target resolution, exactly-once claims for quests
# and missions (double-click, other tab, concurrent), 404/409 edges, derived balances, and the
# reward/claimed fields on /quests/me and /missions/me.

pytestmark = pytest.mark.asyncio

A, B, C = "a@example.com", "b@example.com", "c@example.com"
T0 = datetime(2026, 9, 2, 9, 0, tzinfo=timezone.utc)


def test_level_curve_is_quadratic_and_monotonic():
    assert [rewards.level_start_xp(n) for n in range(1, 7)] == [0, 100, 300, 600, 1000, 1500]
    p = rewards.progression_for(0, 0)
    assert (p.level, p.level_start_xp, p.next_level_xp) == (1, 0, 100)
    p = rewards.progression_for(99, 0)
    assert p.level == 1
    p = rewards.progression_for(100, 0)
    assert (p.level, p.level_start_xp, p.next_level_xp) == (2, 100, 300)
    p = rewards.progression_for(1499, 7)
    assert (p.level, p.coins) == (5, 7)
    assert rewards.progression_for(1500, 0).level == 6


def test_claim_target_resolution_rejects_mismatched_pairs():
    q = rewards.resolve_claim_target("first_check_in", "")
    assert (q.source, q.reward) == ("quest", rewards.REWARD_QUEST_ONCE)
    assert rewards.resolve_claim_target("chat_unique_coworkers", "").reward == rewards.REWARD_QUEST_UNIQUE
    m = rewards.resolve_claim_target("weekly_check_in_days", "w:2026-W36")
    assert (m.source, m.reward) == ("mission", rewards.REWARD_MISSION_WEEKLY)
    assert rewards.resolve_claim_target("daily_check_in", "d:2026-09-02").reward == rewards.REWARD_MISSION_DAILY
    assert rewards.resolve_claim_target("first_check_in", "d:2026-09-02") is None  # quest with a period
    assert rewards.resolve_claim_target("daily_check_in", "") is None  # mission without a period
    assert rewards.resolve_claim_target("daily_check_in", "w:2026-W36") is None  # wrong cadence prefix
    assert rewards.resolve_claim_target("nope", "") is None


# --- service level ---------------------------------------------------------------------------


async def test_claim_is_exactly_once_and_balances_derive_from_grants(db_session):
    await record_quest_event(db_session, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="ci", occurred_at=T0)
    target = rewards.resolve_claim_target("first_check_in", "")
    first = await rewards.claim(db_session, actor=A, target=target, now=T0)
    assert first.granted_now is True and (first.grant.xp, first.grant.coins) == (50, 10)
    second = await rewards.claim(db_session, actor=A, target=target, now=T0)
    assert second.granted_now is False and second.grant.id == first.grant.id
    grants = (await db_session.execute(select(RewardGrant))).scalars().all()
    assert len(grants) == 1
    p = await rewards.load_progression(db_session, actor=A)
    assert (p.xp, p.coins, p.level) == (50, 10, 1)
    # Nothing on the progress row changed: "claimed" lives only in the ledger.
    row = (await db_session.execute(select(QuestProgress).where(QuestProgress.quest_id == "first_check_in"))).scalar_one()
    assert row.completed_at is not None


async def test_claim_requires_completion_and_ignores_other_actors(db_session):
    target = rewards.resolve_claim_target("first_check_in", "")
    with pytest.raises(rewards.NotCompleted):
        await rewards.claim(db_session, actor=A, target=target)  # no progress at all
    await record_quest_event(db_session, actor_email=A, event_type=EVENT_DM_SENT, dedupe_key="m1", target_email=B, occurred_at=T0)
    with pytest.raises(rewards.NotCompleted):
        await rewards.claim(db_session, actor=A, target=rewards.resolve_claim_target("chat_unique_coworkers", ""))  # 1/3
    # B completing their own check-in does not let A claim it.
    await record_quest_event(db_session, actor_email=B, event_type=EVENT_CHECK_IN, dedupe_key="ci-b", occurred_at=T0)
    with pytest.raises(rewards.NotCompleted):
        await rewards.claim(db_session, actor=A, target=target)
    assert (await rewards.claim(db_session, actor=B, target=target)).granted_now is True


# --- REST -----------------------------------------------------------------------------------


@pytest.fixture
async def _app_db(isolated_app_db):
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _as(email: str) -> dict[str, str]:
    return {"x-dev-email": email}


async def test_progression_endpoints_require_identity(_app_db):
    async with _client() as client:
        assert (await client.get("/progression/me")).status_code == 401
        assert (await client.post("/progression/claim", json={"questId": "first_check_in"})).status_code == 401


async def test_quest_claim_flow_over_rest_is_idempotent_and_reflected_in_quests_me(_app_db):
    async with _client() as client:
        fresh = (await client.get("/progression/me", headers=_as(A))).json()
        assert fresh == {"xp": 0, "coins": 0, "level": 1, "levelStartXp": 0, "nextLevelXp": 100}

        # Not completed yet → 409 with the repo's error shape; unknown id → 404.
        res = await client.post("/progression/claim", json={"questId": "first_check_in"}, headers=_as(A))
        assert res.status_code == 409 and res.json() == {"error": "Not completed yet"}
        assert (await client.post("/progression/claim", json={"questId": "nope"}, headers=_as(A))).status_code == 404

        assert (await client.post("/attendance/check-in", headers=_as(A))).status_code == 200
        q = next(x for x in (await client.get("/quests/me", headers=_as(A))).json()["quests"] if x["id"] == "first_check_in")
        assert q["completed"] is True and q["claimed"] is False and (q["rewardXp"], q["rewardCoins"]) == (50, 10)

        res = await client.post("/progression/claim", json={"questId": "first_check_in"}, headers=_as(A))
        assert res.status_code == 200
        body = res.json()
        assert body["grantedNow"] is True and body["reward"] == {"xp": 50, "coins": 10}
        assert body["progression"]["xp"] == 50 and body["progression"]["coins"] == 10 and body["progression"]["level"] == 1

        # Double-click / refresh / other tab: same 200, grantedNow=false, balances unchanged.
        again = (await client.post("/progression/claim", json={"questId": "first_check_in"}, headers=_as(A))).json()
        assert again["grantedNow"] is False and again["progression"]["xp"] == 50
        q = next(x for x in (await client.get("/quests/me", headers=_as(A))).json()["quests"] if x["id"] == "first_check_in")
        assert q["claimed"] is True and q["claimedAt"] is not None
        # B cannot claim A's completion.
        assert (await client.post("/progression/claim", json={"questId": "first_check_in"}, headers=_as(B))).status_code == 409
        assert (await client.get("/progression/me", headers=_as(B))).json()["xp"] == 0


async def test_mission_claim_over_rest_uses_period_key_and_shows_in_missions_me(_app_db):
    now = datetime.now(timezone.utc)
    d = missions.period_for("daily", now)
    async with app_db.async_session_maker() as session:
        for slot, mid in enumerate(("daily_check_in", "daily_ask_toucan", "daily_dm_two_coworkers")):
            session.add(MissionAssignment(actor_email=A, cadence="daily", period_key=d.key, mission_id=mid, slot=slot))
        await session.commit()
    async with _client() as client:
        assert (await client.post("/attendance/check-in", headers=_as(A))).status_code == 200
        block = (await client.get("/missions/me", headers=_as(A))).json()["daily"]
        m = next(x for x in block["missions"] if x["id"] == "daily_check_in")
        assert m["completed"] is True and m["claimed"] is False and (m["rewardXp"], m["rewardCoins"]) == (20, 5)
        # Wrong period key for the cadence → 404; right one → grant.
        bad = await client.post("/progression/claim", json={"questId": "daily_check_in", "periodKey": "w:2026-W36"}, headers=_as(A))
        assert bad.status_code == 404
        res = await client.post("/progression/claim", json={"questId": "daily_check_in", "periodKey": d.key}, headers=_as(A))
        assert res.status_code == 200 and res.json()["grantedNow"] is True and res.json()["reward"] == {"xp": 20, "coins": 5}
        m = next(x for x in (await client.get("/missions/me", headers=_as(A))).json()["daily"]["missions"] if x["id"] == "daily_check_in")
        assert m["claimed"] is True
        # The permanent first_check_in quest completed from the same event is a separate claim.
        res = await client.post("/progression/claim", json={"questId": "first_check_in"}, headers=_as(A))
        assert res.json()["progression"] == {"xp": 70, "coins": 15, "level": 1, "levelStartXp": 0, "nextLevelXp": 100}


async def test_overlapping_claims_on_separate_connections_grant_once(tmp_path):
    """Two tabs, two real connections (NullPool file DB, like the dev rig): tab 2 starts its claim
    while tab 1's grant is still uncommitted. Exactly one grant exists afterwards and the loser
    gets an idempotent "already claimed" result, not an error. (The shared-connection app fixture
    cannot model this — StaticPool serialises everything onto one SQLite transaction.)"""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'race.db'}", poolclass=NullPool)
    app_db._set_sqlite_pragmas(engine)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    target = rewards.resolve_claim_target("first_check_in", "")
    try:
        async with maker() as s0:
            await record_quest_event(s0, actor_email=A, event_type=EVENT_CHECK_IN, dedupe_key="ci", occurred_at=T0)
            await s0.commit()
        async with maker() as tab1, maker() as tab2:
            first = await rewards.claim(tab1, actor=A, target=target)  # inserted, NOT yet committed
            assert first.granted_now is True
            loser = asyncio.create_task(rewards.claim(tab2, actor=A, target=target))
            await asyncio.sleep(0.3)  # tab2 is now blocked on tab1's write lock (busy_timeout)
            await tab1.commit()
            second = await asyncio.wait_for(loser, timeout=10)
            assert second.granted_now is False and second.grant.id == first.grant.id
            await tab2.commit()
        async with maker() as check:
            grants = (await check.execute(select(RewardGrant))).scalars().all()
            assert len(grants) == 1
            assert (await rewards.load_progression(check, actor=A)).xp == 50
    finally:
        await engine.dispose()
