from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.repositories import hub as hub_repo

# Repository-layer coverage for Company Hub V1 — see backend/app/repositories/hub.py.

pytestmark = pytest.mark.asyncio


async def _seed_item(db_session, **overrides):
    defaults = dict(
        type="announcement",
        title="Test item",
        description="Test description",
        priority="normal",
    )
    defaults.update(overrides)
    return await hub_repo.create_item(db_session, **defaults)


async def test_list_active_items_excludes_items_outside_date_window(db_session):
    now = datetime.now(timezone.utc)
    active = await _seed_item(db_session, title="Active")
    await _seed_item(
        db_session, title="Not started yet", start_at=now + timedelta(days=1)
    )
    await _seed_item(
        db_session, title="Already ended", end_at=now - timedelta(days=1)
    )

    items = await hub_repo.list_active_items_for(db_session, "a@example.com")

    assert [i["id"] for i in items] == [active["id"]]


async def test_list_active_items_respects_audience(db_session):
    everyone = await _seed_item(db_session, title="Everyone")
    targeted = await _seed_item(
        db_session, title="Just Bob", audience_email="Bob@Example.com"
    )

    for_bob = await hub_repo.list_active_items_for(db_session, "bob@example.com")
    for_alice = await hub_repo.list_active_items_for(db_session, "alice@example.com")

    assert {i["id"] for i in for_bob} == {everyone["id"], targeted["id"]}
    assert {i["id"] for i in for_alice} == {everyone["id"]}


async def test_list_active_items_orders_required_first(db_session):
    await _seed_item(db_session, title="Normal", priority="normal")
    required = await _seed_item(db_session, title="Required", priority="required")
    await _seed_item(db_session, title="Important", priority="important")

    items = await hub_repo.list_active_items_for(db_session, "a@example.com")

    assert items[0]["id"] == required["id"]


async def test_upsert_state_does_not_downgrade_acknowledged_to_seen(db_session):
    item = await _seed_item(db_session, priority="required")

    await hub_repo.upsert_state(
        db_session, hub_item_id=item["id"], employee_email="a@example.com", status="acknowledged"
    )
    result = await hub_repo.upsert_state(
        db_session, hub_item_id=item["id"], employee_email="a@example.com", status="seen"
    )

    assert result["status"] == "acknowledged"


async def test_upsert_state_upgrades_seen_to_dismissed(db_session):
    item = await _seed_item(db_session)

    await hub_repo.upsert_state(
        db_session, hub_item_id=item["id"], employee_email="a@example.com", status="seen"
    )
    result = await hub_repo.upsert_state(
        db_session, hub_item_id=item["id"], employee_email="a@example.com", status="dismissed"
    )

    assert result["status"] == "dismissed"


async def test_states_are_independent_per_employee(db_session):
    item = await _seed_item(db_session, priority="required")

    await hub_repo.upsert_state(
        db_session, hub_item_id=item["id"], employee_email="a@example.com", status="acknowledged"
    )

    states = await hub_repo.get_states_for(db_session, "b@example.com", [item["id"]])

    assert states == {}


async def test_record_action_persists_acted_at_without_forcing_status(db_session):
    item = await _seed_item(db_session, type="birthday", priority="normal")

    result = await hub_repo.record_action(
        db_session, hub_item_id=item["id"], employee_email="a@example.com"
    )

    assert result["acted_at"] is not None
    assert result["status"] == "seen"


async def test_reset_dev_state_clears_only_dev_tagged_items_for_the_caller(db_session):
    dev_item = await _seed_item(
        db_session, priority="required", created_by=hub_repo.DEV_SEED_TAG
    )
    real_item = await _seed_item(db_session, priority="required")

    await hub_repo.upsert_state(
        db_session, hub_item_id=dev_item["id"], employee_email="a@example.com", status="acknowledged"
    )
    await hub_repo.upsert_state(
        db_session, hub_item_id=real_item["id"], employee_email="a@example.com", status="acknowledged"
    )
    await hub_repo.upsert_state(
        db_session, hub_item_id=dev_item["id"], employee_email="b@example.com", status="acknowledged"
    )

    reset_count = await hub_repo.reset_dev_state_for_employee(db_session, employee_email="A@Example.com")

    assert reset_count == 1
    # a's dev-item state is gone (back to "unseen" from the API's point of view)...
    assert await hub_repo.get_states_for(db_session, "a@example.com", [dev_item["id"]]) == {}
    # ...but a's state on the REAL item survives...
    real_states = await hub_repo.get_states_for(db_session, "a@example.com", [real_item["id"]])
    assert real_states[real_item["id"]]["status"] == "acknowledged"
    # ...and b's state on the same dev item is untouched.
    b_states = await hub_repo.get_states_for(db_session, "b@example.com", [dev_item["id"]])
    assert b_states[dev_item["id"]]["status"] == "acknowledged"


async def test_reset_dev_state_never_deletes_hub_items(db_session):
    dev_item = await _seed_item(db_session, created_by=hub_repo.DEV_SEED_TAG)
    await hub_repo.upsert_state(
        db_session, hub_item_id=dev_item["id"], employee_email="a@example.com", status="acknowledged"
    )

    await hub_repo.reset_dev_state_for_employee(db_session, employee_email="a@example.com")

    assert await hub_repo.get_item_by_id(db_session, dev_item["id"]) is not None
