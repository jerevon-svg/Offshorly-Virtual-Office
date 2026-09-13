from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx

from app.config import settings

# REAL WEATHER FOR THE ONE OFFICE LOCATION (WeatherAPI.com).
#
# WHY THIS LIVES ON THE SERVER AT ALL. WeatherAPI needs a key, and a key in a browser bundle is a
# published key — the same reasoning that keeps LIVEKIT_API_SECRET and OPENAI_API_KEY backend-only
# (see config.py). The browser never sees the key, never sees WeatherAPI's URL, and never talks to
# WeatherAPI: it asks THIS backend for an already-normalized state.
#
# ONE UPSTREAM CALL PER TTL, FOR THE WHOLE OFFICE. The result is cached process-wide, not per
# caller — the office's weather is the same fact for everyone, so N browsers polling this backend
# still cost at most one WeatherAPI request per WEATHER_CACHE_SECONDS. That cache, not client
# discipline, is what makes an unauthenticated read safe to expose.
#
# NEVER RAISES. No key, no network, a 4xx, garbage JSON, an unknown condition code — every one of
# them returns None and the router answers 200 with source="unavailable", exactly the way
# services/team_map/atlas_map.py degrades. The VO's AUTO mode then keeps its last good value (or
# CLEAR), and every manual override keeps working regardless, because an override never consults a
# provider at all.

_logger = logging.getLogger(__name__)

WEATHER_URL = "https://api.weatherapi.com/v1/current.json"
# WeatherAPI's terms require visible attribution wherever the data is shown. Returned with every
# payload so a consumer cannot render the data without also being handed the credit line.
ATTRIBUTION = "Powered by WeatherAPI.com"

# THE APP'S OWN VOCABULARY — the same five states the V2 client models in env/weather.ts. The
# client never learns a WeatherAPI condition code; normalization ends here.
STATES = ("clear", "cloudy", "rain", "heavy_rain", "thunderstorm")


@dataclass(frozen=True)
class OfficeWeather:
    """The COMPLETE set of fields the browser is given. Allowlist, not denylist: nothing else from
    WeatherAPI's response is read, so nothing else can be projected, logged or returned."""

    state: str
    intensity: float
    label: str
    observed_at: int  # epoch ms


def state_for_weatherapi_code(code: int) -> str:
    """WeatherAPI condition code -> our five states.

    States we do not model (snow, sleet, ice) normalize to the nearest thing we DO present rather
    than inventing a sixth — the office is in Manila. Anything unrecognised reads as CLEAR, so a
    new code upstream can never produce an undefined state.
    """
    # thunder, with or without rain or snow
    if code in (1087, 1273, 1276, 1279, 1282):
        return "thunderstorm"
    # heavy rain / heavy showers / torrential downpour
    if code in (1192, 1195, 1201, 1243, 1246, 1252):
        return "heavy_rain"
    # drizzle, patchy/light/moderate rain, rain showers, freezing rain
    if code in (1063, 1072, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189, 1198, 1204, 1207, 1240):
        return "rain"
    # snow/sleet/ice of every kind — not modelled; overcast is the honest read
    if 1210 <= code <= 1264 or code in (1066, 1069, 1114, 1117, 1147, 1237):
        return "cloudy"
    # partly cloudy, cloudy, overcast, mist, fog
    if code in (1003, 1006, 1009, 1030, 1135):
        return "cloudy"
    return "clear"  # 1000 clear/sunny, and anything unrecognised


def _intensity_for(precip_mm: float, state: str) -> float:
    """Saturating 0..1 rate within a state. A provider reading of 0mm during a reported shower
    still reports a floor, so RAIN never arrives as an invisible rain."""
    if state in ("clear", "cloudy"):
        return 0.0
    scaled = min(1.0, precip_mm / 8.0) if precip_mm > 0 else 0.0
    return max(0.35, scaled)


def _to_weather(raw: object) -> OfficeWeather | None:
    if not isinstance(raw, dict):
        return None
    current = raw.get("current")
    if not isinstance(current, dict):
        return None
    condition = current.get("condition")
    if not isinstance(condition, dict):
        return None
    code = condition.get("code")
    if not isinstance(code, int) or isinstance(code, bool):
        return None

    state = state_for_weatherapi_code(code)
    precip = current.get("precip_mm")
    precip_mm = float(precip) if isinstance(precip, (int, float)) and not isinstance(precip, bool) else 0.0
    text = condition.get("text")
    epoch = current.get("last_updated_epoch")
    observed_at = int(epoch) * 1000 if isinstance(epoch, int) and not isinstance(epoch, bool) else int(time.time() * 1000)
    return OfficeWeather(
        state=state,
        intensity=_intensity_for(precip_mm, state),
        label=text.strip() if isinstance(text, str) and text.strip() else state,
        observed_at=observed_at,
    )


# Process-wide cache: (value, fetched_at_monotonic). Deliberately module-level and not per
# caller — see the header. Mirrors the ephemeral in-process registries in app/realtime/state.py:
# single worker today, and a cold start simply costs one upstream call.
_cached: OfficeWeather | None = None
_cached_at: float = 0.0


def weather_configured() -> bool:
    return bool(settings.WEATHER_API_KEY.strip())


def _cache_is_fresh(now: float) -> bool:
    return _cached is not None and (now - _cached_at) < settings.WEATHER_CACHE_SECONDS


def cached_weather() -> OfficeWeather | None:
    """The cached value if still inside its TTL, else None. No I/O."""
    return _cached if _cache_is_fresh(time.monotonic()) else None


def reset_cache() -> None:
    """Test seam only — production never invalidates; the TTL does."""
    global _cached, _cached_at
    _cached = None
    _cached_at = 0.0


async def fetch_office_weather(*, client: httpx.AsyncClient | None = None) -> OfficeWeather | None:
    """Current weather for the configured office location, cached for WEATHER_CACHE_SECONDS.

    Returns ``None`` when weather is unavailable (no key, transport error, non-2xx, malformed
    body). NEVER RAISES, and WeatherAPI's error text never reaches the caller.
    """
    global _cached, _cached_at

    now = time.monotonic()
    if _cache_is_fresh(now):
        return _cached

    if not weather_configured():
        return None

    params = {
        "key": settings.WEATHER_API_KEY.strip(),
        "q": settings.WEATHER_LOCATION.strip(),
        "aqi": "no",
    }
    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=settings.WEATHER_TIMEOUT_SECONDS)
    try:
        res = await http_client.get(WEATHER_URL, params=params)
    except Exception as exc:  # noqa: BLE001 - any transport failure degrades to "unavailable"
        # type(exc).__name__ only: an exception's text can carry the full request URL, and that
        # URL carries the key.
        _logger.warning("Office weather fetch failed: %s", type(exc).__name__)
        return _cached if _cached is not None else None
    finally:
        if owns_client:
            await http_client.aclose()

    if res.status_code < 200 or res.status_code >= 300:
        # Status code only — never the body. WeatherAPI echoes the key in some error payloads.
        _logger.warning("Office weather fetch returned HTTP %s", res.status_code)
        return _cached if _cached is not None else None

    try:
        body = res.json()
    except ValueError:
        _logger.warning("Office weather response was not JSON")
        return _cached if _cached is not None else None

    parsed = _to_weather(body)
    if parsed is None:
        _logger.warning("Office weather response was missing current.condition.code")
        return _cached if _cached is not None else None

    _cached = parsed
    _cached_at = now
    return parsed
