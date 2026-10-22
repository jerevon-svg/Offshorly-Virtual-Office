from __future__ import annotations

import httpx
import pytest

from app.config import settings
from app.database import Base, engine
from app.main import fastapi_app
from app.models.avatar_generation import AvatarGenerationConsent, AvatarGenerationRun, AvatarSpendRecord

# The generation authority over HTTP. Security properties: executor routes need the executor key (and are off without
# one); employee routes act only on the verified caller; nothing a request carries can name another employee's consent,
# records or runs.

pytestmark = pytest.mark.asyncio

KEY = "test-executor-key"
NEW = "new.hire@offshorly.com"
OTHER = "other@offshorly.com"
PHOTO, ILLU = "b" * 64, "c" * 64


@pytest.fixture(autouse=True)
async def _fresh_state(monkeypatch):
    monkeypatch.setattr(settings, "AVATAR_EXECUTOR_KEY", KEY)
    monkeypatch.setattr(settings, "AVATAR_AUTOSPEND_ENABLED", False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for t in (AvatarGenerationConsent, AvatarSpendRecord, AvatarGenerationRun):
            await conn.execute(t.__table__.delete())
    yield


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _as(email: str) -> dict[str, str]:
    return {"x-dev-email": email}


EXEC = {"x-avatar-executor-key": KEY}


def spend(**over) -> dict:
    return {"email": NEW, "personId": "newhire", "stage": "meshy", "inputSha256": ILLU, "photoSha256": PHOTO, "estimate": 30,
            "mode": "manual", "approvedBy": "Bon", "providerBalance": 587, **over}


async def test_executor_routes_are_off_without_a_key_and_refuse_a_wrong_one(monkeypatch):
    async with _client() as c:
        assert (await c.post("/avatar/generation/authorize", json=spend(), headers={"x-avatar-executor-key": "nope"})).status_code == 401
        assert (await c.post("/avatar/generation/authorize", json=spend(), headers=_as(NEW))).status_code == 401   # an employee is not the executor
        monkeypatch.setattr(settings, "AVATAR_EXECUTOR_KEY", "")
        assert (await c.post("/avatar/generation/authorize", json=spend(), headers=EXEC)).status_code == 503


async def test_consent_is_the_callers_own_and_cannot_name_anyone():
    async with _client() as c:
        assert (await c.put("/avatar/generation/consent", json={"photoSha256": PHOTO, "statement": "self-photo-v1"})).status_code == 401
        assert (await c.put("/avatar/generation/consent", headers=_as(NEW), json={"photoSha256": PHOTO, "statement": "self-photo-v1", "email": OTHER})).status_code == 422
        r = await c.put("/avatar/generation/consent", headers=_as(NEW), json={"photoSha256": PHOTO, "statement": "self-photo-v1"})
        assert r.status_code == 200 and r.json()["photoSha256"] == PHOTO
        assert (await c.get("/avatar/generation/me", headers=_as(OTHER))).json()["consents"] == []


async def test_a_manual_spend_is_authorized_recorded_and_settled_and_never_paid_twice():
    async with _client() as c:
        await c.put("/avatar/generation/consent", headers=_as(NEW), json={"photoSha256": PHOTO, "statement": "self-photo-v1"})
        d = (await c.post("/avatar/generation/authorize", headers=EXEC, json=spend())).json()
        assert d["allowed"] is True and d["recordId"]
        # while it runs, a second job for the same stage is refused
        again = (await c.post("/avatar/generation/authorize", headers=EXEC, json=spend())).json()
        assert again["allowed"] is False and "in_flight" in [f["code"] for f in again["failures"]]
        s = await c.post("/avatar/generation/settle", headers=EXEC, json={"recordId": d["recordId"], "outcome": "succeeded", "actual": 30, "evidence": {"task": "t1"}})
        assert s.status_code == 200 and s.json()["status"] == "succeeded"
        assert (await c.post("/avatar/generation/settle", headers=EXEC, json={"recordId": d["recordId"], "outcome": "failed"})).status_code == 409
        dup = (await c.post("/avatar/generation/authorize", headers=EXEC, json=spend())).json()
        assert [f["code"] for f in dup["failures"]] == ["already_generated"]
        mine = (await c.get("/avatar/generation/me", headers=_as(NEW))).json()
        assert [r["status"] for r in mine["spend"]] == ["succeeded", "denied", "denied"]
        assert mine["runsThisMonth"] == 1
        assert (await c.get("/avatar/generation/me", headers=_as(OTHER))).json()["spend"] == []


async def test_a_failed_paid_attempt_caps_retries_until_a_named_reroll():
    async with _client() as c:
        await c.put("/avatar/generation/consent", headers=_as(NEW), json={"photoSha256": PHOTO, "statement": "self-photo-v1"})
        d = (await c.post("/avatar/generation/authorize", headers=EXEC, json=spend())).json()
        await c.post("/avatar/generation/settle", headers=EXEC, json={"recordId": d["recordId"], "outcome": "failed", "evidence": {"error": "meshy task FAILED"}})
        capped = (await c.post("/avatar/generation/authorize", headers=EXEC, json=spend())).json()
        assert [f["code"] for f in capped["failures"]] == ["retry_cap"]
        reroll = (await c.post("/avatar/generation/authorize", headers=EXEC, json=spend(allowReroll=True))).json()
        assert reroll["allowed"] is True


async def test_auto_mode_is_refused_while_autospend_is_off_and_a_dry_run_records_nothing():
    async with _client() as c:
        await c.put("/avatar/generation/consent", headers=_as(NEW), json={"photoSha256": PHOTO, "statement": "self-photo-v1"})
        dry = (await c.post("/avatar/generation/authorize", headers=EXEC, json=spend(mode="auto", approvedBy=None, dryRun=True))).json()
        assert dry["allowed"] is False and [f["code"] for f in dry["failures"]] == ["autospend_disabled"] and dry["recordId"] is None
        assert (await c.get("/avatar/generation/me", headers=_as(NEW))).json()["spend"] == []


async def test_without_consent_only_a_named_admin_attestation_lets_a_manual_spend_through():
    async with _client() as c:
        no = (await c.post("/avatar/generation/authorize", headers=EXEC, json=spend(dryRun=True))).json()
        assert "no_consent" in [f["code"] for f in no["failures"]]
        yes = (await c.post("/avatar/generation/authorize", headers=EXEC, json=spend(consentAttestedBy="Bon"))).json()
        assert yes["allowed"] is True


async def test_runs_associate_artifacts_with_the_account_and_stay_private():
    async with _client() as c:
        for stage, status, art in (("illustrate", "succeeded", {"sha256": ILLU, "path": "uploads/newhire.png"}), ("meshy", "running", None)):
            r = await c.post("/avatar/generation/runs", headers=EXEC, json={"email": NEW, "personId": "newhire", "photoSha256": PHOTO, "stage": stage, "status": status, **({"artifact": art} if art else {})})
            assert r.status_code == 200
        mine = (await c.get("/avatar/generation/me", headers=_as(NEW))).json()["runs"]
        assert len(mine) == 1 and mine[0]["stage"] == "meshy" and mine[0]["artifacts"]["illustrate"]["sha256"] == ILLU
        assert (await c.get("/avatar/generation/me", headers=_as(OTHER))).json()["runs"] == []
        big = await c.post("/avatar/generation/runs", headers=EXEC, json={"email": NEW, "personId": "newhire", "photoSha256": PHOTO, "stage": "build", "status": "failed", "evidence": {"log": "x" * 9000}})
        assert big.status_code == 422


async def test_budget_is_visible_to_the_executor_only():
    async with _client() as c:
        assert (await c.get("/avatar/generation/budget", headers=_as(NEW))).status_code == 401
        b = (await c.get("/avatar/generation/budget", headers=EXEC)).json()
        assert b["autospendEnabled"] is False and b["budgets"]["meshy_credits"] == settings.AVATAR_BUDGET_MESHY_CREDITS_MONTHLY
