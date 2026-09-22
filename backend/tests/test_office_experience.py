from __future__ import annotations

import httpx
import pytest

from app.database import Base, async_session_maker, engine
from app.main import fastapi_app
from app.models.employee_permission import (
    PERMISSION_EXPERIENCE_CREATOR,
    PERMISSION_TIMELOG_EXEMPT,
    EmployeePermission,
)
from app.models.office_experience import (
    SETTING_DEFAULT_EXPERIENCE,
    CompanySetting,
    OfficeExperiencePublication,
)
from app.repositories import employee_permissions as permissions_repo
from app.repositories import office_experience as experience_repo

# Phase 9A — the Office Experience catalog and the Creator capability.
#
# WHAT THESE TESTS ARE FOR. Three security properties and one consistency property:
#   · an ordinary employee cannot see, select or publish an unpublished experience;
#   · a Creator cannot publish an experience whose decoration layer does not exist;
#   · nothing a request CARRIES (a path identifier, a body, a header) can widen what the caller may
#     open — availability is computed from the verified identity;
#   · unpublishing the current default restores the 3D office in the same commit.

pytestmark = pytest.mark.asyncio

CREATOR = "creator@example.com"
STAFF = "staff@example.com"
ADMIN = "admin@example.com"


@pytest.fixture(autouse=True)
async def _fresh_state():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(EmployeePermission.__table__.delete())
        await conn.execute(OfficeExperiencePublication.__table__.delete())
        await conn.execute(CompanySetting.__table__.delete())
    yield


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fastapi_app), base_url="http://test")


def _as(email: str) -> dict[str, str]:
    return {"x-dev-email": email}


async def _make_creator(email: str = CREATOR) -> None:
    """The ONLY way the capability comes into existence — an out-of-band administrative grant,
    exactly as app/scripts/grant_permission.py performs it. There is no HTTP call that does this."""
    async with async_session_maker() as session:
        await permissions_repo.grant(
            session, email, PERMISSION_EXPERIENCE_CREATOR, granted_by=ADMIN, note="test"
        )


# --- the catalog, as an ordinary employee sees it -------------------------------------------------


async def test_ordinary_employee_gets_the_two_permanent_offices_and_no_preview():
    async with _client() as client:
        response = await client.get("/office/experience", headers=_as(STAFF))
    assert response.status_code == 200
    body = response.json()
    assert body["available"] == ["v2", "classic"]
    assert body["previewable"] == []
    assert body["default"] == "v2"
    assert body["creator"] is False


async def test_catalog_requires_authentication():
    """No bearer token and no dev identity -> 401, like every other authenticated route."""
    async with _client() as client:
        response = await client.get("/office/experience")
    assert response.status_code == 401


async def test_every_seasonal_experience_is_listed_with_its_real_state():
    """The Studio has to be able to say WHY a season cannot be published, so a record exists for each
    one whether or not it has a row — and `implemented` tells the two apart.

    Phase 9B shipped Halloween's decoration layer and the White Christmas pass shipped Christmas's,
    so BOTH are implemented and previewable — and NEITHER is published. Implemented is not published,
    and that separation is the whole point of having two fields."""
    await _make_creator()
    async with _client() as client:
        body = (await client.get("/office/experience", headers=_as(CREATOR))).json()
    names = {record["experience"]: record for record in body["publications"]}
    assert set(names) == {"halloween", "christmas"}
    assert names["halloween"]["implemented"] is True
    assert names["christmas"]["implemented"] is True
    assert all(record["published"] is False for record in names.values())
    # IMPLEMENTED IS NOT PUBLISHED. Halloween is the Creator's private preview and nobody else's.
    assert "halloween" not in body["available"]
    assert body["previewable"] == ["halloween", "christmas"]


# --- the Creator capability -----------------------------------------------------------------------


async def test_creator_flag_comes_from_the_permission_not_from_the_email():
    await _make_creator(STAFF)
    async with _client() as client:
        body = (await client.get("/office/experience", headers=_as(STAFF))).json()
    assert body["creator"] is True


async def test_a_different_permission_does_not_make_a_creator():
    async with async_session_maker() as session:
        await permissions_repo.grant(
            session, STAFF, PERMISSION_TIMELOG_EXEMPT, granted_by=ADMIN, note="test"
        )
    async with _client() as client:
        body = (await client.get("/office/experience", headers=_as(STAFF))).json()
        write = await client.put(
            "/office/experience/default", json={"experience": "classic"}, headers=_as(STAFF)
        )
    assert body["creator"] is False
    assert write.status_code == 403


