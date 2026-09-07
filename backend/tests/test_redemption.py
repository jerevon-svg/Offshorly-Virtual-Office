from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx
import pytest
from sqlalchemy import select

from app import database as app_db
from app.config import settings
from app.database import Base
from app.main import fastapi_app
from app.models.redemption import RewardRedemption
from app.models.reward import RewardGrant
from app.services import redemption as svc
from app.services.quests.rewards import load_progression

# Reward Redemption V1: code catalog, atomic balance-checked debit on the ONE Coin ledger,
# per-actor concurrency, idempotent replay, exact/insufficient balance, exactly-once refunds on
# cancel and reject, approver gating, and the self-scoped REST surface.

pytestmark = pytest.mark.asyncio

A, B, APPROVER = "a@example.com", "b@example.com", "boss@example.com"
T0 = datetime(2026, 9, 7, 9, 0, tzinfo=timezone.utc)


def _grant(actor: str, coins: int, key: str) -> RewardGrant:
    # A "credit" straight into the ledger — stands in for claimed quest/mission/badge rewards.
    return RewardGrant(actor_email=actor, source="quest", quest_id=f"seed_{key}", period_key="", xp=0, coins=coins, granted_at=T0)


async def _coins(session, actor) -> int:
    return (await load_progression(session, actor=actor)).coins


async def _ledger(session, actor):
    rows = (await session.execute(select(RewardGrant).where(RewardGrant.actor_email == actor).order_by(RewardGrant.created_at))).scalars().all()
    return [(r.source, r.quest_id, r.period_key, r.coins) for r in rows]


def test_catalog_is_valid_demo_content_and_time_off_requires_approval():
    items = svc.catalog()
    assert 5 <= len(items) <= 6
    assert [i.cost for i in items] == sorted(i.cost for i in items)
    assert all("demo" in i.title.lower() for i in items)
    assert all(i.requires_approval for i in items if i.category == svc.CATEGORY_TIME_OFF)
    assert svc.get_item("coffee_voucher").requires_approval is False
    with pytest.raises(ValueError):
        svc.CatalogItem("x", "x", "x", 10, svc.CATEGORY_TIME_OFF, requires_approval=False)
    with pytest.raises(ValueError):
        svc.CatalogItem("x", "x", "x", 0, svc.CATEGORY_PERK)
    with pytest.raises(ValueError):
        svc.CatalogItem("x", "x", "x", 10, "cash")


async def test_redeem_checks_balance_exactly_and_debits_the_shared_ledger(db_session):
    db_session.add(_grant(A, 60, "a"))
    await db_session.flush()
    with pytest.raises(svc.InsufficientCoins):
        await svc.redeem(db_session, actor_email=A, item_id="desk_plant", idempotency_key="key-desk-0001")  # 120 > 60
    assert await _coins(db_session, A) == 60  # nothing debited on failure

    res = await svc.redeem(db_session, actor_email=A, item_id="coffee_voucher", idempotency_key="key-coffee-01")  # exactly 60
    assert res.created_now is True
    assert res.redemption.status == "approved"  # no approval needed → approved immediately
    assert await _coins(db_session, A) == 0
    assert await _ledger(db_session, A) == [("quest", "seed_a", "", 60), ("redeem", "coffee_voucher", "r:key-coffee-01", -60)]

    with pytest.raises(svc.InsufficientCoins):
        await svc.redeem(db_session, actor_email=A, item_id="playlist_pick", idempotency_key="key-play-0001")  # 40 > 0
    assert await _coins(db_session, A) == 0  # never negative


async def test_replay_with_the_same_key_never_double_spends(db_session):
    db_session.add(_grant(A, 500, "a"))
    await db_session.flush()
    first = await svc.redeem(db_session, actor_email=A, item_id="early_out_pass", idempotency_key="dbl-click-key1")
    again = await svc.redeem(db_session, actor_email=A, item_id="early_out_pass", idempotency_key="dbl-click-key1")
    assert first.created_now is True and again.created_now is False
    assert again.redemption.id == first.redemption.id
    assert first.redemption.status == "pending"  # time-off → approval
    assert await _coins(db_session, A) == 300
    # Same key, different item: still the original request (an idempotency key IS the request).
    other = await svc.redeem(db_session, actor_email=A, item_id="playlist_pick", idempotency_key="dbl-click-key1")
    assert other.created_now is False and other.redemption.item_id == "early_out_pass"
    assert await _coins(db_session, A) == 300


async def test_bad_inputs(db_session):
    with pytest.raises(svc.UnknownItem):
        await svc.redeem(db_session, actor_email=A, item_id="ferrari", idempotency_key="key-ferrari-01")
    for bad in ("short", "has space!!", "x" * 31):
        with pytest.raises(svc.BadIdempotencyKey):
            await svc.redeem(db_session, actor_email=A, item_id="playlist_pick", idempotency_key=bad)


