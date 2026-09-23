from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.models.employee_permission import PERMISSION_EXPERIENCE_CREATOR
from app.repositories import employee_permissions as permissions_repo
from app.repositories import office_experience as experience_repo
from app.schemas.office_experience import (
    DefaultIn,
    ExperienceCatalogOut,
    PublicationIn,
    PublicationOut,
)

# WHICH OFFICE AN EMPLOYEE MAY OPEN, decided on the server (Phase 9A).
#
# THE ONE SECURITY PROPERTY THIS ROUTER EXISTS FOR: the set of experiences a caller may open is
# COMPUTED HERE from their verified identity, and the client only renders it. The frontend resolves
# an office as `URL override ∩ allowed → saved preference ∩ allowed → company default → 3D`, and
# every one of those intersections is against the list this endpoint returned. So a hand-edited
# `?world=halloween`, a hand-edited localStorage key and a stale saved preference are all inert:
# they name something the server did not list, and they collapse to the default.
#
# AUTHORISATION IS THE EXISTING PERMISSION MODEL, NOT A SECOND ONE. "Creator" is
# `experience.creator` in employee_permissions — the same table, repository and grant path the
# Executive Access Pass uses. There is still no HTTP way to grant it (see
# repositories/employee_permissions.py), so a Creator cannot make a second Creator, or re-grant
# themselves anything, through this router or any other. It confers no Atlas privilege of any kind.
#
# NO EMAIL IS EVER COMPARED TO A CONSTANT ANYWHERE IN THIS PATH. The intended Creator account is
# provisioned once, out of band, as a row (see app/scripts/grant_permission.py).
#
# DEPLOY ORDER: MIGRATION FIRST. Every route here reads `office_experience_publications` and
# `company_settings`, created by alembic revision e1f2a3b4c5d7. Before that revision is applied the
# GET answers HTTP 500, and that is deliberate — it is NOT softened into "nothing is published",
# because a forgotten migration would then look healthy. The frontend treats a failed catalog read
# as "only the permanent offices" and never writes anything, so a pre-migration backend leaves every
# employee in the 3D or Classic office with their saved preference untouched.

router = APIRouter(tags=["office-experience"])


async def _is_creator(db: AsyncSession, email: str) -> bool:
    return await permissions_repo.has_permission(db, email, PERMISSION_EXPERIENCE_CREATOR)


async def _require_creator(db: AsyncSession, email: str) -> None:
    """403 for everybody who does not hold the capability. Deliberately the SAME answer for an
    employee who holds nothing and for one who holds a different permission — there is nothing to
    learn here by probing."""
    if not await _is_creator(db, email):
        raise HTTPException(status_code=403, detail="Creator capability required")


def _catalog_out(catalog: experience_repo.ExperienceCatalog) -> ExperienceCatalogOut:
    return ExperienceCatalogOut(
        available=list(catalog.available),
        previewable=list(catalog.previewable),
        default=catalog.default,
        creator=catalog.creator,
        publications=[
            PublicationOut(
                experience=record.experience,
                published=record.published,
                implemented=record.implemented,
                updated_by=record.updated_by,
                updated_at=record.updated_at,
            )
            for record in catalog.publications
        ],
    )


@router.get("/office/experience", response_model=ExperienceCatalogOut)
async def get_experience_catalog(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ExperienceCatalogOut:
    """The offices THIS caller may open, the company default, and whether they are a Creator.

    Read on boot by every employee. It always answers with at least the two permanent offices, so
    there is no state of this table in which somebody has nowhere to go."""
    catalog = await experience_repo.catalog_for(db, creator=await _is_creator(db, email))
    return _catalog_out(catalog)


@router.put("/office/experience/{experience}/publication", response_model=ExperienceCatalogOut)
async def set_publication(
    body: PublicationIn,
    experience: str = Path(max_length=32),
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ExperienceCatalogOut:
    """Publish or unpublish one seasonal experience. CREATOR ONLY.

    Unpublishing the experience that is currently the company default restores the 3D office as the
    default in the SAME transaction — see repositories/office_experience.set_publication.

    Returns the whole catalog rather than the one record, because a publication change can move the
    default too: answering with only the record would leave the Studio showing a default that had
    just changed underneath it."""
    await _require_creator(db, email)
    try:
        await experience_repo.set_publication(
            db, experience, body.published, updated_by=email, note=body.note
        )
    except experience_repo.UnknownExperience as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except experience_repo.InvalidExperienceOperation as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _catalog_out(await experience_repo.catalog_for(db, creator=True))


@router.put("/office/experience/default", response_model=ExperienceCatalogOut)
async def set_default_experience(
    body: DefaultIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ExperienceCatalogOut:
    """Set the company-wide default office. CREATOR ONLY. Passing "v2" is the restore.

    A default change NEVER reaches an employee who is already in the office: the frontend resolves
    its experience once, after the auth gate, and holds it for the session. It takes effect on their
    next ordinary load, and it changes no attendance, presence or work session — this endpoint
    writes one row in `company_settings` and touches nothing else."""
    await _require_creator(db, email)
    try:
        await experience_repo.set_default(db, body.experience, updated_by=email)
    except experience_repo.UnknownExperience as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except experience_repo.InvalidExperienceOperation as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _catalog_out(await experience_repo.catalog_for(db, creator=True))
