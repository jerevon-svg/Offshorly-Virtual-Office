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
