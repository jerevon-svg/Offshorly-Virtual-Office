from __future__ import annotations

import httpx
import pytest

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.toucan import ToucanConversation, ToucanMessage
from app.realtime.state import (
    call_registry,
    dnd_registry,
    offline_lineup,
    room_presence,
    spatial_sessions,
)
from app.repositories import toucan as toucan_repo
from app.services.position_registry import position_registry

# Toucan T1 — persistent conversations. Router-level coverage, ASGITransport + x-dev-email
# identity, same conventions as tests/test_toucan_router.py.
#
# The questions this file exists to answer, in order:
#   1. does a conversation belong to the person who was authenticated, and only them?
#   2. can that ownership be talked around — by an id, or by a body field?
#   3. does an exchange actually survive as BOTH turns?
#   4. do continue / start-new / reload behave the way the panel needs them to?

pytestmark = pytest.mark.asyncio

ANGELO = "angelo@example.com"
MICAH = "micah@example.com"


@pytest.fixture(autouse=True)
async def _fresh_state(isolated_app_db):
    # `isolated_app_db` FIRST, and it is not optional: it repoints the application at a
    # throwaway database before anything below runs. Without it the truncations here would
    # execute against the developer's real virtual_office_fastapi.db (see tests/conftest.py).
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(ToucanMessage.__table__.delete())
        await conn.execute(ToucanConversation.__table__.delete())

    def clear():
        offline_lineup._slot_by_email.clear()
        dnd_registry._dnd_emails.clear()
        room_presence._room_by_email.clear()
        spatial_sessions.reset()
        call_registry.reset()
        position_registry.reset()

    clear()
    yield
    clear()


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


async def _ask(client: httpx.AsyncClient, email: str, question: str, conversation_id=None):
    body: dict = {"question": question}
    if conversation_id is not None:
        body["conversationId"] = conversation_id
    return await client.post("/toucan/ask", json=body, headers=_headers(email))


# --- ownership --------------------------------------------------------------------------


async def test_a_new_conversation_belongs_to_the_authenticated_caller():
    async with await _client() as client:
        asked = await _ask(client, ANGELO, "who is online")
        assert asked.status_code == 200
        conversation_id = asked.json()["conversationId"]

        mine = await client.get("/toucan/conversations", headers=_headers(ANGELO))
        assert [c["id"] for c in mine.json()] == [conversation_id]

        # And nobody else's list contains it.
        theirs = await client.get("/toucan/conversations", headers=_headers(MICAH))
        assert theirs.json() == []


async def test_another_users_conversation_is_not_readable():
    """404 rather than 403 throughout: a 403 would confirm the id exists, which is itself a
    disclosure. Read, continue and delete must all behave identically here."""
    async with await _client() as client:
        theirs = (await _ask(client, ANGELO, "who is online")).json()["conversationId"]

        read = await client.get(f"/toucan/conversations/{theirs}", headers=_headers(MICAH))
        continued = await _ask(client, MICAH, "who is online", conversation_id=theirs)
        removed = await client.delete(f"/toucan/conversations/{theirs}", headers=_headers(MICAH))

    assert read.status_code == 404
    assert continued.status_code == 404
    assert removed.status_code == 404


async def test_a_rejected_continuation_writes_nothing():
    """The ownership check runs BEFORE any answer is produced or any row written, so a failed
    attempt on someone else's conversation cannot leave a turn behind in it."""
    async with await _client() as client:
        theirs = (await _ask(client, ANGELO, "who is online")).json()["conversationId"]
        await _ask(client, MICAH, "sneaking in", conversation_id=theirs)

        detail = await client.get(f"/toucan/conversations/{theirs}", headers=_headers(ANGELO))

    contents = [m["content"] for m in detail.json()["messages"]]
    assert "sneaking in" not in contents
    assert len(contents) == 2


async def test_body_cannot_override_the_owner():
    """extra="forbid" means an owner field is rejected outright, so an attempt to write a
    conversation as somebody else fails loudly rather than silently being ignored."""
    async with await _client() as client:
        for field in ("ownerEmail", "owner_email", "owner", "email"):
            res = await client.post(
                "/toucan/ask",
                json={"question": "who is online", field: MICAH},
                headers=_headers(ANGELO),
            )
            assert res.status_code == 422, field

        listed = await client.get("/toucan/conversations", headers=_headers(MICAH))
    assert listed.json() == []


async def test_every_persistence_endpoint_requires_authentication():
    async with await _client() as client:
        assert (await client.get("/toucan/conversations")).status_code == 401
        assert (await client.get("/toucan/conversations/latest")).status_code == 401
        assert (await client.post("/toucan/conversations")).status_code == 401
        assert (await client.get("/toucan/conversations/anything")).status_code == 401
        assert (await client.delete("/toucan/conversations/anything")).status_code == 401


