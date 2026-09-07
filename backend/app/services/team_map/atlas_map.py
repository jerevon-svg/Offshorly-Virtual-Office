from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import settings

# Mirrors app/services/toucan/roster.py: the caller's own Atlas bearer token is forwarded
# verbatim, so Atlas applies exactly the authorization it would apply to that person's browser.
# No service account, no fallback credential — a caller on the dev bypass gets "unavailable".

_logger = logging.getLogger(__name__)

MAP_PATH = "/api/v1/office/map"
MAP_TIMEOUT_SECONDS = 4.0


@dataclass(frozen=True)
class AtlasMapRow:
    """The COMPLETE set of Atlas map fields this backend is allowed to hold in memory.

    ALLOWLIST, NOT DENYLIST: ``_to_row`` names the keys it wants and ignores the rest of the
    Atlas row. ``home_address`` is deliberately absent — it is never read, so it can never be
    projected, logged, or returned. ``latitude``/``longitude`` here are Atlas's RAW geocode
    (possibly house-level) and exist only long enough for coarse_geo.snap_coarse to replace them;
    routers/team_map.py never serialises this dataclass.
    """

    email: str
    display_name: str | None
    department_name: str | None
    status: str
    latitude: float | None
    longitude: float | None
    country_code: str | None


def _opt_str(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _opt_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _to_row(raw: object) -> AtlasMapRow | None:
    if not isinstance(raw, dict):
        return None
    email = raw.get("user_email")
    if not isinstance(email, str) or not email.strip():
        return None
    lat = _opt_float(raw.get("latitude"))
    lng = _opt_float(raw.get("longitude"))
    if lat is None or lng is None:
        lat = lng = None
    status = raw.get("status")
    country = _opt_str(raw.get("country_code"))
    return AtlasMapRow(
        email=email.strip().lower(),
        display_name=_opt_str(raw.get("display_name")) or _opt_str(raw.get("full_name")),
        department_name=_opt_str(raw.get("department_name")),
        status=status if isinstance(status, str) and status else "OFFLINE",
        latitude=lat,
        longitude=lng,
        country_code=country.upper() if country else None,
    )


async def fetch_atlas_map(
    bearer_token: str | None, *, client: httpx.AsyncClient | None = None
) -> tuple[AtlasMapRow, ...] | None:
    """Fetch Atlas's map roster as the calling employee.

    Returns ``None`` (Atlas unavailable: no token, transport error, non-2xx, malformed body) or
    a tuple of allowlisted rows. NEVER RAISES, and Atlas's error text never reaches the caller —
    the router turns ``None`` into a ``source: "unavailable"`` response the UI degrades on.
    """
    if not bearer_token:
        return None

    url = f"{settings.ATLAS_API_URL.rstrip('/')}{MAP_PATH}"
    owns_client = client is None
    http_client = client or httpx.AsyncClient(timeout=MAP_TIMEOUT_SECONDS)
    try:
        res = await http_client.get(url, headers={"Authorization": f"Bearer {bearer_token}"})
    except Exception as exc:  # noqa: BLE001 - any transport failure degrades to "unavailable"
        _logger.warning("Team map Atlas fetch failed: %s", type(exc).__name__)
        return None
    finally:
        if owns_client:
            await http_client.aclose()

    if res.status_code < 200 or res.status_code >= 300:
        _logger.warning("Team map Atlas fetch returned HTTP %s", res.status_code)
        return None

    try:
        body = res.json()
    except ValueError:
        _logger.warning("Team map Atlas response was not JSON")
        return None
    if not isinstance(body, list):
        _logger.warning("Team map Atlas response was not a list")
        return None

    by_email: dict[str, AtlasMapRow] = {}
    for raw in body:
        row = _to_row(raw)
        if row is not None and row.email not in by_email:
            by_email[row.email] = row
    return tuple(by_email[email] for email in sorted(by_email))
