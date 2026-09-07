from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import bearer_token_from_request, get_current_email
from app.database import get_db
from app.models.working_today import WorkingTodayShare
from app.repositories import working_today as working_today_repo
from app.schemas.team_map import (
    TeamMapPerson,
    TeamMapResponse,
    WorkingTodayOut,
    WorkingTodayShareIn,
    WorkingTodayShareOut,
)
from app.services.team_map.atlas_map import AtlasMapRow, fetch_atlas_map
from app.services.team_map.coarse_geo import PH, snap_coarse

# Global Team Map. The ONLY routes that hand location data to the browser. Atlas-derived
# positions are always coarse (coarse_geo.snap_coarse) and home_address is never read
# (services/team_map/atlas_map.py). A Working Today share is the deliberate exception: the
# employee clicked "Share my exact location today" and approved the browser prompt, so their
# exact fix is stored in VO and shown to coworkers for up to 12 hours. It is never sent to Atlas
# — nothing in this feature makes an outbound request except the token-forwarded Atlas read.
#
# Degrades, never fails: Atlas unreachable → HTTP 200 with source="unavailable" and no people,
# so the panel can say "Atlas unavailable" rather than surfacing a 5xx.

_logger = logging.getLogger(__name__)

router = APIRouter(tags=["team-map"])


def _iso(value: datetime) -> str:
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return aware.isoformat()


def project_person(row: AtlasMapRow) -> TeamMapPerson:
    if row.latitude is None or row.longitude is None:
        return TeamMapPerson(
            email=row.email,
            display_name=row.display_name,
            department_name=row.department_name,
            status=row.status,
            bucket="none",
            latitude=None,
            longitude=None,
            country_code=row.country_code,
            location_label=None,
            timezone=None,
        )
    place = snap_coarse(row.latitude, row.longitude, row.country_code)
    return TeamMapPerson(
        email=row.email,
        display_name=row.display_name,
        department_name=row.department_name,
        status=row.status,
        bucket="ph" if place.country_code == PH else "elsewhere",
        latitude=place.latitude,
        longitude=place.longitude,
        country_code=place.country_code,
        location_label=place.label,
        timezone=place.timezone,
    )


def _marker(share: WorkingTodayShare) -> WorkingTodayOut:
    return WorkingTodayOut(
        shared_at=_iso(share.shared_at),
        expires_at=_iso(share.expires_at),
        active=working_today_repo.is_active(share),
        stopped_at=_iso(share.stopped_at) if share.stopped_at is not None else None,
    )


def apply_working_today(person: TeamMapPerson, share: WorkingTodayShare) -> TeamMapPerson:
    """A share — live, or the saved last shared location — overrides the Atlas base location with
    the EXACT point the employee chose to share. `working_today.active` tells the two apart."""
    return person.model_copy(
        update={
            "bucket": "ph" if share.country_code == PH else "elsewhere",
            "latitude": share.latitude,
            "longitude": share.longitude,
            "country_code": share.country_code,
            "location_label": share.label,
            "timezone": share.timezone,
            "working_today": _marker(share),
        }
    )


def project_people(
    rows: tuple[AtlasMapRow, ...], shares: dict[str, WorkingTodayShare]
) -> list[TeamMapPerson]:
    people: list[TeamMapPerson] = []
    for row in rows:
        try:
            person = project_person(row)
            share = shares.get(person.email)
            people.append(apply_working_today(person, share) if share else person)
        except Exception as exc:  # noqa: BLE001 - one odd row must not blank the whole map
            _logger.warning("Team map row projection failed: %s", type(exc).__name__)
    return people


def _share_out(share: WorkingTodayShare) -> WorkingTodayShareOut:
    return WorkingTodayShareOut(
        latitude=share.latitude,
        longitude=share.longitude,
        location_label=share.label,
        country_code=share.country_code,
        timezone=share.timezone,
        shared_at=_iso(share.shared_at),
        expires_at=_iso(share.expires_at),
        active=working_today_repo.is_active(share),
        stopped_at=_iso(share.stopped_at) if share.stopped_at is not None else None,
    )


@router.get("/team-map/people", response_model=TeamMapResponse)
async def get_team_map_people(
    request: Request,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> TeamMapResponse:
    rows = await fetch_atlas_map(bearer_token_from_request(request))
    shares = await working_today_repo.all_shares(db)
    me = shares.get(email.strip().lower())
    now = datetime.now(timezone.utc).isoformat()
    if rows is None:
        return TeamMapResponse(
            people=[], source="unavailable", generated_at=now, me=_share_out(me) if me else None
        )
    return TeamMapResponse(
        people=project_people(rows, shares),
        source="atlas",
        generated_at=now,
        me=_share_out(me) if me else None,
    )


@router.post("/team-map/working-today", response_model=WorkingTodayShareOut)
async def share_working_today(
    body: WorkingTodayShareIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> WorkingTodayShareOut:
    """Persist the employee's exact fix. snap_coarse is used ONLY to derive context (nearest-city
    label, country for bucketing, time zone) — the stored and served position is the fix itself."""
    context = snap_coarse(body.latitude, body.longitude, None)
    share = await working_today_repo.share(
        db, email, latitude=body.latitude, longitude=body.longitude, context=context
    )
    return _share_out(share)


@router.post("/team-map/working-today/stop", status_code=204, response_class=Response)
async def stop_working_today(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """End live sharing. The last shared point is KEPT (shown as "Last shared") until the employee
    forgets it or shares again."""
    await working_today_repo.stop(db, email)
    return Response(status_code=204)


@router.delete("/team-map/working-today", status_code=204, response_class=Response)
async def forget_working_today(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Forget the saved location entirely; the Atlas base location applies again."""
    await working_today_repo.forget(db, email)
    return Response(status_code=204)
