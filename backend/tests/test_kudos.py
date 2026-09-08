from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - registers every model on Base.metadata
from app.database import Base, get_db
from app.main import fastapi_app
from app.models.quest import QuestEvent
from app.models.reward import RewardGrant
from app.repositories import hub as hub_repo
from app.services.quests import rewards

# Kudos (company terminology for the recognition act). Covers the one behavioural addition:
# the RECIPIENT of a Kudos is paid from the existing reward_grants ledger, server-side and
# idempotently, while the GIVER keeps only their ordinary quest/mission/badge progression.
# Same isolated-engine fixture as test_hub_feed_router.py.

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _isolated_db():
    engine = create_async_engine(
        "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with session_maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    yield session_maker
    fastapi_app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


async def _seed_kudos_item(session_maker, target_email: str) -> str:
    async with session_maker() as session:
        item = await hub_repo.create_item(
            session,
            type="recognition",
            title="Employee of the Month",
            description="d",
            cta_label="Give Kudos",
            target_employee_email=target_email,
        )
        return item["id"]


async def _grants(session_maker, actor: str) -> list[RewardGrant]:
    async with session_maker() as session:
        rows = await session.execute(select(RewardGrant).where(RewardGrant.actor_email == actor))
        return list(rows.scalars().all())


async def test_giving_kudos_pays_the_recipient_once_and_preserves_the_feed_activity(_isolated_db):
    item_id = await _seed_kudos_item(_isolated_db, "alex@example.com")

    async with await _client() as client:
        assert (await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))).status_code == 200
        # Re-click: the Feed activity is idempotent, so the payout must be too.
        assert (await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))).status_code == 200

        feed = await client.get("/feed/alex@example.com", headers=_headers("micah@example.com"))
        posts = feed.json()
        progression = await client.get("/progression/me", headers=_headers("alex@example.com"))

    kudos_posts = [p for p in posts if p["type"] == "congratulation"]
    assert len(kudos_posts) == 1
    assert kudos_posts[0]["authorEmail"] == "bon@example.com"

    grants = await _grants(_isolated_db, "alex@example.com")
    assert len(grants) == 1
    assert (grants[0].source, grants[0].quest_id) == (rewards.SOURCE_KUDOS, rewards.KUDOS_RECEIVED_ID)
    assert (grants[0].xp, grants[0].coins) == (rewards.REWARD_KUDOS_RECEIVED.xp, rewards.REWARD_KUDOS_RECEIVED.coins)
    assert grants[0].period_key == rewards.kudos_period_key(kudos_posts[0]["id"])

    body = progression.json()
    assert body["xp"] == rewards.REWARD_KUDOS_RECEIVED.xp
    assert body["coins"] == rewards.REWARD_KUDOS_RECEIVED.coins


async def test_the_giver_is_not_paid_the_recipient_reward(_isolated_db):
    item_id = await _seed_kudos_item(_isolated_db, "alex@example.com")

    async with await _client() as client:
        await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))

    assert await _grants(_isolated_db, "bon@example.com") == []


async def test_recipient_reward_beats_every_repeatable_engagement_reward(_isolated_db):
    assert rewards.REWARD_KUDOS_RECEIVED.xp > rewards.REWARD_MISSION_WEEKLY.xp
    assert rewards.REWARD_KUDOS_RECEIVED.xp > rewards.REWARD_MISSION_DAILY.xp
    assert rewards.REWARD_KUDOS_RECEIVED.xp > rewards.REWARD_QUEST_ONCE.xp
    assert rewards.REWARD_KUDOS_RECEIVED.coins > rewards.REWARD_MISSION_WEEKLY.coins


async def test_self_kudos_creates_no_activity_and_pays_nothing(_isolated_db):
    item_id = await _seed_kudos_item(_isolated_db, "alex@example.com")

    async with await _client() as client:
        resp = await client.post(f"/hub/items/{item_id}/action", headers=_headers("alex@example.com"))
        assert resp.status_code == 200
        assert resp.json()["myActed"] is True  # the interaction itself is still recorded
        feed = await client.get("/feed/alex@example.com", headers=_headers("alex@example.com"))

    assert feed.json() == []
    assert await _grants(_isolated_db, "alex@example.com") == []


