from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, replace

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


# ======================================================================================================
# CITY SEARCH + 3-DAY FORECAST — the Company Hub's informational weather card.
#
# A SECOND READER OF THE SAME PROVIDER, NOT A SECOND INTEGRATION. Same key, same never-raises
# discipline, same allowlist rule: every field below is one this app chose to project, and WeatherAPI's
# own vocabulary (condition codes, icon URLs, the key, the request URL, `location.tz_id`, air quality,
# alerts) is normalized away here and appears in no schema.
#
# WHY THESE TWO ARE AUTHENTICATED WHEN /weather/office IS NOT. `/weather/office` is one fixed public
# fact with one process-wide cache, so request volume there cannot become WeatherAPI volume. These take
# a CALLER-SUPPLIED query, so an open endpoint would be an open proxy onto a metered key: any number of
# distinct queries is any number of upstream calls. The cache below bounds the damage; the auth
# dependency in routers/weather.py is what stops it being reachable in the first place.
#
# IT CHANGES NOTHING ABOUT THE OFFICE. The V2 world's weather is `fetch_office_weather` (AUTO) or a
# manual Settings override; neither reads anything here. This is a card someone looks at.
# ======================================================================================================

SEARCH_URL = "https://api.weatherapi.com/v1/search.json"
FORECAST_URL = "https://api.weatherapi.com/v1/forecast.json"

# Today plus the next two. WeatherAPI counts today as day 1.
FORECAST_DAYS = 3

# BOUNDS ON THE CALLER'S QUERY. Anything outside these never becomes an upstream request: a 1-character
# query is noise WeatherAPI would charge us for, and a long one is somebody probing what this forwards.
MIN_QUERY_LEN = 2
MAX_QUERY_LEN = 64

# How many places one search may return, after merging the two provider queries below.
MAX_SEARCH_RESULTS = 10

# BOUNDED, CITY-KEYED CACHES. Unlike the office's single slot these are keyed by caller input, so they
# are capped and evicted oldest-first — an unbounded dict keyed on a query string is a memory leak with
# a public-ish door on it. Small on purpose: an office's worth of people watch a handful of cities.
MAX_CACHED_CITIES = 48
MAX_CACHED_SEARCHES = 64

# What a read produced. "rate_limited" is separated from "unavailable" ONLY so the card can say
# something honest ("too many lookups just now") instead of a generic failure; both are 200s.
FetchStatus = str  # "ok" | "unavailable" | "rate_limited"


@dataclass(frozen=True)
class CityMatch:
    """One search hit. Everything except `provider_id` is projected onto the wire."""

    # The query the client sends back to the forecast endpoint: "lat,lon", never WeatherAPI's own
    # numeric id or its `url` slug. Coordinates cannot be resolved to a different place later, which is
    # the same reasoning behind WEATHER_LOCATION's default.
    query: str
    name: str
    region: str
    country: str
    # WeatherAPI's own stable location id. INTERNAL ONLY — it is the identity two variant searches are
    # deduplicated on (see _merge_matches), and the key the one documented label correction is pinned
    # to. It is deliberately NOT projected into CityMatchOut: the client must keep sending coordinates,
    # so that swapping or losing this id can never change which point a saved city resolves to.
    provider_id: int | None = None


@dataclass(frozen=True)
class ForecastDay:
    date: str  # "YYYY-MM-DD", as reported upstream
    max_c: float
    min_c: float
    max_f: float
    min_f: float
    condition: str
    state: str


@dataclass(frozen=True)
class CityForecast:
    """Current conditions plus today and the next two days, for one place."""

    name: str
    region: str
    country: str
    temp_c: float
    temp_f: float
    condition: str
    state: str
    observed_at: int  # epoch ms
    days: tuple[ForecastDay, ...]


_search_cache: dict[str, tuple[tuple[CityMatch, ...], float]] = {}
_forecast_cache: dict[str, tuple[CityForecast, float]] = {}


