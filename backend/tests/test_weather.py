"""Real weather AUTO — the key never leaves the server, one upstream call serves everyone, and
nothing about weather can break the office."""

from __future__ import annotations

import httpx
import pytest

from app.config import settings
from app.main import fastapi_app
from app.services import weather as weather_service
from app.services.weather import (
    STATES,
    fetch_office_weather,
    state_for_weatherapi_code,
    weather_configured,
)

KEY = "test-weatherapi-key-do-not-use"


@pytest.fixture(autouse=True)
def _clean_cache(monkeypatch):
    """Every test starts cold and configured. The cache is process-wide by design, so it must be
    reset between tests or one test's reading answers the next one's request."""
    weather_service.reset_cache()
    monkeypatch.setattr(settings, "WEATHER_API_KEY", KEY)
    monkeypatch.setattr(settings, "WEATHER_LOCATION", "14.5995,120.9842")
    monkeypatch.setattr(settings, "WEATHER_CACHE_SECONDS", 900.0)
    yield
    weather_service.reset_cache()


def _body(code: int, *, text: str = "Light rain", precip: float = 1.2, epoch: int = 1_700_000_000):
    return {
        # Fields the browser must NEVER receive are present on purpose: if any of them ever
        # appear in a response, the allowlist in _to_weather has stopped being an allowlist.
        "location": {"name": "Manila", "region": "Manila", "lat": 14.6, "lon": 120.98},
        "current": {
            "last_updated_epoch": epoch,
            "temp_c": 30.1,
            "wind_kph": 11.2,
            "humidity": 78,
            "precip_mm": precip,
            "condition": {"text": text, "code": code, "icon": "//cdn.weatherapi.com/x.png"},
        },
    }


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ---- normalization ------------------------------------------------------------------------


def test_every_weatherapi_code_normalizes_into_our_five_states():
    for code in range(1000, 1300):
        assert state_for_weatherapi_code(code) in STATES
    assert state_for_weatherapi_code(1000) == "clear"  # sunny
    assert state_for_weatherapi_code(1003) == "cloudy"  # partly cloudy
    assert state_for_weatherapi_code(1009) == "cloudy"  # overcast
    assert state_for_weatherapi_code(1135) == "cloudy"  # fog
    assert state_for_weatherapi_code(1183) == "rain"  # light rain
    assert state_for_weatherapi_code(1189) == "rain"  # moderate rain
    assert state_for_weatherapi_code(1195) == "heavy_rain"  # heavy rain
    assert state_for_weatherapi_code(1243) == "heavy_rain"  # heavy rain shower
    assert state_for_weatherapi_code(1276) == "thunderstorm"  # thundery downpour
    assert state_for_weatherapi_code(1225) == "cloudy"  # heavy snow: not modelled, normalized
    assert state_for_weatherapi_code(4242) == "clear"  # unknown upstream code never breaks


# ---- AUTO receives real normalized weather ------------------------------------------------


@pytest.mark.asyncio
async def test_auto_receives_real_normalized_weather():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json=_body(1195, text="Heavy rain", precip=6.0))

    async with _client(handler) as c:
        got = await fetch_office_weather(client=c)

    assert got is not None
    assert got.state == "heavy_rain"
    assert got.label == "Heavy rain"
    assert 0.0 < got.intensity <= 1.0
    assert got.observed_at == 1_700_000_000 * 1000
    # the configured location is what was asked for
    assert "14.5995%2C120.9842" in seen["url"] or "14.5995,120.9842" in seen["url"]


