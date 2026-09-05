from __future__ import annotations

import httpx
import pytest

from app import database as app_db
from app.database import Base
from app.main import fastapi_app
from app.repositories import chat as chat_repo

# Whiteboard W1/W2 over the real REST path against the isolated throwaway DB: inherited group
# permission (403 for non-participants), group-only attachment (400 for a DM), create/list/open/
# save round trip, and the optimistic-version 409. The dev x-dev-email bypass authenticates.

pytestmark = pytest.mark.asyncio

A, B, C = "a@example.com", "b@example.com", "c@example.com"
DOC = {"document": {"store": {"shape:1": {"type": "note"}}, "schema": {}}, "session": {}}


@pytest.fixture(autouse=True)
async def _isolated(isolated_app_db):
    async with app_db.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _as(email: str) -> dict[str, str]:
    return {"x-dev-email": email}


async def _group(members: list[str], title: str = "Squad") -> str:
    async with app_db.async_session_maker() as session:
        group = await chat_repo.create_group_conversation(session, members[0], members[1:], title=title)
        return group["id"]


async def test_requires_identity():
    gid = await _group([A, B])
    async with _client() as client:
        assert (await client.get(f"/conversations/{gid}/whiteboards")).status_code == 401


async def test_create_list_open_save_round_trip_for_participants():
    gid = await _group([A, B])
    async with _client() as client:
        created = await client.post(f"/conversations/{gid}/whiteboards", json={"title": " Sprint plan "}, headers=_as(A))
        assert created.status_code == 201, created.text
        board = created.json()
        assert board["title"] == "Sprint plan"
        assert board["version"] == 1
        assert board["document"] is None
        assert board["conversationId"] == gid
        assert board["createdByEmail"] == A

        # Any OTHER participant lists and opens it — permission is the group's, not the creator's.
        listed = await client.get(f"/conversations/{gid}/whiteboards", headers=_as(B))
        assert listed.status_code == 200
        assert [b["id"] for b in listed.json()] == [board["id"]]
        assert "document" not in listed.json()[0]

        saved = await client.put(f"/whiteboards/{board['id']}", json={"document": DOC, "version": 1}, headers=_as(B))
        assert saved.status_code == 200, saved.text
        assert saved.json()["version"] == 2
        assert saved.json()["updatedByEmail"] == B

        opened = await client.get(f"/whiteboards/{board['id']}", headers=_as(A))
        assert opened.status_code == 200
        assert opened.json()["document"] == DOC
        assert opened.json()["version"] == 2


async def test_non_participant_is_forbidden_everywhere():
    gid = await _group([A, B])
    async with _client() as client:
        board = (await client.post(f"/conversations/{gid}/whiteboards", json={"title": "x"}, headers=_as(A))).json()
        assert (await client.get(f"/conversations/{gid}/whiteboards", headers=_as(C))).status_code == 403
        assert (await client.post(f"/conversations/{gid}/whiteboards", json={"title": "y"}, headers=_as(C))).status_code == 403
        assert (await client.get(f"/whiteboards/{board['id']}", headers=_as(C))).status_code == 403
        res = await client.put(f"/whiteboards/{board['id']}", json={"document": DOC, "version": 1}, headers=_as(C))
        assert res.status_code == 403
        # Nothing leaked through: the participant still sees version 1 / no document.
        opened = await client.get(f"/whiteboards/{board['id']}", headers=_as(A))
        assert opened.json()["version"] == 1 and opened.json()["document"] is None


async def test_stale_version_save_is_a_409_and_does_not_clobber():
    gid = await _group([A, B])
    async with _client() as client:
        board = (await client.post(f"/conversations/{gid}/whiteboards", json={"title": "x"}, headers=_as(A))).json()
        first = await client.put(f"/whiteboards/{board['id']}", json={"document": DOC, "version": 1}, headers=_as(A))
        assert first.status_code == 200
        stale = {"document": {"document": {"store": {}, "schema": {}}}, "version": 1}
        second = await client.put(f"/whiteboards/{board['id']}", json=stale, headers=_as(B))
        assert second.status_code == 409
        opened = await client.get(f"/whiteboards/{board['id']}", headers=_as(B))
        assert opened.json()["document"] == DOC and opened.json()["version"] == 2
        # Retrying with the fresh version succeeds.
        third = await client.put(f"/whiteboards/{board['id']}", json={**stale, "version": 2}, headers=_as(B))
        assert third.status_code == 200 and third.json()["version"] == 3


async def test_dm_conversations_cannot_carry_whiteboards():
    async with app_db.async_session_maker() as session:
        dm = await chat_repo.upsert_conversation(session, A, B)
    async with _client() as client:
        res = await client.post(f"/conversations/{dm['id']}/whiteboards", json={"title": "x"}, headers=_as(A))
        assert res.status_code == 400
        assert (await client.get(f"/conversations/{dm['id']}/whiteboards", headers=_as(A))).status_code == 400


async def test_unknown_ids_are_404():
    async with _client() as client:
        assert (await client.get("/conversations/nope/whiteboards", headers=_as(A))).status_code == 404
        assert (await client.get("/whiteboards/nope", headers=_as(A))).status_code == 404
