from __future__ import annotations

import httpx
import pytest
from sqlalchemy import select

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.quest import QuestEvent
from app.repositories import chat as chat_repo
from app.repositories import hub as hub_repo
from app.services.chat_send import TOUCAN_CHAT_SENDER, send_chat_message

# Quest Foundation over the real REST/service write paths, against the isolated throwaway DB:
# every authoritative hook (attendance, chat_send, requests, feed, hub, toucan) plus GET
# /quests/me ownership and shape. The dev x-dev-email bypass authenticates each call.

pytestmark = pytest.mark.asyncio

A, B, C, D = "a@example.com", "b@example.com", "c@example.com", "d@example.com"


@pytest.fixture(autouse=True)
async def _isolated(isolated_app_db):
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _as(email: str) -> dict[str, str]:
    return {"x-dev-email": email}


async def _quest(client: httpx.AsyncClient, email: str, quest_id: str) -> dict:
    res = await client.get("/quests/me", headers=_as(email))
    assert res.status_code == 200
    return next(q for q in res.json()["quests"] if q["id"] == quest_id)


async def _event_count(event_type: str | None = None) -> int:
    async with app_db.async_session_maker() as session:
        stmt = select(QuestEvent)
        if event_type:
            stmt = stmt.where(QuestEvent.event_type == event_type)
        return len((await session.execute(stmt)).scalars().all())


async def test_quests_me_requires_identity():
    async with _client() as client:
        assert (await client.get("/quests/me")).status_code == 401


async def test_quests_me_shape_for_a_fresh_user_is_deterministic():
    async with _client() as client:
        res = await client.get("/quests/me", headers=_as(A))
    assert res.status_code == 200
    quests = res.json()["quests"]
    assert [q["id"] for q in quests] == [
        "first_check_in",
        "visit_central_hub",
        "view_coworker_profile",
        "approach_coworker",
        "first_dm",
        "chat_unique_coworkers",
        "join_spatial_conversation",
        "use_ask_to_join",
        "give_recognition",
        "first_time_log",
        "meet_toucan",
    ]
    assert quests[0] == {
        "id": "first_check_in",
        "title": "Check in for the first time",
        "eventType": "check_in",
        "mode": "once",
        "target": 1,
        "order": 10,
        "count": 0,
        "completed": False,
        "completedAt": None,
        "rewardXp": 50,
        "rewardCoins": 10,
        "claimed": False,
        "claimedAt": None,
    }
    assert quests[5]["id"] == "chat_unique_coworkers"
    assert quests[5]["mode"] == "unique_count" and quests[5]["target"] == 3


async def test_check_in_transition_counts_once_and_duplicate_check_in_records_nothing():
    async with _client() as client:
        assert (await client.post("/attendance/check-in", headers=_as("A@Example.com"))).status_code == 200
        assert (await client.post("/attendance/check-in", headers=_as(A))).status_code == 200  # retry / double click
        q = await _quest(client, A, "first_check_in")
        other = await _quest(client, B, "first_check_in")
    assert q["completed"] is True and q["count"] == 1 and q["completedAt"] is not None
    assert other["completed"] is False and other["count"] == 0  # progress is never cross-visible
    assert await _event_count("check_in") == 1


async def test_check_out_transition_is_the_first_time_log_proxy():
    async with _client() as client:
        # Checking out without ever checking in is not a transition: nothing recorded.
        await client.post("/attendance/check-out", headers=_as(B))
        assert (await _quest(client, B, "first_time_log"))["completed"] is False

        await client.post("/attendance/check-in", headers=_as(A))
        await client.post("/attendance/check-out", headers=_as(A))
        await client.post("/attendance/check-out", headers=_as(A))  # retry
        q = await _quest(client, A, "first_time_log")
    assert q["completed"] is True and q["count"] == 1
    assert await _event_count("check_out") == 1


async def test_dm_sends_count_distinct_coworkers_and_group_or_toucan_messages_do_not():
    async with app_db.async_session_maker() as session:
        ab = await chat_repo.upsert_conversation(session, A, B)
        ac = await chat_repo.upsert_conversation(session, A, C)
        group = await chat_repo.create_group_conversation(session, A, [B, C], title="Squad")
        await session.commit()

    async def send(conv_id: str, sender: str, text: str):
        async with app_db.async_session_maker() as session:
            await send_chat_message(session, conversation_id=conv_id, sender_email=sender, text=text)

    await send(ab["id"], A, "hi b")
    await send(ab["id"], A, "hi again b")
    await send(group["id"], A, "hi squad")
    await send(ab["id"], TOUCAN_CHAT_SENDER, "toucan says hi")
    async with _client() as client:
        assert (await _quest(client, A, "first_dm"))["completed"] is True
        unique = await _quest(client, A, "chat_unique_coworkers")
        assert unique["count"] == 1 and unique["completed"] is False
        assert (await _quest(client, B, "first_dm"))["completed"] is False  # receiving is not sending

        await send(ac["id"], A, "hi c")
        assert (await _quest(client, A, "chat_unique_coworkers"))["count"] == 2
    assert await _event_count("dm_sent") == 3
    assert await _event_count("group_message_sent") == 0  # nothing subscribes → not stored