@pytest.mark.asyncio
async def test_endpoint_returns_only_normalized_fields_and_the_attribution():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_body(1183))

    async with _client(handler) as c:
        await fetch_office_weather(client=c)  # warm the cache so the route needs no network

    transport = httpx.ASGITransport(app=fastapi_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as api:
        res = await api.get("/weather/office")

    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "weatherapi"
    assert body["state"] == "rain"
    assert body["attribution"] == "Powered by WeatherAPI.com"
    # THE WIRE CONTRACT IS CLOSED. No key, no upstream vocabulary, no telemetry we never asked for.
    assert set(body) == {"source", "state", "intensity", "label", "observed_at", "attribution"}
    serialized = res.text
    assert KEY not in serialized
    for leaked in ("temp_c", "humidity", "wind_kph", "icon", "code", "region", "lat", "lon"):
        assert leaked not in serialized


# ---- repeated clients use the cached server result ----------------------------------------


@pytest.mark.asyncio
async def test_repeated_clients_share_one_upstream_call():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=_body(1000, text="Sunny", precip=0.0))

    async with _client(handler) as c:
        for _ in range(25):  # twenty-five browsers, one office
            got = await fetch_office_weather(client=c)
            assert got is not None and got.state == "clear"

    assert calls["n"] == 1, "each caller hit WeatherAPI instead of the shared cache"


@pytest.mark.asyncio
async def test_cache_expires_and_refetches(monkeypatch):
    monkeypatch.setattr(settings, "WEATHER_CACHE_SECONDS", 0.0)
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json=_body(1000))

    async with _client(handler) as c:
        await fetch_office_weather(client=c)
        await fetch_office_weather(client=c)

    assert calls["n"] == 2


# ---- missing / invalid key and every other failure fall back safely ------------------------


@pytest.mark.asyncio
async def test_missing_key_never_calls_upstream_and_reports_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "WEATHER_API_KEY", "")
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not run
        calls["n"] += 1
        return httpx.Response(200, json=_body(1000))

    assert weather_configured() is False
    async with _client(handler) as c:
        assert await fetch_office_weather(client=c) is None
    assert calls["n"] == 0

    transport = httpx.ASGITransport(app=fastapi_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as api:
        res = await api.get("/weather/office")
    assert res.status_code == 200  # never a 5xx: weather cannot break the office
    body = res.json()
    assert body["source"] == "unavailable"
    assert body["state"] == "clear"
    assert body["attribution"] == "Powered by WeatherAPI.com"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "handler",
    [
        pytest.param(lambda r: httpx.Response(401, json={"error": {"message": "API key is invalid"}}), id="invalid-key"),
        pytest.param(lambda r: httpx.Response(403, json={"error": {"message": "quota exceeded"}}), id="quota"),
        pytest.param(lambda r: httpx.Response(500, text="upstream boom"), id="upstream-5xx"),
        pytest.param(lambda r: httpx.Response(200, text="not json at all"), id="not-json"),
        pytest.param(lambda r: httpx.Response(200, json={"current": {}}), id="missing-condition"),
        pytest.param(lambda r: httpx.Response(200, json={"current": {"condition": {"code": "x"}}}), id="code-not-int"),
    ],
)
async def test_every_upstream_failure_degrades_rather_than_raising(handler):
    async with _client(handler) as c:
        assert await fetch_office_weather(client=c) is None  # no exception escapes


@pytest.mark.asyncio
async def test_transport_error_degrades():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("network down")

    async with _client(handler) as c:
        assert await fetch_office_weather(client=c) is None


