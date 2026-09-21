from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee_permission import PERMISSION_TIMELOG_EXEMPT
from app.repositories import employee_permissions as permissions_repo

# THE ONE SEAM for "may this employee end a work session without submitting a Zoho work log".
#
# It exists as a named function with one caller-visible answer so the SOURCE of the decision can
# change — today a database grant, tomorrow an Atlas-carried permission claim (see
# ATLAS_TIMELOG_VERIFICATION_REQUEST.md) — without any consumer learning where it came from.
#
# NOTHING READS IT YET. Phase 7F Step 2 is the permission foundation only: no checkout path, no
# attendance route and no UI consults this function. Step 3 wires it.
#
# WHAT THIS FUNCTION IS NOT. It is not a claim that a time log was submitted, and it never will be.
# Whether a work log EXISTS for a given employee and date is a fact only Atlas/Zoho holds, and this
# backend currently cannot verify it at all — POST /attendance/check-out accepts any authenticated
# caller with no evidence of a submission. An exemption therefore waives a requirement this server
# does not yet enforce; the enforcement it will eventually waive is specified in
# ATLAS_TIMELOG_VERIFICATION_REQUEST.md at the repository root.


async def is_timelog_exempt(session: AsyncSession, email: str) -> bool:
    """True when this employee holds an active Executive Access Pass.

    SERVER-AUTHORITATIVE BY CONSTRUCTION: the only input is an email the caller's bearer token was
    verified into (app/auth/deps.get_current_email), and the only evidence is a row an
    administrator wrote. No request body, header, query parameter, job title or frontend label can
    reach this answer."""
    return await permissions_repo.has_permission(session, email, PERMISSION_TIMELOG_EXEMPT)