async def test_ask_to_join_request_counts_once_even_when_retried():
    async with app_db.async_session_maker() as session:
        group = await chat_repo.create_group_conversation(session, A, [B], title="Squad")
        await session.commit()
    async with _client() as client:
        body = {"kind": "join_group", "conversationId": group["id"]}
        assert (await client.post("/requests", json=body, headers=_as(D))).status_code == 201
        assert (await client.post("/requests", json=body, headers=_as(D))).status_code == 201  # idempotent repeat
        q = await _quest(client, D, "use_ask_to_join")
    assert q["completed"] is True and q["count"] == 1
    assert await _event_count("ask_to_join") == 1


async def test_recognition_via_feed_post_and_reaction_but_never_self_directed():
    async with _client() as client:
        # A posts on their OWN feed: not a social act.
        own = await client.post(f"/feed/{A}/posts", json={"content": "note to self"}, headers=_as(A))
        assert own.status_code == 201
        assert (await _quest(client, A, "give_recognition"))["completed"] is False

        # A posts on B's feed: counts for A.
        res = await client.post(f"/feed/{B}/posts", json={"content": "great work"}, headers=_as(A))
        assert res.status_code == 201
        post_id = res.json()["id"]
        assert (await _quest(client, A, "give_recognition"))["completed"] is True

        # A reacting to their own post: nothing. B reacting to A's post (twice, different emoji): once.
        await client.post(f"/feed/posts/{post_id}/react", json={"emoji": "❤️"}, headers=_as(A))
        await client.post(f"/feed/posts/{post_id}/react", json={"emoji": "❤️"}, headers=_as(B))
        await client.post(f"/feed/posts/{post_id}/react", json={"emoji": "👏"}, headers=_as(B))
        assert (await _quest(client, B, "give_recognition"))["completed"] is True
    assert await _event_count("recognition_given") == 2


async def test_hub_congratulation_cta_counts_once_across_repeat_clicks():
    async with app_db.async_session_maker() as session:
        item = await hub_repo.create_item(
            session, type="recognition", title="Kudos", description="d", target_employee_email=B
        )
        await session.commit()
    async with _client() as client:
        for _ in range(2):
            assert (await client.post(f"/hub/items/{item['id']}/action", headers=_as(A))).status_code == 200
        assert (await _quest(client, A, "give_recognition"))["completed"] is True
        assert (await _quest(client, B, "give_recognition"))["completed"] is False
    assert await _event_count("recognition_given") == 1


async def test_toucan_ask_completes_meet_toucan_for_the_asker_only():
    async with _client() as client:
        res = await client.post("/toucan/ask", json={"question": "who is online"}, headers=_as(A))
        assert res.status_code == 200
        assert (await _quest(client, A, "meet_toucan"))["completed"] is True
        assert (await _quest(client, B, "meet_toucan"))["completed"] is False
    assert await _event_count("toucan_asked") == 1


async def test_hub_open_completes_visit_central_hub_once_for_the_viewer_only():
    async with _client() as client:
        assert (await client.get("/hub/items", headers=_as(A))).status_code == 200
        assert (await client.get("/hub/items", headers=_as(A))).status_code == 200  # reopen
        q = await _quest(client, A, "visit_central_hub")
        assert q["count"] == 1 and q["completed"] is True and q["completedAt"] is not None
        assert (await _quest(client, B, "visit_central_hub"))["completed"] is False
    assert await _event_count("hub_visited") == 1


async def test_viewing_a_coworker_profile_counts_once_and_own_profile_never_counts():
    async with _client() as client:
        assert (await client.get(f"/feed/{A}", headers=_as(A))).status_code == 200  # own profile
        assert (await _quest(client, A, "view_coworker_profile"))["completed"] is False
        assert await _event_count("profile_viewed") == 0

        assert (await client.get(f"/feed/{B}", headers=_as(A))).status_code == 200
        assert (await client.get(f"/feed/{B}", headers=_as(A))).status_code == 200  # same profile again
        assert (await client.get(f"/feed/{C}", headers=_as(A))).status_code == 200  # second coworker
        q = await _quest(client, A, "view_coworker_profile")
        assert q["count"] == 1 and q["completed"] is True
        # The viewed person gains nothing from being looked at.
        assert (await _quest(client, B, "view_coworker_profile"))["completed"] is False
    # Keyed per actor+target+UTC day (missions need recurrence): B twice collapses, C is new.
    assert await _event_count("profile_viewed") == 2
