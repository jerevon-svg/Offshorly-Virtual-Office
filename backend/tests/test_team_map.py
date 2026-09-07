"""Global Team Map V1 — privacy boundary + degrade-safely contract.

Two walls are pinned here: (1) Atlas's ``home_address`` is never read into memory, and (2) no
coordinate the browser receives equals the raw Atlas geocode — every one is a city centroid or a
grid-cell centre at two decimals."""

from __future__ import annotations

import dataclasses
import json

import httpx
import pytest

from app.main import fastapi_app
from app.routers import team_map as team_map_router
from app.routers.team_map import project_person
from app.schemas.team_map import TeamMapPerson
from app.services.team_map.atlas_map import MAP_PATH, AtlasMapRow, _to_row, fetch_atlas_map
from app.services.team_map.coarse_geo import OUTPUT_DECIMALS, snap_coarse

TOKEN = "caller-bearer-token"
VIEWER = "bon@example.com"

# A house-level Nominatim-style geocode somewhere inside Pasig, with a fake but realistic address.
RAW_LAT, RAW_LNG = 14.583912, 121.061377
ATLAS_ROW = {
    "user_email": "Angelo@Example.com",
    "full_name": "Angelo Reyes",
    "display_name": "Angelo R.",
    "photo_url": "https://people.zoho.com/x.jpg",
    "avatar_url": "/api/v1/office/avatar/angelo@example.com",
    "department_name": "Engineering",
    "location": "Ortigas Office",
    "home_address": "2910 East Tower, Some Condo, Pasig",
    "latitude": RAW_LAT,
    "longitude": RAW_LNG,
    "country_code": "PH",
    "status": "ONLINE",
    "current_activity": "Reviewing the deploy",
    "checked_in": True,
}


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _ok(rows):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=rows)

    return handler


# --- wall 1: allowlist -------------------------------------------------------------------------


def test_home_address_and_free_text_never_enter_the_row():
    row = _to_row(ATLAS_ROW)
    assert row is not None
    names = {f.name for f in dataclasses.fields(AtlasMapRow)}
    assert "home_address" not in names
    assert "location" not in names
    assert "current_activity" not in names
    assert row.email == "angelo@example.com"
    assert row.display_name == "Angelo R."
    assert row.country_code == "PH"


def test_partial_coordinates_collapse_to_no_location():
    row = _to_row({**ATLAS_ROW, "longitude": None})
    assert row is not None and row.latitude is None and row.longitude is None


@pytest.mark.asyncio
async def test_fetch_forwards_the_callers_token_to_the_map_endpoint():
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers.get("authorization", "")
        seen["path"] = request.url.path
        return httpx.Response(200, json=[ATLAS_ROW])

    rows = await fetch_atlas_map(TOKEN, client=_client(handler))
    assert seen == {"auth": f"Bearer {TOKEN}", "path": MAP_PATH}
    assert rows is not None and [r.email for r in rows] == ["angelo@example.com"]


@pytest.mark.asyncio
async def test_no_token_or_atlas_failure_reads_as_unavailable_not_empty():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=[ATLAS_ROW])

    assert await fetch_atlas_map(None, client=_client(handler)) is None
    assert calls == 0
    assert await fetch_atlas_map(TOKEN, client=_client(lambda r: httpx.Response(503))) is None
    assert await fetch_atlas_map(TOKEN, client=_client(lambda r: httpx.Response(200, json={"a": 1}))) is None


# --- wall 2: coarse projection -----------------------------------------------------------------


def test_snap_returns_a_city_centroid_never_the_input():
    place = snap_coarse(RAW_LAT, RAW_LNG, "PH")
    assert place.kind == "city"
    assert place.country_code == "PH"
    assert place.timezone == "Asia/Manila"
    assert (place.latitude, place.longitude) != (RAW_LAT, RAW_LNG)
    assert round(place.latitude, OUTPUT_DECIMALS) == place.latitude
    assert round(place.longitude, OUTPUT_DECIMALS) == place.longitude
    assert place.label.endswith(", Philippines")


