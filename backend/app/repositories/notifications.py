from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification

# Global Notifications V1 repository. Plain-dict returns, matching this codebase's house style
# (see app/repositories/requests.py's module docstring). Every write to `notifications` goes
# through here, and every caller of this module goes through services/notifications.py — feature
# code never reaches either layer directly.

# Panel default. Kept small on purpose: the bell is a "what happened recently" surface, not an
# archive, and the unread COUNT is a separate aggregate so it stays exact past this window.
DEFAULT_LIMIT = 30
MAX_LIMIT = 100


def _to_dict(row: Notification) -> dict[str, Any]:
    return {
        "id": row.id,
        "recipient_email": row.recipient_email,
        "type": row.type,
        "dedupe_key": row.dedupe_key,
        "title": row.title,
        "body": row.body,
        "nav_kind": row.nav_kind,
        "nav_payload": row.nav_payload,
        "read_at": row.read_at,
        "created_at": row.created_at,
    }


async def create(
    session: AsyncSession,
    *,
    recipient_email: str,
    type: str,
    dedupe_key: str,
    title: str,
    body: str | None = None,
    nav_kind: str | None = None,
    nav_payload: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """INSERT one notification. Raises IntegrityError on a duplicate (recipient, dedupe_key) —
    the service layer wraps this in a SAVEPOINT and treats the collision as "already told
    them", so a duplicate can never roll back the caller's own writes."""
    row = Notification(
        recipient_email=recipient_email,
        type=type,
        dedupe_key=dedupe_key,
        title=title,
        body=body,
        nav_kind=nav_kind,
        nav_payload=nav_payload,
        created_at=now or datetime.now(timezone.utc),
    )
    session.add(row)
    await session.flush()
    return _to_dict(row)


async def list_for_recipient(
    session: AsyncSession, *, recipient_email: str, limit: int = DEFAULT_LIMIT
) -> list[dict[str, Any]]:
    """Newest first — the panel's only ordering. Ties break on id so the order is total and a
    refresh never shuffles two notifications written in the same millisecond."""
    capped = max(1, min(limit, MAX_LIMIT))
    stmt = (
        select(Notification)
        .where(Notification.recipient_email == recipient_email)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(capped)
    )
    return [_to_dict(row) for row in (await session.execute(stmt)).scalars().all()]


async def unread_count(session: AsyncSession, *, recipient_email: str) -> int:
    """Counted over the WHOLE table, not the listed window, so the badge is never capped by the
    panel's page size."""
    stmt = select(func.count()).select_from(Notification).where(
        Notification.recipient_email == recipient_email, Notification.read_at.is_(None)
    )
    return int((await session.execute(stmt)).scalar_one() or 0)


async def mark_read(
    session: AsyncSession, *, notification_id: str, recipient_email: str, now: datetime | None = None
) -> bool:
    """Mark ONE notification read. Scoped by recipient in the WHERE clause, so a caller can
    never mark somebody else's notification read (and gets the same answer as for a missing id
    rather than learning it exists). Already-read rows keep their original read_at — returns
    False, which the router treats as success (idempotent)."""
    stmt = (
        update(Notification)
        .where(
            Notification.id == notification_id,
            Notification.recipient_email == recipient_email,
            Notification.read_at.is_(None),
        )
        .values(read_at=now or datetime.now(timezone.utc))
    )
    return int((await session.execute(stmt)).rowcount or 0) > 0


async def mark_all_read(session: AsyncSession, *, recipient_email: str, now: datetime | None = None) -> int:
    """Mark every unread notification of this recipient read; returns how many changed."""
    stmt = (
        update(Notification)
        .where(Notification.recipient_email == recipient_email, Notification.read_at.is_(None))
        .values(read_at=now or datetime.now(timezone.utc))
    )
    return int((await session.execute(stmt)).rowcount or 0)