# --- what gets stored -------------------------------------------------------------------


async def test_both_the_question_and_the_answer_are_persisted():
    room_presence.enter(ANGELO, "ai-room")
    async with await _client() as client:
        asked = await _ask(client, ANGELO, "who is in this room")
        answer = asked.json()
        detail = await client.get(
            f"/toucan/conversations/{answer['conversationId']}", headers=_headers(ANGELO)
        )

    messages = detail.json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "who is in this room"
    assert messages[1]["content"] == answer["text"]


async def test_the_transcript_holds_only_the_two_turns_and_nothing_about_the_office():
    """PRIVACY BOUNDARY: the answer text is stored because the user read it, but none of the
    context it was BUILT from may be. Angelo is put in a room with Micah so the context layer
    genuinely holds a roster and a room; only the worded answer may survive."""
    room_presence.enter(ANGELO, "ai-room")
    room_presence.enter(MICAH, "ai-room")
    dnd_registry.set_dnd(MICAH, True)

    async with await _client() as client:
        asked = await _ask(client, ANGELO, "who is in this room")
        conversation_id = asked.json()["conversationId"]
        detail = await client.get(
            f"/toucan/conversations/{conversation_id}", headers=_headers(ANGELO)
        )

    body = detail.json()
    # The wire shape carries a transcript and its label — no owner, no context, no snapshot.
    assert set(body) == {"id", "title", "createdAt", "updatedAt", "messages"}
    assert all(set(m) == {"id", "role", "content", "createdAt"} for m in body["messages"])
    # Not one field of the stored row is an office-state structure.
    assert ANGELO not in str(body)


async def test_the_title_comes_from_the_users_own_first_question():
    async with await _client() as client:
        first = await _ask(client, ANGELO, "where is micah")
        conversation_id = first.json()["conversationId"]
        await _ask(client, ANGELO, "who is on dnd", conversation_id=conversation_id)
        listed = await client.get("/toucan/conversations", headers=_headers(ANGELO))

    assert listed.json()[0]["title"] == "where is micah"


async def test_a_long_question_is_truncated_into_the_title_not_stored_unbounded():
    long_question = "where is " + "a" * 500
    async with await _client() as client:
        asked = await _ask(client, ANGELO, long_question)
        listed = await client.get("/toucan/conversations", headers=_headers(ANGELO))

    assert asked.status_code == 200
    assert len(listed.json()[0]["title"]) <= toucan_repo.TITLE_CHARS


# --- continue / start new / reload ------------------------------------------------------


async def test_supplying_a_conversation_id_continues_the_same_conversation():
    async with await _client() as client:
        first = (await _ask(client, ANGELO, "who is online")).json()["conversationId"]
        second = (await _ask(client, ANGELO, "who is checked out", conversation_id=first)).json()

        detail = await client.get(f"/toucan/conversations/{first}", headers=_headers(ANGELO))
        listed = await client.get("/toucan/conversations", headers=_headers(ANGELO))

    assert second["conversationId"] == first
    assert len(detail.json()["messages"]) == 4
    # Continuing must not have created a second conversation.
    assert len(listed.json()) == 1


async def test_omitting_the_conversation_id_starts_a_new_conversation():
    async with await _client() as client:
        first = (await _ask(client, ANGELO, "who is online")).json()["conversationId"]
        second = (await _ask(client, ANGELO, "who is online")).json()["conversationId"]
        listed = await client.get("/toucan/conversations", headers=_headers(ANGELO))

    assert first != second
    assert {c["id"] for c in listed.json()} == {first, second}


async def test_new_conversation_endpoint_creates_an_empty_one_that_becomes_latest():
    """The panel's "New conversation" action. Created eagerly so a refresh straight afterwards
    restores the NEW (empty) conversation rather than reopening the previous one."""
    async with await _client() as client:
        old = (await _ask(client, ANGELO, "who is online")).json()["conversationId"]
        created = await client.post("/toucan/conversations", headers=_headers(ANGELO))
        latest = await client.get("/toucan/conversations/latest", headers=_headers(ANGELO))

    assert created.status_code == 201
    new_id = created.json()["id"]
    assert new_id != old
    assert created.json()["title"] is None
    assert latest.json()["id"] == new_id
    assert latest.json()["messages"] == []


async def test_latest_returns_the_most_recently_used_conversation_with_its_transcript():
    """The refresh / re-summon path, in one round trip."""
    async with await _client() as client:
        older = (await _ask(client, ANGELO, "who is online")).json()["conversationId"]
        newer = (await _ask(client, ANGELO, "who is checked out")).json()["conversationId"]
        # Talking in the OLDER one again must move it back to the front.
        await _ask(client, ANGELO, "who is on dnd", conversation_id=older)

        latest = await client.get("/toucan/conversations/latest", headers=_headers(ANGELO))

    assert older != newer
    body = latest.json()
    assert body["id"] == older
    # Four turns: the original exchange, then the one just appended.
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user", "assistant"]
    assert [body["messages"][0]["content"], body["messages"][2]["content"]] == [
        "who is online",
        "who is on dnd",
    ]