def test_snap_falls_back_to_a_grid_cell_far_from_any_city():
    # Mid-Pacific, no city within 75 km.
    place = snap_coarse(10.123456, -150.654321, None)
    assert place.kind == "region"
    assert (place.latitude, place.longitude) == (10.5, -150.5)
    assert place.label == "Unknown region"
    assert place.timezone.startswith("Etc/")


def test_snap_honours_atlas_country_over_a_cross_border_city():
    # Just south of Vancouver but Atlas says US: must not relabel them as Canada.
    place = snap_coarse(49.0, -122.7, "US")
    assert place.country_code == "US"
    assert place.kind == "region"
    assert place.timezone == "America/Los_Angeles"


def test_projected_person_buckets_and_wire_keys():
    none = project_person(_to_row({**ATLAS_ROW, "latitude": None, "longitude": None}))
    assert none.bucket == "none" and none.latitude is None and none.timezone is None

    ph = project_person(_to_row(ATLAS_ROW))
    assert ph.bucket == "ph" and ph.location_label and ph.timezone == "Asia/Manila"

    elsewhere = project_person(
        _to_row({**ATLAS_ROW, "latitude": 1.30, "longitude": 103.85, "country_code": "SG"})
    )
    assert elsewhere.bucket == "elsewhere" and elsewhere.country_code == "SG"

    assert set(TeamMapPerson.model_fields) == {
        "email",
        "display_name",
        "department_name",
        "status",
        "bucket",
        "latitude",
        "longitude",
        "country_code",
        "location_label",
        "timezone",
        "working_today",
    }


def test_projection_keeps_metadata_bound_to_email_whatever_the_row_order():
    from app.routers.team_map import project_people

    a = {**ATLAS_ROW, "user_email": "a@example.com", "display_name": "Ay", "department_name": "Operations"}
    b = {**ATLAS_ROW, "user_email": "b@example.com", "display_name": "Bee", "department_name": "Design"}
    forward = {p.email: (p.display_name, p.department_name) for p in project_people((_to_row(a), _to_row(b)), {})}
    reverse = {p.email: (p.display_name, p.department_name) for p in project_people((_to_row(b), _to_row(a)), {})}
    assert forward == reverse == {
        "a@example.com": ("Ay", "Operations"),
        "b@example.com": ("Bee", "Design"),
    }


# --- router ------------------------------------------------------------------------------------


def _api() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


@pytest.mark.asyncio
async def test_dev_bypass_has_no_atlas_token_and_degrades_to_unavailable(isolated_app_db):
    async with _api() as client:
        res = await client.get("/team-map/people", headers={"x-dev-email": VIEWER})
    assert res.status_code == 200
    assert res.json() == {
        "people": [],
        "source": "unavailable",
        "generated_at": res.json()["generated_at"],
        "me": None,
    }


@pytest.mark.asyncio
async def test_unauthenticated_request_is_rejected(isolated_app_db):
    async with _api() as client:
        res = await client.get("/team-map/people")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_response_never_contains_the_raw_geocode_or_home_address(isolated_app_db, monkeypatch):
    async def fake_fetch(token, *, client=None):
        assert token == TOKEN
        return (_to_row(ATLAS_ROW),)

    async def fake_verify(token, client=None):
        return VIEWER

    monkeypatch.setattr(team_map_router, "fetch_atlas_map", fake_fetch)
    monkeypatch.setattr("app.auth.deps.verify_atlas_token", fake_verify)

    async with _api() as client:
        res = await client.get("/team-map/people", headers={"Authorization": f"Bearer {TOKEN}"})
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "atlas"
    [person] = body["people"]
    assert "home_address" not in json.dumps(body)
    assert "East Tower" not in res.text
    assert str(RAW_LAT) not in res.text and str(RAW_LNG) not in res.text
    assert person["bucket"] == "ph"
    assert person["timezone"] == "Asia/Manila"
    assert round(person["latitude"], OUTPUT_DECIMALS) == person["latitude"]
