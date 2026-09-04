from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.schemas.chat import to_iso_z

AttendanceStatus = Literal["CHECKED_IN", "CHECKED_OUT"]


class AttendanceOut(BaseModel):
    """Wire shape for GET /attendance/me and both POSTs. Contract: a missing row is reported as
    CHECKED_OUT with null timestamps — the client never needs to distinguish "never checked in"
    from "checked out"."""

    model_config = ConfigDict(populate_by_name=True)

    email: str
    status: AttendanceStatus
    checked_in_at: datetime | None = Field(alias="checkedInAt")
    checked_out_at: datetime | None = Field(alias="checkedOutAt")

    @field_serializer("checked_in_at", "checked_out_at")
    def _ser_dt(self, value: datetime | None) -> str | None:
        return to_iso_z(value) if value is not None else None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AttendanceOut":
        return cls(
            email=data["email"],
            status=data["status"],
            checked_in_at=data["checked_in_at"],
            checked_out_at=data["checked_out_at"],
        )