def reset_lookup_caches() -> None:
    """Test seam only, as reset_cache is — production relies on the TTL and the caps."""
    _search_cache.clear()
    _forecast_cache.clear()


def _cache_get(store: dict, key: str, now: float):
    hit = store.get(key)
    if hit is None:
        return None
    value, at = hit
    if (now - at) >= settings.WEATHER_CACHE_SECONDS:
        store.pop(key, None)
        return None
    return value


def _cache_put(store: dict, key: str, value, now: float, cap: int) -> None:
    # Drop anything already expired before deciding we are full, then evict oldest-first. Plain dicts
    # preserve insertion order, so the first key is the oldest write.
    for stale in [k for k, (_, at) in store.items() if (now - at) >= settings.WEATHER_CACHE_SECONDS]:
        store.pop(stale, None)
    while len(store) >= cap:
        store.pop(next(iter(store)))
    store[key] = (value, now)


def normalize_query(raw: str) -> str | None:
    """The caller's text, bounded and trimmed — or None when it is not worth an upstream request."""
    q = " ".join(raw.split())[:MAX_QUERY_LEN].strip()
    return q if len(q) >= MIN_QUERY_LEN else None


def _status_for(code: int) -> FetchStatus:
    # 429 is the documented rate limit; WeatherAPI also answers 403 when the monthly quota is spent.
    return "rate_limited" if code in (429, 403) else "unavailable"


async def _get_json(url: str, params: dict[str, str], *, what: str, client: httpx.AsyncClient | None):
    """One upstream GET, returning (status, body). NEVER RAISES, and never lets WeatherAPI's text —
    which can echo the request URL, and with it the key — reach a caller or a log line."""
    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=settings.WEATHER_TIMEOUT_SECONDS)
    try:
        res = await http_client.get(url, params=params)
    except Exception as exc:  # noqa: BLE001 - any transport failure degrades, exactly as above
        _logger.warning("%s fetch failed: %s", what, type(exc).__name__)
        return "unavailable", None
    finally:
        if owns_client:
            await http_client.aclose()

    if res.status_code < 200 or res.status_code >= 300:
        _logger.warning("%s fetch returned HTTP %s", what, res.status_code)  # status only, never the body
        return _status_for(res.status_code), None
    try:
        return "ok", res.json()
    except ValueError:
        _logger.warning("%s response was not JSON", what)
        return "unavailable", None


def _to_city(raw: object) -> CityMatch | None:
    if not isinstance(raw, dict):
        return None
    name = raw.get("name")
    lat, lon = raw.get("lat"), raw.get("lon")
    if not isinstance(name, str) or not name.strip():
        return None
    if not isinstance(lat, (int, float)) or isinstance(lat, bool):
        return None
    if not isinstance(lon, (int, float)) or isinstance(lon, bool):
        return None
    region = raw.get("region")
    country = raw.get("country")
    provider_id = raw.get("id")
    return _correct_known_bad_region(
        CityMatch(
            query=f"{float(lat):.4f},{float(lon):.4f}",
            name=name.strip(),
            region=region.strip() if isinstance(region, str) else "",
            country=country.strip() if isinstance(country, str) else "",
            provider_id=provider_id if isinstance(provider_id, int) and not isinstance(provider_id, bool) else None,
        )
    )


