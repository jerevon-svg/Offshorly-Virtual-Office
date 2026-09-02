from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.models.toucan import ToucanMemory, ToucanResource
from app.repositories import toucan_memory as memory_repo
from app.services.toucan.memory_commands import (
    NO_MEMORIES_TEXT,
    parse_memory_command,
)

# Toucan T4 — important memory + resource references. Router-level coverage over the isolated
# app DB, same conventions as tests/test_toucan_persistence.py. The questions, in order:
#
#   1. does an EXPLICIT command save, list and forget — and does anything else stay unsaved?
#   2. is a memory durable across conversations and across a storage close/reopen (a restart)?
#   3. is everything owner-scoped — list, forget, REST delete, and the resource attach points?
#   4. can ownership be talked around by a body field? (it must 422, loudly)
#   5. do resources hold references only — no path for a file body into SQLite?

pytestmark = pytest.mark.asyncio

ANGELO = "angelo@example.com"
MICAH = "micah@example.com"

DEMO_FACT = "the Virtual Office demo is Friday"


@pytest.fixture(autouse=True)
async def _fresh_db(isolated_app_db):
    # isolated_app_db FIRST and not optional — see tests/conftest.py. Tables are created by the
    # fixture; this only clears the ones this file writes, inside the throwaway DB.
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(ToucanResource.__table__.delete())
        await conn.execute(ToucanMemory.__table__.delete())
    yield


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


async def _ask(client: httpx.AsyncClient, email: str, question: str, conversation_id=None):
    body: dict = {"question": question}
    if conversation_id is not None:
        body["conversationId"] = conversation_id
    return await client.post("/toucan/ask", json=body, headers=_headers(email))


# --- explicit save / list / forget through chat -------------------------------------------


async def test_remember_command_saves_and_list_command_returns_it():
    async with await _client() as client:
        saved = await _ask(client, ANGELO, f"Remember that {DEMO_FACT}.")
        assert saved.status_code == 200
        assert saved.json()["intent"] == "memory_save"
        assert DEMO_FACT in saved.json()["text"]

        listed = await _ask(client, ANGELO, "What do you remember?")
        assert listed.json()["intent"] == "memory_list"
        assert DEMO_FACT in listed.json()["text"]


async def test_save_note_command_saves_a_note_kind():
    async with await _client() as client:
        await _ask(client, ANGELO, "Save this note: finish the meeting-room design")
        res = await client.get("/toucan/memories", headers=_headers(ANGELO))
    rows = res.json()
    assert len(rows) == 1
    assert rows[0]["kind"] == "note"
    assert rows[0]["content"] == "finish the meeting-room design"


async def test_memory_survives_a_new_conversation():
    async with await _client() as client:
        await _ask(client, ANGELO, "Remember this: we decided to use the standard flow")
        fresh = await client.post("/toucan/conversations", headers=_headers(ANGELO))
        listed = await _ask(
            client, ANGELO, "What have I asked you to remember?", fresh.json()["id"]
        )
    assert listed.json()["intent"] == "memory_list"
    assert "we decided to use the standard flow" in listed.json()["text"]


async def test_forget_command_deletes_the_exact_memory_only():
    async with await _client() as client:
        await _ask(client, ANGELO, f"Remember that {DEMO_FACT}.")
        await _ask(client, ANGELO, "Remember that the retro is Monday")

        forgotten = await _ask(client, ANGELO, f"Forget that {DEMO_FACT}")
        assert forgotten.json()["intent"] == "memory_forget"

        res = await client.get("/toucan/memories", headers=_headers(ANGELO))
    contents = [r["content"] for r in res.json()]
    assert contents == ["the retro is Monday"]


async def test_forgetting_something_never_saved_deletes_nothing_and_says_so():
    async with await _client() as client:
        await _ask(client, ANGELO, f"Remember that {DEMO_FACT}")
        missed = await _ask(client, ANGELO, "Forget that the sky is green")
        res = await client.get("/toucan/memories", headers=_headers(ANGELO))
    assert "don't have" in missed.json()["text"]
    assert len(res.json()) == 1


async def test_ordinary_messages_never_become_memories():
    """The structural guarantee: only the explicit command phrasings write to the memory table.
    A question, small talk, even a sentence CONTAINING private-sounding content — nothing lands."""
    async with await _client() as client:
        for question in (
            "who is online",
            "where is micah",
            "what did I miss",
            "my password is hunter2",  # typed content, but never asked to be remembered
            "I think we should remember to test",  # "remember" mid-sentence is not a command
        ):
            res = await _ask(client, ANGELO, question)
            assert res.status_code == 200
            assert res.json()["intent"] not in ("memory_save", "memory_list", "memory_forget"), question
        listing = await client.get("/toucan/memories", headers=_headers(ANGELO))
    assert listing.json() == []