@pytest.mark.asyncio
async def test_a_failure_after_a_good_reading_keeps_the_last_good_value():
    """An outage must not flicker the sky back to CLEAR mid-storm."""
    state = {"fail": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if state["fail"]:
            raise httpx.ConnectError("network down")
        return httpx.Response(200, json=_body(1276, text="Thundery outbreaks"))

    async with _client(handler) as c:
        good = await fetch_office_weather(client=c)
        assert good is not None and good.state == "thunderstorm"
        # expire the TTL so the next call really goes upstream, then break the network
        weather_service._cached_at = 0.0
        state["fail"] = True
        after = await fetch_office_weather(client=c)

    assert after is not None and after.state == "thunderstorm"


@pytest.mark.asyncio
async def test_the_key_is_never_logged(caplog):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": f"key {KEY} is invalid"}})

    with caplog.at_level("WARNING"):
        async with _client(handler) as c:
            await fetch_office_weather(client=c)

    assert KEY not in caplog.text


# ---- CITY SEARCH + 3-DAY FORECAST ---------------------------------------------------------
# The Company Hub's informational card. Same three properties the office read has to hold —
# the key stays here, nothing upstream leaks into the wire contract, and no failure is an
# error — plus the two this one adds: it is authenticated, and its cache is bounded.

SELF = "bon@example.com"


def _as(email: str = SELF) -> dict[str, str]:
    return {"x-dev-email": email}


@pytest.fixture(autouse=True)
def _clean_lookup_caches():
    weather_service.reset_lookup_caches()
    yield
    weather_service.reset_lookup_caches()


def _search_body():
    # `id` and `url` are present on purpose: if either appears on the wire, the allowlist in
    # _to_city has stopped being one.
    return [
        {"id": 2554124, "name": "Cebu City", "region": "Cebu", "country": "Philippines",
         "lat": 10.3, "lon": 123.9, "url": "cebu-city-cebu-philippines"},
        {"id": 2553604, "name": "Manila", "region": "Manila", "country": "Philippines",
         "lat": 14.6, "lon": 120.98, "url": "manila-philippines"},
    ]


def _forecast_body(code: int = 1183):
    return {
        "location": {"name": "Cebu City", "region": "Cebu", "country": "Philippines",
                     "lat": 10.3, "lon": 123.9, "tz_id": "Asia/Manila", "localtime": "2026-09-21 18:00"},
        "current": {
            "last_updated_epoch": 1_700_000_000,
            "temp_c": 29.4, "temp_f": 84.9, "wind_kph": 11.2, "humidity": 78,
            "condition": {"text": "Light rain", "code": code, "icon": "//cdn.weatherapi.com/x.png"},
        },
        "forecast": {"forecastday": [
            {"date": "2026-09-21", "day": {"maxtemp_c": 31.0, "mintemp_c": 25.0, "maxtemp_f": 87.8,
                                           "mintemp_f": 77.0, "avghumidity": 80,
                                           "condition": {"text": "Patchy rain", "code": 1063, "icon": "//x.png"}}},
            {"date": "2026-09-22", "day": {"maxtemp_c": 32.0, "mintemp_c": 26.0, "maxtemp_f": 89.6,
                                           "mintemp_f": 78.8,
                                           "condition": {"text": "Sunny", "code": 1000, "icon": "//x.png"}}},
            {"date": "2026-09-23", "day": {"maxtemp_c": 30.0, "mintemp_c": 24.0, "maxtemp_f": 86.0,
                                           "mintemp_f": 75.2,
                                           "condition": {"text": "Thundery outbreaks", "code": 1087, "icon": "//x.png"}}},
        ]},
    }


@pytest.mark.asyncio
async def test_search_normalizes_to_an_allowlist_and_asks_for_coordinates_back():
    async with _client(lambda r: httpx.Response(200, json=_search_body())) as c:
        status, matches = await weather_service.search_cities("cebu", client=c)

    assert status == "ok"
    assert [m.name for m in matches] == ["Cebu City", "Manila"]
    # The forecast is asked for by COORDINATES, never by WeatherAPI's own id or url slug.
    assert matches[0].query == "10.3000,123.9000"


@pytest.mark.asyncio
async def test_a_query_too_short_is_an_empty_result_and_never_an_upstream_request():
    called = []

    def handler(request: httpx.Request) -> httpx.Response:
        called.append(1)
        return httpx.Response(200, json=[])

    async with _client(handler) as c:
        status, matches = await weather_service.search_cities("c", client=c)

    assert (status, matches) == ("ok", ())
    assert called == []


@pytest.mark.asyncio
async def test_an_over_long_query_is_bounded_before_it_is_forwarded():
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request.url.params.get("q"))
        return httpx.Response(200, json=[])

    async with _client(handler) as c:
        await weather_service.search_cities("x" * 500, client=c)

    # Every query that reached the provider is within the bound — including the "<X> City" variant,
    # which is suppressed rather than allowed to push a near-maximum query over it.
    assert sent and all(len(q) <= weather_service.MAX_QUERY_LEN for q in sent)
    assert len(sent[0]) == weather_service.MAX_QUERY_LEN


@pytest.mark.asyncio
async def test_a_rate_limited_lookup_is_reported_as_such_rather_than_as_a_generic_failure():
    async with _client(lambda r: httpx.Response(429, text="quota exceeded for key=SECRET")) as c:
        assert await weather_service.search_cities("cebu", client=c) == ("rate_limited", ())
        status, forecast = await weather_service.fetch_city_forecast("cebu", client=c)
    assert (status, forecast) == ("rate_limited", None)


