from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - registers every model on Base.metadata
from app.database import Base, get_db
from app.main import fastapi_app
from app.repositories import hub as hub_repo

# Router-layer coverage for the Hub -> Employee Feed wiring (Employee Feed V1) — see
# backend/app/routers/hub.py's act_on_hub_item and backend/app/routers/feed.py. Mirrors
# test_requests_router.py's httpx ASGITransport + x-dev-email pattern, but overrides the get_db
# dependency with its own fresh in-memory engine (conftest.py's db_session fixture pattern)
# rather than relying on app.database's module-level engine — that engine is bound to whatever
# DATABASE_URL is configured (the real local dev sqlite file by default), and
# Base.metadata.create_all only creates MISSING tables, never migrates existing ones; reusing it
# here would silently pass or fail depending on that file's incidental schema history.

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


async def _seed_birthday_item(session_maker, target_email: str) -> str:
    async with session_maker() as session:
        item = await hub_repo.create_item(
            session,
            type="birthday",
            title="Happy Birthday",
            description="d",
            target_employee_email=target_email,
        )
        return item["id"]


async def test_wish_happy_birthday_creates_feed_activity_once(_isolated_db):
    item_id = await _seed_birthday_item(_isolated_db, "alex@example.com")

    async with await _client() as client:
        r1 = await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))
        assert r1.status_code == 200

        r2 = await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))
        assert r2.status_code == 200

        feed = await client.get("/feed/alex@example.com", headers=_headers("micah@example.com"))
        posts = feed.json()

    birthday_posts = [p for p in posts if p["type"] == "birthday"]
    assert len(birthday_posts) == 1
    assert birthday_posts[0]["authorEmail"] == "bon@example.com"
    assert birthday_posts[0]["targetEmail"] == "alex@example.com"


async def test_different_authors_each_get_their_own_birthday_activity(_isolated_db):
    item_id = await _seed_birthday_item(_isolated_db, "alex@example.com")

    async with await _client() as client:
        await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))
        await client.post(f"/hub/items/{item_id}/action", headers=_headers("micah@example.com"))

        feed = await client.get("/feed/alex@example.com", headers=_headers("alex@example.com"))
        posts = feed.json()

    authors = {p["authorEmail"] for p in posts if p["type"] == "birthday"}
    assert authors == {"bon@example.com", "micah@example.com"}


async def test_feed_react_comment_reply_persist_and_are_isolated_per_employee(_isolated_db):
    item_id = await _seed_birthday_item(_isolated_db, "alex@example.com")

    async with await _client() as client:
        await client.post(f"/hub/items/{item_id}/action", headers=_headers("bon@example.com"))
        feed = await client.get("/feed/alex@example.com", headers=_headers("bon@example.com"))
        post_id = feed.json()[0]["id"]

        react = await client.post(
            f"/feed/posts/{post_id}/react", json={"emoji": "🎉"}, headers=_headers("micah@example.com")
        )
        assert react.status_code == 200
        assert react.json()["reactions"] == [{"emoji": "🎉", "count": 1}]

        comment = await client.post(
            f"/feed/posts/{post_id}/comments",
            json={"content": "Happy birthday!!"},
            headers=_headers("micah@example.com"),
        )
        comment_id = comment.json()["comments"][0]["id"]

        reply = await client.post(
            f"/feed/posts/{post_id}/comments",
            json={"content": "Thank you!!", "parentCommentId": comment_id},
            headers=_headers("alex@example.com"),
        )
        assert reply.status_code == 201
        top_level = reply.json()["comments"][0]
        assert len(top_level["replies"]) == 1
        assert top_level["replies"][0]["authorEmail"] == "alex@example.com"

        # Refetch from a third employee's perspective — content must be identical (no
        # per-viewer leakage) except myReaction, which must be empty for someone who never
        # reacted.
        refetched = await client.get("/feed/alex@example.com", headers=_headers("someone-else@example.com"))
        refetched_post = refetched.json()[0]
        assert refetched_post["myReaction"] is None
        assert refetched_post["reactions"] == [{"emoji": "🎉", "count": 1}]
        assert len(refetched_post["comments"][0]["replies"]) == 1