async def test_latest_is_null_for_someone_who_has_never_asked_anything():
    """200 + null, not 404 — "you have no conversations yet" is an ordinary answer, and the
    panel branches on it to show the greeting."""
    async with await _client() as client:
        res = await client.get("/toucan/conversations/latest", headers=_headers(MICAH))
    assert res.status_code == 200
    assert res.json() is None


async def test_latest_is_scoped_to_the_caller():
    async with await _client() as client:
        await _ask(client, ANGELO, "who is online")
        mine = await client.get("/toucan/conversations/latest", headers=_headers(MICAH))
    assert mine.json() is None


# --- invalid ids and limits -------------------------------------------------------------


async def test_an_unknown_conversation_id_is_a_404_not_a_new_conversation():
    """A stale id in a browser that was open across a delete must NOT silently start a fresh
    conversation — the client is told, and can decide to start one deliberately."""
    async with await _client() as client:
        asked = await _ask(client, ANGELO, "who is online", conversation_id="does-not-exist")
        read = await client.get("/toucan/conversations/does-not-exist", headers=_headers(ANGELO))
        listed = await client.get("/toucan/conversations", headers=_headers(ANGELO))

    assert asked.status_code == 404
    assert read.status_code == 404
    assert listed.json() == []


async def test_an_oversized_conversation_id_is_rejected_before_it_reaches_the_database():
    async with await _client() as client:
        res = await _ask(client, ANGELO, "who is online", conversation_id="x" * 200)
    assert res.status_code == 422


async def test_a_null_conversation_id_is_treated_as_omitted():
    async with await _client() as client:
        res = await client.post(
            "/toucan/ask",
            json={"question": "who is online", "conversationId": None},
            headers=_headers(ANGELO),
        )
    assert res.status_code == 200
    assert res.json()["conversationId"]


async def test_the_conversation_list_size_is_bounded():
    async with await _client() as client:
        over = await client.get(
            f"/toucan/conversations?limit={toucan_repo.MAX_CONVERSATIONS_RETURNED + 1}",
            headers=_headers(ANGELO),
        )
        under = await client.get("/toucan/conversations?limit=0", headers=_headers(ANGELO))
    assert over.status_code == 422
    assert under.status_code == 422


async def test_a_conversations_transcript_is_returned_bounded():
    """Directly at the repository, because driving MAX_MESSAGES_RETURNED turns through the
    router would be slow for no extra coverage. The most RECENT turns are what survive the cap —
    that is the part the panel is scrolled to."""
    async with app_db.async_session_maker() as session:
        conv = await toucan_repo.create_conversation(session, owner_email=ANGELO)
        for i in range(5):
            await toucan_repo.append_exchange(
                session, conversation=conv, question=f"q{i}", answer=f"a{i}"
            )
        await session.commit()

        page = await toucan_repo.list_messages(session, conversation_id=conv.id, limit=4)
        clamped = await toucan_repo.list_messages(
            session, conversation_id=conv.id, limit=toucan_repo.MAX_MESSAGES_RETURNED + 1000
        )

    # 5 exchanges = 10 turns; asking for 4 returns the LAST 4, still oldest-first.
    assert [m["content"] for m in page] == ["q3", "a3", "q4", "a4"]
    assert len(clamped) == 10


async def test_stored_content_is_clamped():
    async with app_db.async_session_maker() as session:
        conv = await toucan_repo.create_conversation(session, owner_email=ANGELO)
        await toucan_repo.append_exchange(
            session,
            conversation=conv,
            question="q",
            answer="z" * (toucan_repo.MAX_STORED_CONTENT_CHARS + 500),
        )
        await session.commit()
        messages = await toucan_repo.list_messages(session, conversation_id=conv.id)

    assert len(messages[1]["content"]) == toucan_repo.MAX_STORED_CONTENT_CHARS


# --- delete -----------------------------------------------------------------------------


async def test_deleting_a_conversation_removes_it_and_its_messages():
    from sqlalchemy import func, select

    async with await _client() as client:
        conversation_id = (await _ask(client, ANGELO, "who is online")).json()["conversationId"]
        removed = await client.delete(
            f"/toucan/conversations/{conversation_id}", headers=_headers(ANGELO)
        )
        listed = await client.get("/toucan/conversations", headers=_headers(ANGELO))

    assert removed.status_code == 204
    assert listed.json() == []

    async with app_db.async_session_maker() as session:
        orphans = await session.execute(
            select(func.count())
            .select_from(ToucanMessage)
            .where(ToucanMessage.conversation_id == conversation_id)
        )
    assert orphans.scalar_one() == 0
