from __future__ import annotations

import httpx
import pytest

from app import database as app_db
from app.config import settings
from app.database import Base
from app.main import fastapi_app
from app.repositories import chat as chat_repo

# Whiteboard W1/W2 (+ W4 room scope) over the real REST path against the isolated throwaway DB:
# inherited group permission (403 for non-participants) for groups AND 1:1 DMs, room/office boards
# open to any authenticated user, create/list/open/save round trip, and the optimistic-version 409.
# The dev x-dev-email bypass authenticates.

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


async def test_dm_participants_share_one_board_set_and_outsiders_are_forbidden():
    """1:1 follow-up: DMs carry whiteboards too. Both DM participants see the same boards; the
    spatial 1:1 window resolves to the SAME conversation via dm_key (either email order), so it
    can never surface a separate board set; a third person is still 403."""
    async with app_db.async_session_maker() as session:
        dm = await chat_repo.upsert_conversation(session, A, B)
        same_dm = await chat_repo.upsert_conversation(session, B, A)
    assert same_dm["id"] == dm["id"]
    async with _client() as client:
        created = await client.post(f"/conversations/{dm['id']}/whiteboards", json={"title": "Pairing"}, headers=_as(A))
        assert created.status_code == 201, created.text
        board = created.json()

        listed_by_b = await client.get(f"/conversations/{dm['id']}/whiteboards", headers=_as(B))
        assert listed_by_b.status_code == 200
        assert [b["id"] for b in listed_by_b.json()] == [board["id"]]

        saved = await client.put(f"/whiteboards/{board['id']}", json={"document": DOC, "version": 1}, headers=_as(B))
        assert saved.status_code == 200 and saved.json()["version"] == 2
        assert (await client.get(f"/whiteboards/{board['id']}", headers=_as(A))).json()["document"] == DOC

        assert (await client.get(f"/conversations/{dm['id']}/whiteboards", headers=_as(C))).status_code == 403
        assert (await client.post(f"/conversations/{dm['id']}/whiteboards", json={"title": "x"}, headers=_as(C))).status_code == 403
        assert (await client.get(f"/whiteboards/{board['id']}", headers=_as(C))).status_code == 403


async def test_unknown_ids_are_404():
    async with _client() as client:
        assert (await client.get("/conversations/nope/whiteboards", headers=_as(A))).status_code == 404
        assert (await client.get("/whiteboards/nope", headers=_as(A))).status_code == 404


# ---- W4: room / office scoped boards -------------------------------------------------------------


async def test_room_board_round_trip_between_users_who_share_no_conversation():
    async with _client() as client:
        assert (await client.get("/rooms/dev-team/whiteboards")).status_code == 401

        created = await client.post("/rooms/dev-team/whiteboards", json={"title": " Standup "}, headers=_as(A))
        assert created.status_code == 201, created.text
        board = created.json()
        assert board["title"] == "Standup" and board["version"] == 1 and board["document"] is None
        assert board["roomId"] == "dev-team" and board["conversationId"] is None

        # C shares NO conversation with A — room boards are the office's, not a group's.
        listed = await client.get("/rooms/dev-team/whiteboards", headers=_as(C))
        assert listed.status_code == 200
        assert [b["id"] for b in listed.json()] == [board["id"]]
        assert listed.json()[0]["roomId"] == "dev-team" and "document" not in listed.json()[0]

        saved = await client.put(f"/whiteboards/{board['id']}", json={"document": DOC, "version": 1}, headers=_as(C))
        assert saved.status_code == 200, saved.text
        assert saved.json()["version"] == 2 and saved.json()["updatedByEmail"] == C

        opened = await client.get(f"/whiteboards/{board['id']}", headers=_as(A))
        assert opened.status_code == 200 and opened.json()["document"] == DOC

        # Other rooms don't see it; an unknown room is simply empty, never 404.
        assert (await client.get("/rooms/qa-room/whiteboards", headers=_as(A))).json() == []


async def test_office_board_uses_the_office_room_sentinel():
    async with _client() as client:
        created = await client.post("/rooms/office/whiteboards", json={"title": "All hands"}, headers=_as(B))
        assert created.status_code == 201, created.text
        assert created.json()["roomId"] == "office"
        listed = await client.get("/rooms/office/whiteboards", headers=_as(C))
        assert [b["title"] for b in listed.json()] == ["All hands"]


async def test_room_id_must_be_a_usable_id():
    async with _client() as client:
        assert (await client.post("/rooms/%20/whiteboards", json={"title": "x"}, headers=_as(A))).status_code == 422
        too_long = "r" * 65
        assert (await client.get(f"/rooms/{too_long}/whiteboards", headers=_as(A))).status_code == 422
        # Ids are trimmed, so the same room is addressed with or without stray whitespace.
        await client.post("/rooms/design-team/whiteboards", json={"title": "x"}, headers=_as(A))
        assert len((await client.get("/rooms/%20design-team%20/whiteboards", headers=_as(A))).json()) == 1