async def test_memory_answers_are_still_recorded_in_conversation_history_but_stay_separate():
    """The command exchange lands in the TRANSCRIPT (it happened) while the fact lands in the
    MEMORY table — two stores, and deleting the conversation must not delete the memory."""
    async with await _client() as client:
        saved = await _ask(client, ANGELO, f"Remember that {DEMO_FACT}")
        conversation_id = saved.json()["conversationId"]

        detail = await client.get(
            f"/toucan/conversations/{conversation_id}", headers=_headers(ANGELO)
        )
        assert any(f"Remember that {DEMO_FACT}" in m["content"] for m in detail.json()["messages"])

        deleted = await client.delete(
            f"/toucan/conversations/{conversation_id}", headers=_headers(ANGELO)
        )
        assert deleted.status_code == 204

        listing = await client.get("/toucan/memories", headers=_headers(ANGELO))
    assert [r["content"] for r in listing.json()] == [DEMO_FACT]


# --- durability across a storage close/reopen (backend restart) ----------------------------


async def test_memory_survives_storage_reopen(tmp_path):
    """A file-backed engine is written, DISPOSED, and reopened cold by a brand-new engine — the
    closest a test can come to killing and restarting the backend process."""
    db_file = tmp_path / "restart_memory.db"

    def _engine():
        return create_async_engine(
            f"sqlite+aiosqlite:///{db_file}",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

    first = _engine()
    async with first.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(first, class_=AsyncSession, expire_on_commit=False)() as session:
        await memory_repo.save_memory(session, owner_email=ANGELO, content=DEMO_FACT, kind="fact")
        await session.commit()
    await first.dispose()

    second = _engine()
    async with async_sessionmaker(second, class_=AsyncSession, expire_on_commit=False)() as session:
        rows = await memory_repo.list_memories(session, owner_email=ANGELO)
    await second.dispose()

    assert [r["content"] for r in rows] == [DEMO_FACT]


# --- ownership / privacy --------------------------------------------------------------------


async def test_memories_are_private_to_their_owner():
    async with await _client() as client:
        await _ask(client, ANGELO, f"Remember that {DEMO_FACT}")

        micah_chat = await _ask(client, MICAH, "What do you remember?")
        assert micah_chat.json()["text"] == NO_MEMORIES_TEXT

        micah_rest = await client.get("/toucan/memories", headers=_headers(MICAH))
        assert micah_rest.json() == []


async def test_forget_cannot_reach_another_users_memory():
    async with await _client() as client:
        await _ask(client, ANGELO, f"Remember that {DEMO_FACT}")
        await _ask(client, MICAH, f"Forget that {DEMO_FACT}")
        listing = await client.get("/toucan/memories", headers=_headers(ANGELO))
    assert len(listing.json()) == 1


async def test_rest_delete_is_ownership_scoped_and_404s_for_foreign_ids():
    async with await _client() as client:
        created = await client.post(
            "/toucan/memories", json={"content": DEMO_FACT}, headers=_headers(ANGELO)
        )
        memory_id = created.json()["id"]

        foreign = await client.delete(f"/toucan/memories/{memory_id}", headers=_headers(MICAH))
        assert foreign.status_code == 404

        still_there = await client.get("/toucan/memories", headers=_headers(ANGELO))
        assert len(still_there.json()) == 1

        own = await client.delete(f"/toucan/memories/{memory_id}", headers=_headers(ANGELO))
        assert own.status_code == 204


async def test_request_body_cannot_spoof_the_owner():
    """extra="forbid" turns a smuggled identity into a loud 422 — on the memory POST and on the
    resource POST alike."""
    async with await _client() as client:
        for payload in (
            {"content": "x", "ownerEmail": MICAH},
            {"content": "x", "owner_email": MICAH},
            {"content": "x", "email": MICAH},
        ):
            res = await client.post("/toucan/memories", json=payload, headers=_headers(ANGELO))
            assert res.status_code == 422, payload

        res = await client.post(
            "/toucan/resources",
            json={"displayName": "doc", "ownerEmail": MICAH},
            headers=_headers(ANGELO),
        )
        assert res.status_code == 422


# --- bounded retrieval ----------------------------------------------------------------------


async def test_chat_listing_is_bounded_to_the_answer_limit():
    async with app_db.async_session_maker() as session:
        for i in range(memory_repo.MEMORY_ANSWER_LIMIT + 5):
            await memory_repo.save_memory(session, owner_email=ANGELO, content=f"fact {i}", kind="fact")
        await session.commit()

    async with await _client() as client:
        res = await _ask(client, ANGELO, "What do you remember?")
    bullets = [line for line in res.json()["text"].splitlines() if line.startswith("•")]
    assert len(bullets) == memory_repo.MEMORY_ANSWER_LIMIT


async def test_repository_list_caps_the_limit(db_session):
    for i in range(3):
        await memory_repo.save_memory(db_session, owner_email=ANGELO, content=f"m{i}")
    rows = await memory_repo.list_memories(db_session, owner_email=ANGELO, limit=100000)
    assert len(rows) == 3  # capped, not erroring — and the cap itself is MAX_MEMORIES_RETURNED
    over = await memory_repo.list_memories(db_session, owner_email=ANGELO, limit=0)
    assert len(over) == 1  # floored to 1


# --- resources: references only, owner-scoped ------------------------------------------------


async def test_resource_metadata_persists_and_lists_for_its_owner_only():
    async with await _client() as client:
        created = await client.post(
            "/toucan/resources",
            json={
                "displayName": "Design brief",
                "locator": "https://example.com/brief.pdf",
                "mediaType": "application/pdf",
            },
            headers=_headers(ANGELO),
        )
        assert created.status_code == 201
        assert created.json()["displayName"] == "Design brief"

        mine = await client.get("/toucan/resources", headers=_headers(ANGELO))
        assert len(mine.json()) == 1

        theirs = await client.get("/toucan/resources", headers=_headers(MICAH))
        assert theirs.json() == []

        foreign_delete = await client.delete(
            f"/toucan/resources/{created.json()['id']}", headers=_headers(MICAH)
        )
        assert foreign_delete.status_code == 404


async def test_resource_cannot_attach_to_another_users_conversation_or_memory():
    async with await _client() as client:
        asked = await _ask(client, ANGELO, "who is online")
        angelo_conversation = asked.json()["conversationId"]
        angelo_memory = (
            await client.post(
                "/toucan/memories", json={"content": DEMO_FACT}, headers=_headers(ANGELO)
            )
        ).json()["id"]

        for payload in (
            {"displayName": "doc", "conversationId": angelo_conversation},
            {"displayName": "doc", "memoryId": angelo_memory},
        ):
            res = await client.post("/toucan/resources", json=payload, headers=_headers(MICAH))
            assert res.status_code == 404, payload


async def test_deleting_a_memory_severs_the_resource_link_but_keeps_the_resource():
    async with await _client() as client:
        memory_id = (
            await client.post(
                "/toucan/memories", json={"content": DEMO_FACT}, headers=_headers(ANGELO)
            )
        ).json()["id"]
        resource = await client.post(
            "/toucan/resources",
            json={"displayName": "agenda", "memoryId": memory_id},
            headers=_headers(ANGELO),
        )
        assert resource.json()["memoryId"] == memory_id

        await client.delete(f"/toucan/memories/{memory_id}", headers=_headers(ANGELO))

        listing = await client.get("/toucan/resources", headers=_headers(ANGELO))
    rows = listing.json()
    assert len(rows) == 1
    assert rows[0]["memoryId"] is None


async def test_no_body_content_can_ride_into_a_resource():
    """There is no field a file body fits in: unknown fields 422, and the locator is bounded far
    below any useful payload."""
    async with await _client() as client:
        smuggle = await client.post(
            "/toucan/resources",
            json={"displayName": "doc", "data": "aGVsbG8=" * 1000},
            headers=_headers(ANGELO),
        )
        assert smuggle.status_code == 422

        oversized = await client.post(
            "/toucan/resources",
            json={"displayName": "doc", "locator": "x" * 2000},
            headers=_headers(ANGELO),
        )
        assert oversized.status_code == 422

    # And the table itself has no content-like column to receive one.
    columns = {c.name for c in ToucanResource.__table__.columns}
    assert columns == {
        "id", "owner_email", "conversation_id", "memory_id",
        "display_name", "locator", "media_type", "created_at", "updated_at",
    }


# --- parser edges (pure) ---------------------------------------------------------------------


async def test_parser_only_claims_explicit_commands():
    assert parse_memory_command("Remember that the demo is Friday.").content == "the demo is Friday"
    assert parse_memory_command("remember this: use the standard flow").kind == "fact"
    assert parse_memory_command("Save this note: ship it").kind == "note"
    assert parse_memory_command("What do you remember?").action == "list"
    assert parse_memory_command("Forget that the demo is Friday").action == "forget"
    # A bare verb is a command with empty content (answered with usage help, never saved).
    assert parse_memory_command("remember").content == ""
    # NOT commands: the verb mid-sentence, questions about people, ordinary chat.
    assert parse_memory_command("I remembered something") is None
    assert parse_memory_command("can you help me remember things") is None
    assert parse_memory_command("who is online") is None