async def test_a_birthday_wish_does_not_pay_the_kudos_reward(_isolated_db):
    async with _isolated_db() as session:
        item = await hub_repo.create_item(
            session, type="birthday", title="Happy Birthday", description="d",
            target_employee_email="alex@example.com",
        )
    async with await _client() as client:
        await client.post(f"/hub/items/{item['id']}/action", headers=_headers("bon@example.com"))
        feed = await client.get("/feed/alex@example.com", headers=_headers("bon@example.com"))

    assert [p["type"] for p in feed.json()] == ["birthday"]
    assert await _grants(_isolated_db, "alex@example.com") == []


async def test_kudos_period_key_fits_the_ledger_column(_isolated_db):
    key = rewards.kudos_period_key("11111111-2222-3333-4444-555555555555")
    assert key == "11111111222233334444555555555555"
    assert len(key) <= 32


async def test_kudos_pseudo_id_is_not_claimable_through_the_claim_endpoint(_isolated_db):
    item_id = await _seed_kudos_item(_isolated_db, "alex@example.com")
    async with await _client() as client:
        await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))
        feed = await client.get("/feed/alex@example.com", headers=_headers("alex@example.com"))
        post_id = feed.json()[0]["id"]
        resp = await client.post(
            "/progression/claim",
            json={"questId": rewards.KUDOS_RECEIVED_ID, "periodKey": rewards.kudos_period_key(post_id)},
            headers=_headers("alex@example.com"),
        )
    assert resp.status_code == 404
    # ...and the automatic grant is still the only one.
    assert len(await _grants(_isolated_db, "alex@example.com")) == 1


# --- The explicit Give Kudos action ------------------------------------------------------------
# A normal Feed post is ordinary engagement: no quest event, no payout. Kudos is its own act.


async def _kudos(client, giver: str, recipient: str, message: str = "Great Job!"):
    return await client.post(
        f"/feed/{recipient}/kudos", json={"message": message}, headers=_headers(giver)
    )


async def _events(session_maker, giver: str) -> list[QuestEvent]:
    async with session_maker() as session:
        rows = await session.execute(select(QuestEvent).where(QuestEvent.actor_email == giver))
        return list(rows.scalars().all())


async def test_a_normal_feed_post_records_nothing_and_pays_nobody(_isolated_db):
    async with await _client() as client:
        create = await client.post(
            "/feed/jan@example.com/posts", json={"content": "Great Job!"}, headers=_headers("bon@example.com")
        )
        assert create.status_code == 201
        assert create.json()["type"] == "post"
        assert create.json()["canDelete"] is True  # still an ordinary, deletable post

    assert await _grants(_isolated_db, "jan@example.com") == []
    assert await _events(_isolated_db, "bon@example.com") == []


async def test_give_kudos_posts_the_message_pays_the_recipient_and_advances_the_giver(_isolated_db):
    async with await _client() as client:
        resp = await _kudos(client, "bon@example.com", "jan@example.com", "Saved the release 🙌")
        assert resp.status_code == 201
        assert resp.json()["type"] == "recognition"
        assert resp.json()["content"] == "Saved the release 🙌"  # the Feed activity carries the message

        feed = await client.get("/feed/jan@example.com", headers=_headers("micah@example.com"))
        progression = await client.get("/progression/me", headers=_headers("jan@example.com"))
        quests = await client.get("/quests/me", headers=_headers("bon@example.com"))

    assert [p["type"] for p in feed.json()] == ["recognition"]

    grants = await _grants(_isolated_db, "jan@example.com")
    assert len(grants) == 1
    assert (grants[0].xp, grants[0].coins) == (rewards.REWARD_KUDOS_RECEIVED.xp, rewards.REWARD_KUDOS_RECEIVED.coins)
    assert progression.json()["xp"] == rewards.REWARD_KUDOS_RECEIVED.xp
    assert progression.json()["coins"] == rewards.REWARD_KUDOS_RECEIVED.coins

    # The giver's existing progression still advances — quest, missions and the badge metric all
    # hang off the one recognition_given event.
    events = await _events(_isolated_db, "bon@example.com")
    assert [(e.event_type, e.target_email) for e in events] == [("recognition_given", "jan@example.com")]
    assert next(q for q in quests.json()["quests"] if q["id"] == "give_recognition")["completed"] is True


