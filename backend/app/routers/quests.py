from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.repositories import quests as quests_repo
from app.schemas.quest import MyQuestsOut, QuestOut

# Quest Foundation read API. One endpoint, self-scoped by construction: the actor is the bearer
# identity and there is no path/query parameter that could name anyone else.

router = APIRouter(tags=["quests"])


@router.get("/quests/me", response_model=MyQuestsOut, response_model_by_alias=True)
async def get_my_quests(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> MyQuestsOut:
    rows = await quests_repo.list_my_quests(db, actor_email=email)
    return MyQuestsOut(quests=[QuestOut.from_dict(r) for r in rows])
