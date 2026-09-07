from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.working_today import WorkingTodayShare
from app.services.team_map.coarse_geo import CoarsePlace

# Working Today shares are LIVE for 12 hours. Expiry is lazy: every read stamps `stopped_at` on
# rows whose `expires_at` has passed, so no background job is needed and an expired share can
# never be served as live. The row itself is kept as the employee's "last shared location" until
# they explicitly forget it or share again.
SHARE_TTL = timedelta(hours=12)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize(email: str) -> str:
    return email.strip().lower()


def _aware(value: datetime) -> datetime:
    # SQLite hands back naive datetimes for DateTime(timezone=True) columns; they were written
    # as UTC, so re-attach UTC before comparing.
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def is_active(row: WorkingTodayShare, now: datetime | None = None) -> bool:
    moment = now or _now()
    return row.stopped_at is None and _aware(row.expires_at) > moment


async def share(
    session: AsyncSession,
    email: str,
    *,
    latitude: float,
    longitude: float,
    context: CoarsePlace,
    now: datetime | None = None,
) -> WorkingTodayShare:
    """Upsert the caller's share with the EXACT coordinate they chose to share, replacing any
    previous active or saved location and making the row live again. `context` is the
    nearest-city projection of that same point and supplies only label / country / time zone."""
    email = _normalize(email)
    moment = now or _now()
    row = await session.get(WorkingTodayShare, email)
    if row is None:
        row = WorkingTodayShare(email=email)
        session.add(row)
    row.latitude = latitude
    row.longitude = longitude
    row.label = context.label
    row.country_code = context.country_code
    row.timezone = context.timezone
    row.shared_at = moment
    row.expires_at = moment + SHARE_TTL
    row.stopped_at = None
    await session.commit()
    await session.refresh(row)
    return row


async def stop(session: AsyncSession, email: str, *, now: datetime | None = None) -> bool:
    """End live sharing but KEEP the last shared point (marks the row inactive). Returns whether
    a live share was actually ended."""
    row = await session.get(WorkingTodayShare, _normalize(email))
    if row is None or row.stopped_at is not None:
        return False
    row.stopped_at = now or _now()
    await session.commit()
    return True


async def forget(session: AsyncSession, email: str) -> bool:
    """Remove the saved location entirely; the Atlas base location applies again."""
    result = await session.execute(
        delete(WorkingTodayShare).where(WorkingTodayShare.email == _normalize(email))
    )
    await session.commit()
    return bool(result.rowcount)


async def all_shares(
    session: AsyncSession, *, now: datetime | None = None
) -> dict[str, WorkingTodayShare]:
    """Every row (active or saved) keyed by email. Live rows past their expiry are stamped
    inactive on the way past — `stopped_at` = `expires_at` — so a stale share is never served as
    live, while the point survives as the employee's last shared location."""
    moment = now or _now()
    rows = (await session.execute(select(WorkingTodayShare))).scalars().all()
    expired = [row for row in rows if row.stopped_at is None and _aware(row.expires_at) <= moment]
    for row in expired:
        row.stopped_at = _aware(row.expires_at)
    if expired:
        await session.commit()
    return {row.email: row for row in rows}
