from __future__ import annotations

import base64
import json

import httpx
import pytest

from app.config import settings
from app.main import fastapi_app
from app.realtime.socket import call_registry, spatial_sessions

# Router-layer coverage for POST /calls/token — mirrors tests/test_talk_requests_router.py's
# conventions (ASGITransport + the dev x-dev-email identity bypass, no live server needed).

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _fresh_state():
    original_env = settings.APP_ENV
    original = (settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
    settings.APP_ENV = "development"
    # Deterministic dummy credentials — never the real ones from backend/.env.
    settings.LIVEKIT_URL = "wss://test.livekit.example"
    settings.LIVEKIT_API_KEY = "APItestkey"
    settings.LIVEKIT_API_SECRET = "test-secret-value-long-enough-to-sign"
    spatial_sessions.reset()
    call_registry.reset()
    yield
    spatial_sessions.reset()
    call_registry.reset()
    settings.LIVEKIT_URL, settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET = original
    settings.APP_ENV = original_env


async def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _headers(email: str) -> dict:
    return {"x-dev-email": email}


def _decode_claims(token: str) -> dict:
    """Read the JWT payload without verifying — enough to assert identity/grants. Signature
    verification is LiveKit's job, not this test's."""
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


def _seat_two(session_id: str = "conv-1") -> None:
    spatial_sessions.start("a@example.com", session_id, "sid-a")
    spatial_sessions.start("b@example.com", session_id, "sid-b")


# --- rejection paths ---------------------------------------------------------------------


async def test_unauthenticated_request_is_rejected():
    settings.APP_ENV = "production"  # disables the dev x-dev-email bypass
    try:
        async with await _client() as client:
            res = await client.post("/calls/token", json={"sessionId": "conv-1"})
        assert res.status_code == 401
    finally:
        settings.APP_ENV = "development"


async def test_non_member_of_the_session_is_rejected():
    _seat_two()
    async with await _client() as client:
        res = await client.post(
            "/calls/token", json={"sessionId": "conv-1"}, headers=_headers("intruder@example.com")
        )
    assert res.status_code == 403
    assert call_registry.existing_room_for_session("conv-1") is None


async def test_member_of_a_DIFFERENT_session_cannot_get_a_token_for_this_one():
    _seat_two("conv-1")
    spatial_sessions.start("c@example.com", "conv-2", "sid-c")
    spatial_sessions.start("d@example.com", "conv-2", "sid-d")
    async with await _client() as client:
        res = await client.post(
            "/calls/token", json={"sessionId": "conv-1"}, headers=_headers("c@example.com")
        )
    assert res.status_code == 403


async def test_solo_spatial_session_is_rejected():
    spatial_sessions.start("a@example.com", "conv-1", "sid-a")
    async with await _client() as client:
        res = await client.post(
            "/calls/token", json={"sessionId": "conv-1"}, headers=_headers("a@example.com")
        )
    assert res.status_code == 409
    assert call_registry.existing_room_for_session("conv-1") is None


async def test_missing_session_id_is_rejected():
    async with await _client() as client:
        res = await client.post("/calls/token", json={"sessionId": "  "}, headers=_headers("a@example.com"))
    assert res.status_code == 400


async def test_unconfigured_livekit_fails_closed_without_leaking_config():
    settings.LIVEKIT_API_SECRET = ""
    _seat_two()
    async with await _client() as client:
        res = await client.post(
            "/calls/token", json={"sessionId": "conv-1"}, headers=_headers("a@example.com")
        )
    assert res.status_code == 503
    assert "secret" not in res.text.lower()


# --- success path ------------------------------------------------------------------------


async def test_valid_member_receives_a_token_response():
    _seat_two()
    async with await _client() as client:
        res = await client.post(
            "/calls/token", json={"sessionId": "conv-1"}, headers=_headers("a@example.com")
        )
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"url", "token", "room", "identity"}
    assert body["url"] == "wss://test.livekit.example"
    assert body["identity"] == "a@example.com"
    assert body["room"] == call_registry.existing_room_for_session("conv-1")
    assert body["token"]


async def test_response_never_contains_the_api_key_or_secret():
    _seat_two()
    async with await _client() as client:
        res = await client.post(
            "/calls/token", json={"sessionId": "conv-1"}, headers=_headers("a@example.com")
        )
    assert settings.LIVEKIT_API_SECRET not in res.text
    # The key appears in the JWT header by design (LiveKit needs it to pick the signing key);
    # what must never leak is the SECRET.
    assert settings.LIVEKIT_API_SECRET not in json.dumps(_decode_claims(res.json()["token"]))


async def test_identity_comes_from_server_auth_not_the_request_body():
    _seat_two()
    async with await _client() as client:
        res = await client.post(
            "/calls/token",
            # A malicious client trying to impersonate b@example.com and target another room.
            json={"sessionId": "conv-1", "identity": "b@example.com", "room": "attacker-room"},
            headers=_headers("a@example.com"),
        )
    assert res.status_code == 200
    body = res.json()
    assert body["identity"] == "a@example.com"
    assert body["room"] != "attacker-room"
    claims = _decode_claims(body["token"])
    assert claims["sub"] == "a@example.com"
    assert claims["video"]["room"] == body["room"]


