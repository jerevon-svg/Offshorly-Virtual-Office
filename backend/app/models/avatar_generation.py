from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AvatarGenerationConsent(Base):
    """An employee's own consent that THIS photo (by hash) is of them and may be used to generate their character.

    Written only by the verified employee themselves (routers/avatar_generation.py derives the email from the session),
    one row per (employee, photo). Automatic paid generation requires it; a manual approval may instead carry a named
    admin's attestation, recorded on the spend record."""

    __tablename__ = "avatar_generation_consents"

    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    photo_sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    statement: Mapped[str] = mapped_column(String(32), nullable=False)
    attested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AvatarSpendRecord(Base):
    """THE SPENDING LEDGER: one row per paid-stage authorization request — granted ("authorized", then "succeeded" /
    "failed" when the executor settles it) or refused ("denied", with every failing check). Budgets, duplicate and retry
    rules are all computed from these rows, so the ledger is the policy's memory and the audit trail at once."""

    __tablename__ = "avatar_spend_records"
    __table_args__ = (Index("ix_avatar_spend_records_email_stage", "email", "stage"), Index("ix_avatar_spend_records_created_at", "created_at"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    person_id: Mapped[str] = mapped_column(String(64), nullable=False)
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(16), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    input_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    photo_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    mode: Mapped[str] = mapped_column(String(8), nullable=False)
    approved_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    consent: Mapped[str] = mapped_column(String(255), nullable=False)
    estimate: Mapped[float] = mapped_column(Float, nullable=False)
    actual: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[list | None] = mapped_column(JSON, nullable=True)
    evidence: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AvatarGenerationRun(Base):
    """ONE GENERATION RUN per (employee, photo): where it is, how it ended, and which artifact each stage produced (by
    hash) — the backend's record of job ownership and artifact association, reported by the executor. The executor's
    files stay where they are; this table is the account-bound index of them."""

    __tablename__ = "avatar_generation_runs"

    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    photo_sha256: Mapped[str] = mapped_column(String(64), primary_key=True)
    person_id: Mapped[str] = mapped_column(String(64), nullable=False)
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    artifacts: Mapped[dict] = mapped_column(JSON, nullable=False)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    evidence: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