async def test_self_kudos_is_refused(_isolated_db):
    async with await _client() as client:
        resp = await _kudos(client, "bon@example.com", "bon@example.com")
        assert resp.status_code == 400
        feed = await client.get("/feed/bon@example.com", headers=_headers("bon@example.com"))

    assert feed.json() == []
    assert await _grants(_isolated_db, "bon@example.com") == []


async def test_blank_kudos_message_is_rejected(_isolated_db):
    async with await _client() as client:
        resp = await _kudos(client, "bon@example.com", "jan@example.com", "   ")
    assert resp.status_code == 422


# --- Anti-farming V1: one rewarded Kudos per giver->recipient pair per rolling 7 days ----------


async def test_second_kudos_to_the_same_person_posts_but_awards_nothing(_isolated_db):
    async with await _client() as client:
        await _kudos(client, "bon@example.com", "jan@example.com", "first")
        second = await _kudos(client, "bon@example.com", "jan@example.com", "second")
        assert second.status_code == 201  # still posted, still visible on the Feed
        feed = await client.get("/feed/jan@example.com", headers=_headers("jan@example.com"))
        progression = await client.get("/progression/me", headers=_headers("jan@example.com"))

    assert sorted(p["content"] for p in feed.json()) == ["first", "second"]
    # Reward is paid once...
    assert len(await _grants(_isolated_db, "jan@example.com")) == 1
    assert progression.json()["xp"] == rewards.REWARD_KUDOS_RECEIVED.xp
    # ...and quest/mission/badge progression cannot be farmed either: only one event exists.
    assert len(await _events(_isolated_db, "bon@example.com")) == 1


async def test_the_cooldown_is_per_pair_not_per_giver(_isolated_db):
    async with await _client() as client:
        await _kudos(client, "bon@example.com", "jan@example.com")
        other = await _kudos(client, "bon@example.com", "alex@example.com")
        assert other.status_code == 201

    assert len(await _grants(_isolated_db, "alex@example.com")) == 1
    assert len(await _grants(_isolated_db, "jan@example.com")) == 1
    # Two DIFFERENT recipients, so the unique-count mission/badge metrics still see both.
    assert len(await _events(_isolated_db, "bon@example.com")) == 2


async def test_a_different_giver_is_not_blocked_by_someone_elses_cooldown(_isolated_db):
    async with await _client() as client:
        await _kudos(client, "bon@example.com", "jan@example.com")
        await _kudos(client, "micah@example.com", "jan@example.com")

    assert len(await _grants(_isolated_db, "jan@example.com")) == 2


async def test_the_reward_returns_once_the_rolling_window_has_passed(_isolated_db):
    async with await _client() as client:
        await _kudos(client, "bon@example.com", "jan@example.com", "first")
        # Age the recorded event past the window — the cooldown reads occurred_at, so this is
        # exactly what the passage of 7 days looks like to it.
        async with _isolated_db() as session:
            row = (await session.execute(select(QuestEvent))).scalars().one()
            row.occurred_at = datetime.now(timezone.utc) - timedelta(days=rewards.KUDOS_COOLDOWN_DAYS, hours=1)
            await session.commit()

        again = await _kudos(client, "bon@example.com", "jan@example.com", "later")
        assert again.status_code == 201

    assert len(await _grants(_isolated_db, "jan@example.com")) == 2
    assert len(await _events(_isolated_db, "bon@example.com")) == 2


async def test_a_reaction_does_not_consume_the_kudos_cooldown(_isolated_db):
    """Reactions share the recognition_given event type but are not Kudos — the dedupe-key
    prefix is what keeps the pair probe from confusing the two."""
    async with await _client() as client:
        post = await client.post(
            "/feed/jan@example.com/posts", json={"content": "hello"}, headers=_headers("micah@example.com")
        )
        await client.post(
            f"/feed/posts/{post.json()['id']}/react", json={"emoji": "🎉"}, headers=_headers("bon@example.com")
        )
        # Bon reacted to a post authored by Jan; a Kudos to Jan must still be rewarded.
        resp = await _kudos(client, "bon@example.com", "jan@example.com")
        assert resp.status_code == 201

    assert len(await _grants(_isolated_db, "jan@example.com")) == 1


