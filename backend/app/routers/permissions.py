from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.models.employee_permission import PERMISSION_TIMELOG_EXEMPT
from app.repositories import employee_permissions as permissions_repo
from app.schemas.permissions import MyPermissionsOut

# READ-ONLY, AND SELF-ONLY. This router has exactly one route, it is a GET, and its answer is
# derived entirely from `get_current_email` — the same verified-identity dependency every other
# router uses (app/auth/deps.py: the bearer token is verified against Atlas; a request body, query
# parameter or custom header can never supply an identity, and the x-dev-email bypass is hard-gated
# on APP_ENV == "development").
#
# THERE IS NO WRITE SURFACE HERE ON PURPOSE. Granting and revoking live in
# repositories/employee_permissions.py and are reachable only out of band, so "an employee cannot
# assign themselves a permission" is a property of the routing table rather than a check that could
# be forgotten. tests/test_employee_permissions.py asserts it by walking the app's real routes.
#
# WHY A SEPARATE ENDPOINT RATHER THAN A FIELD ON /attendance/me: Phase 7F Step 2 must not change
# attendance behaviour or its wire shape at all. Capabilities are also not attendance — a second
# capability would have nothing to do with a work session — so they get their own read.
#
# DEPLOY ORDER: MIGRATION FIRST. This endpoint reads the `employee_permissions` table created by
# alembic revision d0e1f2a3b4c6. Until that revision is applied, the query raises
# `OperationalError: no such table: employee_permissions` and the request answers HTTP 500. That is
# deliberate and must not be softened into an empty permission list: "the migration has not run" and
# "this employee holds nothing" are different facts, and a fallback that conflated them would let a
# forgotten migration look healthy — and would, once anything depends on the exemption, read as
# "not exempt" for a person who genuinely holds the pass.
#
# NOTHING ELSE BREAKS IN THE MEANTIME. Attendance, checkout, the Zoho submission and quest XP do not
# touch this router, this table or this session, so a pre-migration 500 here is confined to this one
# route (verified against a database at the previous revision: /attendance/me, /attendance/check-in
# and /attendance/check-out all continue to answer 200).

router = APIRouter(tags=["permissions"])


@router.get("/me/permissions", response_model=MyPermissionsOut)
async def get_my_permissions(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> MyPermissionsOut:
    """The authenticated employee's own active capabilities.

    Contract, ONCE THE TABLE EXISTS: an employee with no grants is reported with an empty list and
    every derived flag false — never a 404. That is what makes this safe to read on boot.

    BEFORE alembic revision d0e1f2a3b4c6 HAS BEEN APPLIED this route answers HTTP 500, because the
    table it reads is not there. It is not caught and not reported as an empty list — see the
    deploy-order note in the module header."""
    active = await permissions_repo.list_active(db, email)
    return MyPermissionsOut(
        email=email,
        permissions=active,
        timelog_exempt=PERMISSION_TIMELOG_EXEMPT in active,
    )