async def test_revoking_the_capability_takes_the_creator_view_away():
    await _make_creator()
    async with async_session_maker() as session:
        await permissions_repo.revoke(session, CREATOR, PERMISSION_EXPERIENCE_CREATOR)
    async with _client() as client:
        body = (await client.get("/office/experience", headers=_as(CREATOR))).json()
        write = await client.put(
            "/office/experience/halloween/publication", json={"published": True}, headers=_as(CREATOR)
        )
    assert body["creator"] is False
    assert write.status_code == 403


# --- unauthorized writes ---------------------------------------------------------------------------


async def test_ordinary_employee_cannot_publish_or_set_the_default():
    async with _client() as client:
        publish = await client.put(
            "/office/experience/halloween/publication", json={"published": True}, headers=_as(STAFF)
        )
        default = await client.put(
            "/office/experience/default", json={"experience": "classic"}, headers=_as(STAFF)
        )
    assert publish.status_code == 403
    assert default.status_code == 403
    async with async_session_maker() as session:
        assert await experience_repo.get_default(session) == "v2"


async def test_unauthenticated_writes_are_refused():
    async with _client() as client:
        publish = await client.put(
            "/office/experience/halloween/publication", json={"published": True}
        )
        default = await client.put("/office/experience/default", json={"experience": "classic"})
    assert publish.status_code == 401
    assert default.status_code == 401


async def test_a_creator_cannot_grant_permissions_through_any_route():
    """The Creator capability is scoped to experiences. Nothing in the HTTP app writes
    employee_permissions — asserted here against the REAL route table so a future endpoint that
    broke it fails a test rather than a review."""
    offenders = [
        (route.path, sorted(route.methods - {"HEAD", "OPTIONS"}))
        for route in fastapi_app.routes
        if "permission" in getattr(route, "path", "")
        and getattr(route, "methods", set()) - {"GET", "HEAD", "OPTIONS"}
    ]
    # /office/experience/{experience}/publication is a publication write, not a permission write.
    offenders = [item for item in offenders if "/office/experience/" not in item[0]]
    assert offenders == []


# --- identifier validation --------------------------------------------------------------------------


async def test_unknown_experience_identifiers_are_refused():
    await _make_creator()
    async with _client() as client:
        publish = await client.put(
            "/office/experience/nonsense/publication", json={"published": True}, headers=_as(CREATOR)
        )
        default = await client.put(
            "/office/experience/default", json={"experience": "nonsense"}, headers=_as(CREATOR)
        )
    assert publish.status_code == 404
    assert default.status_code == 404


async def test_permanent_experiences_cannot_be_unpublished():
    """'Unpublish Classic' is a mistake, and answering 200 to it would hide the mistake."""
    await _make_creator()
    async with _client() as client:
        for name in ("v2", "classic"):
            response = await client.put(
                f"/office/experience/{name}/publication",
                json={"published": False},
                headers=_as(CREATOR),
            )
            assert response.status_code == 400, name
        body = (await client.get("/office/experience", headers=_as(CREATOR))).json()
    assert body["available"] == ["v2", "classic"]


async def test_unimplemented_experience_cannot_be_published(monkeypatch):
    """THE GATE: a season with no decoration layer in this build cannot be published, previewed or
    chosen, and the SERVER is what refuses it — the client is never the thing deciding that.

    THE GATE IS ABOUT THE CODE, NOT ABOUT THE CALENDAR, so this test no longer names whichever season
    happens to be unshipped today. Both seasons now have layers, so the unimplemented case is created
    here by taking one back out of IMPLEMENTED_EXPERIENCES — which is exactly the state this build was
    in before each of them shipped, and the state the next season will start in."""
    await _make_creator()
    monkeypatch.setattr(
        experience_repo, "IMPLEMENTED_EXPERIENCES", frozenset({"v2", "classic", "halloween"})
    )
    async with _client() as client:
        response = await client.put(
            "/office/experience/christmas/publication", json={"published": True}, headers=_as(CREATOR)
        )
    assert response.status_code == 400
    # This app's REST error shape is {"error": ...}, never FastAPI's {"detail": ...} — see
    # app/main.py's http_exception_handler. The Creator Studio reads the same field.
    assert "decoration layer" in response.json()["error"]
    async with async_session_maker() as session:
        catalog = await experience_repo.catalog_for(session, creator=True)
    assert "christmas" not in catalog.available
    assert "christmas" not in catalog.previewable


