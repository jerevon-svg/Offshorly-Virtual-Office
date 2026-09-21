from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee_permission import KNOWN_PERMISSIONS, EmployeePermission

# THE ONLY MODULE THAT QUERIES employee_permissions. Every reader — the GET endpoint, the
# attendance-exemption seam, anything added later — comes through here, so "what counts as an
# active grant" is decided exactly once.
#
# WRITES ARE DELIBERATELY UNREACHABLE FROM HTTP. `grant` and `revoke` exist because a permission has
# to be assignable, but nothing in app/routers/ calls them and routers/permissions.py exposes no
# write method at all. Assignment is an out-of-band administrative act (a console session or a
# future admin surface), which is what makes self-assignment structurally impossible rather than
# merely forbidden. tests/test_employee_permissions.py asserts that absence.


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize(email: str) -> str:
    """Same normalisation attendance uses, for the same reason: the email arriving from Atlas and
    the email an administrator typed must resolve to one row."""
    return email.strip().lower()


def is_active(row: EmployeePermission) -> bool:
    """A grant is active until it is revoked. Expiry is deliberately NOT modelled — a pass that
    silently lapses is a support ticket, and nothing here needs it yet."""
    return row.revoked_at is None


async def has_permission(session: AsyncSession, email: str, permission: str) -> bool:
    """Does this employee currently hold this capability? FAIL CLOSED on an unrecognised name."""
    if permission not in KNOWN_PERMISSIONS:
        return False
    row = await session.get(EmployeePermission, (_normalize(email), permission))
    return row is not None and is_active(row)


async def list_active(session: AsyncSession, email: str) -> list[str]:
    """The employee's active permission names, sorted. Revoked rows are absent, and so is any name
    this build no longer recognises — a stale row from a removed capability must never be reported
    as a live one."""
    result = await session.execute(
        select(EmployeePermission.permission)
        .where(EmployeePermission.email == _normalize(email))
        .where(EmployeePermission.revoked_at.is_(None))
        .order_by(EmployeePermission.permission)
    )
    return sorted(name for name in result.scalars().all() if name in KNOWN_PERMISSIONS)


async def grant(
    session: AsyncSession,
    email: str,
    permission: str,
    *,
    granted_by: str,
    note: str | None = None,
    now: datetime | None = None,
) -> EmployeePermission:
    """Assign a capability. ADMINISTRATIVE ONLY — see the module header; no request path reaches it.

    Re-granting a revoked capability reactivates the same row and re-stamps who did it, so the row
    always answers "who granted the grant that is currently in force". Raises on an unknown
    permission name rather than writing a row that could never match a read."""
    if permission not in KNOWN_PERMISSIONS:
        raise ValueError(f"Unknown permission: {permission!r}")
    email = _normalize(email)
    moment = now or _now()
    row = await session.get(EmployeePermission, (email, permission))
    if row is None:
        row = EmployeePermission(email=email, permission=permission)
        session.add(row)
    row.granted_by = _normalize(granted_by)
    row.granted_at = moment
    row.revoked_at = None
    row.note = note
    await session.commit()
    await session.refresh(row)
    return row


async def revoke(
    session: AsyncSession,
    email: str,
    permission: str,
    *,
    now: datetime | None = None,
) -> bool:
    """End a capability, keeping the row (and therefore the audit trail). Returns False when there
    was no active grant to end. ADMINISTRATIVE ONLY, like `grant`."""
    row = await session.get(EmployeePermission, (_normalize(email), permission))
    if row is None or row.revoked_at is not None:
        return False
    row.revoked_at = now or _now()
    await session.commit()
    return True
