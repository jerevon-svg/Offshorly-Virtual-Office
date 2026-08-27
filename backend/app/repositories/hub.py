from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.hub import HubItem, HubItemState

# Company Hub V1 repository. Plain-dict returns, matching this codebase's house style (see
# app/repositories/requests.py's module docstring).

# Monotonic status ranking — a later call can only move a state FORWARD, never back. This is
# what makes "Refresh/reconnect must not reset that state" and "don't repeatedly block on an
# already-acknowledged required item" hold: e.g. re-showing the Hub and re-marking an item
# "seen" must not un-acknowledge it.
_STATUS_RANK = {"seen": 0, "dismissed": 1, "acknowledged": 2}

# Tag shared with app/scripts/seed_dev_hub_content.py (which imports this constant rather than
# defining its own, so the two can never drift) and app/routers/hub.py's dev-only demo-reset
# endpoint — identifies items that are dev/test mock content, never real company content.
DEV_SEED_TAG = "dev-seed-mock"


def _item_to_dict(item: HubItem) -> dict[str, Any]:
    return {
        "id": item.id,
        "type": item.type,
        "title": item.title,
        "description": item.description,
        "image_url": item.image_url,
        "start_at": item.start_at,
        "end_at": item.end_at,
        "priority": item.priority,
        "cta_label": item.cta_label,
        "cta_action": item.cta_action,
        "audience_email": item.audience_email,
        "target_employee_email": item.target_employee_email,
        "created_by": item.created_by,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _state_to_dict(state: HubItemState) -> dict[str, Any]:
    return {
        "id": state.id,
        "hub_item_id": state.hub_item_id,
        "employee_email": state.employee_email,
        "status": state.status,
        "acted_at": state.acted_at,
    }


async def create_item(
    session: AsyncSession,
    *,
    type: str,
    title: str,
    description: str,
    image_url: str | None = None,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    priority: str = "normal",
    cta_label: str | None = None,
    cta_action: str | None = None,
    audience_email: str | None = None,
    target_employee_email: str | None = None,
    created_by: str | None = None,
) -> dict[str, Any]:
    item = HubItem(
        type=type,
        title=title,
        description=description,
        image_url=image_url,
        start_at=start_at or datetime.now(timezone.utc),
        end_at=end_at,
        priority=priority,
        cta_label=cta_label,
        cta_action=cta_action,
        audience_email=audience_email.strip().lower() if audience_email else None,
        target_employee_email=(
            target_employee_email.strip().lower() if target_employee_email else None
        ),
        created_by=created_by,
    )
    session.add(item)
    await session.flush()
    await session.commit()
    return _item_to_dict(item)


async def get_item_by_id(session: AsyncSession, item_id: str) -> dict[str, Any] | None:
    result = await session.execute(select(HubItem).where(HubItem.id == item_id))
    item = result.scalar_one_or_none()
    return _item_to_dict(item) if item is not None else None


async def list_active_items_for(
    session: AsyncSession, email: str, *, now: datetime | None = None
) -> list[dict[str, Any]]:
    """Items currently in [start_at, end_at) whose audience is either everyone (audience_email
    IS NULL) or this employee. Ordered required-first (most likely to gate Enter Office), then
    important, then normal, newest-created first within a priority tier."""
    self_email = email.strip().lower()
    moment = now or datetime.now(timezone.utc)

    priority_order = {"required": 0, "important": 1, "normal": 2}
    result = await session.execute(
        select(HubItem).where(
            HubItem.start_at <= moment,
            or_(HubItem.end_at.is_(None), HubItem.end_at >= moment),
            or_(HubItem.audience_email.is_(None), HubItem.audience_email == self_email),
        )
    )
    items = result.scalars().all()
    items.sort(key=lambda i: (priority_order.get(i.priority, 3), -i.created_at.timestamp()))
    return [_item_to_dict(i) for i in items]


async def get_states_for(
    session: AsyncSession, email: str, item_ids: list[str]
) -> dict[str, dict[str, Any]]:
    if not item_ids:
        return {}
    self_email = email.strip().lower()
    result = await session.execute(
        select(HubItemState).where(
            HubItemState.employee_email == self_email,
            HubItemState.hub_item_id.in_(item_ids),
        )
    )
    return {s.hub_item_id: _state_to_dict(s) for s in result.scalars().all()}


async def _get_state_row(
    session: AsyncSession, *, hub_item_id: str, employee_email: str
) -> HubItemState | None:
    result = await session.execute(
        select(HubItemState).where(
            HubItemState.hub_item_id == hub_item_id,
            HubItemState.employee_email == employee_email,
        )
    )
    return result.scalar_one_or_none()


async def upsert_state(
    session: AsyncSession,
    *,
    hub_item_id: str,
    employee_email: str,
    status: str,
) -> dict[str, Any]:
    """Race-tolerant monotonic upsert (see _STATUS_RANK). A concurrent duplicate insert (two
    tabs marking "seen" at once) is resolved by re-reading and applying the same rank rule, same
    idempotent-retry shape as requests.py's create_request."""
    if status not in _STATUS_RANK:
        raise ValueError(f"Invalid hub item status: {status!r}")
    self_email = employee_email.strip().lower()

    row = await _get_state_row(session, hub_item_id=hub_item_id, employee_email=self_email)
    if row is None:
        try:
            async with session.begin_nested():
                row = HubItemState(
                    hub_item_id=hub_item_id, employee_email=self_email, status=status
                )
                session.add(row)
                await session.flush()
        except IntegrityError:
            # Lost the insert race to a concurrent request for this same (item, employee) —
            # same idempotent-retry shape as requests.py's create_request. Fall through to the
            # update branch below against the row the other request just created.
            row = await _get_state_row(session, hub_item_id=hub_item_id, employee_email=self_email)
            assert row is not None
            if _STATUS_RANK[status] > _STATUS_RANK[row.status]:
                row.status = status
    elif _STATUS_RANK[status] > _STATUS_RANK[row.status]:
        row.status = status

    await session.commit()
    row = await _get_state_row(session, hub_item_id=hub_item_id, employee_email=self_email)
    assert row is not None
    return _state_to_dict(row)


async def reset_dev_state_for_employee(session: AsyncSession, *, employee_email: str) -> int:
    """Dev-only demo reset (see routers/hub.py's settings.is_development gate — this function
    itself does not check it, so it must never be reachable from a non-dev-gated caller):
    deletes THIS employee's seen/dismissed/acknowledged/acted state on dev-seeded ([DEV]) Hub
    items only, so a required item can be re-demoed without waiting for a fresh item.

    Deliberately narrow on both axes: only rows tagged HubItem.created_by == DEV_SEED_TAG are
    touched (never a real Hub item), and only rows for `employee_email` are deleted (every
    other employee's state on those same dev items is untouched). Never deletes HubItem rows
    themselves — only the per-employee HubItemState rows. Returns the number of rows removed."""
    self_email = employee_email.strip().lower()
    result = await session.execute(
        delete(HubItemState).where(
            HubItemState.employee_email == self_email,
            HubItemState.hub_item_id.in_(select(HubItem.id).where(HubItem.created_by == DEV_SEED_TAG)),
        )
    )
    await session.commit()
    return result.rowcount


async def record_action(
    session: AsyncSession, *, hub_item_id: str, employee_email: str
) -> dict[str, Any]:
    """Persists that the employee performed the item's CTA action (Wish Happy Birthday /
    Congratulate / Read More / Answer Survey / See What's New). Does not by itself change
    status — dismiss/acknowledge stay separate calls — but ensures a state row exists (defaults
    to "seen") so acted_at has somewhere to live."""
    self_email = employee_email.strip().lower()
    now = datetime.now(timezone.utc)

    row = await _get_state_row(session, hub_item_id=hub_item_id, employee_email=self_email)
    if row is None:
        row = HubItemState(hub_item_id=hub_item_id, employee_email=self_email, status="seen", acted_at=now)
        session.add(row)
    else:
        row.acted_at = now
    await session.flush()
    await session.commit()

    row = await _get_state_row(session, hub_item_id=hub_item_id, employee_email=self_email)
    assert row is not None
    return _state_to_dict(row)