async def test_room_boards_never_leak_into_conversation_lists_and_vice_versa():
    gid = await _group([A, B])
    async with _client() as client:
        conv_board = (await client.post(f"/conversations/{gid}/whiteboards", json={"title": "conv"}, headers=_as(A))).json()
        room_board = (await client.post("/rooms/dev-team/whiteboards", json={"title": "room"}, headers=_as(A))).json()
        assert [b["id"] for b in (await client.get(f"/conversations/{gid}/whiteboards", headers=_as(A))).json()] == [conv_board["id"]]
        assert [b["id"] for b in (await client.get("/rooms/dev-team/whiteboards", headers=_as(A))).json()] == [room_board["id"]]
        # Conversation permissions are untouched by W4: C still can't open the group's board...
        assert (await client.get(f"/whiteboards/{conv_board['id']}", headers=_as(C))).status_code == 403
        # ...but can open the room's.
        assert (await client.get(f"/whiteboards/{room_board['id']}", headers=_as(C))).status_code == 200


# --- W5-B board voice token -----------------------------------------------------------------


@pytest.fixture
def livekit_configured():
    original = (settings.APP_ENV, settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    settings.APP_ENV = "development"
    settings.LIVEKIT_URL = "wss://test.livekit.example"
    settings.LIVEKIT_API_KEY = "APItestkey"
    settings.LIVEKIT_API_SECRET = "test-secret-value-long-enough-to-sign"
    from app.realtime.state import call_registry

    call_registry.reset()
    yield
    call_registry.reset()
    settings.APP_ENV, settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET = original


def _claims(token: str) -> dict:
    import base64
    import json

    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


async def test_board_voice_token_follows_board_access_and_shares_one_room(livekit_configured):
    """Conversation board: participants get a token, an outsider gets the same 403 as every other
    board read. Both participants land in the SAME opaque room, which never embeds the board id;
    the token is voice-only, identity is the caller, and the response carries no key/secret."""
    gid = await _group([A, B])
    async with _client() as client:
        board = (await client.post(f"/conversations/{gid}/whiteboards", json={"title": "Voice"}, headers=_as(A))).json()
        url = f"/whiteboards/{board['id']}/voice/token"

        assert (await client.post(url)).status_code == 401
        assert (await client.post(url, headers=_as(C))).status_code == 403
        assert (await client.post("/whiteboards/nope/voice/token", headers=_as(A))).status_code == 404

        ra = await client.post(url, headers=_as(A))
        rb = await client.post(url, headers=_as(B))
        assert ra.status_code == 200 and rb.status_code == 200, (ra.text, rb.text)
        a, b = ra.json(), rb.json()
        assert a["room"] == b["room"] and a["room"].startswith("vo-call-")
        assert board["id"] not in a["room"] and gid not in a["room"]
        assert a["identity"] == A and b["identity"] == B
        assert a["url"] == "wss://test.livekit.example"
        assert "APItestkey" not in ra.text and "test-secret" not in ra.text
        claims = _claims(a["token"])
        assert claims["sub"] == A
        video = claims["video"]
        assert video["room"] == a["room"] and video["roomJoin"] is True
        assert video["canPublish"] is True and video["canSubscribe"] is True
        assert video.get("canPublishData", False) is False and video.get("roomAdmin", False) is False
        # Same shared CallRegistry as spatial calls, under the namespaced key — one calling system.
        from app.realtime.state import call_registry

        assert call_registry.existing_room_for_session(f"whiteboard:{board['id']}") == a["room"]


async def test_room_board_voice_is_open_to_every_signed_in_user(livekit_configured):
    async with _client() as client:
        board = (await client.post("/rooms/dev-team/whiteboards", json={"title": "Standup"}, headers=_as(A))).json()
        url = f"/whiteboards/{board['id']}/voice/token"
        ra = await client.post(url, headers=_as(A))
        rc = await client.post(url, headers=_as(C))  # shares no conversation with A
        assert ra.status_code == 200 and rc.status_code == 200
        assert ra.json()["room"] == rc.json()["room"]


async def test_board_voice_fails_closed_when_livekit_is_unconfigured():
    original = (settings.APP_ENV, settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    settings.APP_ENV = "development"
    settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET = "", "", ""
    try:
        gid = await _group([A, B])
        async with _client() as client:
            board = (await client.post(f"/conversations/{gid}/whiteboards", json={"title": "Voice"}, headers=_as(A))).json()
            r = await client.post(f"/whiteboards/{board['id']}/voice/token", headers=_as(A))
            assert r.status_code == 503
            assert "LIVEKIT" not in r.text and "secret" not in r.text.lower()
    finally:
        settings.APP_ENV, settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET = original
