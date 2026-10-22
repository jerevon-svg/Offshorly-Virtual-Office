from __future__ import annotations

import httpx
import pytest

from app.database import Base, engine
from app.main import fastapi_app
from app.models.avatar_wardrobe import AvatarWardrobe

# Character Studio EDIT — saved HumanBase outfits. The security property under test: the row read or written by
# /avatar/wardrobe/me is always the VERIFIED caller's own; nothing a request carries can name another employee.

pytestmark = pytest.mark.asyncio

ALEX = "alex@example.com"
BON = "bon@example.com"
TEE = {"assetId": "tee-offshorly", "colorway": "sky"}


@pytest.fixture(autouse=True)
async def _fresh_state():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(AvatarWardrobe.__table__.delete())
    yield


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _as(email: str) -> dict[str, str]:
    return {"x-dev-email": email}


async def test_requires_authentication():
    async with _client() as client:
        assert (await client.get("/avatar/wardrobe/me")).status_code == 401
        assert (await client.put("/avatar/wardrobe/me", json={"outfit": {"top": TEE}})).status_code == 401
        assert (await client.get("/avatar/wardrobes")).status_code == 401


async def test_never_edited_reads_as_the_default():
    async with _client() as client:
        r = await client.get("/avatar/wardrobe/me", headers=_as(ALEX))
    assert r.status_code == 200
    assert r.json() == {"nickname": None, "outfit": {}, "updatedAt": None}


async def test_save_persists_for_the_caller_only_and_survives_a_reload():
    async with _client() as client:
        saved = await client.put("/avatar/wardrobe/me", headers=_as(ALEX), json={"nickname": " Lex ", "outfit": {"top": TEE}})
        assert saved.status_code == 200
        assert saved.json()["outfit"] == {"top": TEE}
        assert saved.json()["nickname"] == "Lex"
        assert saved.json()["updatedAt"]
        # a fresh read (a reload) returns what was saved
        again = await client.get("/avatar/wardrobe/me", headers=_as(ALEX))
        assert again.json()["outfit"] == {"top": TEE}
        # another employee is untouched
        other = await client.get("/avatar/wardrobe/me", headers=_as(BON))
        assert other.json()["outfit"] == {}


async def test_a_body_can_never_name_another_employee():
    async with _client() as client:
        r = await client.put("/avatar/wardrobe/me", headers=_as(ALEX), json={"email": BON, "outfit": {"top": TEE}})
        assert r.status_code == 422
        assert (await client.get("/avatar/wardrobe/me", headers=_as(BON))).json()["outfit"] == {}


async def test_shapes_are_validated():
    async with _client() as client:
        bad_slot = await client.put("/avatar/wardrobe/me", headers=_as(ALEX), json={"outfit": {"hat": TEE}})
        bad_id = await client.put("/avatar/wardrobe/me", headers=_as(ALEX), json={"outfit": {"top": {"assetId": "../../etc", "colorway": "x"}}})
        extra = await client.put("/avatar/wardrobe/me", headers=_as(ALEX), json={"outfit": {"top": {**TEE, "url": "http://x"}}})
    assert bad_slot.status_code == 422
    assert bad_id.status_code == 422
    assert extra.status_code == 422


async def test_nickname_is_cleaned_and_bounded():
    async with _client() as client:
        r = await client.put("/avatar/wardrobe/me", headers=_as(ALEX), json={"nickname": "<b>Al\u0007ex</b>" + "x" * 60, "outfit": {}})
    assert r.status_code == 200
    nick = r.json()["nickname"]
    assert "<" not in nick and "\u0007" not in nick and len(nick) <= 40


async def test_a_second_save_replaces_the_first():
    async with _client() as client:
        await client.put("/avatar/wardrobe/me", headers=_as(ALEX), json={"outfit": {"top": TEE, "shoes": {"assetId": "clogs", "colorway": "sage"}}})
        await client.put("/avatar/wardrobe/me", headers=_as(ALEX), json={"outfit": {"top": {"assetId": "hoodie-crrn", "colorway": "bone"}}})
        r = await client.get("/avatar/wardrobe/me", headers=_as(ALEX))
    assert r.json()["outfit"] == {"top": {"assetId": "hoodie-crrn", "colorway": "bone"}}


async def test_the_office_reads_every_outfit_keyed_by_email_without_nicknames():
    async with _client() as client:
        await client.put("/avatar/wardrobe/me", headers=_as(ALEX), json={"nickname": "Lex", "outfit": {"top": TEE}})
        await client.put("/avatar/wardrobe/me", headers=_as(BON), json={"outfit": {"bottom": {"assetId": "shorts-denim", "colorway": "light"}}})
        r = await client.get("/avatar/wardrobes", headers=_as(ALEX))
    assert r.status_code == 200
    assert r.json() == {"outfits": {ALEX: {"top": TEE}, BON: {"bottom": {"assetId": "shorts-denim", "colorway": "light"}}}}
    assert "Lex" not in r.text