@pytest.mark.asyncio
async def test_forecast_returns_today_plus_the_next_two_days():
    async with _client(lambda r: httpx.Response(200, json=_forecast_body())) as c:
        status, forecast = await weather_service.fetch_city_forecast("10.3,123.9", client=c)

    assert status == "ok"
    assert forecast is not None
    assert forecast.name == "Cebu City"
    assert forecast.state == "rain" and forecast.condition == "Light rain"
    assert len(forecast.days) == 3
    assert [d.date for d in forecast.days] == ["2026-09-21", "2026-09-22", "2026-09-23"]
    assert (forecast.days[0].max_c, forecast.days[0].min_c) == (31.0, 25.0)
    assert [d.state for d in forecast.days] == ["rain", "clear", "thunderstorm"]


@pytest.mark.asyncio
async def test_forecast_asks_for_exactly_three_days_and_no_extras():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(dict(request.url.params))
        return httpx.Response(200, json=_forecast_body())

    async with _client(handler) as c:
        await weather_service.fetch_city_forecast("cebu", client=c)

    assert seen["days"] == "3"
    assert seen["aqi"] == "no" and seen["alerts"] == "no"


@pytest.mark.asyncio
async def test_one_upstream_call_serves_repeat_lookups_of_the_same_city():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(200, json=_forecast_body())

    async with _client(handler) as c:
        await weather_service.fetch_city_forecast("Cebu", client=c)
        await weather_service.fetch_city_forecast("cebu", client=c)  # same place, different casing
        await weather_service.search_cities("cebu", client=c)

    assert len(calls) == 2  # one forecast, one search — the repeat forecast was served from cache


@pytest.mark.asyncio
async def test_the_city_cache_is_bounded_and_evicts_oldest_first():
    async with _client(lambda r: httpx.Response(200, json=_forecast_body())) as c:
        for i in range(weather_service.MAX_CACHED_CITIES + 12):
            await weather_service.fetch_city_forecast(f"city-{i}", client=c)

    # An unbounded dict keyed on caller input is a memory leak with a door on it.
    assert len(weather_service._forecast_cache) <= weather_service.MAX_CACHED_CITIES


@pytest.mark.asyncio
async def test_a_malformed_forecast_is_unavailable_rather_than_a_partial_card():
    async with _client(lambda r: httpx.Response(200, json={"location": {"name": "X"}})) as c:
        assert await weather_service.fetch_city_forecast("x-city", client=c) == ("unavailable", None)