# ---- THE "<X> City" PROBLEM ---------------------------------------------------------------------
#
# WeatherAPI's gazetteer treats "Mandaluyong" and "Mandaluyong City" as two unrelated entries, and its
# autocomplete is a prefix match that returns ONE of them per query:
#
#   q=Mandaluyong        -> id 1852528  Mandaluyong      | Cavite           | 14.27, 120.92
#   q=Mandaluyong City   -> id 1852527  Mandaluyong City | Negros Oriental  | 14.58, 121.04
#
# Both are real. The first is a barangay in Cavite; the second is the Metro Manila city of 425,000
# people. Somebody typing "Mandaluyong" was shown only the Cavite one and had no way to know the other
# existed. The same split affects Cebu/Cebu City, Quezon/Quezon City, Davao/Davao City and
# Kuwait/Kuwait City — it is how this provider's index is built, not a Philippine special case.
#
# SO ONE EXTRA QUERY IS ASKED, AND ONLY ONE. A search for "<X>" also asks for "<X> City", and the two
# result sets are merged. The cost is bounded at two upstream calls per distinct uncached query, and
# each variant is cached under its OWN key, so the second search anybody makes for either spelling is
# free.
#
# WHAT THE VARIANT IS ALLOWED TO CONTRIBUTE is the part that needs care, because "<X> City" is itself a
# fuzzy match and will happily answer with something else entirely:
#
#   q=Makati City  -> Makati | Berea | LESOTHO          (not a "Makati City" at all)
#   q=Paris City   -> Paris  | Ouest | HAITI
#
# A variant hit therefore counts ONLY when the provider itself names it exactly "<X> City". That is a
# fact in the response, not an assumption about geography: "Mandaluyong City", "Cebu City", "Quezon
# City", "Davao City" and "Kuwait City" all pass it, and the Lesotho and Haiti answers all fail it.
#
# The cost of being this strict is that a variant hit under a DIFFERENT name is dropped — "Pasig City"
# returns "Pasig | Iloilo", which is real and is not surfaced. That is the deliberate trade: a missing
# true result is recoverable by typing more, an unexplained foreign city in the list is not.
CITY_SUFFIX = "City"


_COORDINATE_RE = re.compile(r"^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$")


def looks_like_coordinates(query: str) -> bool:
    """Is this a "lat,lon" point rather than a place name? Both the forecast's saved-city queries and
    the REVERSE lookup a device location makes are coordinates, and "14.58,121.04 City" is not a
    question worth asking anybody."""
    return bool(_COORDINATE_RE.match(query.strip()))


def _variant_query(query: str) -> str | None:
    """The one extra provider query a search is allowed to make, or None when it would be pointless."""
    if looks_like_coordinates(query):
        return None  # a point has no "<X> City" spelling
    if query.casefold().endswith(f" {CITY_SUFFIX}".casefold()):
        return None  # they already typed it
    variant = f"{query} {CITY_SUFFIX}"
    # The bound on what this service forwards is MAX_QUERY_LEN, and a variant is still a forwarded
    # query. A near-maximum query simply does not get one rather than being allowed to exceed it.
    return variant if len(variant) <= MAX_QUERY_LEN else None


# ---- ONE DOCUMENTED LABEL CORRECTION --------------------------------------------------------------
#
# SCOPE: exactly one WeatherAPI location id. This is not a region-fixing layer and must not become one.
#
# WeatherAPI returns `region: "Negros Oriental"` for location id 1852527, whose OWN coordinates it
# reports as 14.58, 121.04. That point is in Metro Manila — it is Mandaluyong City, ~1,000 km from
# Negros Oriental, and WeatherAPI's own forecast for those coordinates is Metro Manila weather. The
# region string is simply wrong, and shown unaltered it actively tells the employee that the Metro
# Manila entry is somewhere else, which is the opposite of the disambiguation this whole change is for.
#
# SOURCE: WeatherAPI search.json and forecast.json responses for id 1852527, observed 2026-09-21; the
# coordinates agree with Mandaluyong City's published location (14.5794, 121.0359) to within ~0.6 km.
#
# SELF-HEALING, AND FAIL-OPEN. The correction applies only while ALL THREE still hold: the id matches,
# the coordinates are still the verified point, and the region is still the known-wrong string. If
# WeatherAPI fixes the label, moves the point, or reuses the id, nothing is rewritten and their value
# stands. No other location is touched, and no rule is generalised from this one.
_REGION_CORRECTIONS: dict[int, tuple[float, float, str, str]] = {
    # provider id: (expected lat, expected lon, the wrong region, the corrected region)
    1852527: (14.58, 121.04, "Negros Oriental", "Metro Manila"),
}
_CORRECTION_COORD_EPSILON = 0.05  # ~5 km: tight enough that a moved point stops matching