async def test_a_creator_may_privately_preview_christmas_without_it_being_published():
    """WHITE CHRISTMAS IS CREATOR-ONLY UNTIL SOMEBODY PUBLISHES IT. It is implemented, so a Creator
    gets it in `previewable`; it is unpublished, so it is in nobody's `available` — not the Creator's
    either — and it is not the default."""
    await _make_creator()
    async with _client() as client:
        creator_body = (await client.get("/office/experience", headers=_as(CREATOR))).json()
        other_body = (await client.get("/office/experience", headers=_as(STAFF))).json()
    assert "christmas" in creator_body["previewable"]
    assert "christmas" not in creator_body["available"]
    assert other_body["previewable"] == []
    assert "christmas" not in other_body["available"]
    assert creator_body["default"] == "v2"


async def test_an_unpublished_experience_cannot_become_the_default():
    await _make_creator()
    async with _client() as client:
        response = await client.put(
            "/office/experience/default", json={"experience": "christmas"}, headers=_as(CREATOR)
        )
    assert response.status_code == 400


# --- the default ------------------------------------------------------------------------------------


async def test_creator_can_set_and_restore_the_company_default():
    await _make_creator()
    async with _client() as client:
        to_classic = await client.put(
            "/office/experience/default", json={"experience": "classic"}, headers=_as(CREATOR)
        )
        assert to_classic.status_code == 200
        assert to_classic.json()["default"] == "classic"
        # Everyone sees it, not just the Creator.
        assert (await client.get("/office/experience", headers=_as(STAFF))).json()["default"] == "classic"
        restored = await client.put(
            "/office/experience/default", json={"experience": "v2"}, headers=_as(CREATOR)
        )
    assert restored.json()["default"] == "v2"


async def test_the_default_is_attributed_to_the_verified_identity():
    """`updated_by` is the bearer identity, never anything the body carried."""
    await _make_creator()
    async with _client() as client:
        await client.put(
            "/office/experience/default", json={"experience": "classic"}, headers=_as(CREATOR)
        )
    async with async_session_maker() as session:
        row = await session.get(CompanySetting, SETTING_DEFAULT_EXPERIENCE)
    assert row is not None
    assert row.updated_by == CREATOR
    assert row.updated_at is not None


async def test_a_stored_default_naming_an_unavailable_office_reads_as_the_3d_office():
    """Defence in depth against a hand-edited row: the read never hands out an office the caller
    could not open anyway."""
    async with async_session_maker() as session:
        session.add(
            CompanySetting(
                key=SETTING_DEFAULT_EXPERIENCE,
                value="halloween",
                updated_by=ADMIN,
                updated_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
            )
        )
        await session.commit()
    async with _client() as client:
        body = (await client.get("/office/experience", headers=_as(STAFF))).json()
    assert body["default"] == "v2"


# --- publication, with an experience pretended into existence -----------------------------------------


@pytest.fixture
def implemented_halloween(monkeypatch):
    """Pretend the Halloween decoration layer has shipped.

    THIS IS EXACTLY THE FUTURE CHANGE, and that is the point of patching this one frozenset: making
    a season publishable later is adding its identifier to IMPLEMENTED_EXPERIENCES and nothing
    else. These tests therefore prove the publish/unpublish/default machinery works end to end
    before any decoration exists, without shipping a fake experience to anybody."""
    from app.models import office_experience as model
    from app.repositories import office_experience as repo

    implemented = frozenset({*model.IMPLEMENTED_EXPERIENCES, "halloween"})
    monkeypatch.setattr(model, "IMPLEMENTED_EXPERIENCES", implemented)
    monkeypatch.setattr(repo, "IMPLEMENTED_EXPERIENCES", implemented)
    return implemented