@pytest.mark.asyncio
async def test_both_lookups_require_a_caller():
    transport = httpx.ASGITransport(app=fastapi_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as api:
        assert (await api.get("/weather/search", params={"q": "cebu"})).status_code == 401
        assert (await api.get("/weather/forecast", params={"q": "cebu"})).status_code == 401
        # ...while the office read stays open, exactly as it was.
        assert (await api.get("/weather/office")).status_code == 200


@pytest.mark.asyncio
async def test_the_forecast_wire_contract_is_closed_and_carries_the_attribution():
    async with _client(lambda r: httpx.Response(200, json=_forecast_body())) as c:
        await weather_service.fetch_city_forecast("10.3,123.9", client=c)  # warm the cache

    transport = httpx.ASGITransport(app=fastapi_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as api:
        res = await api.get("/weather/forecast", params={"q": "10.3,123.9"}, headers=_as())
        search_res = await api.get("/weather/search", params={"q": "cebu"}, headers=_as())

    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "weatherapi"
    assert body["attribution"] == "Powered by WeatherAPI.com"
    assert len(body["days"]) == 3
    assert set(body) == {
        "source", "name", "region", "country", "temp_c", "temp_f", "condition", "state",
        "observed_at", "days", "attribution",
    }
    assert set(body["days"][0]) == {"date", "max_c", "min_c", "max_f", "min_f", "condition", "state"}
    for leaked in (KEY, "icon", "tz_id", "localtime", "humidity", "wind_kph", "cdn.weatherapi.com", "api.weatherapi.com"):
        assert leaked not in res.text
    # The search reached upstream with no key configured on this path? No — it is simply not cached, so
    # it degrades rather than erroring. Either way the caller gets a 200 and the credit line.
    assert search_res.status_code == 200
    assert search_res.json()["attribution"] == "Powered by WeatherAPI.com"


@pytest.mark.asyncio
async def test_no_key_configured_is_a_200_that_says_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "WEATHER_API_KEY", "")
    transport = httpx.ASGITransport(app=fastapi_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as api:
        res = await api.get("/weather/forecast", params={"q": "cebu"}, headers=_as())
        search = await api.get("/weather/search", params={"q": "cebu"}, headers=_as())

    assert res.status_code == 200 and res.json()["source"] == "unavailable"
    assert res.json()["days"] == []
    assert search.status_code == 200 and search.json()["source"] == "unavailable"


# ---- DISAMBIGUATING "<X>" FROM "<X> CITY" -----------------------------------------------------
# WeatherAPI indexes "Mandaluyong" (a Cavite barangay) and "Mandaluyong City" (Metro Manila) as two
# unrelated entries and its autocomplete returns one per query, so somebody typing the city's common
# name was never shown the city. The service now asks a bounded SECOND query. Every payload below is
# the provider's real response, recorded 2026-09-21.

MANDALUYONG_CAVITE = {"id": 1852528, "name": "Mandaluyong", "region": "Cavite",
                      "country": "Philippines", "lat": 14.27, "lon": 120.92,
                      "url": "mandaluyong-cavite-philippines"}
MANDALUYONG_CITY = {"id": 1852527, "name": "Mandaluyong City", "region": "Negros Oriental",
                    "country": "Philippines", "lat": 14.58, "lon": 121.04,
                    "url": "mandaluyong-city-negros-oriental-philippines"}
TOKYO = {"id": 3125553, "name": "Tokyo", "region": "Tokyo", "country": "Japan",
         "lat": 35.69, "lon": 139.69, "url": "tokyo-tokyo-japan"}
BANGKOK = {"id": 2366981, "name": "Bangkok", "region": "Krung Thep", "country": "Thailand",
           "lat": 13.75, "lon": 100.52, "url": "bangkok-krung-thep-thailand"}
# What q="Makati City" REALLY answers: a different city, in a different country.
MAKATI_LESOTHO = {"id": 1450632, "name": "Makati", "region": "Berea", "country": "Lesotho",
                  "lat": -29.15, "lon": 27.75, "url": "makati-berea-lesotho"}


def _routed(routes: dict[str, list]):
    """A provider stand-in that answers each exact `q` with its own recorded payload, and records
    every query that actually reached it."""
    sent: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        q = request.url.params.get("q")
        sent.append(q)
        return httpx.Response(200, json=routes.get(q, []))

    return handler, sent


@pytest.mark.asyncio
async def test_mandaluyong_returns_BOTH_places_from_two_bounded_queries():
    handler, sent = _routed({"Mandaluyong": [MANDALUYONG_CAVITE], "Mandaluyong City": [MANDALUYONG_CITY]})
    async with _client(handler) as c:
        status, matches = await weather_service.search_cities("Mandaluyong", client=c)

    assert status == "ok"
    assert sent == ["Mandaluyong", "Mandaluyong City"]  # exactly two, never more
    assert [(m.name, m.region, m.country) for m in matches] == [
        ("Mandaluyong", "Cavite", "Philippines"),
        # The region correction, applied to this ONE verified id. See _REGION_CORRECTIONS.
        ("Mandaluyong City", "Metro Manila", "Philippines"),
    ]
    # DISTINCT PLACES ARE NOT MERGED: two rows, each keeping its own coordinates.
    assert [m.query for m in matches] == ["14.2700,120.9200", "14.5800,121.0400"]


@pytest.mark.asyncio
async def test_the_cavite_mandaluyong_is_preserved_exactly_as_the_provider_gave_it():
    handler, _ = _routed({"Mandaluyong": [MANDALUYONG_CAVITE], "Mandaluyong City": []})
    async with _client(handler) as c:
        _, matches = await weather_service.search_cities("Mandaluyong", client=c)

    assert len(matches) == 1
    assert (matches[0].name, matches[0].region, matches[0].country) == ("Mandaluyong", "Cavite", "Philippines")
    assert matches[0].query == "14.2700,120.9200"  # Cavite's own point, untouched


@pytest.mark.asyncio
async def test_typing_the_city_spelling_makes_no_second_query():
    handler, sent = _routed({"Mandaluyong City": [MANDALUYONG_CITY]})
    async with _client(handler) as c:
        status, matches = await weather_service.search_cities("Mandaluyong City", client=c)

    assert status == "ok"
    assert sent == ["Mandaluyong City"]  # no "Mandaluyong City City"
    assert matches[0].region == "Metro Manila"


@pytest.mark.asyncio
async def test_the_region_correction_is_pinned_to_one_id_and_fails_open():
    """It applies ONLY while id, coordinates and the wrong label all still match."""
    moved = {**MANDALUYONG_CITY, "lat": 9.3, "lon": 123.3}       # same id, Negros coordinates
    relabelled = {**MANDALUYONG_CITY, "region": "Metro Manila"}   # upstream fixed it themselves
    other_id = {**MANDALUYONG_CITY, "id": 999999}                 # a different place entirely

    for payload, expected in ((moved, "Negros Oriental"), (relabelled, "Metro Manila"), (other_id, "Negros Oriental")):
        weather_service.reset_lookup_caches()
        handler, _ = _routed({"Mandaluyong": [], "Mandaluyong City": [payload]})
        async with _client(handler) as c:
            _, matches = await weather_service.search_cities("Mandaluyong", client=c)
        assert matches[0].region == expected, payload


@pytest.mark.asyncio
async def test_a_variant_hit_the_provider_names_differently_is_DROPPED():
    """q="Makati City" answers with Makati, Berea, LESOTHO. It is not a "Makati City" and must not
    appear in a search for Makati."""
    makati_ph = {"id": 1851432, "name": "Makati", "region": "Manila", "country": "Philippines",
                 "lat": 14.55, "lon": 121.03, "url": "makati-manila-philippines"}
    handler, sent = _routed({"Makati": [makati_ph], "Makati City": [MAKATI_LESOTHO]})
    async with _client(handler) as c:
        _, matches = await weather_service.search_cities("Makati", client=c)

    assert sent == ["Makati", "Makati City"]
    assert [m.country for m in matches] == ["Philippines"]
    assert all("Lesotho" not in m.country for m in matches)


@pytest.mark.asyncio
async def test_international_searches_are_unchanged_and_never_duplicated():
    """Tokyo and Bangkok answer identically to both queries — one row each, not two."""
    for term, payload in (("Tokyo", TOKYO), ("Bangkok", BANGKOK)):
        weather_service.reset_lookup_caches()
        handler, sent = _routed({term: [payload], f"{term} City": [payload]})
        async with _client(handler) as c:
            status, matches = await weather_service.search_cities(term, client=c)

        assert status == "ok"
        assert sent == [term, f"{term} City"]
        # DEDUPLICATED ON THE PROVIDER'S OWN ID: the same entry returned twice is one place.
        assert len(matches) == 1, [m.name for m in matches]
        assert (matches[0].name, matches[0].region, matches[0].country) == (
            payload["name"], payload["region"], payload["country"],
        )
        assert matches[0].query == f"{payload['lat']:.4f},{payload['lon']:.4f}"


@pytest.mark.asyncio
async def test_duplicates_without_an_id_collapse_on_coordinates():
    no_id = {"name": "Nowhere", "region": "R", "country": "C", "lat": 1.0, "lon": 2.0}
    handler, _ = _routed({"Nowhere": [no_id, dict(no_id)], "Nowhere City": [dict(no_id)]})
    async with _client(handler) as c:
        _, matches = await weather_service.search_cities("Nowhere", client=c)
    assert len(matches) == 1


@pytest.mark.asyncio
async def test_a_failing_variant_never_fails_the_search():
    def handler(request: httpx.Request) -> httpx.Response:
        q = request.url.params.get("q")
        if q == "Mandaluyong City":
            return httpx.Response(429, text="rate limited")
        return httpx.Response(200, json=[MANDALUYONG_CAVITE])

    async with _client(handler) as c:
        status, matches = await weather_service.search_cities("Mandaluyong", client=c)

    assert status == "ok"  # the bonus query is never a dependency
    assert [m.name for m in matches] == ["Mandaluyong"]


@pytest.mark.asyncio
async def test_each_variant_is_cached_separately_so_the_second_search_is_free():
    handler, sent = _routed({"Mandaluyong": [MANDALUYONG_CAVITE], "Mandaluyong City": [MANDALUYONG_CITY]})
    async with _client(handler) as c:
        await weather_service.search_cities("Mandaluyong", client=c)
        await weather_service.search_cities("mandaluyong", client=c)   # same query, different case
        await weather_service.search_cities("Mandaluyong City", client=c)  # already fetched as a variant

    assert sent == ["Mandaluyong", "Mandaluyong City"]  # still exactly two upstream calls


@pytest.mark.asyncio
async def test_the_selected_coordinates_are_what_the_forecast_is_fetched_with():
    """No re-resolution by name anywhere: the row's own point is the forecast's `q`."""
    handler, _ = _routed({"Mandaluyong": [MANDALUYONG_CAVITE], "Mandaluyong City": [MANDALUYONG_CITY]})
    async with _client(handler) as c:
        _, matches = await weather_service.search_cities("Mandaluyong", client=c)
    chosen = matches[1]
    assert chosen.query == "14.5800,121.0400"

    asked = {}

    def forecast_handler(request: httpx.Request) -> httpx.Response:
        asked["q"] = request.url.params.get("q")
        return httpx.Response(200, json=_forecast_body())

    async with _client(forecast_handler) as c:
        status, forecast = await weather_service.fetch_city_forecast(chosen.query, client=c)

    assert status == "ok" and forecast is not None
    assert asked["q"] == "14.5800,121.0400"


@pytest.mark.asyncio
async def test_the_provider_id_never_reaches_the_wire():
    """Identity is internal. The client keeps sending coordinates, so losing or changing an id can
    never move a saved city."""
    handler, _ = _routed({"Mandaluyong": [MANDALUYONG_CAVITE], "Mandaluyong City": [MANDALUYONG_CITY]})
    async with _client(handler) as c:
        await weather_service.search_cities("Mandaluyong", client=c)  # warm both cache entries

    transport = httpx.ASGITransport(app=fastapi_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as api:
        res = await api.get("/weather/search", params={"q": "Mandaluyong"}, headers=_as())

    assert res.status_code == 200
    body = res.json()
    assert len(body["results"]) == 2
    assert set(body["results"][0]) == {"query", "name", "region", "country"}
    for leaked in ("1852527", "1852528", "provider_id", "url", "mandaluyong-cavite"):
        assert leaked not in res.text


@pytest.mark.asyncio
async def test_a_coordinate_query_makes_exactly_one_call_and_no_City_variant():
    """The REVERSE lookup a device location makes is a point, and "14.58,121.04 City" is not a
    question worth asking. Also covers a saved city's own coordinates."""
    reverse_hit = {"id": 1, "name": "Hagdang Bato Libis", "region": "Quezon",
                   "country": "Philippines", "lat": 14.58, "lon": 121.04}
    handler, sent = _routed({"14.5794,121.0359": [reverse_hit]})
    async with _client(handler) as c:
        status, matches = await weather_service.search_cities("14.5794,121.0359", client=c)

    assert status == "ok"
    assert sent == ["14.5794,121.0359"]
    assert matches[0].name == "Hagdang Bato Libis"
    # The place the provider matched carries ITS OWN point, which is what lets the caller check how
    # far from the device that actually is before believing the label.
    assert matches[0].query == "14.5800,121.0400"


def test_coordinate_detection_does_not_swallow_place_names():
    for point in ("14.58,121.04", "-33.87,151.21", " 51.5072 , -0.1276 "):
        assert weather_service.looks_like_coordinates(point)
    for name in ("Mandaluyong", "Cebu City", "St. Louis, Missouri", "1st Avenue"):
        assert not weather_service.looks_like_coordinates(name)