def _correct_known_bad_region(match: CityMatch) -> CityMatch:
    entry = _REGION_CORRECTIONS.get(match.provider_id) if match.provider_id is not None else None
    if entry is None:
        return match
    lat_s, lon_s = match.query.split(",")
    exp_lat, exp_lon, wrong_region, right_region = entry
    if match.region != wrong_region:
        return match  # upstream changed it — theirs wins
    if abs(float(lat_s) - exp_lat) > _CORRECTION_COORD_EPSILON or abs(float(lon_s) - exp_lon) > _CORRECTION_COORD_EPSILON:
        return match  # not the point this correction was verified against
    return replace(match, region=right_region)


def _identity(match: CityMatch) -> tuple:
    """What makes two hits THE SAME PLACE. The provider's own id when it gave one — two variant
    searches routinely return the identical entry (Tokyo/Tokyo City are id 3125553 both times) and
    that must collapse to one row. Coordinates are the fallback, rounded to the 4dp the query string
    already carries, so identity can never be finer than the value the client sends back."""
    return ("id", match.provider_id) if match.provider_id is not None else ("at", match.query)


def _merge_matches(*groups: tuple[CityMatch, ...]) -> tuple[CityMatch, ...]:
    """Concatenate result groups in order, dropping repeats of the same place. DISTINCT places are
    never merged: Mandaluyong/Cavite and Mandaluyong City are different ids at different points, so
    both survive — deduplication here only ever removes an exact re-appearance."""
    seen: set[tuple] = set()
    merged: list[CityMatch] = []
    for group in groups:
        for match in group:
            key = _identity(match)
            if key in seen:
                continue
            seen.add(key)
            merged.append(match)
    return tuple(merged[:MAX_SEARCH_RESULTS])


async def _search_once(
    query: str, *, client: httpx.AsyncClient | None
) -> tuple[FetchStatus, tuple[CityMatch, ...]]:
    """ONE provider query, cached under its own exact text. Never raises."""
    key = query.casefold()
    now = time.monotonic()
    cached = _cache_get(_search_cache, key, now)
    if cached is not None:
        return "ok", cached

    status, body = await _get_json(
        SEARCH_URL,
        {"key": settings.WEATHER_API_KEY.strip(), "q": query},
        what="City search",
        client=client,
    )
    if status != "ok":
        return status, ()
    if not isinstance(body, list):
        _logger.warning("City search response was not a list")
        return "unavailable", ()

    matches = tuple(c for c in (_to_city(item) for item in body[:MAX_SEARCH_RESULTS]) if c is not None)
    _cache_put(_search_cache, key, matches, now, MAX_CACHED_SEARCHES)
    return "ok", matches


async def search_cities(
    raw_query: str, *, client: httpx.AsyncClient | None = None
) -> tuple[FetchStatus, tuple[CityMatch, ...]]:
    """Places matching the caller's text, from at most TWO provider queries (see the block above).

    Bounded, cached and silent about upstream failures. The order is the order shown: everything the
    plain query matched first, then whatever the "<X> City" variant added.
    """
    query = normalize_query(raw_query)
    if query is None:
        return "ok", ()  # too short to ask about: an EMPTY result, not a failure
    if not weather_configured():
        return "unavailable", ()

    status, primary = await _search_once(query, client=client)
    if status != "ok":
        return status, ()

    variant = _variant_query(query)
    if variant is None:
        return "ok", _merge_matches(primary)

    # THE VARIANT IS A BONUS, NEVER A DEPENDENCY. If this second call fails or is rate limited, the
    # search still answers with what the plain query found rather than failing the whole lookup.
    variant_status, variant_hits = await _search_once(variant, client=client)
    if variant_status != "ok":
        return "ok", _merge_matches(primary)

    expected = variant.casefold()
    kept = tuple(m for m in variant_hits if m.name.casefold() == expected)
    return "ok", _merge_matches(primary, kept)