async def test_creator_publishes_and_everyone_can_then_open_it(implemented_halloween):
    await _make_creator()
    async with _client() as client:
        published = await client.put(
            "/office/experience/halloween/publication",
            json={"published": True, "note": "October"},
            headers=_as(CREATOR),
        )
        assert published.status_code == 200
        assert "halloween" in published.json()["available"]
        # It leaves the Creator's PREVIEW set the moment it is public — it is not private any more.
        # The OTHER season stays in it, which is what makes this an assertion about publication rather
        # than about the set being emptied.
        assert published.json()["previewable"] == ["christmas"]
        staff_view = (await client.get("/office/experience", headers=_as(STAFF))).json()
    assert "halloween" in staff_view["available"]
    assert staff_view["previewable"] == []
    assert staff_view["creator"] is False


async def test_an_implemented_unpublished_season_is_previewable_only_by_the_creator(
    implemented_halloween,
):
    await _make_creator()
    async with _client() as client:
        creator_view = (await client.get("/office/experience", headers=_as(CREATOR))).json()
        staff_view = (await client.get("/office/experience", headers=_as(STAFF))).json()
    assert creator_view["previewable"] == ["halloween", "christmas"]
    assert "halloween" not in creator_view["available"]
    assert staff_view["previewable"] == []
    assert "halloween" not in staff_view["available"]


async def test_publication_is_attributed_and_auditable(implemented_halloween):
    await _make_creator()
    async with _client() as client:
        await client.put(
            "/office/experience/halloween/publication",
            json={"published": True, "note": "approved by Bon"},
            headers=_as(CREATOR),
        )
    async with async_session_maker() as session:
        row = await session.get(OfficeExperiencePublication, "halloween")
    assert row is not None
    assert row.published is True
    assert row.updated_by == CREATOR
    assert row.note == "approved by Bon"
    assert row.updated_at is not None


async def test_unpublishing_the_current_default_restores_the_3d_office_atomically(
    implemented_halloween,
):
    """THE CONSISTENCY PROPERTY. One commit, or neither change — a default pointing at an
    unpublished office is a state employees would load in."""
    await _make_creator()
    async with _client() as client:
        await client.put(
            "/office/experience/halloween/publication", json={"published": True}, headers=_as(CREATOR)
        )
        await client.put(
            "/office/experience/default", json={"experience": "halloween"}, headers=_as(CREATOR)
        )
        assert (await client.get("/office/experience", headers=_as(STAFF))).json()["default"] == "halloween"

        unpublished = await client.put(
            "/office/experience/halloween/publication",
            json={"published": False},
            headers=_as(CREATOR),
        )

    assert unpublished.status_code == 200
    assert unpublished.json()["default"] == "v2"
    assert "halloween" not in unpublished.json()["available"]
    # The STORED row moved too, not just the computed answer: nothing is left for a later read to
    # have to repair.
    async with async_session_maker() as session:
        row = await session.get(CompanySetting, SETTING_DEFAULT_EXPERIENCE)
        assert row is not None and row.value == "v2"
        assert await experience_repo.get_default(session) == "v2"


async def test_unpublishing_a_season_that_is_not_the_default_leaves_the_default_alone(
    implemented_halloween,
):
    await _make_creator()
    async with _client() as client:
        await client.put(
            "/office/experience/halloween/publication", json={"published": True}, headers=_as(CREATOR)
        )
        await client.put(
            "/office/experience/default", json={"experience": "classic"}, headers=_as(CREATOR)
        )
        result = await client.put(
            "/office/experience/halloween/publication",
            json={"published": False},
            headers=_as(CREATOR),
        )
    assert result.json()["default"] == "classic"


async def test_publishing_never_touches_attendance_or_any_employee_row(implemented_halloween):
    """A company-wide office change is a company SETTING. It writes two tables at most and nothing
    that belongs to a person — no attendance, no presence, no preference."""
    from app.models.attendance import EmployeeAttendance

    await _make_creator()
    async with _client() as client:
        await client.put(
            "/office/experience/halloween/publication", json={"published": True}, headers=_as(CREATOR)
        )
        await client.put(
            "/office/experience/default", json={"experience": "halloween"}, headers=_as(CREATOR)
        )
    async with async_session_maker() as session:
        from sqlalchemy import func, select

        attendance_rows = await session.scalar(select(func.count()).select_from(EmployeeAttendance))
        permission_rows = await session.scalar(select(func.count()).select_from(EmployeePermission))
    assert attendance_rows == 0
    assert permission_rows == 1  # the Creator's own grant, unchanged