async def test_cancel_refunds_exactly_once_and_only_while_pending(db_session):
    db_session.add(_grant(A, 300, "a"))
    await db_session.flush()
    res = await svc.redeem(db_session, actor_email=A, item_id="early_out_pass", idempotency_key="cancel-key-001")
    assert await _coins(db_session, A) == 100
    row = await svc.cancel(db_session, actor_email=A, redemption_id=res.redemption.id)
    assert row.status == "cancelled" and row.refund_grant_id is not None
    assert await _coins(db_session, A) == 300
    with pytest.raises(svc.InvalidTransition):
        await svc.cancel(db_session, actor_email=A, redemption_id=res.redemption.id)  # second cancel: no second refund
    assert await _coins(db_session, A) == 300
    assert [r for r in await _ledger(db_session, A) if r[0] == "refund"] == [("refund", "early_out_pass", "f:cancel-key-001", 200)]
    # B cannot cancel A's redemption; an approved one cannot be cancelled.
    with pytest.raises(svc.NotFound):
        await svc.cancel(db_session, actor_email=B, redemption_id=res.redemption.id)
    approved = await svc.redeem(db_session, actor_email=A, item_id="coffee_voucher", idempotency_key="coffee-key-0001")
    with pytest.raises(svc.InvalidTransition):
        await svc.cancel(db_session, actor_email=A, redemption_id=approved.redemption.id)


async def test_approver_transitions_and_reject_refunds_once(db_session, monkeypatch):
    monkeypatch.setattr(settings, "REWARD_APPROVER_EMAILS", f" {APPROVER.upper()}, other@example.com ")
    db_session.add(_grant(A, 1000, "a"))
    await db_session.flush()
    pending = (await svc.redeem(db_session, actor_email=A, item_id="half_day_leave", idempotency_key="leave-key-00001")).redemption
    other = (await svc.redeem(db_session, actor_email=A, item_id="desk_plant", idempotency_key="plant-key-00001")).redemption
    assert await _coins(db_session, A) == 380

    with pytest.raises(svc.NotAllowed):
        await svc.decide(db_session, approver_email=A, redemption_id=pending.id, status="approved", note=None)
    with pytest.raises(svc.InvalidTransition):
        await svc.decide(db_session, approver_email=APPROVER, redemption_id=pending.id, status="fulfilled", note=None)  # must approve first
    with pytest.raises(svc.InvalidTransition):
        await svc.decide(db_session, approver_email=APPROVER, redemption_id=pending.id, status="cancelled", note=None)

    row = await svc.decide(db_session, approver_email=APPROVER, redemption_id=pending.id, status="approved", note="ok for Friday")
    assert (row.status, row.decided_by, row.note) == ("approved", APPROVER, "ok for Friday")
    row = await svc.decide(db_session, approver_email=APPROVER, redemption_id=pending.id, status="fulfilled", note=None)
    assert row.status == "fulfilled"
    assert await _coins(db_session, A) == 380  # approval/fulfilment never move Coins

    row = await svc.decide(db_session, approver_email=APPROVER, redemption_id=other.id, status="rejected", note="out of stock")
    assert row.status == "rejected" and row.refund_grant_id is not None
    assert await _coins(db_session, A) == 500
    with pytest.raises(svc.InvalidTransition):
        await svc.decide(db_session, approver_email=APPROVER, redemption_id=other.id, status="rejected", note=None)
    assert await _coins(db_session, A) == 500  # exactly one refund
    with pytest.raises(svc.NotFound):
        await svc.decide(db_session, approver_email=APPROVER, redemption_id="nope", status="approved", note=None)


