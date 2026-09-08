from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_email
from app.database import get_db
from app.repositories import notifications as notifications_repo
from app.schemas.notification import NotificationListOut, NotificationOut, UnreadOut

# Global Notifications V1 REST layer. SELF-SCOPED BY CONSTRUCTION, like /quests/me and
# /progression/me: the recipient is always the bearer identity, so there is no path or body
# parameter through which one person could read or clear another's notifications. Notifications
# are never CREATED from the client — every one is written server-side from the authoritative
# action (see services/notifications.py).

router = APIRouter(tags=["notifications"])


@router.get("/notifications/me", response_model=NotificationListOut, response_model_by_alias=True)
async def list_my_notifications(
    limit: int = Query(default=notifications_repo.DEFAULT_LIMIT, ge=1, le=notifications_repo.MAX_LIMIT),
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> NotificationListOut:
    """Newest first, plus the exact unread count (counted over everything, not this window).
    This is what makes the bell survive a refresh or a reconnect: the server holds the state
    and the client re-asks on mount, on tab focus and on socket reconnect."""
    recipient = email.strip().lower()
    rows = await notifications_repo.list_for_recipient(db, recipient_email=recipient, limit=limit)
    unread = await notifications_repo.unread_count(db, recipient_email=recipient)
    return NotificationListOut(
        notifications=[NotificationOut.from_dict(row) for row in rows], unread_count=unread
    )


@router.post("/notifications/{notification_id}/read", response_model=UnreadOut, response_model_by_alias=True)
async def mark_notification_read(
    notification_id: str,
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> UnreadOut:
    """Idempotent, and deliberately NOT a 404 for an unknown id: a notification the caller does
    not own and a notification that does not exist are the same answer, so this endpoint leaks
    nothing. The client calls it on every notification click, including clicks whose
    destination it cannot open."""
    recipient = email.strip().lower()
    changed = await notifications_repo.mark_read(db, notification_id=notification_id, recipient_email=recipient)
    unread = await notifications_repo.unread_count(db, recipient_email=recipient)
    return UnreadOut(unread_count=unread, updated=1 if changed else 0)


@router.post("/notifications/read-all", response_model=UnreadOut, response_model_by_alias=True)
async def mark_all_notifications_read(
    email: str = Depends(get_current_email),
    db: AsyncSession = Depends(get_db),
) -> UnreadOut:
    recipient = email.strip().lower()
    updated = await notifications_repo.mark_all_read(db, recipient_email=recipient)
    unread = await notifications_repo.unread_count(db, recipient_email=recipient)
    return UnreadOut(unread_count=unread, updated=updated)
