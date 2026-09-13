from __future__ import annotations

from fastapi import APIRouter

from app.schemas.weather import OfficeWeatherOut
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