async def test_concurrent_spends_on_separate_connections_cannot_go_negative(tmp_path):
    """Two tabs, two real connections (NullPool file DB like the dev rig), different idempotency
    keys, a balance that covers only one item. Exactly one debit lands; Coins end >= 0."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'race.db'}", poolclass=NullPool)
    app_db._set_sqlite_pragmas(engine)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with maker() as s0:
            s0.add(_grant(A, 60, "a"))
            await s0.commit()

        async def spend(key: str) -> str:
            async with maker() as s:
                try:
                    res = await svc.redeem(s, actor_email=A, item_id="coffee_voucher", idempotency_key=key)
                    await s.commit()
                    return "spent" if res.created_now else "replay"
                except svc.InsufficientCoins:
                    return "insufficient"

        outcomes = await asyncio.gather(spend("tab-one-key-0001"), spend("tab-two-key-0002"))
        assert sorted(outcomes) == ["insufficient", "spent"]
        async with maker() as check:
            assert await _coins(check, A) == 0
            assert len((await check.execute(select(RewardRedemption))).scalars().all()) == 1
    finally:
        await engine.dispose()


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


async def test_rewards_rest_flow(_app_db, monkeypatch):
    monkeypatch.setattr(settings, "REWARD_APPROVER_EMAILS", APPROVER)
    async with app_db.async_session_maker() as session:
        session.add(_grant(A, 100, "a"))
        await session.commit()
    async with _client() as client:
        assert (await client.get("/rewards/catalog")).status_code == 401
        cat = (await client.get("/rewards/catalog", headers=_as(A))).json()
        assert cat["progression"]["coins"] == 100
        by_id = {i["id"]: i for i in cat["items"]}
        assert set(by_id["coffee_voucher"]) == {"id", "title", "description", "cost", "category", "requiresApproval", "affordable"}
        assert by_id["coffee_voucher"]["affordable"] is True and by_id["desk_plant"]["affordable"] is False
        assert by_id["early_out_pass"]["requiresApproval"] is True

        # Insufficient → 409 with the repo's error shape; unknown → 404; bad key → 400.
        res = await client.post("/rewards/redeem", json={"itemId": "desk_plant", "idempotencyKey": "rest-key-000001"}, headers=_as(A))
        assert res.status_code == 409 and "Not enough Coins" in res.json()["error"]
        assert (await client.post("/rewards/redeem", json={"itemId": "nope", "idempotencyKey": "rest-key-000001"}, headers=_as(A))).status_code == 404
        assert (await client.post("/rewards/redeem", json={"itemId": "coffee_voucher", "idempotencyKey": "x"}, headers=_as(A))).status_code == 400

        res = await client.post("/rewards/redeem", json={"itemId": "playlist_pick", "idempotencyKey": "rest-key-000002"}, headers=_as(A))
        assert res.status_code == 201
        body = res.json()
        assert body["createdNow"] is True and body["redemption"]["status"] == "approved" and body["progression"]["coins"] == 60
        replay = await client.post("/rewards/redeem", json={"itemId": "playlist_pick", "idempotencyKey": "rest-key-000002"}, headers=_as(A))
        assert replay.status_code == 200 and replay.json()["createdNow"] is False and replay.json()["progression"]["coins"] == 60

        res = await client.post("/rewards/redeem", json={"itemId": "coffee_voucher", "idempotencyKey": "rest-key-000003"}, headers=_as(A))
        assert res.status_code == 201 and res.json()["progression"]["coins"] == 0
        # Pending time-off needs approval; cancel while pending refunds.
        async with app_db.async_session_maker() as session:
            session.add(_grant(A, 200, "b"))
            await session.commit()
        res = await client.post("/rewards/redeem", json={"itemId": "early_out_pass", "idempotencyKey": "rest-key-000004"}, headers=_as(A))
        pend = res.json()["redemption"]
        assert res.status_code == 201 and pend["status"] == "pending" and res.json()["progression"]["coins"] == 0

        mine = (await client.get("/rewards/redemptions/me", headers=_as(A))).json()["redemptions"]
        assert [r["itemId"] for r in mine] == ["early_out_pass", "coffee_voucher", "playlist_pick"]  # newest first
        assert set(mine[0]) == {"id", "itemId", "title", "cost", "status", "note", "createdAt", "decidedAt"}
        assert (await client.get("/rewards/redemptions/me", headers=_as(B))).json()["redemptions"] == []

        # Approver gate: employee → 403, approver → ok. Reject refunds once.
        assert (await client.post(f"/rewards/redemptions/{pend['id']}/decide", json={"status": "approved"}, headers=_as(A))).status_code == 403
        res = await client.post(f"/rewards/redemptions/{pend['id']}/decide", json={"status": "rejected", "note": "not this week"}, headers=_as(APPROVER))
        assert res.status_code == 200 and res.json()["redemption"]["status"] == "rejected" and res.json()["progression"]["coins"] == 200
        assert (await client.post(f"/rewards/redemptions/{pend['id']}/cancel", headers=_as(A))).status_code == 409  # already decided
        assert (await client.get("/progression/me", headers=_as(A))).json()["coins"] == 200

        # Cancel path over REST.
        res = await client.post("/rewards/redeem", json={"itemId": "early_out_pass", "idempotencyKey": "rest-key-000005"}, headers=_as(A))
        rid = res.json()["redemption"]["id"]
        assert res.json()["progression"]["coins"] == 0
        res = await client.post(f"/rewards/redemptions/{rid}/cancel", headers=_as(A))
        assert res.status_code == 200 and res.json()["redemption"]["status"] == "cancelled" and res.json()["progression"]["coins"] == 200
        assert (await client.post(f"/rewards/redemptions/{rid}/cancel", headers=_as(A))).status_code == 409
        assert (await client.post(f"/rewards/redemptions/{rid}/cancel", headers=_as(B))).status_code == 404
