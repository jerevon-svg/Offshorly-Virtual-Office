from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.repositories import attendance as attendance_repo

# Repository coverage for the server-authoritative attendance record — see
# app/models/attendance.py. Contract under test: no row == CHECKED_OUT; check-in/check-out are
# idempotent; a fresh check-in after a checkout starts a new session.

pytestmark = pytest.mark.asyncio

T0 = datetime(2026, 9, 4, 1, 0, tzinfo=timezone.utc)


async def test_no_row_reads_as_checked_out_with_null_timestamps(db_session):
    status = await attendance_repo.get_status(db_session, "  New@Example.com ")
    assert status == {
        "email": "new@example.com",
        "status": "CHECKED_OUT",
        "checked_in_at": None,
        "checked_out_at": None,
    }


async def test_check_in_creates_active_session(db_session):
    record = await attendance_repo.check_in(db_session, "A@Example.com", now=T0)
    assert record["email"] == "a@example.com"
    assert record["status"] == "CHECKED_IN"
    assert record["checked_in_at"] is not None
    assert record["checked_out_at"] is None


async def test_check_in_is_idempotent_and_keeps_original_start(db_session):
    first = await attendance_repo.check_in(db_session, "a@example.com", now=T0)
    second = await attendance_repo.check_in(db_session, "a@example.com", now=T0 + timedelta(hours=2))
    assert second["status"] == "CHECKED_IN"
    assert second["checked_in_at"] == first["checked_in_at"]


async def test_check_out_ends_session_and_is_idempotent(db_session):
    await attendance_repo.check_in(db_session, "a@example.com", now=T0)
    out = await attendance_repo.check_out(db_session, "a@example.com", now=T0 + timedelta(hours=8))
    assert out["status"] == "CHECKED_OUT"
    assert out["checked_in_at"] is not None
    assert out["checked_out_at"] is not None
    again = await attendance_repo.check_out(db_session, "a@example.com", now=T0 + timedelta(hours=9))
    assert again["checked_out_at"] == out["checked_out_at"]


async def test_check_out_without_row_records_checkout_only(db_session):
    out = await attendance_repo.check_out(db_session, "b@example.com", now=T0)
    assert out["status"] == "CHECKED_OUT"
    assert out["checked_in_at"] is None
    assert out["checked_out_at"] is not None


async def test_recheck_in_after_checkout_starts_new_session(db_session):
    await attendance_repo.check_in(db_session, "a@example.com", now=T0)
    await attendance_repo.check_out(db_session, "a@example.com", now=T0 + timedelta(hours=8))
    again = await attendance_repo.check_in(db_session, "a@example.com", now=T0 + timedelta(days=1))
    assert again["status"] == "CHECKED_IN"
    assert again["checked_out_at"] is None


async def test_list_checked_out_emails_excludes_active_and_never_checked_in(db_session):
    await attendance_repo.check_in(db_session, "active@example.com", now=T0)
    await attendance_repo.check_in(db_session, "gone@example.com", now=T0)
    await attendance_repo.check_out(db_session, "gone@example.com", now=T0 + timedelta(hours=1))
    await attendance_repo.check_out(db_session, "never@example.com", now=T0 + timedelta(hours=2))
    assert await attendance_repo.list_checked_out_emails(db_session) == ["gone@example.com", "never@example.com"]
