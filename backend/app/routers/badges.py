from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.repositories import badges as badges_repo
from app.schemas.badge import BadgeOut, MyBadgesOut

# Badge Progression read API. Self-scoped by construction like /quests/me, /missions/me and
# /progression/me. No claim endpoint: tiers are awarded server-side when thresholds are crossed.

router = APIRouter(tags=["badges"])


@router.get("/badges/me", response_model=MyBadgesOut, response_model_by_alias=True)
async def get_my_badges(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> MyBadgesOut:
    rows = await badges_repo.list_my_badges(db, actor_email=email)
    return MyBadgesOut(badges=[BadgeOut.from_dict(r) for r in rows])
