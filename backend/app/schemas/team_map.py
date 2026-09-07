from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Wire contract for the Global Team Map routes (see routers/team_map.py). This is the COMPLETE
# set of fields the browser may learn about a colleague's location. There is no home_address and
# no Atlas geocode anywhere in this module by construction — an Atlas-derived latitude/longitude
# is always coarse_geo.snap_coarse output (a city centroid or a grid-cell centre, 2 decimals).
# The ONE exception is an active Working Today share: the employee explicitly opted in to show
# coworkers their exact current location, so `working_today` rows carry that precise point.

TeamMapBucket = Literal["ph", "elsewhere", "none"]
TeamMapSource = Literal["atlas", "unavailable"]


class WorkingTodayOut(BaseModel):
    """Marker on a colleague: their position on the map is an EXACT location they chose to share,
    not their Atlas base location. The point itself rides on the person's ordinary
    latitude/longitude fields. `active` = live "Working today"; False = the LAST SHARED location
    kept after Stop sharing / expiry (never to be presented as current)."""

    model_config = ConfigDict(extra="forbid")

    shared_at: str
    expires_at: str
    active: bool
    stopped_at: str | None


class WorkingTodayShareOut(BaseModel):
    """The caller's OWN active share, echoed back after POST and on every GET so the button
    state survives refresh/reconnect. `latitude`/`longitude` are the exact shared point;
    `location_label` is nearest-city context."""

    model_config = ConfigDict(extra="forbid")

    latitude: float
    longitude: float
    location_label: str
    country_code: str | None
    timezone: str
    shared_at: str
    expires_at: str
    active: bool
    stopped_at: str | None


class WorkingTodayShareIn(BaseModel):
    """A browser geolocation fix the employee explicitly chose to share. Persisted verbatim in VO
    (never forwarded to Atlas) for at most 12 hours — see models/working_today.py."""

    model_config = ConfigDict(extra="forbid")

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class TeamMapPerson(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str
    display_name: str | None
    department_name: str | None
    # Atlas's 5-value PresenceStatus string ("ONLINE", "AWAY", ...), passed through unchanged;
    # the frontend maps it with services/presence/status.ts exactly as the floor does.
    status: str
    bucket: TeamMapBucket
    # Coarse (Atlas base) unless `working_today` is set, in which case exact. Null (together)
    # when bucket == "none".
    latitude: float | None
    longitude: float | None
    country_code: str | None
    # Human label of the SNAPPED place ("Cebu City, Philippines"), never Atlas's free text.
    location_label: str | None
    # IANA zone derived from the snapped place; null when there is no location.
    timezone: str | None
    # Set when the fields above come from a Working Today share (live, or the saved last shared
    # location) instead of Atlas.
    working_today: WorkingTodayOut | None = None


class TeamMapResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    people: list[TeamMapPerson] = Field(default_factory=list)
    # "unavailable" = Atlas could not be reached as the caller (no token, down, non-2xx). The UI
    # shows a stale/unavailable banner instead of an empty globe.
    source: TeamMapSource
    generated_at: str
    # The caller's own share, live or saved (independent of Atlas availability), or null.
    me: WorkingTodayShareOut | None = None
