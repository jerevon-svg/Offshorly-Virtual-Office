from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.avatar_generation import AvatarGenerationConsent, AvatarGenerationRun, AvatarSpendRecord
from app.services.avatar_generation_policy import COUNTED, Decision, LedgerEntry, SpendRequest


def _key(email: str) -> str:
    return email.strip().lower()


def _entry(r: AvatarSpendRecord) -> LedgerEntry:
    return LedgerEntry(email=r.email, stage=r.stage, input_sha256=r.input_sha256, photo_sha256=r.photo_sha256, status=r.status,
                       estimate=r.estimate, unit=r.unit or "", created_at=_aware(r.created_at))


def _aware(t: datetime) -> datetime:
    # SQLite hands timestamps back naive; every value here was written as UTC
    from datetime import timezone
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


async def upsert_consent(session: AsyncSession, email: str, photo_sha256: str, statement: str, now: datetime) -> AvatarGenerationConsent:
    row = await session.get(AvatarGenerationConsent, (_key(email), photo_sha256))
    if row is None:
        row = AvatarGenerationConsent(email=_key(email), photo_sha256=photo_sha256, statement=statement, attested_at=now)
        session.add(row)
    else:
        row.statement, row.attested_at = statement, now
    await session.commit()
    return row


async def has_consent(session: AsyncSession, email: str, photo_sha256: str) -> bool:
    return await session.get(AvatarGenerationConsent, (_key(email), photo_sha256)) is not None


async def consents_for(session: AsyncSession, email: str) -> list[AvatarGenerationConsent]:
    rows = await session.execute(select(AvatarGenerationConsent).where(AvatarGenerationConsent.email == _key(email)))
    return list(rows.scalars())


async def user_history(session: AsyncSession, email: str) -> list[LedgerEntry]:
    rows = await session.execute(select(AvatarSpendRecord).where(AvatarSpendRecord.email == _key(email)))
    return [_entry(r) for r in rows.scalars()]


async def company_since(session: AsyncSession, start: datetime) -> list[LedgerEntry]:
    rows = await session.execute(select(AvatarSpendRecord).where(AvatarSpendRecord.created_at >= start))
    return [_entry(r) for r in rows.scalars()]


async def month_totals(session: AsyncSession, start: datetime) -> dict[str, float]:
    out: dict[str, float] = {}
    for e in await company_since(session, start):
        if e.status in COUNTED and e.unit:
            out[e.unit] = out.get(e.unit, 0.0) + e.estimate
    return out


async def create_record(session: AsyncSession, req: SpendRequest, decision: Decision, consent: str, now: datetime) -> AvatarSpendRecord:
    row = AvatarSpendRecord(
        id=str(uuid.uuid4()), email=_key(req.email), person_id=req.person_id, stage=req.stage, provider=decision.provider,
        unit=decision.unit, input_sha256=req.input_sha256, photo_sha256=req.photo_sha256, mode=req.mode,
        approved_by=req.approved_by, consent=consent, estimate=req.estimate, status="authorized" if decision.allowed else "denied",
        reason=[{"code": c, "message": m} for c, m in decision.failures] or None, created_at=now,
    )
    session.add(row)
    await session.commit()
    return row


async def settle(session: AsyncSession, record_id: str, outcome: str, actual: float | None, evidence: dict | None, now: datetime) -> AvatarSpendRecord | None:
    row = await session.get(AvatarSpendRecord, record_id)
    if row is None or row.status != "authorized":
        return None
    row.status, row.actual, row.evidence, row.settled_at = outcome, actual, evidence, now
    await session.commit()
    return row


async def records_for(session: AsyncSession, email: str) -> list[AvatarSpendRecord]:
    rows = await session.execute(select(AvatarSpendRecord).where(AvatarSpendRecord.email == _key(email)).order_by(AvatarSpendRecord.created_at))
    return list(rows.scalars())


async def upsert_run(session: AsyncSession, *, email: str, photo_sha256: str, person_id: str, stage: str, status: str,
                     artifact: dict | None, error: str | None, evidence: dict | None, now: datetime) -> AvatarGenerationRun:
    row = await session.get(AvatarGenerationRun, (_key(email), photo_sha256))
    if row is None:
        row = AvatarGenerationRun(email=_key(email), photo_sha256=photo_sha256, person_id=person_id, stage=stage, status=status,
                                  artifacts={}, error=None, evidence=None, updated_at=now)
        session.add(row)
    row.person_id, row.stage, row.status, row.error, row.updated_at = person_id, stage, status, error, now
    if evidence is not None:
        row.evidence = evidence
    if artifact:
        row.artifacts = {**(row.artifacts or {}), stage: artifact}
    await session.commit()
    return row


async def runs_for(session: AsyncSession, email: str) -> list[AvatarGenerationRun]:
    rows = await session.execute(select(AvatarGenerationRun).where(AvatarGenerationRun.email == _key(email)).order_by(AvatarGenerationRun.updated_at))
    return list(rows.scalars())