async def test_delete_permissions_on_normal_posts(_isolated_db):
    async with await _client() as client:
        create = await client.post(
            "/feed/alex@example.com/posts",
            json={"content": "Great work!"},
            headers=_headers("bon@example.com"),
        )
        post_id = create.json()["id"]

        denied = await client.delete(f"/feed/posts/{post_id}", headers=_headers("micah@example.com"))
        assert denied.status_code == 403

        allowed = await client.delete(f"/feed/posts/{post_id}", headers=_headers("bon@example.com"))
        assert allowed.status_code == 204


async def test_rejects_empty_post_content(_isolated_db):
    async with await _client() as client:
        resp = await client.post(
            "/feed/alex@example.com/posts",
            json={"content": "   "},
            headers=_headers("bon@example.com"),
        )
    assert resp.status_code == 422


async def test_dev_reset_endpoint_is_gated_off_outside_development(_isolated_db, monkeypatch):
    # In production, the x-dev-email bypass itself is also gated on settings.is_development
    # (app/auth/deps.py), so an unauthenticated-looking caller already gets 401 before this
    # endpoint's own check ever runs — a real Atlas bearer token would be required first. To
    # exercise THIS endpoint's own settings.is_development guard specifically (defense in depth
    # in case that ever changes), bypass auth here via dependency_overrides rather than relying
    # on the header trick, and independently force production.
    from app.auth.deps import get_current_email
    from app.config import settings

    monkeypatch.setattr(settings, "APP_ENV", "production")
    fastapi_app.dependency_overrides[get_current_email] = lambda: "bon@example.com"
    try:
        async with await _client() as client:
            resp = await client.post("/hub/dev/reset-my-state")
    finally:
        fastapi_app.dependency_overrides.pop(get_current_email, None)

    assert resp.status_code == 404


async def test_dev_reset_endpoint_returns_401_in_production_via_the_normal_auth_gate(_isolated_db, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "APP_ENV", "production")

    async with await _client() as client:
        resp = await client.post("/hub/dev/reset-my-state", headers=_headers("bon@example.com"))

    assert resp.status_code == 401


async def test_dev_reset_endpoint_clears_only_required_dev_item_for_caller(_isolated_db):
    async with _isolated_db() as session:
        dev_item = await hub_repo.create_item(
            session,
            type="announcement",
            title="[DEV] required",
            description="d",
            priority="required",
            created_by=hub_repo.DEV_SEED_TAG,
        )
        real_item = await hub_repo.create_item(
            session, type="announcement", title="real", description="d", priority="required"
        )

    async with await _client() as client:
        # Acknowledge both a dev item and a real item as bon, plus the same dev item as micah.
        await client.post(f"/hub/items/{dev_item['id']}/acknowledge", headers=_headers("bon@example.com"))
        await client.post(f"/hub/items/{real_item['id']}/acknowledge", headers=_headers("bon@example.com"))
        await client.post(f"/hub/items/{dev_item['id']}/acknowledge", headers=_headers("micah@example.com"))

        reset = await client.post("/hub/dev/reset-my-state", headers=_headers("bon@example.com"))
        assert reset.status_code == 200
        assert reset.json() == {"resetCount": 1}

        items_for_bon = {i["id"]: i for i in (await client.get("/hub/items", headers=_headers("bon@example.com"))).json()}
        items_for_micah = {i["id"]: i for i in (await client.get("/hub/items", headers=_headers("micah@example.com"))).json()}

    # bon's dev item is back to unseen (required -> blocks again)...
    assert items_for_bon[dev_item["id"]]["myStatus"] == "unseen"
    # ...but bon's real-item acknowledgment survives...
    assert items_for_bon[real_item["id"]]["myStatus"] == "acknowledged"
    # ...and micah's acknowledgment of the SAME dev item is untouched.
    assert items_for_micah[dev_item["id"]]["myStatus"] == "acknowledged"
