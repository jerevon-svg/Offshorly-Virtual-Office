"""HumanBase avatar generation — THE PAID-STEP AUTHORITY (2026-10-13).

Pure decision logic, no I/O: given one spend request, the policy (settings), whether the employee consented for this
photo, and the ledger, decide whether a PAID generation stage may run. The router loads the ledger and records the
decision; the executor (HumanBase Studio today, a backend worker later) asks before it spends and settles afterwards.

EVERY CHECK RUNS and every failure is reported, so a dry run (preflight) shows the whole picture at once:

  approver_required      a manual request must name its human approver
  autospend_disabled     an automatic request needs AVATAR_AUTOSPEND_ENABLED (off everywhere until approved)
  unknown_stage          a stage this policy does not price
  estimate_out_of_range  the executor asked for more than one ordinary call of that stage costs
  not_eligible           the verified email's domain is not an eligible one
  has_character          the employee already has an approved character (regenerating it is an admin decision)
  no_consent             no consent on record for this photo (an admin attestation counts for a MANUAL request only)
  in_flight              an authorized, unsettled spend for this employee + stage exists (one paid job at a time)
  already_generated      this exact input already produced a paid result — reuse it, never pay twice
  retry_cap              paid attempts on this exact input reached the cap; a reroll needs a named approver + allow_reroll
  user_limit             distinct photos this month reached the per-employee cap
  budget_exhausted       this spend would exceed the company's monthly budget in its unit
  balance_unknown        a credit-metered provider's balance was not supplied (fail closed)
  low_balance            spending would leave the provider below its reserve
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

# stage -> (provider, unit, the most one ordinary call of it may cost)
PAID_STAGES: Mapping[str, tuple[str, str, float]] = {
    "illustrate": ("openai", "usd", 0.5),          # one gpt-image-1 1024x1024 edit (photo -> Offshorly portrait)
    "meshy": ("meshy", "meshy_credits", 40.0),     # one image-to-3D head (no remesh / rig / animation)
}
# ledger statuses that spent (or reserved) money; "denied" spent nothing
COUNTED = frozenset({"authorized", "succeeded", "failed"})
# an authorized spend never settled (the executor died) stops blocking new jobs after this — it still counts as spent
STALE_AFTER = timedelta(hours=6)


@dataclass(frozen=True)
class Policy:
    autospend_enabled: bool
    eligible_domains: tuple[str, ...]
    max_paid_attempts_per_stage: int
    max_runs_per_user_monthly: int
    budgets: Mapping[str, float]
    meshy_reserve_credits: float

    @classmethod
    def from_settings(cls, s) -> Policy:
        return cls(
            autospend_enabled=bool(s.AVATAR_AUTOSPEND_ENABLED),
            eligible_domains=tuple(d.strip().lower() for d in s.AVATAR_ELIGIBLE_DOMAINS.split(",") if d.strip()),
            max_paid_attempts_per_stage=max(1, int(s.AVATAR_MAX_PAID_ATTEMPTS_PER_STAGE)),
            max_runs_per_user_monthly=max(0, int(s.AVATAR_MAX_RUNS_PER_USER_MONTHLY)),
            budgets={"meshy_credits": float(s.AVATAR_BUDGET_MESHY_CREDITS_MONTHLY), "usd": float(s.AVATAR_BUDGET_USD_MONTHLY)},
            meshy_reserve_credits=float(s.AVATAR_MESHY_RESERVE_CREDITS),
        )


@dataclass(frozen=True)
class SpendRequest:
    email: str
    person_id: str
    stage: str
    input_sha256: str
    photo_sha256: str
    estimate: float
    mode: str  # "auto" | "manual"
    approved_by: str | None = None
    allow_reroll: bool = False
    provider_balance: float | None = None
    has_approved_character: bool = False
    consent_attested_by: str | None = None


@dataclass(frozen=True)
class LedgerEntry:
    email: str
    stage: str
    input_sha256: str
    photo_sha256: str
    status: str
    estimate: float
    unit: str
    created_at: datetime


@dataclass(frozen=True)
class Decision:
    allowed: bool
    failures: tuple[tuple[str, str], ...] = field(default_factory=tuple)
    provider: str | None = None
    unit: str | None = None

    @property
    def codes(self) -> list[str]:
        return [c for c, _ in self.failures]


def month_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def evaluate(
    req: SpendRequest,
    policy: Policy,
    *,
    consent_on_record: bool,
    user_history: Sequence[LedgerEntry],
    company_month: Sequence[LedgerEntry],
    now: datetime,
) -> Decision:
    fail: list[tuple[str, str]] = []
    email = req.email.strip().lower()
    manual = req.mode == "manual"
    priced = PAID_STAGES.get(req.stage)
    provider, unit, ceiling = priced if priced else (None, None, 0.0)

    if req.mode not in ("auto", "manual"):
        fail.append(("unknown_mode", f"mode must be auto or manual, not {req.mode!r}"))
    if manual and not (req.approved_by or "").strip():
        fail.append(("approver_required", "a manual spend must name the person who approved it"))
    if req.mode == "auto" and not policy.autospend_enabled:
        fail.append(("autospend_disabled", "automatic paid generation is switched off — an admin approves each paid step"))
    if not priced:
        fail.append(("unknown_stage", f"{req.stage!r} is not a paid stage this policy prices"))
    elif not (0 < req.estimate <= ceiling):
        fail.append(("estimate_out_of_range", f"{req.stage} estimate {req.estimate} is outside (0, {ceiling}] {unit}"))

    domain = email.rsplit("@", 1)[-1] if "@" in email else ""
    if domain not in policy.eligible_domains:
        fail.append(("not_eligible", f"{domain or 'this account'} is not an eligible domain"))
    if req.has_approved_character:
        fail.append(("has_character", "this employee already has an approved character — regenerating it is an admin decision"))
    if not (consent_on_record or (manual and (req.consent_attested_by or "").strip())):
        fail.append(("no_consent", "no consent on record for this photo"))

    mine = [e for e in user_history if e.email == email and e.status in COUNTED]
    same_stage = [e for e in mine if e.stage == req.stage]
    if any(e.status == "authorized" and now - e.created_at < STALE_AFTER for e in same_stage):
        fail.append(("in_flight", f"a {req.stage} generation for this employee is already running"))
    same_input = [e for e in same_stage if e.input_sha256 == req.input_sha256]
    reroll = manual and req.allow_reroll and bool((req.approved_by or "").strip())
    if any(e.status == "succeeded" for e in same_input) and not reroll:
        fail.append(("already_generated", f"this exact input already produced a paid {req.stage} result — reuse it"))
    if sum(1 for e in same_input if e.status == "failed") >= policy.max_paid_attempts_per_stage and not reroll:
        fail.append(("retry_cap", f"{req.stage} already had {policy.max_paid_attempts_per_stage} paid attempt(s) on this input — a reroll needs a named approver"))

    start = month_start(now)
    photos = {e.photo_sha256 for e in mine if e.created_at >= start and e.photo_sha256 != req.photo_sha256}
    if len(photos) >= policy.max_runs_per_user_monthly:
        fail.append(("user_limit", f"{len(photos)} photo(s) already generated this month (limit {policy.max_runs_per_user_monthly})"))

    if priced:
        spent = sum(e.estimate for e in company_month if e.status in COUNTED and e.unit == unit and e.created_at >= start)
        budget = float(policy.budgets.get(unit, 0.0))
        if spent + req.estimate > budget:
            fail.append(("budget_exhausted", f"{spent:g} + {req.estimate:g} {unit} would exceed this month's {budget:g}"))
        if unit == "meshy_credits":
            if req.provider_balance is None:
                fail.append(("balance_unknown", "the Meshy balance was not supplied"))
            elif req.provider_balance - req.estimate < policy.meshy_reserve_credits:
                fail.append(("low_balance", f"balance {req.provider_balance:g} − {req.estimate:g} would fall below the reserve {policy.meshy_reserve_credits:g}"))

    return Decision(allowed=not fail, failures=tuple(fail), provider=provider, unit=unit)