# --- Hub Kudos shares the one cooldown rule ----------------------------------------------------


async def test_hub_kudos_and_profile_kudos_share_one_cooldown(_isolated_db):
    """The Hub CTA and the profile action are the same act, so one rewards the giver's pair and
    the other must then find the cooldown already spent — in BOTH orders."""
    item_id = await _seed_kudos_item(_isolated_db, "alex@example.com")

    async with await _client() as client:
        # Profile first, then the Hub CTA for the same pair.
        assert (await _kudos(client, "bon@example.com", "alex@example.com")).status_code == 201
        assert (await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))).status_code == 200
        feed = await client.get("/feed/alex@example.com", headers=_headers("alex@example.com"))

    # Both activities are on the Feed...
    assert sorted(p["type"] for p in feed.json()) == ["congratulation", "recognition"]
    # ...but the pair was rewarded once, and progressed once.
    assert len(await _grants(_isolated_db, "alex@example.com")) == 1
    assert len(await _events(_isolated_db, "bon@example.com")) == 1


async def test_hub_kudos_first_then_profile_kudos_is_not_rewarded_twice(_isolated_db):
    item_id = await _seed_kudos_item(_isolated_db, "alex@example.com")

    async with await _client() as client:
        assert (await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))).status_code == 200
        assert (await _kudos(client, "bon@example.com", "alex@example.com")).status_code == 201
        progression = await client.get("/progression/me", headers=_headers("alex@example.com"))

    assert len(await _grants(_isolated_db, "alex@example.com")) == 1
    assert progression.json()["xp"] == rewards.REWARD_KUDOS_RECEIVED.xp
    assert len(await _events(_isolated_db, "bon@example.com")) == 1


async def test_hub_kudos_cooldown_is_per_giver_and_lifts_after_the_window(_isolated_db):
    item_id = await _seed_kudos_item(_isolated_db, "alex@example.com")

    async with await _client() as client:
        await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))
        # A DIFFERENT giver on the same Hub item is unaffected.
        await client.post(f"/hub/items/{item_id}/action", headers=_headers("micah@example.com"))
        assert len(await _grants(_isolated_db, "alex@example.com")) == 2

        # Age Bon's Kudos event past the window; his next Kudos to Alex is eligible again.
        async with _isolated_db() as session:
            row = (
                await session.execute(select(QuestEvent).where(QuestEvent.actor_email == "bon@example.com"))
            ).scalars().one()
            row.occurred_at = datetime.now(timezone.utc) - timedelta(days=rewards.KUDOS_COOLDOWN_DAYS, hours=1)
            await session.commit()

        assert (await _kudos(client, "bon@example.com", "alex@example.com")).status_code == 201

    assert len(await _grants(_isolated_db, "alex@example.com")) == 3


async def test_a_hub_birthday_wish_is_never_gated_by_the_kudos_cooldown(_isolated_db):
    """A birthday wish is ordinary engagement: it keeps its own key family, so it neither
    consumes the Kudos cooldown nor gets withheld by one."""
    async with _isolated_db() as session:
        bday = await hub_repo.create_item(
            session, type="birthday", title="Happy Birthday", description="d",
            target_employee_email="alex@example.com",
        )

    async with await _client() as client:
        await _kudos(client, "bon@example.com", "alex@example.com")
        assert (await client.post(f"/hub/items/{bday['id']}/action", headers=_headers("bon@example.com"))).status_code == 200

    # The birthday still recorded its own event, and paid nothing.
    events = await _events(_isolated_db, "bon@example.com")
    assert sorted(e.dedupe_key.split(":")[0] for e in events) == ["kudos", "post"]
    assert len(await _grants(_isolated_db, "alex@example.com")) == 1


async def test_repeat_hub_clicks_still_collapse_to_one_activity_and_one_reward(_isolated_db):
    item_id = await _seed_kudos_item(_isolated_db, "alex@example.com")

    async with await _client() as client:
        for _ in range(3):
            assert (await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))).status_code == 200
        feed = await client.get("/feed/alex@example.com", headers=_headers("alex@example.com"))

    assert len(feed.json()) == 1  # existing Hub idempotency preserved
    assert len(await _grants(_isolated_db, "alex@example.com")) == 1
    assert len(await _events(_isolated_db, "bon@example.com")) == 1

