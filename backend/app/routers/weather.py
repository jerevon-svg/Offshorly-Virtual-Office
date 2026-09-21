from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.auth.deps import get_current_email
from app.schemas.weather import (
    CityForecastOut,
    CityMatchOut,
    CitySearchOut,
    ForecastDayOut,
    OfficeWeatherOut,
)
from app.services import weather as weather_service

# Real weather for the ONE configured office location, for the V2 3D office's AUTO mode.
#
# DELIBERATELY UNAUTHENTICATED, like /health. What it returns is a public meteorological fact
# about a single fixed place — no user, no roster, no position, nothing derived from a caller. It
# is safe to expose because services/weather.py caches process-wide: request volume here cannot
# turn into WeatherAPI request volume, so there is no quota to drain and no cost to amplify. It
# also keeps the dev VO rig (which has no Atlas session) on the same code path as the app.
#
# ALWAYS 200. There is no failure mode that returns 5xx — "unavailable" is a value of `source`.
# A weather outage must never surface as a broken office.

router = APIRouter(tags=["weather"])


@router.get("/weather/office", response_model=OfficeWeatherOut)
async def office_weather() -> OfficeWeatherOut:
    current = await weather_service.fetch_office_weather()
    if current is None:
        return OfficeWeatherOut(source="unavailable", attribution=weather_service.ATTRIBUTION)
    return OfficeWeatherOut(
        source="weatherapi",
        state=current.state,  # type: ignore[arg-type]  - normalized to the Literal in services/weather
        intensity=current.intensity,
        label=current.label,
        observed_at=current.observed_at,
        attribution=weather_service.ATTRIBUTION,
    )


# ---- CITY SEARCH + 3-DAY FORECAST --------------------------------------------------------------------
# The Company Hub's informational weather card. AUTHENTICATED, unlike /weather/office above, and for a
# reason worth stating: these take a CALLER-SUPPLIED place, so an open endpoint would be an open proxy
# onto a metered key — any number of distinct queries is any number of upstream calls. The office read
# is one fixed fact behind one process-wide cache and has no such property.
#
# ALSO ALWAYS 200. "unavailable" and "rate_limited" are values of `source`, exactly as above, so a
# provider outage renders as a card that says so rather than as a failed Hub.
#
# INFORMATIONAL ONLY. Nothing here feeds the V2 world's weather, which is fetch_office_weather (AUTO) or
# a manual Settings → Environment override. Neither reads these endpoints.


@router.get("/weather/search", response_model=CitySearchOut)
async def search_cities(
    # Bounded at the door as well as in the service: FastAPI rejects an over-long query before any of
    # our code runs, and normalize_query bounds it again for every other caller of the service.
    q: str = Query(..., min_length=1, max_length=weather_service.MAX_QUERY_LEN),
    _email: str = Depends(get_current_email),
) -> CitySearchOut:
    status, matches = await weather_service.search_cities(q)
    return CitySearchOut(
        source="weatherapi" if status == "ok" else status,  # type: ignore[arg-type]
        results=[CityMatchOut(query=m.query, name=m.name, region=m.region, country=m.country) for m in matches],
        attribution=weather_service.ATTRIBUTION,
    )


@router.get("/weather/forecast", response_model=CityForecastOut)
async def city_forecast(
    q: str = Query(..., min_length=1, max_length=weather_service.MAX_QUERY_LEN),
    _email: str = Depends(get_current_email),
) -> CityForecastOut:
    status, forecast = await weather_service.fetch_city_forecast(q)
    if forecast is None:
        return CityForecastOut(
            source="rate_limited" if status == "rate_limited" else "unavailable",
            attribution=weather_service.ATTRIBUTION,
        )
    return CityForecastOut(
        source="weatherapi",
        name=forecast.name,
        region=forecast.region,
        country=forecast.country,
        temp_c=forecast.temp_c,
        temp_f=forecast.temp_f,
        condition=forecast.condition,
        state=forecast.state,  # type: ignore[arg-type]  - normalized in services/weather
        observed_at=forecast.observed_at,
        days=[
            ForecastDayOut(
                date=d.date,
                max_c=d.max_c,
                min_c=d.min_c,
                max_f=d.max_f,
                min_f=d.min_f,
                condition=d.condition,
                state=d.state,  # type: ignore[arg-type]
            )
            for d in forecast.days
        ],
        attribution=weather_service.ATTRIBUTION,
    )
