from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.office_experience import (
    DEFAULT_EXPERIENCE,
    IMPLEMENTED_EXPERIENCES,
    KNOWN_EXPERIENCES,
    PERMANENT_EXPERIENCES,
    SEASONAL_EXPERIENCES,
    SETTING_DEFAULT_EXPERIENCE,
    CompanySetting,
    OfficeExperiencePublication,
)

# THE ONLY MODULE THAT QUERIES office_experience_publications OR company_settings, and therefore the
# only place that decides what "available", "previewable" and "the default" mean. The router does no
# arithmetic on experiences at all — it authenticates, authorises and calls in here.
#
# EVERY RULE IN ONE PLACE, because every one of them is a security rule once a client is allowed to
# ask for an experience by name:
#
#   · an identifier this build does not know is refused, never stored (InvalidExperience);
#   · a permanent experience cannot be published or unpublished (it is available by construction);
#   · a seasonal experience with no shipped decoration layer cannot be published or previewed;
#   · the company default must be something that is actually available;
#   · UNPUBLISHING THE CURRENT DEFAULT RESTORES THE 3D OFFICE IN THE SAME TRANSACTION. Not a
#     follow-up write, not a repair on the next read: one commit, or neither change. A default
#     pointing at an unpublished office is the one inconsistent state this table can reach, and the
#     window in which it existed is what employees would load in.


class ExperienceError(ValueError):
    """Base for every refusal here. The router maps subclasses to status codes; nothing else
    catches these, so an unexpected one surfaces as a 500 rather than as a silent success."""


class UnknownExperience(ExperienceError):
    """The identifier is not one this build recognises at all -> 404."""


class InvalidExperienceOperation(ExperienceError):
    """A known identifier, asked to do something it cannot do -> 400."""


@dataclass(frozen=True)
class PublicationRecord:
    """One seasonal experience, as the Creator Studio needs to see it."""

    experience: str
    published: bool
    implemented: bool
    updated_by: str | None
    updated_at: datetime | None


@dataclass(frozen=True)
class ExperienceCatalog:
    """THE WHOLE ANSWER TO "WHICH OFFICES MAY THIS CALLER OPEN", resolved on the server.

    `available` is what anyone may open. `previewable` is the Creator's private set — implemented
    seasons that are not published yet — and is empty for everybody else. The client's allowed set
    is the union, and it never computes either half itself: that is what makes a hand-edited URL or
    localStorage value inert rather than merely discouraged."""

    available: tuple[str, ...]
    previewable: tuple[str, ...]
    default: str
    creator: bool
    publications: tuple[PublicationRecord, ...]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize(email: str) -> str:
    """The same normalisation employee_permissions and attendance use, for the same reason."""
    return email.strip().lower()


def _require_known(experience: str) -> str:
    """Validate an identifier that arrived from a request. Anything not in this build's vocabulary
    is refused here, before it can reach a row, a comparison or a response."""
    value = experience.strip().lower()
    if value not in KNOWN_EXPERIENCES:
        raise UnknownExperience(f"Unknown office experience: {experience!r}")
    return value


async def _published_set(session: AsyncSession) -> set[str]:
    """The seasonal experiences currently switched on. A row for an identifier this build no longer
    knows, or one that is no longer implemented, is IGNORED rather than reported — a stale row must
    never advertise an office the deployed frontend cannot draw."""
    result = await session.execute(
        select(OfficeExperiencePublication.experience).where(
            OfficeExperiencePublication.published.is_(True)
        )
    )
    return {
        name
        for name in result.scalars().all()
        if name in SEASONAL_EXPERIENCES and name in IMPLEMENTED_EXPERIENCES
    }


async def get_default(session: AsyncSession) -> str:
    """The company-wide default office.

    FALLS BACK TO THE 3D OFFICE in three separate cases, and they are all the same answer: no row
    has ever been written, the stored value is not an identifier this build knows, or it names an
    office that is no longer available. The last one is what makes the default safe to read even if
    a row were edited by hand in the database."""
    row = await session.get(CompanySetting, SETTING_DEFAULT_EXPERIENCE)
    if row is None:
        return DEFAULT_EXPERIENCE
    value = row.value
    if value in PERMANENT_EXPERIENCES:
        return value
    if value in await _published_set(session):
        return value
    return DEFAULT_EXPERIENCE


