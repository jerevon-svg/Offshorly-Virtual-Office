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
