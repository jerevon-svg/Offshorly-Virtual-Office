from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.repositories import missions as missions_repo
from app.schemas.mission import MissionPeriodOut, MyMissionsOut

# Daily/Weekly Missions read API. Mirrors routers/quests.py: one endpoint, self-scoped by
# construction (actor = bearer identity, no parameter can name anyone else). Progress is never
# written from the client; the only side effect is the lazy first-touch draw of a period.

router = APIRouter(tags=["missions"])


@router.get("/missions/me", response_model=MyMissionsOut, response_model_by_alias=True)
async def get_my_missions(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> MyMissionsOut:
    data = await missions_repo.list_my_missions(db, actor_email=email)
    return MyMissionsOut(
        server_time=data["server_time"],
        daily=MissionPeriodOut.from_dict(data["daily"]),
        weekly=MissionPeriodOut.from_dict(data["weekly"]),
    )
