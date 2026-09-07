from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.schemas.progression import ProgressionOut
from app.schemas.redemption import (
    CatalogItemOut,
    CatalogOut,
    DecideIn,
    MyRedemptionsOut,
    RedeemIn,
    RedeemOut,
    RedemptionActionOut,
    RedemptionOut,
)
from app.services import redemption as svc
from app.services.quests.rewards import load_progression

# Reward Redemption V1. Self-scoped reads/writes for the employee; one approver-gated decision
# endpoint (settings.REWARD_APPROVER_EMAILS). Every Coin movement is a reward_grants row.

router = APIRouter(tags=["rewards"])


def _title(item_id: str) -> str:
    item = svc.get_item(item_id)
    return item.title if item else item_id


def _raise(exc: svc.RedemptionError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=str(exc) or exc.__class__.__name__)


@router.get("/rewards/catalog", response_model=CatalogOut, response_model_by_alias=True)
async def get_catalog(email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)) -> CatalogOut:
    progression = await load_progression(db, actor=email.strip().lower())
    return CatalogOut(
        items=[CatalogItemOut.from_item(i, progression.coins) for i in svc.catalog()],
        progression=ProgressionOut.from_progression(progression),
    )


@router.post("/rewards/redeem", response_model=RedeemOut, response_model_by_alias=True)
async def redeem(
    body: RedeemIn, response: Response, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> RedeemOut:
    """201 on a new redemption, 200 when the idempotency key replays an earlier one."""
    try:
        result = await svc.redeem(db, actor_email=email, item_id=body.item_id, idempotency_key=body.idempotency_key)
    except svc.RedemptionError as exc:
        _raise(exc)
    response.status_code = 201 if result.created_now else 200
    progression = await load_progression(db, actor=email.strip().lower())
    return RedeemOut(
        redemption=RedemptionOut.from_row(result.redemption, _title(result.redemption.item_id)),
        created_now=result.created_now,
        progression=ProgressionOut.from_progression(progression),
    )


@router.get("/rewards/redemptions/me", response_model=MyRedemptionsOut, response_model_by_alias=True)
async def my_redemptions(email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)) -> MyRedemptionsOut:
    rows = await svc.list_mine(db, actor_email=email)
    return MyRedemptionsOut(redemptions=[RedemptionOut.from_row(r, _title(r.item_id)) for r in rows])


@router.post("/rewards/redemptions/{redemption_id}/cancel", response_model=RedemptionActionOut, response_model_by_alias=True)
async def cancel_redemption(
    redemption_id: str, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> RedemptionActionOut:
    try:
        row = await svc.cancel(db, actor_email=email, redemption_id=redemption_id)
    except svc.RedemptionError as exc:
        _raise(exc)
    progression = await load_progression(db, actor=email.strip().lower())
    return RedemptionActionOut(redemption=RedemptionOut.from_row(row, _title(row.item_id)), progression=ProgressionOut.from_progression(progression))


@router.post("/rewards/redemptions/{redemption_id}/decide", response_model=RedemptionActionOut, response_model_by_alias=True)
async def decide_redemption(
    redemption_id: str, body: DecideIn, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)
) -> RedemptionActionOut:
    """Approver-only (REWARD_APPROVER_EMAILS): approved | rejected | fulfilled."""
    try:
        row = await svc.decide(db, approver_email=email, redemption_id=redemption_id, status=body.status, note=body.note)
    except svc.RedemptionError as exc:
        _raise(exc)
    progression = await load_progression(db, actor=row.actor_email)
    return RedemptionActionOut(redemption=RedemptionOut.from_row(row, _title(row.item_id)), progression=ProgressionOut.from_progression(progression))
