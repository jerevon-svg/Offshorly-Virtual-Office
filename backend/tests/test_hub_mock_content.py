from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - registers every model on Base.metadata
from app.config import settings
from app.database import Base, get_db
from app.main import fastapi_app
from app.models.feed import FeedPost
from app.models.hub import HubItem, HubItemState
from app.repositories import feed as feed_repo
from app.repositories import hub as hub_repo
from app.repositories.hub import DEV_SEED_TAG
from app.scripts import seed_dev_hub_content as hub_mock

# Coverage for the MOCK-RIG Company Hub dataset + reset (app/scripts/seed_dev_hub_content.py,
# and routers/hub.py's dev-only reset endpoint that delegates to it). Same isolated-engine
# pattern as test_hub_feed_router.py — never touches the configured DATABASE_URL.

pytestmark = pytest.mark.asyncio

TESTER = "tester@offshorly.com"
OTHER = "someone-else@offshorly.com"


@pytest.fixture(autouse=True)
async def session_maker():
    engine = create_async_engine(
        "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_get_db():
        async with maker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    yield maker
    fastapi_app.dependency_overrides.pop(get_db, None)
    await engine.dispose()


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


# --- dataset -----------------------------------------------------------------------------


async def test_seed_creates_every_required_item_type_with_stable_ids(session_maker):
    async with session_maker() as session:
        counts = await hub_mock.ensure_seeded(session)
        assert counts["created"] == len(hub_mock.MOCK_ITEMS)

        rows = (await session.execute(select(HubItem))).scalars().all()

    assert {r.id for r in rows} == set(hub_mock.MOCK_ITEM_IDS)
    assert all(r.created_by == DEV_SEED_TAG for r in rows)

    by_type: dict[str, list[HubItem]] = {}
    for r in rows:
        by_type.setdefault(r.type, []).append(r)
    # The five kinds the mock rig has to exercise, plus the pre-existing whatsnew card.
    assert set(by_type) == {"announcement", "birthday", "recognition", "survey", "whatsnew"}
    assert len(by_type["announcement"]) == 2  # one required, one dismissible

    required = [r for r in rows if r.priority == "required"]
    assert [r.id for r in required] == ["devmock-announcement-required"]

    birthday = by_type["birthday"][0]
    recognition = by_type["recognition"][0]
    assert birthday.target_employee_email == hub_mock.BIRTHDAY_TARGET[1]
    assert recognition.target_employee_email == hub_mock.RECOGNITION_TARGET[1]
    # Everyone sees them; target_employee_email is who they're ABOUT, not who they're FOR.
    assert all(r.audience_email is None for r in rows)
    assert all(r.cta_label for r in rows)


async def test_every_seeded_item_is_active_right_now(session_maker):
    async with session_maker() as session:
        await hub_mock.ensure_seeded(session)
        active = await hub_repo.list_active_items_for(session, TESTER)

    assert {i["id"] for i in active} == set(hub_mock.MOCK_ITEM_IDS)
    # Required sorts first so it's the card that gates "Enter Office".
    assert active[0]["id"] == "devmock-announcement-required"


async def test_reseeding_refreshes_dates_instead_of_duplicating(session_maker):
    """The whole point of relative dates: a dataset seeded long ago must not age out of
    list_active_items_for's window and send the Hub back to "You're all caught up!"."""
    long_ago = datetime.now(timezone.utc) - timedelta(days=365)
    async with session_maker() as session:
        await hub_mock.ensure_seeded(session, now=long_ago)
        stale = await hub_repo.list_active_items_for(session, TESTER)
        # The windowed items have already expired; only the open-ended ones survive.
        assert {i["id"] for i in stale} < set(hub_mock.MOCK_ITEM_IDS)

        counts = await hub_mock.ensure_seeded(session)
        assert counts == {"created": 0, "refreshed": len(hub_mock.MOCK_ITEMS), "removedStale": 0}

        active = await hub_repo.list_active_items_for(session, TESTER)
        total = len((await session.execute(select(HubItem))).scalars().all())

    assert {i["id"] for i in active} == set(hub_mock.MOCK_ITEM_IDS)
    assert total == len(hub_mock.MOCK_ITEMS)


async def test_seed_drops_legacy_random_id_mock_rows(session_maker):
    async with session_maker() as session:
        legacy = await hub_repo.create_item(
            session,
            type="announcement",
            title="[DEV] Mock Announcement: Office Wi-Fi Upgrade",
            description="seeded by the old uuid4 seeder",
            priority="required",
            created_by=DEV_SEED_TAG,
        )
        await hub_repo.upsert_state(
            session, hub_item_id=legacy["id"], employee_email=TESTER, status="acknowledged"
        )

        counts = await hub_mock.ensure_seeded(session, prune_legacy=True)
        assert counts["removedStale"] == 1

        remaining = {r.id for r in (await session.execute(select(HubItem))).scalars().all()}
        orphan_states = (await session.execute(select(HubItemState))).scalars().all()

    assert legacy["id"] not in remaining
    assert remaining == set(hub_mock.MOCK_ITEM_IDS)
    assert orphan_states == []


async def test_seed_never_touches_non_mock_items(session_maker):
    async with session_maker() as session:
        real = await hub_repo.create_item(
            session,
            type="announcement",
            title="Real company announcement",
            description="not mock content",
            priority="required",
            created_by="hr@offshorly.com",
        )
        await hub_mock.ensure_seeded(session)
        still_there = await hub_repo.get_item_by_id(session, real["id"])

    assert still_there is not None
    assert still_there["title"] == "Real company announcement"


# --- required acknowledgement ------------------------------------------------------------


async def test_required_item_blocks_until_acknowledged_then_persists(session_maker):
    async with session_maker() as session:
        await hub_mock.ensure_seeded(session)

    async with _client() as client:
        headers = {"x-dev-email": TESTER}
        items = (await client.get("/hub/items", headers=headers)).json()
        required = [i for i in items if i["priority"] == "required"]
        assert len(required) == 1
        assert required[0]["myStatus"] == "unseen"

        # Dismiss must NOT satisfy the gate — hasBlockingRequiredItems only clears on
        # "acknowledged" (frontend/src/services/hub/companyHubStore.ts).
        dismissed = (
            await client.post(f"/hub/items/{required[0]['id']}/dismiss", headers=headers)
        ).json()
        assert dismissed["myStatus"] == "dismissed"

        acked = (
            await client.post(f"/hub/items/{required[0]['id']}/acknowledge", headers=headers)
        ).json()
        assert acked["myStatus"] == "acknowledged"

        # Persists across a refetch (the "refresh preserves state" requirement).
        refetched = (await client.get("/hub/items", headers=headers)).json()
        assert next(i for i in refetched if i["priority"] == "required")["myStatus"] == "acknowledged"


# --- birthday / recognition actions -------------------------------------------------------


@pytest.mark.parametrize(
    ("item_id", "feed_type", "target"),
    [
        ("devmock-birthday-micah", "birthday", hub_mock.BIRTHDAY_TARGET[1]),
        ("devmock-recognition-alex", "congratulation", hub_mock.RECOGNITION_TARGET[1]),
    ],
)
async def test_mock_action_creates_the_expected_feed_activity(
    session_maker, item_id, feed_type, target
):
    async with session_maker() as session:
        await hub_mock.ensure_seeded(session)

    async with _client() as client:
        acted = (await client.post(f"/hub/items/{item_id}/action", headers={"x-dev-email": TESTER})).json()
        assert acted["myActed"] is True

    async with session_maker() as session:
        posts = (
            (await session.execute(select(FeedPost).where(FeedPost.source_hub_item_id == item_id)))
            .scalars()
            .all()
        )

    assert len(posts) == 1
    assert (posts[0].type, posts[0].target_email, posts[0].author_email) == (feed_type, target, TESTER)


# --- reset ---------------------------------------------------------------------------------


async def test_reset_clears_state_and_feed_activity_so_actions_are_re_testable(session_maker):
    async with session_maker() as session:
        await hub_mock.ensure_seeded(session)

    async with _client() as client:
        headers = {"x-dev-email": TESTER}
        await client.post("/hub/items/devmock-announcement-required/action", headers=headers)
        await client.post("/hub/items/devmock-announcement-required/acknowledge", headers=headers)
        await client.post("/hub/items/devmock-announcement-normal/dismiss", headers=headers)
        await client.post("/hub/items/devmock-birthday-micah/action", headers=headers)
        await client.post("/hub/items/devmock-recognition-alex/action", headers=headers)

        result = (await client.post("/hub/dev/reset-my-state", headers=headers)).json()
        assert result["resetCount"] == 4
        assert result["feedActivitiesCleared"] == 2
        assert result["itemsCreated"] == 0
        assert result["itemsRefreshed"] == len(hub_mock.MOCK_ITEMS)

        after = (await client.get("/hub/items", headers=headers)).json()
        assert {i["id"] for i in after} == set(hub_mock.MOCK_ITEM_IDS)
        assert all(i["myStatus"] == "unseen" and i["myActed"] is False for i in after)

        # The Feed activity is creatable again — the point of clearing it (uq_feed_hub_activity).
        await client.post("/hub/items/devmock-birthday-micah/action", headers=headers)

    async with session_maker() as session:
        posts = (
            (
                await session.execute(
                    select(FeedPost).where(FeedPost.source_hub_item_id == "devmock-birthday-micah")
                )
            )
            .scalars()
            .all()
        )
    assert len(posts) == 1


async def test_reset_leaves_legacy_uuid_mock_rows_alone(session_maker):
    """Pruning legacy rows deletes EVERY tester's state on them, so it belongs to the seeding
    entry points (CLI / MOCK_HUB_SEED boot), not to one tester's reset."""
    async with session_maker() as session:
        legacy = await hub_repo.create_item(
            session, type="survey", title="[DEV] legacy", description="d", created_by=DEV_SEED_TAG
        )
        await hub_repo.upsert_state(
            session, hub_item_id=legacy["id"], employee_email=OTHER, status="acknowledged"
        )

    async with _client() as client:
        await client.post("/hub/dev/reset-my-state", headers={"x-dev-email": TESTER})

    async with session_maker() as session:
        assert await hub_repo.get_item_by_id(session, legacy["id"]) is not None
        states = await hub_repo.get_states_for(session, OTHER, [legacy["id"]])
    assert states[legacy["id"]]["status"] == "acknowledged"


async def test_reset_restores_deleted_mock_items(session_maker):
    async with session_maker() as session:
        await hub_mock.ensure_seeded(session)
        await hub_mock.clear_mock_content(session)
        assert (await hub_repo.list_active_items_for(session, TESTER)) == []

    async with _client() as client:
        result = (await client.post("/hub/dev/reset-my-state", headers={"x-dev-email": TESTER})).json()
        assert result["itemsCreated"] == len(hub_mock.MOCK_ITEMS)
        after = (await client.get("/hub/items", headers={"x-dev-email": TESTER})).json()

    assert {i["id"] for i in after} == set(hub_mock.MOCK_ITEM_IDS)


async def test_reset_is_scoped_to_the_caller_and_to_mock_content(session_maker):
    async with session_maker() as session:
        await hub_mock.ensure_seeded(session)
        real = await hub_repo.create_item(
            session,
            type="announcement",
            title="Real announcement",
            description="d",
            created_by="hr@offshorly.com",
        )
        await hub_repo.upsert_state(
            session, hub_item_id=real["id"], employee_email=TESTER, status="acknowledged"
        )
        await hub_repo.upsert_state(
            session,
            hub_item_id="devmock-announcement-required",
            employee_email=OTHER,
            status="acknowledged",
        )
        await feed_repo.create_hub_triggered_post(
            session,
            hub_item_id="devmock-birthday-micah",
            target_email=hub_mock.BIRTHDAY_TARGET[1],
            author_email=OTHER,
            type="birthday",
            content="wished them a Happy Birthday! 🎉",
        )

    async with _client() as client:
        await client.post("/hub/dev/reset-my-state", headers={"x-dev-email": TESTER})

    async with session_maker() as session:
        # The caller's state on the REAL item survives — reset only knows about mock content.
        real_state = await hub_repo.get_states_for(session, TESTER, [real["id"]])
        other_states = await hub_repo.get_states_for(
            session, OTHER, ["devmock-announcement-required"]
        )
        other_posts = (
            (await session.execute(select(FeedPost).where(FeedPost.author_email == OTHER)))
            .scalars()
            .all()
        )

    assert real_state[real["id"]]["status"] == "acknowledged"
    assert other_states["devmock-announcement-required"]["status"] == "acknowledged"
    assert len(other_posts) == 1


async def test_reset_endpoint_is_unreachable_outside_development(session_maker, monkeypatch):
    """Two independent gates, both keyed on the same fail-closed settings.is_development
    allow-list: the x-dev-email identity bypass (app/auth/deps.py) rejects the caller with 401
    before the route body even runs, and the route's own check would 404 it anyway. Asserting on
    "not 200" rather than on 404 keeps this honest about which gate fires first."""
    monkeypatch.setattr(settings, "APP_ENV", "production")
    async with _client() as client:
        res = await client.post("/hub/dev/reset-my-state", headers={"x-dev-email": TESTER})
    assert res.status_code in (401, 404)
