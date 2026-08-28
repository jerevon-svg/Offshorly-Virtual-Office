from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.repositories import position as position_repo

# Repository-layer coverage for the durable stable-position upsert — see
# app/repositories/position.py's docstring for why this is a single atomic
# INSERT ... ON CONFLICT DO UPDATE rather than session.get()-then-add/setattr, and why the
# update is additionally guarded to never regress a higher stored revision.

pytestmark = pytest.mark.asyncio


def _now():
    return datetime.now(timezone.utc)


async def test_upsert_stable_inserts_new_row(db_session):
    await position_repo.upsert_stable(
        db_session,
        email="A@Example.com",
        x=1.0,
        y=2.0,
        facing="front",
        state="standing",
        seat_key=None,
        room_id=None,
        revision=1,
        updated_at=_now(),
    )

    rows = await position_repo.list_all(db_session)
    assert len(rows) == 1
    assert rows[0]["email"] == "a@example.com"
    assert rows[0]["revision"] == 1


async def test_upsert_stable_updates_existing_row_with_higher_revision(db_session):
    await position_repo.upsert_stable(
        db_session,
        email="a@example.com",
        x=1.0,
        y=2.0,
        facing="front",
        state="standing",
        seat_key=None,
        room_id=None,
        revision=1,
        updated_at=_now(),
    )

    await position_repo.upsert_stable(
        db_session,
        email="a@example.com",
        x=10.0,
        y=20.0,
        facing="right",
        state="sitting",
        seat_key="desk-1",
        room_id="design-team",
        revision=2,
        updated_at=_now(),
    )

    rows = await position_repo.list_all(db_session)
    assert len(rows) == 1
    assert rows[0]["x"] == 10.0
    assert rows[0]["state"] == "sitting"
    assert rows[0]["revision"] == 2


async def test_upsert_stable_with_lower_revision_does_not_overwrite_stored_row(db_session):
    """Guards against an out-of-order/older persist (lower revision than what's already stored)
    regressing the row — e.g. two concurrent walk_arrived persists for the same email racing,
    where the higher-revision one commits first."""
    await position_repo.upsert_stable(
        db_session,
        email="a@example.com",
        x=10.0,
        y=20.0,
        facing="right",
        state="sitting",
        seat_key="desk-1",
        room_id="design-team",
        revision=5,
        updated_at=_now(),
    )

    await position_repo.upsert_stable(
        db_session,
        email="a@example.com",
        x=999.0,
        y=999.0,
        facing="left",
        state="standing",
        seat_key=None,
        room_id=None,
        revision=2,  # lower than the stored revision=5
        updated_at=_now(),
    )

    rows = await position_repo.list_all(db_session)
    assert len(rows) == 1
    # stale/lower-revision write must be a no-op — the higher-revision row is preserved
    assert rows[0]["x"] == 10.0
    assert rows[0]["y"] == 20.0
    assert rows[0]["state"] == "sitting"
    assert rows[0]["seat_key"] == "desk-1"
    assert rows[0]["revision"] == 5


async def test_upsert_stable_with_equal_revision_does_not_overwrite_stored_row(db_session):
    await position_repo.upsert_stable(
        db_session,
        email="a@example.com",
        x=10.0,
        y=20.0,
        facing="right",
        state="sitting",
        seat_key="desk-1",
        room_id="design-team",
        revision=5,
        updated_at=_now(),
    )

    await position_repo.upsert_stable(
        db_session,
        email="a@example.com",
        x=999.0,
        y=999.0,
        facing="left",
        state="standing",
        seat_key=None,
        room_id=None,
        revision=5,  # equal revision — the guard is strictly `<`, so this must also no-op
        updated_at=_now(),
    )

    rows = await position_repo.list_all(db_session)
    assert rows[0]["x"] == 10.0
    assert rows[0]["revision"] == 5
