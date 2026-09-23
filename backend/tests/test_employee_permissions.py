from __future__ import annotations

import httpx
import pytest

from app.database import Base, async_session_maker, engine
from app.main import fastapi_app
from app.models.employee_permission import (
    KNOWN_PERMISSIONS,
    PERMISSION_TIMELOG_EXEMPT,
    EmployeePermission,
)
from app.repositories import employee_permissions as permissions_repo
from app.services.attendance_exemption import is_timelog_exempt

# Phase 7F Step 2 — the permission foundation for the Executive Access Pass.
#
# THE TWO PROPERTIES THESE TESTS EXIST FOR are the security ones: a permission cannot be
# SELF-ASSIGNED (there is no write surface anywhere in the HTTP app) and cannot be IMPERSONATED
# (the answer is derived from the verified identity, never from anything the request carried).
# Everything else here is the small amount of behaviour needed to make those two meaningful.

pytestmark = pytest.mark.asyncio

EXEC = "exec@example.com"
STAFF = "staff@example.com"
ADMIN = "admin@example.com"


@pytest.fixture(autouse=True)
async def _fresh_state():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(EmployeePermission.__table__.delete())
    yield


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _as(email: str) -> dict[str, str]:
    return {"x-dev-email": email}


async def _grant(email: str, permission: str = PERMISSION_TIMELOG_EXEMPT) -> None:
    """An out-of-band administrative grant — the ONLY way a permission can come into existence.
    There is deliberately no HTTP call that does this; see test_no_write_route_exists_anywhere."""
    async with async_session_maker() as session:
        await permissions_repo.grant(session, email, permission, granted_by=ADMIN, note="test")


# --- the security properties ---------------------------------------------------------------------


async def test_no_write_route_exists_anywhere_for_permissions():
    """SELF-ASSIGNMENT IS STRUCTURALLY IMPOSSIBLE, not merely rejected. Walk the real route table:
    nothing that mentions permissions may carry a write method. A future endpoint that broke this
    would fail here rather than in review."""
    offenders = [
        (route.path, sorted(route.methods))
        for route in fastapi_app.routes
        if "permission" in getattr(route, "path", "")
        and not set(getattr(route, "methods", set())) <= {"GET", "HEAD"}
    ]
    assert offenders == []


async def test_employee_cannot_self_assign_via_any_http_method():
    async with _client() as client:
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            res = await client.request(
                method,
                "/me/permissions",
                headers=_as(STAFF),
                json={"permissions": [PERMISSION_TIMELOG_EXEMPT], "timelogExempt": True},
            )
            assert res.status_code == 405, f"{method} must not be routable"
        after = await client.get("/me/permissions", headers=_as(STAFF))
    assert after.json()["permissions"] == []
    assert after.json()["timelogExempt"] is False


async def test_request_supplied_identity_is_ignored_entirely():
    """IMPERSONATION. The exec really does hold the pass; the staff member asks for it by every
    means a request has — query parameter, JSON body, and a claim that they are the exec — and is
    still answered about themselves."""
    await _grant(EXEC)
    async with _client() as client:
        res = await client.request(
            "GET",
            f"/me/permissions?email={EXEC}&user={EXEC}",
            headers={**_as(STAFF), "x-employee-email": EXEC},
            json={"email": EXEC, "timelogExempt": True},
        )
    body = res.json()
    assert res.status_code == 200
    assert body["email"] == STAFF
    assert body["permissions"] == []
    assert body["timelogExempt"] is False


async def test_holder_sees_only_their_own_grant():
    await _grant(EXEC)
    async with _client() as client:
        mine = await client.get("/me/permissions", headers=_as(EXEC))
        theirs = await client.get("/me/permissions", headers=_as(STAFF))
    assert mine.json() == {
        "email": EXEC,
        "permissions": [PERMISSION_TIMELOG_EXEMPT],
        "timelogExempt": True,
    }
    assert theirs.json()["timelogExempt"] is False


async def test_requires_verified_identity():
    async with _client() as client:
        res = await client.get("/me/permissions")
    assert res.status_code == 401


async def test_dev_email_bypass_is_refused_outside_development(monkeypatch):
    """The x-dev-email header is the one identity input that is not a verified token. It must be
    inert the moment APP_ENV is anything but "development" — otherwise a header would be enough to
    read (and later, to exercise) somebody else's pass in a deploy."""
    from app.config import settings

    monkeypatch.setattr(settings, "APP_ENV", "production")
    async with _client() as client:
        res = await client.get("/me/permissions", headers=_as(EXEC))
    assert res.status_code == 401


# --- the model behind them -------------------------------------------------------------------------


async def test_no_grant_reads_as_no_permission(db_session):
    assert await permissions_repo.has_permission(db_session, STAFF, PERMISSION_TIMELOG_EXEMPT) is False
    assert await permissions_repo.list_active(db_session, STAFF) == []
    assert await is_timelog_exempt(db_session, STAFF) is False


async def test_grant_is_recorded_with_its_audit_fields_and_normalised_email(db_session):
    row = await permissions_repo.grant(
        db_session, "  Exec@Example.COM ", PERMISSION_TIMELOG_EXEMPT, granted_by="Admin@Example.com", note="approved"
    )
    assert row.email == EXEC
    assert row.granted_by == ADMIN
    assert row.granted_at is not None
    assert row.revoked_at is None
    assert row.note == "approved"
    assert await is_timelog_exempt(db_session, "EXEC@example.com") is True


async def test_revoke_ends_the_grant_but_keeps_the_audit_row(db_session):
    await permissions_repo.grant(db_session, EXEC, PERMISSION_TIMELOG_EXEMPT, granted_by=ADMIN)
    assert await permissions_repo.revoke(db_session, EXEC, PERMISSION_TIMELOG_EXEMPT) is True

    assert await is_timelog_exempt(db_session, EXEC) is False
    assert await permissions_repo.list_active(db_session, EXEC) == []
    row = await db_session.get(EmployeePermission, (EXEC, PERMISSION_TIMELOG_EXEMPT))
    assert row is not None and row.revoked_at is not None and row.granted_by == ADMIN

    # Revoking again is not an error, it is simply nothing left to end.
    assert await permissions_repo.revoke(db_session, EXEC, PERMISSION_TIMELOG_EXEMPT) is False


async def test_regrant_reactivates_the_same_row(db_session):
    await permissions_repo.grant(db_session, EXEC, PERMISSION_TIMELOG_EXEMPT, granted_by=ADMIN)
    await permissions_repo.revoke(db_session, EXEC, PERMISSION_TIMELOG_EXEMPT)
    await permissions_repo.grant(db_session, EXEC, PERMISSION_TIMELOG_EXEMPT, granted_by="hr@example.com")

    assert await is_timelog_exempt(db_session, EXEC) is True
    rows = (await db_session.execute(EmployeePermission.__table__.select())).all()
    assert len(rows) == 1


async def test_unknown_permission_name_is_refused(db_session):
    assert "attendance.admin" not in KNOWN_PERMISSIONS
    with pytest.raises(ValueError):
        await permissions_repo.grant(db_session, EXEC, "attendance.admin", granted_by=ADMIN)
    assert await permissions_repo.has_permission(db_session, EXEC, "attendance.admin") is False


async def test_nothing_is_granted_by_default(db_session):
    """No seed, no default holder, no email pattern. An empty table means nobody is exempt — which
    is the state Phase 7F Step 2 ships in."""
    rows = (await db_session.execute(EmployeePermission.__table__.select())).all()
    assert rows == []
