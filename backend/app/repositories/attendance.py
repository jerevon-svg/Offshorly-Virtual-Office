from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attendance import EmployeeAttendance

# Attendance repository — see app/models/attendance.py. Same atomic INSERT ... ON CONFLICT DO
# UPDATE shape as repositories/position.py so two tabs checking in at once cannot race into a
# PK violation; the `where=` guards make both writes idempotent (a second check-in keeps the
# original checked_in_at, a second check-out keeps the original checked_out_at).

CHECKED_IN = "CHECKED_IN"
CHECKED_OUT = "CHECKED_OUT"


def _normalize(email: str) -> str:
    return email.strip().lower()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _status_of(row: EmployeeAttendance | None) -> str:
    if row is not None and row.checked_in_at is not None and row.checked_out_at is None:
        return CHECKED_IN
    return CHECKED_OUT


def _to_dict(email: str, row: EmployeeAttendance | None) -> dict[str, Any]:
    return {
        "email": email,
        "status": _status_of(row),
        "checked_in_at": row.checked_in_at if row is not None else None,
        "checked_out_at": row.checked_out_at if row is not None else None,
    }


async def get_status(session: AsyncSession, email: str) -> dict[str, Any]:
    """No row → CHECKED_OUT with null timestamps. A row is never created just to read."""
    email = _normalize(email)
    row = await session.get(EmployeeAttendance, email)
    return _to_dict(email, row)


async def _upsert(
    session: AsyncSession,
    *,
    values: dict[str, Any],
    set_: dict[str, Any],
    where_sqlite,
    where_pg,
    fallback_should_update,
) -> None:
    bind_name = session.bind.dialect.name if session.bind is not None else ""
    if bind_name == "sqlite":
        stmt = sqlite_insert(EmployeeAttendance).values(**values)
        stmt = stmt.on_conflict_do_update(index_elements=[EmployeeAttendance.email], set_=set_, where=where_sqlite)
        await session.execute(stmt)
    elif bind_name == "postgresql":
        stmt = postgresql_insert(EmployeeAttendance).values(**values)
        stmt = stmt.on_conflict_do_update(index_elements=[EmployeeAttendance.email], set_=set_, where=where_pg)
        await session.execute(stmt)
    else:
        existing = await session.get(EmployeeAttendance, values["email"])
        if existing is None:
            session.add(EmployeeAttendance(**values))
        elif fallback_should_update(existing):
            for key, value in set_.items():
                setattr(existing, key, value)
    await session.commit()


async def check_in(session: AsyncSession, email: str, *, now: datetime | None = None) -> dict[str, Any]:
    """Starts a work session. Idempotent: an already-CHECKED_IN row is left untouched (original
    checked_in_at preserved). A CHECKED_OUT row gets a fresh checked_in_at and its checked_out_at
    cleared."""
    email = _normalize(email)
    now = now or _now()
    values = dict(email=email, checked_in_at=now, checked_out_at=None, updated_at=now)
    set_ = dict(checked_in_at=now, checked_out_at=None, updated_at=now)
    not_checked_in = (EmployeeAttendance.checked_in_at.is_(None)) | (EmployeeAttendance.checked_out_at.isnot(None))
    await _upsert(
        session,
        values=values,
        set_=set_,
        where_sqlite=not_checked_in,
        where_pg=not_checked_in,
        fallback_should_update=lambda row: _status_of(row) == CHECKED_OUT,
    )
    session.expire_all()
    return await get_status(session, email)


async def check_out(session: AsyncSession, email: str, *, now: datetime | None = None) -> dict[str, Any]:
    """Ends the active work session. Idempotent: an already-CHECKED_OUT row keeps its original
    checked_out_at. Checking out with no row records the checkout (checked_in_at stays NULL)."""
    email = _normalize(email)
    now = now or _now()
    values = dict(email=email, checked_in_at=None, checked_out_at=now, updated_at=now)
    set_ = dict(checked_out_at=now, updated_at=now)
    currently_in = EmployeeAttendance.checked_out_at.is_(None)
    await _upsert(
        session,
        values=values,
        set_=set_,
        where_sqlite=currently_in,
        where_pg=currently_in,
        fallback_should_update=lambda row: row.checked_out_at is None,
    )
    session.expire_all()
    return await get_status(session, email)


async def list_checked_out_emails(session: AsyncSession) -> list[str]:
    """Emails with an explicit checkout on record, oldest checkout first — used at startup to
    re-seed the in-memory offline lineup so checked-out people stay on the sidewalk across a
    backend restart. Never-checked-in employees (no row) are deliberately not included: the
    lineup has always meant "explicitly checked out"."""
    result = await session.execute(
        select(EmployeeAttendance.email)
        .where(EmployeeAttendance.checked_out_at.isnot(None))
        .order_by(EmployeeAttendance.checked_out_at, EmployeeAttendance.email)
    )
    return [row[0] for row in result.all()]


async def recover_stale_session(
    session: AsyncSession, email: str, expected_checked_in_at: datetime, *, now: datetime | None = None,
) -> dict[str, Any] | None:
    """Close only the named stale session; never create a row or close a replacement session."""
    email = _normalize(email)
    now = now or _now()
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    expected = expected_checked_in_at
    if expected.tzinfo is None:
        expected = expected.replace(tzinfo=timezone.utc)
    expected = expected.astimezone(timezone.utc)
    midnight = now.astimezone(ZoneInfo("Asia/Manila")).replace(hour=0, minute=0, second=0, microsecond=0)
    if expected > now - timedelta(hours=24) or expected >= midnight:
        return None
    await session.execute(
        update(EmployeeAttendance)
        .where(
            EmployeeAttendance.email == email,
            EmployeeAttendance.checked_in_at == expected,
            EmployeeAttendance.checked_out_at.is_(None),
            EmployeeAttendance.checked_in_at <= now - timedelta(hours=24),
            EmployeeAttendance.checked_in_at < midnight.astimezone(timezone.utc),
        )
        .values(checked_out_at=now, updated_at=now)
        .execution_options(synchronize_session=False)
    )
    await session.commit()
    session.expire_all()
    record = await get_status(session, email)
    actual = record["checked_in_at"]
    if actual is not None and actual.tzinfo is None:
        actual = actual.replace(tzinfo=timezone.utc)
    if actual == expected and record["checked_out_at"] is not None:
        return record
    return None
