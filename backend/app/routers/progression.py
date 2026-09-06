from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.schemas.progression import ClaimIn, ClaimOut, ProgressionOut, RewardOut
from app.services.quests import rewards

# Progression & Rewards V1. Self-scoped by construction like /quests/me and /missions/me: the
# actor is the bearer identity, so nobody can claim or read anyone else's rewards.

router = APIRouter(tags=["progression"])


@router.get("/progression/me", response_model=ProgressionOut, response_model_by_alias=True)
async def get_my_progression(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ProgressionOut:
    return ProgressionOut.from_progression(await rewards.load_progression(db, actor=email.strip().lower()))


@router.post("/progression/claim", response_model=ClaimOut, response_model_by_alias=True)
async def claim_reward(
    body: ClaimIn,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> ClaimOut:
    """Claim the reward of one completed quest (empty periodKey) or mission (its periodKey).
    Idempotent: a repeat claim returns 200 with grantedNow=false and unchanged balances."""
    target = rewards.resolve_claim_target(body.quest_id.strip(), body.period_key.strip())
    if target is None:
        raise HTTPException(status_code=404, detail="Unknown quest or mission")
    actor = email.strip().lower()
    try:
        result = await rewards.claim(db, actor=actor, target=target)
    except rewards.NotCompleted:
        raise HTTPException(status_code=409, detail="Not completed yet")
    progression = await rewards.load_progression(db, actor=actor)
    return ClaimOut(
        quest_id=target.quest_id,
        period_key=target.period_key,
        granted_now=result.granted_now,
        reward=RewardOut(xp=result.grant.xp, coins=result.grant.coins),
        progression=ProgressionOut.from_progression(progression),
    )