def _num(value: object) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _condition_of(raw: object) -> tuple[str, str] | None:
    """(label, our state) from a WeatherAPI `condition` object, or None if it is not one."""
    if not isinstance(raw, dict):
        return None
    code = raw.get("code")
    if not isinstance(code, int) or isinstance(code, bool):
        return None
    state = state_for_weatherapi_code(code)
    text = raw.get("text")
    return (text.strip() if isinstance(text, str) and text.strip() else state), state


def _to_day(raw: object) -> ForecastDay | None:
    if not isinstance(raw, dict):
        return None
    date = raw.get("date")
    day = raw.get("day")
    if not isinstance(date, str) or not isinstance(day, dict):
        return None
    condition = _condition_of(day.get("condition"))
    max_c, min_c = _num(day.get("maxtemp_c")), _num(day.get("mintemp_c"))
    max_f, min_f = _num(day.get("maxtemp_f")), _num(day.get("mintemp_f"))
    if condition is None or max_c is None or min_c is None or max_f is None or min_f is None:
        return None
    label, state = condition
    return ForecastDay(date=date, max_c=max_c, min_c=min_c, max_f=max_f, min_f=min_f, condition=label, state=state)


def _to_forecast(raw: object) -> CityForecast | None:
    if not isinstance(raw, dict):
        return None
    location, current, forecast = raw.get("location"), raw.get("current"), raw.get("forecast")
    if not isinstance(location, dict) or not isinstance(current, dict) or not isinstance(forecast, dict):
        return None
    name = location.get("name")
    if not isinstance(name, str) or not name.strip():
        return None
    condition = _condition_of(current.get("condition"))
    temp_c, temp_f = _num(current.get("temp_c")), _num(current.get("temp_f"))
    if condition is None or temp_c is None or temp_f is None:
        return None
    label, state = condition

    raw_days = forecast.get("forecastday")
    days = tuple(d for d in (_to_day(x) for x in (raw_days if isinstance(raw_days, list) else [])) if d is not None)
    if not days:
        return None  # a forecast card with no forecast is not a partial success

    epoch = current.get("last_updated_epoch")
    region, country = location.get("region"), location.get("country")
    return CityForecast(
        name=name.strip(),
        region=region.strip() if isinstance(region, str) else "",
        country=country.strip() if isinstance(country, str) else "",
        temp_c=temp_c,
        temp_f=temp_f,
        condition=label,
        state=state,
        observed_at=int(epoch) * 1000 if isinstance(epoch, int) and not isinstance(epoch, bool) else int(time.time() * 1000),
        days=days[:FORECAST_DAYS],
    )


async def fetch_city_forecast(
    raw_query: str, *, client: httpx.AsyncClient | None = None
) -> tuple[FetchStatus, CityForecast | None]:
    """Current conditions plus today and the next two days for one place. Never raises."""
    query = normalize_query(raw_query)
    if query is None:
        return "unavailable", None
    if not weather_configured():
        return "unavailable", None

    key = query.casefold()
    now = time.monotonic()
    cached = _cache_get(_forecast_cache, key, now)
    if cached is not None:
        return "ok", cached

    status, body = await _get_json(
        FORECAST_URL,
        {
            "key": settings.WEATHER_API_KEY.strip(),
            "q": query,
            "days": str(FORECAST_DAYS),
            "aqi": "no",
            "alerts": "no",
        },
        what="City forecast",
        client=client,
    )
    if status != "ok":
        return status, None

    parsed = _to_forecast(body)
    if parsed is None:
        _logger.warning("City forecast response was missing current/forecast fields")
        return "unavailable", None

    _cache_put(_forecast_cache, key, parsed, now, MAX_CACHED_CITIES)
    return "ok", parsed
