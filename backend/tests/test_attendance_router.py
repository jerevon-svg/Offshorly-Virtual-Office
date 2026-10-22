from __future__ import annotations

import httpx
import pytest
from app.database import Base, engine
from app.main import fastapi_app
from app.models.attendance import EmployeeAttendance
from app.realtime.state import offline_lineup

# Router coverage for /attendance — mirrors test_room_requests_router.py's ASGI-transport
# pattern. Also asserts the routes keep the in-memory sidewalk lineup in step with attendance.

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
async def _fresh_state():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(EmployeeAttendance.__table__.delete())
    offline_lineup._slot_by_email.clear()
    yield
    offline_lineup._slot_by_email.clear()


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _as(email: str) -> dict[str, str]:
    return {"x-dev-email": email}


async def test_me_without_row_is_checked_out_with_nulls():
    async with _client() as client:
        res = await client.get("/attendance/me", headers=_as("fresh@example.com"))
    assert res.status_code == 200
    assert res.json() == {
        "email": "fresh@example.com",
        "status": "CHECKED_OUT",
        "checkedInAt": None,
        "checkedOutAt": None,
    }


async def test_requires_identity():
    async with _client() as client:
        res = await client.get("/attendance/me")
    assert res.status_code == 401


async def test_check_in_marks_checked_in_and_leaves_sidewalk_lineup():
    offline_lineup.add("bon@example.com")
    async with _client() as client:
        res = await client.post("/attendance/check-in", headers=_as("Bon@Example.com"))
        me = await client.get("/attendance/me", headers=_as("bon@example.com"))
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "CHECKED_IN"
    assert body["checkedInAt"].endswith("Z")
    assert body["checkedOutAt"] is None
    assert me.json()["status"] == "CHECKED_IN"
    assert offline_lineup.snapshot() == []


async def test_check_out_marks_checked_out_and_joins_sidewalk_lineup():
    async with _client() as client:
        await client.post("/attendance/check-in", headers=_as("bon@example.com"))
        res = await client.post("/attendance/check-out", headers=_as("bon@example.com"))
        me = await client.get("/attendance/me", headers=_as("bon@example.com"))
    assert res.json()["status"] == "CHECKED_OUT"
    assert res.json()["checkedOutAt"] is not None
    assert me.json()["status"] == "CHECKED_OUT"
    assert offline_lineup.snapshot() == [{"email": "bon@example.com", "slot": 0}]


async def test_second_browser_sees_active_session():
    """The whole point: attendance is per employee, not per tab/socket/browser."""
    async with _client() as client:
        await client.post("/attendance/check-in", headers=_as("bon@example.com"))
    async with _client() as other_browser:
        me = await other_browser.get("/attendance/me", headers=_as("bon@example.com"))
    assert me.json()["status"] == "CHECKED_IN"



async def test_recover_stale_commits_before_lineup_without_quest(monkeypatch):
    from datetime import datetime, timezone
    from unittest.mock import AsyncMock

    from app.repositories import attendance as repo
    from app.routers import attendance as routes

    start = datetime(2026, 9, 25, 18, 55, 49, 123456, tzinfo=timezone.utc)
    monkeypatch.setattr(repo, "_now", lambda: start)
    async with _client() as client:
        checked_in = (await client.post("/attendance/check-in", headers=_as("bon@example.com"))).json()
        monkeypatch.setattr(repo, "_now", lambda: datetime(2026, 10, 10, tzinfo=timezone.utc))
        quest = AsyncMock()
        monkeypatch.setattr(routes, "record_quest_event", quest)
        async def broadcast():
            me = await client.get("/attendance/me", headers=_as("bon@example.com"))
            assert me.json()["status"] == "CHECKED_OUT"
        monkeypatch.setattr(routes, "_broadcast_lineup", broadcast)
        response = await client.post("/attendance/recover-stale", headers=_as("bon@example.com"),
                                     json={"expectedCheckedInAt": checked_in["checkedInAt"]})
    assert response.status_code == 200
    assert response.json()["checkedInAt"] == "2026-09-25T18:55:49.123456Z"
    assert offline_lineup.snapshot() == [{"email": "bon@example.com", "slot": 0}]
    quest.assert_not_awaited()


async def test_recover_requires_identity_and_rejects_current_or_mismatched_session():
    async with _client() as client:
        body = {"expectedCheckedInAt": "2026-09-25T18:55:49Z"}
        assert (await client.post("/attendance/recover-stale", json=body)).status_code == 401
        current = (await client.post("/attendance/check-in", headers=_as("bon@example.com"))).json()
        for expected in (body["expectedCheckedInAt"], current["checkedInAt"]):
            response = await client.post("/attendance/recover-stale", headers=_as("bon@example.com"),
                                         json={"expectedCheckedInAt": expected})
            assert response.status_code == 409
        assert (await client.get("/attendance/me", headers=_as("bon@example.com"))).json() == current
    assert offline_lineup.snapshot() == []


async def test_normal_checkout_still_records_the_checkout_quest(monkeypatch):
    from unittest.mock import AsyncMock

    from app.routers import attendance as routes

    async with _client() as client:
        await client.post("/attendance/check-in", headers=_as("bon@example.com"))
        quest = AsyncMock()
        monkeypatch.setattr(routes, "record_quest_event", quest)
        response = await client.post("/attendance/check-out", headers=_as("bon@example.com"))
    assert response.status_code == 200
    quest.assert_awaited_once()
    assert quest.call_args.kwargs["event_type"] == routes.EVENT_CHECK_OUT
