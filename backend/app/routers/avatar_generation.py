from __future__ import annotations

import asyncio
import hmac
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.config import settings
from app.database import get_db
from app.repositories import avatar_generation as repo
from app.schemas.avatar_generation import (
    AuthorizeIn,
    BudgetOut,
    ConsentIn,
    ConsentOut,
    DecisionOut,
    Failure,
    MeOut,
    RunEventIn,
    RunOut,
    SettleIn,
    SpendRecordOut,
)
from app.services.avatar_generation_policy import COUNTED, Policy, SpendRequest, evaluate, month_start

# HUMANBASE AVATAR GENERATION — the backend side of employee photo -> character (2026-10-13).
#
# TWO KINDS OF CALLER, never mixed:
#   · the EMPLOYEE (verified session, get_current_email) records consent for their own photo and reads their own runs
#     and spending — no route here takes an email from an employee request;
#   · the EXECUTOR (HumanBase Studio today, a backend worker later; x-avatar-executor-key = AVATAR_EXECUTOR_KEY) asks
#     before every paid stage, settles afterwards, and reports progress + artifact hashes. With no key configured the
#     executor routes answer 503: nothing can authorize a spend.
#
# AUTO-SPEND IS OFF (AVATAR_AUTOSPEND_ENABLED=false) until deliberately approved: every paid stage then needs a named
# human approver, and every safeguard in app/services/avatar_generation_policy.py applies to that approval too.

router = APIRouter()
_locks: dict[str, asyncio.Lock] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def require_executor(request: Request) -> None:
    key = settings.AVATAR_EXECUTOR_KEY
    if not key:
        raise HTTPException(status_code=503, detail="avatar generation executor is not configured")
    given = request.headers.get("x-avatar-executor-key") or ""
    if not hmac.compare_digest(given.encode(), key.encode()):
        raise HTTPException(status_code=401, detail="executor key required")


def _record_out(r) -> SpendRecordOut:
    return SpendRecordOut(id=r.id, person_id=r.person_id, stage=r.stage, provider=r.provider, unit=r.unit, estimate=r.estimate,
                          actual=r.actual, status=r.status, reason=r.reason, mode=r.mode, approved_by=r.approved_by, consent=r.consent,
                          photo_sha256=r.photo_sha256, input_sha256=r.input_sha256, created_at=r.created_at, settled_at=r.settled_at)


def _run_out(r) -> RunOut:
    return RunOut(person_id=r.person_id, photo_sha256=r.photo_sha256, stage=r.stage, status=r.status, artifacts=r.artifacts or {},
                  error=r.error, evidence=r.evidence, updated_at=r.updated_at)


# ---- the employee ------------------------------------------------------------------------------------------------------

@router.put("/avatar/generation/consent", response_model=ConsentOut, response_model_by_alias=True)
async def give_consent(body: ConsentIn, email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)) -> ConsentOut:
    row = await repo.upsert_consent(db, email, body.photo_sha256, body.statement, _now())
    return ConsentOut(photo_sha256=row.photo_sha256, statement=row.statement, attested_at=row.attested_at)


@router.get("/avatar/generation/me", response_model=MeOut, response_model_by_alias=True)
async def my_generation(email: str = Depends(get_current_email), db: AsyncSession = Depends(get_db)) -> MeOut:
    start = month_start(_now())
    records = await repo.records_for(db, email)
    photos = {r.photo_sha256 for r in records if r.status in COUNTED and repo._aware(r.created_at) >= start}
    return MeOut(
        autospend_enabled=settings.AVATAR_AUTOSPEND_ENABLED,
        consents=[ConsentOut(photo_sha256=c.photo_sha256, statement=c.statement, attested_at=c.attested_at) for c in await repo.consents_for(db, email)],
        spend=[_record_out(r) for r in records],
        runs=[_run_out(r) for r in await repo.runs_for(db, email)],
        runs_this_month=len(photos),
        max_runs_per_month=settings.AVATAR_MAX_RUNS_PER_USER_MONTHLY,
    )


# ---- the executor ------------------------------------------------------------------------------------------------------

@router.post("/avatar/generation/authorize", response_model=DecisionOut, response_model_by_alias=True, dependencies=[Depends(require_executor)])
async def authorize(body: AuthorizeIn, db: AsyncSession = Depends(get_db)) -> DecisionOut:
    req = SpendRequest(email=body.email.strip().lower(), person_id=body.person_id, stage=body.stage, input_sha256=body.input_sha256,
                       photo_sha256=body.photo_sha256, estimate=body.estimate, mode=body.mode, approved_by=body.approved_by,
                       allow_reroll=body.allow_reroll, provider_balance=body.provider_balance,
                       has_approved_character=body.has_approved_character, consent_attested_by=body.consent_attested_by)
    # one decision at a time per employee + stage, so two concurrent requests cannot both pass the in-flight check
    # (single worker; a multi-worker deployment needs a database-level guard here)
    lock = _locks.setdefault(f"{req.email}|{req.stage}", asyncio.Lock())
    async with lock:
        now = _now()
        consent = await repo.has_consent(db, req.email, req.photo_sha256)
        decision = evaluate(req, Policy.from_settings(settings), consent_on_record=consent,
                            user_history=await repo.user_history(db, req.email), company_month=await repo.company_since(db, month_start(now)), now=now)
        record_id = None
        if not body.dry_run:
            label = "employee" if consent else f"attested by {req.consent_attested_by}" if req.consent_attested_by else "none"
            record_id = (await repo.create_record(db, req, decision, label, now)).id
    return DecisionOut(allowed=decision.allowed, record_id=record_id, failures=[Failure(code=c, message=m) for c, m in decision.failures],
                       provider=decision.provider, unit=decision.unit)


@router.post("/avatar/generation/settle", response_model=SpendRecordOut, response_model_by_alias=True, dependencies=[Depends(require_executor)])
async def settle(body: SettleIn, db: AsyncSession = Depends(get_db)) -> SpendRecordOut:
    row = await repo.settle(db, body.record_id, body.outcome, body.actual, body.evidence, _now())
    if row is None:
        raise HTTPException(status_code=409, detail="no authorized, unsettled spend with that id")
    return _record_out(row)


@router.post("/avatar/generation/runs", response_model=RunOut, response_model_by_alias=True, dependencies=[Depends(require_executor)])
async def report_run(body: RunEventIn, db: AsyncSession = Depends(get_db)) -> RunOut:
    row = await repo.upsert_run(db, email=body.email, photo_sha256=body.photo_sha256, person_id=body.person_id, stage=body.stage,
                                status=body.status, artifact=body.artifact.model_dump() if body.artifact else None, error=body.error,
                                evidence=body.evidence, now=_now())
    return _run_out(row)


@router.get("/avatar/generation/budget", response_model=BudgetOut, response_model_by_alias=True, dependencies=[Depends(require_executor)])
async def budget(db: AsyncSession = Depends(get_db)) -> BudgetOut:
    now = _now()
    p = Policy.from_settings(settings)
    return BudgetOut(autospend_enabled=p.autospend_enabled, month=now.strftime("%Y-%m"), spent=await repo.month_totals(db, month_start(now)),
                     budgets=dict(p.budgets), meshy_reserve_credits=p.meshy_reserve_credits)
