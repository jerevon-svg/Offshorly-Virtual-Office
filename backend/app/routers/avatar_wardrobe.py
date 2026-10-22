from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.repositories import avatar_wardrobes as wardrobe_repo
from app.schemas.avatar_wardrobe import WardrobeIn, WardrobeOut, WardrobesOut

# CHARACTER STUDIO EDIT — an employee's saved HumanBase outfit (2026-10-13).
#
# THE ONE SECURITY PROPERTY: the row read or written by /me is the VERIFIED caller's (get_current_email), never
# one a request names — so no employee can change another's character. The list read is outfits only, for
# dressing coworkers' bodies in the office; it carries no nickname and no other personal field.
#
# Wardrobe changes are data on top of the approved character: no head is regenerated, nothing is promoted and
# no credit is spent here.

router = APIRouter()


def _out(row) -> WardrobeOut:
    if row is None:
        return WardrobeOut()
    return WardrobeOut(nickname=row.nickname, outfit=row.outfit or {}, updated_at=row.updated_at)


@router.get("/avatar/wardrobe/me", response_model=WardrobeOut, response_model_by_alias=True)
async def read_my_wardrobe(email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)) -> WardrobeOut:
    return _out(await wardrobe_repo.get(db, email))


@router.put("/avatar/wardrobe/me", response_model=WardrobeOut, response_model_by_alias=True)
async def save_my_wardrobe(
    body: WardrobeIn, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> WardrobeOut:
    outfit = {slot: item.model_dump(by_alias=True) for slot, item in body.outfit.items()}
    return _out(await wardrobe_repo.upsert(db, email, body.nickname, outfit))


@router.get("/avatar/wardrobes", response_model=WardrobesOut, response_model_by_alias=True)
async def read_all_outfits(email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)) -> WardrobesOut:
    del email  # authenticated read: any signed-in employee may see how coworkers are dressed (they see them anyway)
    return WardrobesOut(outfits=await wardrobe_repo.all_outfits(db))
