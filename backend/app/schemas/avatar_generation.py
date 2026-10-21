from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SHA256 = r"^[0-9a-f]{64}$"
PERSON = r"^[a-z0-9-]{1,64}$"
_MAX_EVIDENCE = 8192


def _bounded(v: dict | None) -> dict | None:
    if v is not None and len(json.dumps(v, default=str)) > _MAX_EVIDENCE:
        raise ValueError(f"evidence larger than {_MAX_EVIDENCE} bytes — send the log tail and paths, not the logs")
    return v


class _M(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class ConsentIn(_M):
    """PUT by the employee themselves: no email field — the session says whose consent it is."""
    photo_sha256: str = Field(alias="photoSha256", pattern=SHA256)
    statement: Literal["self-photo-v1"]


class ConsentOut(_M):
    photo_sha256: str = Field(alias="photoSha256")
    statement: str
    attested_at: datetime = Field(alias="attestedAt")


class AuthorizeIn(_M):
    """The executor's request to spend on one paid stage for one employee."""
    email: str = Field(max_length=255)
    person_id: str = Field(alias="personId", pattern=PERSON)
    stage: str = Field(max_length=32)
    input_sha256: str = Field(alias="inputSha256", pattern=SHA256)
    photo_sha256: str = Field(alias="photoSha256", pattern=SHA256)
    estimate: float
    mode: Literal["auto", "manual"]
    approved_by: str | None = Field(default=None, alias="approvedBy", max_length=255)
    allow_reroll: bool = Field(default=False, alias="allowReroll")
    provider_balance: float | None = Field(default=None, alias="providerBalance")
    has_approved_character: bool = Field(default=False, alias="hasApprovedCharacter")
    consent_attested_by: str | None = Field(default=None, alias="consentAttestedBy", max_length=255)
    dry_run: bool = Field(default=False, alias="dryRun")


class Failure(_M):
    code: str
    message: str


class DecisionOut(_M):
    allowed: bool
    record_id: str | None = Field(default=None, alias="recordId")
    failures: list[Failure]
    provider: str | None = None
    unit: str | None = None


class SettleIn(_M):
    record_id: str = Field(alias="recordId", max_length=36)
    outcome: Literal["succeeded", "failed"]
    actual: float | None = None
    evidence: dict | None = None

    @field_validator("evidence")
    @classmethod
    def _bounded_evidence(cls, v: dict | None) -> dict | None:
        return _bounded(v)


class SpendRecordOut(_M):
    id: str
    person_id: str = Field(alias="personId")
    stage: str
    provider: str | None
    unit: str | None
    estimate: float
    actual: float | None
    status: str
    reason: list | None
    mode: str
    approved_by: str | None = Field(alias="approvedBy")
    consent: str
    photo_sha256: str = Field(alias="photoSha256")
    input_sha256: str = Field(alias="inputSha256")
    created_at: datetime = Field(alias="createdAt")
    settled_at: datetime | None = Field(alias="settledAt")


class Artifact(_M):
    sha256: str = Field(pattern=SHA256)
    path: str = Field(max_length=400)


class RunEventIn(_M):
    email: str = Field(max_length=255)
    person_id: str = Field(alias="personId", pattern=PERSON)
    photo_sha256: str = Field(alias="photoSha256", pattern=SHA256)
    stage: str = Field(max_length=32)
    status: str = Field(max_length=32)
    artifact: Artifact | None = None
    error: str | None = Field(default=None, max_length=500)
    evidence: dict | None = None

    @field_validator("evidence")
    @classmethod
    def _bounded_evidence(cls, v: dict | None) -> dict | None:
        return _bounded(v)


class RunOut(_M):
    person_id: str = Field(alias="personId")
    photo_sha256: str = Field(alias="photoSha256")
    stage: str
    status: str
    artifacts: dict
    error: str | None
    evidence: dict | None
    updated_at: datetime = Field(alias="updatedAt")


class MeOut(_M):
    autospend_enabled: bool = Field(alias="autospendEnabled")
    consents: list[ConsentOut]
    spend: list[SpendRecordOut]
    runs: list[RunOut]
    runs_this_month: int = Field(alias="runsThisMonth")
    max_runs_per_month: int = Field(alias="maxRunsPerMonth")


class BudgetOut(_M):
    autospend_enabled: bool = Field(alias="autospendEnabled")
    month: str
    spent: dict[str, float]
    budgets: dict[str, float]
    meshy_reserve_credits: float = Field(alias="meshyReserveCredits")