async def list_publications(session: AsyncSession) -> tuple[PublicationRecord, ...]:
    """Every seasonal experience this build knows, in declaration order, whether or not it has a
    row. The Creator Studio has to be able to show "Halloween — not implemented yet" as a real
    state, so absence is reported as a record rather than omitted."""
    result = await session.execute(select(OfficeExperiencePublication))
    rows = {row.experience: row for row in result.scalars().all()}
    return tuple(
        PublicationRecord(
            experience=name,
            published=bool(rows[name].published) if name in rows else False,
            implemented=name in IMPLEMENTED_EXPERIENCES,
            updated_by=rows[name].updated_by if name in rows else None,
            updated_at=rows[name].updated_at if name in rows else None,
        )
        for name in SEASONAL_EXPERIENCES
    )


async def catalog_for(session: AsyncSession, *, creator: bool) -> ExperienceCatalog:
    """What this caller may open, and what they may see. `creator` is decided by the router from the
    verified identity's permissions — never from anything the request carried."""
    published = await _published_set(session)
    available = tuple(name for name in KNOWN_EXPERIENCES if name in PERMANENT_EXPERIENCES or name in published)
    previewable = (
        tuple(
            name
            for name in SEASONAL_EXPERIENCES
            if name in IMPLEMENTED_EXPERIENCES and name not in published
        )
        if creator
        else ()
    )
    return ExperienceCatalog(
        available=available,
        previewable=previewable,
        default=await get_default(session),
        creator=creator,
        publications=await list_publications(session),
    )


async def set_publication(
    session: AsyncSession,
    experience: str,
    published: bool,
    *,
    updated_by: str,
    note: str | None = None,
    now: datetime | None = None,
) -> PublicationRecord:
    """Publish or unpublish ONE seasonal experience. CREATOR-ONLY — the router checks; this function
    assumes the check has been made and is never reachable without it.

    UNPUBLISHING THE CURRENT DEFAULT RESTORES THE 3D OFFICE, and both writes land in ONE commit.
    They are staged on the session and committed together at the end, so a failure leaves the table
    exactly as it was rather than half-changed."""
    name = _require_known(experience)
    if name in PERMANENT_EXPERIENCES:
        raise InvalidExperienceOperation(
            f"{name!r} is permanently available and cannot be published or unpublished."
        )
    if published and name not in IMPLEMENTED_EXPERIENCES:
        raise InvalidExperienceOperation(
            f"{name!r} has no decoration layer in this build and cannot be published yet."
        )

    moment = now or _now()
    row = await session.get(OfficeExperiencePublication, name)
    if row is None:
        row = OfficeExperiencePublication(experience=name)
        session.add(row)
    row.published = published
    row.updated_by = _normalize(updated_by)
    row.updated_at = moment
    row.note = note

    if not published:
        # ATOMIC RESTORE. Read the RAW stored default rather than get_default(): get_default already
        # answers "v2" for an unavailable value, which would make this look like there was nothing
        # to repair and leave the stale row in the table for the next person to puzzle over.
        setting = await session.get(CompanySetting, SETTING_DEFAULT_EXPERIENCE)
        if setting is not None and setting.value == name:
            setting.value = DEFAULT_EXPERIENCE
            setting.updated_by = _normalize(updated_by)
            setting.updated_at = moment

    await session.commit()
    await session.refresh(row)
    return PublicationRecord(
        experience=row.experience,
        published=bool(row.published),
        implemented=row.experience in IMPLEMENTED_EXPERIENCES,
        updated_by=row.updated_by,
        updated_at=row.updated_at,
    )


async def set_default(
    session: AsyncSession,
    experience: str,
    *,
    updated_by: str,
    now: datetime | None = None,
) -> str:
    """Set the company-wide default office. CREATOR-ONLY, like set_publication.

    THE DEFAULT MUST BE AVAILABLE TO EVERYONE. A Creator may PREVIEW an unpublished season, but
    making it the company default would hand every employee an office the server does not list for
    them — they would resolve straight past it to the 3D office and the setting would look broken
    while being right. So the check is against `available`, not against the Creator's own view."""
    name = _require_known(experience)
    if name not in PERMANENT_EXPERIENCES and name not in await _published_set(session):
        raise InvalidExperienceOperation(
            f"{name!r} is not published, so it cannot be the company default."
        )

    moment = now or _now()
    row = await session.get(CompanySetting, SETTING_DEFAULT_EXPERIENCE)
    if row is None:
        row = CompanySetting(key=SETTING_DEFAULT_EXPERIENCE)
        session.add(row)
    row.value = name
    row.updated_by = _normalize(updated_by)
    row.updated_at = moment
    await session.commit()
    return name
