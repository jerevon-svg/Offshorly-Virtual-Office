"""Global Team Map V1.1 — Working Today (explicit exact-location opt-in) with a saved last
location. Precedence pinned here:

  1. live share  → exact point, working_today.active = True
  2. saved share → exact last point, working_today.active = False (Stop sharing, or 12h expiry)
  3. nothing     → Atlas base location (after "Forget saved location")

Plus: a new share replaces the saved one, the caller's own state survives a fresh request (and
Atlas being down), and Atlas's own coarsening / home_address handling never changes."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select

from app.main import fastapi_app
from app.models.working_today import WorkingTodayShare
from app.repositories import working_today as repo
from app.routers import team_map as team_map_router
from app.services.team_map.atlas_map import _to_row

pytestmark = pytest.mark.asyncio

ME = "bon@example.com"
TOKEN = "caller-bearer-token"

# Precise fixes (not real addresses) inside Makati and Pasig.
FIX_LAT, FIX_LNG = 14.551234, 121.027654
FIX2_LAT, FIX2_LNG = 14.581111, 121.088888
BASE_ROW = {
    "user_email": ME,
    "display_name": "Bon",
    "department_name": "Design",
    "latitude": 10.31,  # Atlas base: Cebu City
    "longitude": 123.89,
    "country_code": "PH",
    "status": "ONLINE",
    "home_address": "should never appear",
}
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def _api() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


@pytest.fixture
def atlas_up(monkeypatch):
    async def fake_fetch(token, *, client=None):
        return (_to_row(BASE_ROW),)

    async def fake_verify(token, client=None):
        return ME

    monkeypatch.setattr(team_map_router, "fetch_atlas_map", fake_fetch)
    monkeypatch.setattr("app.auth.deps.verify_atlas_token", fake_verify)


async def _share(client, lat=FIX_LAT, lng=FIX_LNG):
    return await client.post("/team-map/working-today", json={"latitude": lat, "longitude": lng}, headers=AUTH)


async def _people(client):
    return (await client.get("/team-map/people", headers=AUTH)).json()


async def _rows():
    from app.database import async_session_maker

    async with async_session_maker() as session:
        return (await session.execute(select(WorkingTodayShare))).scalars().all()


async def test_share_is_live_exact_and_echoed_with_context(isolated_app_db, atlas_up):
    async with _api() as client:
        res = await _share(client)
        after = await _people(client)
    assert res.status_code == 200
    body = res.json()
    assert (body["latitude"], body["longitude"]) == (FIX_LAT, FIX_LNG)
    assert body["location_label"] == "Makati, Philippines"  # nearest-city context only
    assert body["active"] is True and body["stopped_at"] is None
    assert set(body) == {
        "latitude", "longitude", "location_label", "country_code", "timezone",
        "shared_at", "expires_at", "active", "stopped_at",
    }
    assert datetime.fromisoformat(body["expires_at"]) - datetime.fromisoformat(body["shared_at"]) == timedelta(hours=12)

    [person] = after["people"]
    assert (person["latitude"], person["longitude"]) == (FIX_LAT, FIX_LNG)
    assert person["working_today"]["active"] is True
    assert after["me"]["active"] is True
    assert "should never appear" not in str(after)
    rows = await _rows()
    assert len(rows) == 1 and (rows[0].latitude, rows[0].longitude) == (FIX_LAT, FIX_LNG)


async def test_stop_keeps_the_last_shared_location_as_inactive(isolated_app_db, atlas_up):
    async with _api() as client:
        await _share(client)
        stop = await client.post("/team-map/working-today/stop", headers=AUTH)
        after = await _people(client)
    assert stop.status_code == 204
    [person] = after["people"]
    # Still the last shared point, but explicitly NOT live.
    assert (person["latitude"], person["longitude"]) == (FIX_LAT, FIX_LNG)
    assert person["working_today"]["active"] is False
    assert person["working_today"]["stopped_at"] is not None
    assert after["me"]["active"] is False and after["me"]["stopped_at"] is not None
    assert (after["me"]["latitude"], after["me"]["longitude"]) == (FIX_LAT, FIX_LNG)
    assert len(await _rows()) == 1


async def test_expiry_ends_live_sharing_but_keeps_the_snapshot(isolated_app_db, atlas_up, monkeypatch):
    t0 = datetime(2026, 9, 7, 8, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(repo, "_now", lambda: t0)
    async with _api() as client:
        await _share(client)
        monkeypatch.setattr(repo, "_now", lambda: t0 + timedelta(hours=11, minutes=59))
        still = await _people(client)
        monkeypatch.setattr(repo, "_now", lambda: t0 + timedelta(hours=12, seconds=1))
        gone = await _people(client)
    assert still["people"][0]["working_today"]["active"] is True
    assert gone["people"][0]["working_today"]["active"] is False
    assert (gone["people"][0]["latitude"], gone["people"][0]["longitude"]) == (FIX_LAT, FIX_LNG)
    assert gone["me"]["active"] is False
    assert gone["me"]["stopped_at"] == gone["me"]["expires_at"]
    rows = await _rows()
    assert len(rows) == 1 and rows[0].stopped_at is not None


async def test_new_share_replaces_the_saved_location_and_goes_live_again(isolated_app_db, atlas_up):
    async with _api() as client:
        await _share(client)
        await client.post("/team-map/working-today/stop", headers=AUTH)
        second = await _share(client, FIX2_LAT, FIX2_LNG)
        after = await _people(client)
    assert second.status_code == 200
    [person] = after["people"]
    assert (person["latitude"], person["longitude"]) == (FIX2_LAT, FIX2_LNG)
    assert person["working_today"]["active"] is True
    assert person["working_today"]["stopped_at"] is None
    assert person["location_label"] == "Pasig, Philippines"
    assert len(await _rows()) == 1


async def test_forget_removes_the_saved_location_and_falls_back_to_atlas(isolated_app_db, atlas_up):
    async with _api() as client:
        await _share(client)
        await client.post("/team-map/working-today/stop", headers=AUTH)
        forget = await client.delete("/team-map/working-today", headers=AUTH)
        after = await _people(client)
    assert forget.status_code == 204
    [person] = after["people"]
    assert person["location_label"] == "Cebu City, Philippines" and person["working_today"] is None
    assert (person["latitude"], person["longitude"]) != (FIX_LAT, FIX_LNG)
    assert after["me"] is None
    assert await _rows() == []


async def test_saved_state_survives_refresh_even_when_atlas_is_down(isolated_app_db, atlas_up, monkeypatch):
    async with _api() as client:
        await _share(client)
        await client.post("/team-map/working-today/stop", headers=AUTH)

        async def atlas_down(token, *, client=None):
            return None

        monkeypatch.setattr(team_map_router, "fetch_atlas_map", atlas_down)
        res = await _people(client)
    assert res["source"] == "unavailable" and res["people"] == []
    assert (res["me"]["latitude"], res["me"]["longitude"]) == (FIX_LAT, FIX_LNG)
    assert res["me"]["active"] is False


async def test_stop_and_forget_without_a_share_are_harmless(isolated_app_db, atlas_up):
    async with _api() as client:
        assert (await client.post("/team-map/working-today/stop", headers=AUTH)).status_code == 204
        assert (await client.delete("/team-map/working-today", headers=AUTH)).status_code == 204
        after = await _people(client)
    assert after["me"] is None and after["people"][0]["working_today"] is None


async def test_out_of_range_fix_is_rejected(isolated_app_db, atlas_up):
    async with _api() as client:
        res = await _share(client, 95, 10)
    assert res.status_code == 422


async def test_unauthenticated_calls_are_rejected(isolated_app_db):
    async with _api() as client:
        assert (await client.post("/team-map/working-today", json={"latitude": 1, "longitude": 1})).status_code == 401
        assert (await client.post("/team-map/working-today/stop")).status_code == 401
        assert (await client.delete("/team-map/working-today")).status_code == 401
