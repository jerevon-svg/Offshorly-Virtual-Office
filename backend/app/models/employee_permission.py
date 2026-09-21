from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# THE PERMISSION VOCABULARY. A permission is a NAMED CAPABILITY, never a person, a job title or an
# email pattern — those are the binding, and the binding lives in rows of the table below. Adding a
# capability means adding a name here; granting it to somebody means inserting a row.
#
# Phase 7F Step 1 established that this backend had no authorization model at all: identity is an
# email (app/auth/deps.py) and the only gate in the product is an env allow-list of approver emails
# (settings.REWARD_APPROVER_EMAILS). This is the smallest additive model that replaces "a list of
# emails in config" with a grant that can be assigned, revoked and audited.

#: Exemption from submitting a Zoho work log before ending a work session (the "Executive Access
#: Pass"). GRANTING IT CHANGES NOTHING ON ITS OWN — Step 2 is the permission foundation only; no
#: checkout path reads it yet. See app/services/attendance_exemption.py for the single seam every
#: future reader must go through.
PERMISSION_TIMELOG_EXEMPT = "attendance.timelog_exempt"

#: The complete set of permission names this backend recognises. A grant is refused unless its name
#: is in here, so a typo becomes an error at write time rather than a permission that silently never
#: matches — and an attacker who somehow reached the repository could not invent a capability.
KNOWN_PERMISSIONS: frozenset[str] = frozenset({PERMISSION_TIMELOG_EXEMPT})


class EmployeePermission(Base):
    """One granted capability for one employee.

    NATURAL COMPOSITE KEY (email, permission), mirroring EmployeeAttendance's and
    WorkingTodayShare's "no surrogate uuid, one row per real-world fact" convention: an employee
    either holds a capability or does not, so a re-grant upserts the existing row rather than
    accumulating duplicates.

    REVOKED, NOT DELETED. `revoked_at` is what ends a grant; the row stays so `granted_by` /
    `granted_at` remain readable afterwards. A row with `revoked_at` set is INACTIVE and every read
    path must treat it as if it were absent (repositories/employee_permissions.py is the only place
    that decides this, and it is the only module that queries this table).

    NOBODY CAN GRANT THEMSELVES ANYTHING THROUGH THE API. There is no HTTP write surface for this
    table anywhere in the app — routers/permissions.py is GET-only — so `granted_by` is always an
    out-of-band administrator, never a value a request supplied. The read endpoint derives the
    caller's email from the verified bearer token (app/auth/deps.get_current_email) and will not
    read any other employee's rows."""

    __tablename__ = "employee_permissions"

    #: Lowercased, trimmed — normalised by the repository, exactly as attendance normalises.
    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    #: One of KNOWN_PERMISSIONS.
    permission: Mapped[str] = mapped_column(String(64), primary_key=True)
    #: Who assigned it — an administrator's email, or an operational marker for a scripted grant.
    #: Recorded for audit; never supplied by the holder.
    granted_by: Mapped[str] = mapped_column(String(255), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: NULL while the grant is active. Set to end it; cleared by a re-grant.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Free-text reason for the audit trail (ticket, approval, who asked). Optional.
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
