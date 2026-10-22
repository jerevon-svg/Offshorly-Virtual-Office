from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

from app.services.avatar_generation_policy import LedgerEntry, Policy, SpendRequest, evaluate

# THE PAID-STEP AUTHORITY, rule by rule. Every check reports itself; a request is allowed only when none fails.

NOW = datetime(2026, 10, 13, 9, 0, tzinfo=timezone.utc)
P = Policy(autospend_enabled=False, eligible_domains=("offshorly.com",), max_paid_attempts_per_stage=1, max_runs_per_user_monthly=2,
           budgets={"meshy_credits": 150.0, "usd": 10.0}, meshy_reserve_credits=100.0)
A, B, C = "a" * 64, "b" * 64, "c" * 64
MESHY = SpendRequest(email="new.hire@offshorly.com", person_id="newhire", stage="meshy", input_sha256=A, photo_sha256=B, estimate=30,
                     mode="manual", approved_by="Bon", provider_balance=587)


def entry(status: str, *, stage="meshy", input_sha256=A, photo_sha256=B, estimate=30.0, unit="meshy_credits", email="new.hire@offshorly.com", ago=timedelta(hours=1)):
    return LedgerEntry(email=email, stage=stage, input_sha256=input_sha256, photo_sha256=photo_sha256, status=status, estimate=estimate, unit=unit, created_at=NOW - ago)


def codes(req=MESHY, policy=P, consent=True, history=(), company=()):
    return evaluate(req, policy, consent_on_record=consent, user_history=list(history), company_month=list(company), now=NOW).codes


def test_a_manual_approval_with_consent_balance_and_budget_is_allowed():
    d = evaluate(MESHY, P, consent_on_record=True, user_history=[], company_month=[], now=NOW)
    assert d.allowed and d.provider == "meshy" and d.unit == "meshy_credits"


def test_auto_spend_is_off_by_default_and_names_itself():
    assert codes(replace(MESHY, mode="auto", approved_by=None)) == ["autospend_disabled"]
    assert codes(replace(MESHY, mode="auto", approved_by=None), policy=replace(P, autospend_enabled=True)) == []


def test_a_manual_spend_needs_a_named_approver():
    assert "approver_required" in codes(replace(MESHY, approved_by="  "))


def test_unknown_stages_and_oversized_estimates_are_refused():
    assert "unknown_stage" in codes(replace(MESHY, stage="rig"))
    assert "estimate_out_of_range" in codes(replace(MESHY, estimate=55))          # remesh + rig + animation, not one head
    assert "estimate_out_of_range" in codes(replace(MESHY, stage="illustrate", estimate=2.0))


def test_eligibility_character_and_consent():
    assert "not_eligible" in codes(replace(MESHY, email="someone@gmail.com"))
    assert "has_character" in codes(replace(MESHY, has_approved_character=True))
    assert "no_consent" in codes(consent=False)
    assert "no_consent" not in codes(replace(MESHY, consent_attested_by="Bon"), consent=False)                     # manual: an admin may attest
    assert "no_consent" in codes(replace(MESHY, mode="auto", approved_by=None, consent_attested_by="Bon"), policy=replace(P, autospend_enabled=True), consent=False)


def test_one_paid_job_at_a_time_and_a_stale_reservation_stops_blocking():
    assert "in_flight" in codes(history=[entry("authorized", input_sha256=C)])
    assert "in_flight" not in codes(history=[entry("authorized", input_sha256=C, ago=timedelta(hours=7))])


def test_never_pay_twice_for_the_same_input_and_one_paid_attempt_per_input():
    assert "already_generated" in codes(history=[entry("succeeded")])
    assert "retry_cap" in codes(history=[entry("failed")])
    reroll = replace(MESHY, allow_reroll=True)
    assert codes(reroll, history=[entry("failed")]) == []                                                        # a named approver may reroll
    assert "retry_cap" in codes(replace(reroll, mode="auto", approved_by=None), policy=replace(P, autospend_enabled=True), history=[entry("failed")])
    assert "retry_cap" not in codes(history=[entry("failed", input_sha256=C)])                                   # a different input is a new attempt


def test_per_employee_monthly_photo_limit():
    two_photos = [entry("succeeded", stage="illustrate", unit="usd", estimate=0.2, photo_sha256=p, input_sha256=p) for p in ("1" * 64, "2" * 64)]
    assert "user_limit" in codes(history=two_photos)
    assert "user_limit" not in codes(history=[replace(e, created_at=NOW - timedelta(days=40)) for e in two_photos])
    assert "user_limit" not in codes(history=[entry("denied", photo_sha256=p) for p in ("1" * 64, "2" * 64)])   # a refusal spent nothing


def test_company_budget_counts_everyone_and_only_spend():
    spent = [entry("succeeded", email=f"p{i}@offshorly.com", photo_sha256=str(i) * 64) for i in range(4)]       # 120 credits
    assert "budget_exhausted" in codes(company=spent + [entry("authorized", email="x@offshorly.com", photo_sha256=C)])
    assert "budget_exhausted" not in codes(company=spent + [entry("denied", email="x@offshorly.com", photo_sha256=C)])
    assert "budget_exhausted" not in codes(company=[replace(e, created_at=NOW - timedelta(days=40)) for e in spent * 2])


def test_low_balance_and_unknown_balance_fail_closed():
    assert "balance_unknown" in codes(replace(MESHY, provider_balance=None))
    assert "low_balance" in codes(replace(MESHY, provider_balance=125))       # 125 - 30 < 100
    assert codes(replace(MESHY, provider_balance=130)) == []
    usd = replace(MESHY, stage="illustrate", estimate=0.2, provider_balance=None)
    assert codes(usd) == []                                                    # no balance API for OpenAI: the USD budget is the cap


def test_every_failure_is_reported_at_once():
    bad = replace(MESHY, mode="auto", approved_by=None, email="x@gmail.com", provider_balance=None)
    assert codes(bad, consent=False) == ["autospend_disabled", "not_eligible", "no_consent", "balance_unknown"]
