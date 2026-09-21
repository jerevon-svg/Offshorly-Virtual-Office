from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Wire contract for GET /weather/office (see routers/weather.py). This is the COMPLETE set of
# fields the browser learns about the weather — five app-owned states, a rate, a display label and
# a timestamp. WeatherAPI's own vocabulary (condition codes, icon URLs, temperature, wind, region,
# the key) is normalized away in services/weather.py and appears nowhere in this module.

WeatherState = Literal["clear", "cloudy", "rain", "heavy_rain", "thunderstorm"]
WeatherSource = Literal["weatherapi", "unavailable"]


class OfficeWeatherOut(BaseModel):
    """Current weather at the one configured office location.

    `source: "unavailable"` is a NORMAL 200 response, not an error: no key configured, WeatherAPI
    unreachable, or a malformed upstream body all land here. The client keeps its last good value
    (or CLEAR) and the VO carries on — weather must never be able to break the office.
    """

    model_config = ConfigDict(extra="forbid")

    source: WeatherSource
    state: WeatherState = "clear"
    intensity: float = Field(default=0.0, ge=0.0, le=1.0)
    label: str = ""
    observed_at: int | None = Field(default=None, description="epoch ms, as reported upstream")
    # Present on every response, including "unavailable", so no consumer can render weather data
    # without also being handed the credit line WeatherAPI's terms require.
    attribution: str


# ---- City search + 3-day forecast (the Company Hub's informational card) ------------------------------
# Same rule as above: this is the COMPLETE set of fields the browser learns. WeatherAPI's condition
# codes, icon URLs, its numeric location ids and `url` slugs, timezone data, air quality and alerts are
# normalized away in services/weather.py and appear nowhere here.

# "rate_limited" exists only so the card can say something honest instead of a generic failure. Both it
# and "unavailable" arrive as 200s — a weather lookup must never surface as a broken Hub.
LookupSource = Literal["weatherapi", "unavailable", "rate_limited"]


class CityMatchOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # What the client sends back as `q` to the forecast endpoint: "lat,lon". Never WeatherAPI's own id.
    query: str
    name: str
    region: str = ""
    country: str = ""


class CitySearchOut(BaseModel):
    """`results: []` with source "weatherapi" is a genuine EMPTY (nothing matched, or the query was
    too short to ask about); the other two sources are the card's error states."""

    model_config = ConfigDict(extra="forbid")

    source: LookupSource
    results: list[CityMatchOut] = []
    attribution: str


class ForecastDayOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: str
    max_c: float
    min_c: float
    max_f: float
    min_f: float
    condition: str
    state: WeatherState = "clear"


class CityForecastOut(BaseModel):
    """Today plus the next two days for one place, with current conditions."""

    model_config = ConfigDict(extra="forbid")

    source: LookupSource
    name: str = ""
    region: str = ""
    country: str = ""
    temp_c: float = 0.0
    temp_f: float = 0.0
    condition: str = ""
    state: WeatherState = "clear"
    observed_at: int | None = None
    days: list[ForecastDayOut] = []
    attribution: str
