from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# Global Notifications V1 wire shapes. camelCase aliases, matching every other panel API in this
# app (see schemas/progression.py). `navKind`/`navPayload` are deliberately open at the type
# level: the client switches on a kind it recognises and falls through to "mark read, do nothing"
# for anything it does not, so the server can add destinations without a client release.


def _as_utc(value: datetime | None) -> datetime | None:
    """Force an offset onto the wire. SQLite does not store timezones, so a DateTime(timezone=True)
    column read back from the dev/test database is NAIVE — it serializes without a `Z`, and
    `new Date("...")` in the browser then reads it as LOCAL time and shows a notification from
    "in 8 hours". The values are always written in UTC (see models/base.py), so stamping UTC on a
    naive read is a faithful normalisation, not a guess. Applied here, at the one wire boundary,
    so a pushed notification and a fetched one are identical strings on both engines.
    """
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class NotificationOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    type: str
    title: str
    body: str | None = None
    nav_kind: str | None = Field(default=None, alias="navKind")
    nav_payload: dict[str, Any] | None = Field(default=None, alias="navPayload")
    read_at: datetime | None = Field(default=None, alias="readAt")
    created_at: datetime = Field(alias="createdAt")

    @classmethod
    def from_dict(cls, row: dict[str, Any]) -> NotificationOut:
        return cls(
            id=row["id"],
            type=row["type"],
            title=row["title"],
            body=row.get("body"),
            nav_kind=row.get("nav_kind"),
            nav_payload=row.get("nav_payload"),
            read_at=_as_utc(row.get("read_at")),
            created_at=_as_utc(row["created_at"]),
        )


class NotificationListOut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    notifications: list[NotificationOut]
    # Counted over the whole table, not the returned window — see repositories/notifications.py.
    unread_count: int = Field(alias="unreadCount")


class UnreadOut(BaseModel):
    """Answer shape for both read endpoints: the client only ever needs the new badge value."""

    model_config = ConfigDict(populate_by_name=True)

    unread_count: int = Field(alias="unreadCount")
    updated: int = 0


def serialize_notification(row: dict[str, Any]) -> dict[str, Any]:
    """The realtime wire form — identical to what GET /notifications/me returns for the same
    row, so a pushed notification and a fetched one are the same object to the client."""
    return NotificationOut.from_dict(row).model_dump(by_alias=True, mode="json")