async def test_token_grants_are_voice_only_and_scoped_to_one_room():
    _seat_two()
    async with await _client() as client:
        res = await client.post(
            "/calls/token", json={"sessionId": "conv-1"}, headers=_headers("a@example.com")
        )
    grants = _decode_claims(res.json()["token"])["video"]
    assert grants["roomJoin"] is True
    assert grants["room"] == res.json()["room"]
    assert grants["canPublish"] is True
    assert grants["canSubscribe"] is True
    # Nothing beyond joining this one room and exchanging audio.
    for denied in ("roomCreate", "roomAdmin", "roomList", "roomRecord", "canPublishData"):
        assert not grants.get(denied, False), denied


async def test_token_is_short_lived():
    _seat_two()
    async with await _client() as client:
        res = await client.post(
            "/calls/token", json={"sessionId": "conv-1"}, headers=_headers("a@example.com")
        )
    # The SDK emits nbf/exp (no iat), so measure the window against nbf.
    claims = _decode_claims(res.json()["token"])
    assert 0 < claims["exp"] - claims["nbf"] <= 15 * 60


async def test_both_members_of_the_same_session_get_the_SAME_room():
    _seat_two()
    async with await _client() as client:
        a = await client.post("/calls/token", json={"sessionId": "conv-1"}, headers=_headers("a@example.com"))
        b = await client.post("/calls/token", json={"sessionId": "conv-1"}, headers=_headers("b@example.com"))
    assert a.json()["room"] == b.json()["room"]
    assert a.json()["identity"] != b.json()["identity"]


async def test_repeat_request_reuses_the_room_rather_than_minting_a_new_one():
    _seat_two()
    async with await _client() as client:
        first = await client.post("/calls/token", json={"sessionId": "conv-1"}, headers=_headers("a@example.com"))
        second = await client.post("/calls/token", json={"sessionId": "conv-1"}, headers=_headers("a@example.com"))
    assert first.json()["room"] == second.json()["room"]


async def test_room_name_does_not_embed_the_conversation_id():
    spatial_sessions.start("a@example.com", "conv-secret-1234", "sid-a")
    spatial_sessions.start("b@example.com", "conv-secret-1234", "sid-b")
    async with await _client() as client:
        res = await client.post(
            "/calls/token", json={"sessionId": "conv-secret-1234"}, headers=_headers("a@example.com")
        )
    assert "conv-secret-1234" not in res.json()["room"]


# --- session upgrade + spatial independence ---------------------------------------------


async def test_upgraded_session_id_resolves_to_the_SAME_room():
    """Ask-to-Join re-keys the mapping (see routers/requests.py); the joiner's token request for
    the NEW session id must land in the call the incumbents are already in."""
    _seat_two("old-conv")
    async with await _client() as client:
        before = await client.post(
            "/calls/token", json={"sessionId": "old-conv"}, headers=_headers("a@example.com")
        )
        call_registry.join("old-conv", "a@example.com", "sid-a")

        # Simulate the upgrade: new conversation id, three spatial members, mapping re-keyed.
        call_registry.rekey_session("old-conv", "new-conv")
        spatial_sessions.start("a@example.com", "new-conv", "sid-a")
        spatial_sessions.start("b@example.com", "new-conv", "sid-b")
        spatial_sessions.start("c@example.com", "new-conv", "sid-c")

        joiner = await client.post(
            "/calls/token", json={"sessionId": "new-conv"}, headers=_headers("c@example.com")
        )
    assert joiner.status_code == 200
    assert joiner.json()["room"] == before.json()["room"]
    assert joiner.json()["identity"] == "c@example.com"


async def test_leaving_media_does_not_alter_spatial_membership():
    _seat_two()
    call_registry.join("conv-1", "a@example.com", "sid-a")
    call_registry.join("conv-1", "b@example.com", "sid-b")

    call_registry.leave("a@example.com", "sid-a")

    # Media gone for a, spatial conversation completely untouched for both.
    assert call_registry.participants("conv-1") == ["b@example.com"]
    assert spatial_sessions.session_of("a@example.com") == "conv-1"
    assert spatial_sessions.snapshot() == [
        {"sessionId": "conv-1", "members": ["a@example.com", "b@example.com"]}
    ]


async def test_a_still_eligible_after_leaving_media_can_rejoin():
    _seat_two()
    call_registry.join("conv-1", "a@example.com", "sid-a")
    call_registry.join("conv-1", "b@example.com", "sid-b")
    call_registry.leave("a@example.com", "sid-a")
    async with await _client() as client:
        res = await client.post(
            "/calls/token", json={"sessionId": "conv-1"}, headers=_headers("a@example.com")
        )
    assert res.status_code == 200
